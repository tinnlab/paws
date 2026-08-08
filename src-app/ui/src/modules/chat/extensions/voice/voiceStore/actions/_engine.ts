import { message } from '@ziee/kit'
import { ApiClient } from '@/api-client'
import { Permissions } from '@/api-client/permissions'
import { hasPermissionNow } from '@/core/permissions'
import { paneRegistry } from '@/modules/chat/core/stores/chatBridge'
import {
  acquireRecordingLock,
  releaseRecordingLock,
} from '../../voiceRecordingLock'
import { recordedBlobToWav16k } from '../../audio/wav'
import {
  type ComposerSpan,
  insertTranscript,
  isSuperseded,
  micErrorMessage,
  normalizeInterimTranscript,
  relocateSpan,
  resolveLivePref,
  restoreSpan,
  shouldRunInterim,
  spliceTranscript,
} from '../../voiceLogic'
import type { VoiceStoreGet, VoiceStoreSet } from '../state'
import { Chat } from '@/modules/chat/core/stores/chatBridge'

/**
 * The voice-dictation state machine — the entire former `Voice.store.ts` action
 * body, relocated VERBATIM. The 5 public actions share per-instance closures
 * (errorRevertTimer, fail, revertToIdleSoon, runInterimTick) + module-scope
 * imperative resources, so they cannot be split into independent per-file
 * factories; instead the engine is built ONCE per store instance (memoized by
 * the stable `get` identity below) and each `actions/<name>.ts` thin-delegates
 * to it. This keeps the delicate supersession-token / recording-lock / per-pane
 * error-revert invariants byte-identical.
 */

// ── Module-scope imperative resources (not reactive / not serializable) ──────
let mediaRecorder: MediaRecorder | null = null
let mediaStream: MediaStream | null = null
let chunks: Blob[] = []
let elapsedTimer: ReturnType<typeof setInterval> | null = null
let stageTimer: ReturnType<typeof setTimeout> | null = null
// NOTE: `errorRevertTimer` is deliberately NOT module-scope — see the per-instance
// declaration inside the engine. The other timers/recorder above ARE shared because
// the exclusive recording lock guarantees at most one pane is in the recording flow
// at a time; but TWO panes can sit in the post-fail 'error' window simultaneously
// (pane A fails → releases the lock → pane B records → fails), so a shared revert
// timer would let pane B's fail cancel pane A's error→idle auto-revert.
let requestTimeout: ReturnType<typeof setTimeout> | null = null
/** Self-rescheduling interim (live-caption) decode timer; null when not looping. */
let interimTimer: ReturnType<typeof setTimeout> | null = null
let recordStartedAt = 0
/**
 * In-progress latch for `stopRecording`'s finalization window. `status` stays
 * `'recording'` and `mediaRecorder` stays non-null until the onstop promise
 * resolves, so without this a second stop dispatched in that sub-millisecond gap
 * (e.g. the max-clip auto-stop timer racing a user Stop click) would re-enter.
 */
let finalizing = false
/**
 * Monotonic token guarding the async getUserMedia await. Bumped whenever a
 * pending permission request must be abandoned (cancel / timeout / unmount) so
 * a late-resolving prompt discards its stream instead of latching a mic the
 * user already backed out of. See startRecording / cancelRecording.
 */
let requestGeneration = 0

/** getUserMedia can hang forever on an unanswered permission prompt; escape it. */
const GET_USER_MEDIA_TIMEOUT_MS = 15000

/** Per-device "Live captions" preference (opt-out to batch). */
const LIVE_CAPTIONS_KEY = 'ziee.voice.liveCaptions'
/** Clamp the admin cadence to the same bounds the backend validates (300..=10000). */
function clampInterval(ms: number | undefined): number {
  return Math.min(10_000, Math.max(300, Math.round(ms ?? 1000)))
}
/** Read the stored per-device live-captions pref (null when unset / storage blocked). */
function storedLivePref(): string | null {
  try {
    return typeof localStorage !== 'undefined'
      ? localStorage.getItem(LIVE_CAPTIONS_KEY)
      : null
  } catch {
    return null
  }
}

function stopStream(): void {
  if (mediaStream) {
    for (const track of mediaStream.getTracks()) track.stop()
    mediaStream = null
  }
  mediaRecorder = null
}

function clearTimers(): void {
  if (elapsedTimer !== null) {
    clearInterval(elapsedTimer)
    elapsedTimer = null
  }
  if (stageTimer !== null) {
    clearTimeout(stageTimer)
    stageTimer = null
  }
  if (requestTimeout !== null) {
    clearTimeout(requestTimeout)
    requestTimeout = null
  }
  if (interimTimer !== null) {
    clearTimeout(interimTimer)
    interimTimer = null
  }
}

/** The composer-access surface this engine needs off a pane's TextStore. */
interface ComposerAccess {
  getText(): string
  setText(t: string): void
  getSelection(): ComposerSpan | null
  applyEdit(text: string, start: number, end?: number): void
  focusInput(): void
}

/** The TextStore of the OWNING pane (ITEM-45) — the pane that recorded — so the
 *  transcript lands in ITS composer, not the focused pane's. paneId null → the
 *  focused/single-pane bridge (unchanged). */
function ownerTextStore(paneId: string | null): ComposerAccess {
  if (paneId) {
    const handle = paneRegistry.get(paneId)
    if (handle) {
      return (
        handle.api.getState() as unknown as { TextStore: ComposerAccess }
      ).TextStore
    }
  }
  return Chat.$.TextStore as unknown as ComposerAccess
}

/**
 * Focus the OWNING pane's composer, optionally restoring a caret/selection.
 *
 * This goes through the pane's TextStore-registered closure over its own
 * textarea ref — NOT a `document.querySelector('[data-testid=…]')`. The previous
 * testid-based implementation was a **no-op in every production build**, because
 * `ui/plugins/vite-plugin-remove-data-test.js` strips every `data-test*`
 * attribute from non-dev/non-test builds (`vite.config.ts`). It only ever worked
 * in dev + e2e, where the attribute survives. See
 * `ui/docs/VOICE_DICTATION_COMPOSER.md` §2.1.
 *
 * Deferred a frame because callers focus as part of a state transition whose
 * re-render may not have committed yet.
 */
function focusComposer(paneId: string | null, select?: ComposerSpan): void {
  if (typeof requestAnimationFrame === 'undefined') return
  requestAnimationFrame(() => {
    const store = ownerTextStore(paneId)
    store.focusInput()
    if (select) store.applyEdit(store.getText(), select.start, select.end)
  })
}

// ── the dictation session ────────────────────────────────────────────────────

/**
 * The composer span ONE recording owns, so interim decodes can revise their own
 * words in place and a cancel can put the composer back byte-exactly.
 *
 * Module-scope beside `mediaRecorder`/`chunks`/`finalizing` for the same
 * documented reason: the exclusive recording lock guarantees at most one pane is
 * in the recording flow at a time, and this session has exactly the recorder's
 * lifetime. (The per-instance counter-example, `errorRevertTimer`, exists
 * because two panes CAN sit in the post-fail 'error' window at once — a state in
 * which `fail()` has already cleared this session.)
 */
interface DictationSession {
  /** Generation token at record start; a stale tick must never write. */
  gen: number
  /** The pane whose composer this session writes into. */
  paneId: string | null
  /** The caret/selection captured at record start; null → append at the end. */
  anchor: ComposerSpan | null
  /** The text the anchor selection covered, restored verbatim on cancel. */
  anchorText: string
  /** The span this session has written so far (join padding included). */
  span: ComposerSpan | null
  /** Exactly what was written into `span`, used to re-locate it. */
  written: string
  /**
   * True once the user edited the provisional text out from under us. A
   * detached session stops writing interims and restores nothing — that text
   * belongs to the user now (DEC-5).
   */
  detached: boolean
}

let dictation: DictationSession | null = null

/** Resolve the span the next write should replace, or null if we must detach. */
function resolveWriteSpan(
  session: DictationSession,
  value: string,
): ComposerSpan | null {
  if (session.span) return relocateSpan(value, session.span, session.written)
  // First write: replace the anchor selection (if any), else append at the end.
  return session.anchor ?? { start: value.length, end: value.length }
}

/**
 * Write `transcript` into the owning composer, replacing whatever this session
 * wrote before it. A blank transcript takes the provisional words away.
 *
 * Returns false when the session detached (the user edited our text) — the
 * caller then leaves the composer alone.
 */
function writeDictation(session: DictationSession, transcript: string): boolean {
  if (session.detached) return false
  const store = ownerTextStore(session.paneId)
  const value = store.getText()
  const span = resolveWriteSpan(session, value)
  if (!span) {
    session.detached = true
    return false
  }
  const edit = spliceTranscript(value, span, transcript)
  store.applyEdit(edit.value, edit.caret)
  session.span = { start: edit.start, end: edit.end }
  session.written = edit.value.slice(edit.start, edit.end)
  return true
}

/**
 * Put the composer back exactly as it was before this session wrote anything —
 * the cancel / supersede path (INV-4). A session that never wrote, or that
 * detached, restores nothing.
 */
function restoreDictation(session: DictationSession): void {
  if (session.detached || !session.span) return
  const store = ownerTextStore(session.paneId)
  const value = store.getText()
  const span = relocateSpan(value, session.span, session.written)
  if (!span) return // the user has since edited it — leave their text alone
  const edit = restoreSpan(value, span, session.anchorText)
  store.applyEdit(edit.value, edit.start, edit.end)
}

/**
 * Write the FINAL authoritative transcript into the owning composer and return
 * the caret to leave behind.
 *
 * Three cases, in priority order:
 *  1. a live session that streamed words in → the final transcript REPLACES
 *     exactly those words, so the provisional wording never survives alongside
 *     the authoritative one;
 *  2. otherwise (live captions off, or the session detached because the user
 *     edited our text) → insert at the composer's CURRENT insertion point,
 *     which is where the user actually is now;
 *  3. no insertion point at all → append at the end (INV-5).
 */
function commitTranscript(
  paneId: string | null,
  transcript: string,
): ComposerSpan {
  const store = ownerTextStore(paneId)
  const session = dictation && !dictation.detached ? dictation : null

  if (session?.span) {
    // The session owns a span; `writeDictation` relocates it and, if the user
    // has since edited it away, detaches instead of clobbering their text.
    if (writeDictation(session, transcript)) {
      const span = session.span
      // Caret after the transcript itself, before any trailing join pad.
      const end = span.end - (session.written.endsWith(' ') ? 1 : 0)
      return { start: end, end }
    }
  }

  const value = store.getText()
  if (!transcript) return currentCaret(store, value)
  const edit = insertTranscript(value, store.getSelection(), transcript)
  store.applyEdit(edit.value, edit.caret)
  return { start: edit.caret, end: edit.caret }
}

/** The composer's current caret, or the end of its text when it has none. */
function currentCaret(store: ComposerAccess, value: string): ComposerSpan {
  return store.getSelection() ?? { start: value.length, end: value.length }
}

/** Drop the session without touching the composer. */
function endDictation(): void {
  dictation = null
}

/**
 * True when the browser can actually capture a mic: a secure context (https or
 * localhost) with a `mediaDevices.getUserMedia`. Used by the button to HIDE
 * itself where recording is impossible (matches the capability-disabled hide).
 */
export function isRecordingSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    (window.isSecureContext ?? false) &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function' &&
    typeof window.MediaRecorder !== 'undefined'
  )
}

export interface VoiceEngine {
  fetchCapability: () => Promise<void>
  setLiveCaptions: (on: boolean) => void
  startRecording: (paneId?: string | null) => Promise<void>
  stopRecording: () => Promise<void>
  cancelRecording: () => void
}

/** One engine per live store instance, keyed by the stable per-instance `get`. */
const engines = new WeakMap<VoiceStoreGet, VoiceEngine>()

export default function voiceEngine(
  set: VoiceStoreSet,
  get: VoiceStoreGet,
): VoiceEngine {
  const existing = engines.get(get)
  if (existing) return existing

  // Per-instance (per-pane): each pane's 'error' state owns its OWN auto-revert
  // timer, so a second pane failing doesn't cancel this pane's error→idle revert.
  let errorRevertTimer: ReturnType<typeof setTimeout> | null = null
  const revertToIdleSoon = () => {
    if (errorRevertTimer !== null) clearTimeout(errorRevertTimer)
    errorRevertTimer = setTimeout(() => {
      errorRevertTimer = null
      if (get().status === 'error') {
        set({ status: 'idle', errorMessage: null, elapsedMs: 0, stageText: '' })
      }
    }, 2500)
  }

  const fail = (msg: string) => {
    clearTimers()
    // Abandon any pending permission prompt whose stream might still resolve.
    requestGeneration++
    stopStream()
    chunks = []
    // A failed recording must leave the composer exactly as it was (INV-4):
    // take back any provisional words this session streamed in, so the user is
    // left with their draft plus an error toast, never half a transcript.
    if (dictation) {
      restoreDictation(dictation)
      endDictation()
    }
    releaseRecordingLock(get().recordingPaneId) // ITEM-45: free the exclusive lock
    message.error(msg)
    set({
      status: 'error',
      recordingPaneId: null,
      errorMessage: msg,
      announcement: msg,
      elapsedMs: 0,
      stageText: '',
    })
    revertToIdleSoon()
  }

  /**
   * Self-rescheduling live-dictation loop: while recording (and not superseded /
   * finalizing), decode the WHOLE accumulating buffer and write the returned
   * full transcript INTO THE COMPOSER, replacing what the previous tick wrote.
   * This is what makes dictation real-time (INV-2) — the words appear in the
   * chat input as the user speaks, not only at Stop.
   *
   * Single-flight (the next tick is scheduled only after the previous settles)
   * and interim-errors-non-fatal — a failed decode just skips one update, never
   * the recording.
   */
  const runInterimTick = (gen: number, intervalMs: number) => {
    interimTimer = setTimeout(async () => {
      interimTimer = null
      if (
        isSuperseded(gen, requestGeneration) ||
        get().status !== 'recording' ||
        finalizing
      ) {
        return
      }
      try {
        const blob = new Blob(chunks, {
          type: mediaRecorder?.mimeType || 'audio/webm',
        })
        if (blob.size > 0) {
          const wav = await recordedBlobToWav16k(blob)
          const formData = new FormData()
          formData.append('file', wav, 'interim.wav')
          const result = await ApiClient.Voice.transcribeStream(formData)
          // Only write while still actively recording THIS session — the same
          // triple guard the caption update used to sit behind. The extra
          // `dictation.gen` check makes the session itself the unit of identity,
          // so a tick from a previous recording can never write into a new one.
          if (
            !isSuperseded(gen, requestGeneration) &&
            get().status === 'recording' &&
            !finalizing &&
            dictation?.gen === gen
          ) {
            writeDictation(dictation, normalizeInterimTranscript(result.text))
          }
        }
      } catch {
        // Non-fatal: skip this caption update; recording + the authoritative
        // final decode are unaffected.
      }
      if (
        !isSuperseded(gen, requestGeneration) &&
        get().status === 'recording' &&
        !finalizing
      ) {
        runInterimTick(gen, intervalMs)
      }
    }, intervalMs)
  }

  /** Fetch the readiness snapshot. Self-gates on the transcribe permission. */
  const fetchCapability = async () => {
    if (!hasPermissionNow(Permissions.VoiceTranscribe)) {
      set({ capabilityLoaded: true })
      return
    }
    try {
      const capability = await ApiClient.Voice.capability()
      // Resolve the per-device live-captions pref against the deployment toggle
      // (default follows streaming_enabled — opt-out).
      set({
        capability,
        capabilityLoaded: true,
        liveCaptions: resolveLivePref(
          storedLivePref(),
          capability.streaming_enabled,
        ),
      })
    } catch {
      // Non-fatal: the button hides when capability stays null.
      set({ capabilityLoaded: true })
    }
  }

  /** Toggle + persist the per-device "Live captions" preference. */
  const setLiveCaptions = (on: boolean) => {
    try {
      localStorage.setItem(LIVE_CAPTIONS_KEY, on ? '1' : '0')
    } catch {
      /* storage blocked — apply for this session only */
    }
    set({ liveCaptions: on })
  }

  const startRecording = async (paneId: string | null = null) => {
    const { status, capability } = get()
    if (status !== 'idle' && status !== 'error') return
    if (!isRecordingSupported()) {
      fail('Voice recording is not supported in this browser.')
      return
    }
    // Exclusive recording (ITEM-45, DEC-61 A1): the mic + module recorder are
    // single-owner, so refuse if ANOTHER split pane is already recording rather
    // than clobbering its stream. (Held through transcription so its buffered
    // chunks aren't reset out from under it.)
    if (!acquireRecordingLock(paneId)) {
      set({ announcement: 'Another pane is recording. Stop it first.' })
      return
    }
    const gen = ++requestGeneration
    set({
      status: 'requesting',
      recordingPaneId: paneId,
      errorMessage: null,
      announcement: '',
      elapsedMs: 0,
      stageText: '',
    })
    // Backstop: an unanswered permission prompt never rejects getUserMedia,
    // so time it out and return to idle rather than spinning forever.
    requestTimeout = setTimeout(() => {
      requestTimeout = null
      if (requestGeneration === gen && get().status === 'requesting') {
        fail('Microphone permission timed out. Try again when you’re ready.')
      }
    }, GET_USER_MEDIA_TIMEOUT_MS)
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err) {
      if (requestTimeout !== null) {
        clearTimeout(requestTimeout)
        requestTimeout = null
      }
      // A cancel/timeout/unmount already superseded this request and reset
      // state — swallow the (now irrelevant) rejection.
      if (isSuperseded(gen, requestGeneration)) return
      fail(micErrorMessage(err))
      return
    }
    if (requestTimeout !== null) {
      clearTimeout(requestTimeout)
      requestTimeout = null
    }
    // Cancelled/superseded while the prompt was open: discard the live stream
    // instead of leaving the mic on.
    if (isSuperseded(gen, requestGeneration) || get().status !== 'requesting') {
      for (const track of stream.getTracks()) track.stop()
      return
    }
    mediaStream = stream
    chunks = []
    // Live-caption mode: decode the accumulating buffer on a cadence while
    // recording. A timeslice makes MediaRecorder flush chunks periodically so
    // the accumulate-from-start blob is decodable each interim tick.
    const live = shouldRunInterim('recording', capability, get().liveCaptions)
    const intervalMs = clampInterval(capability?.stream_interval_ms)
    try {
      const recorder = new MediaRecorder(stream)
      mediaRecorder = recorder
      recorder.ondataavailable = e => {
        if (e.data && e.data.size > 0) chunks.push(e.data)
      }
      if (live) recorder.start(intervalMs)
      else recorder.start()
    } catch {
      fail('Could not start the audio recorder.')
      return
    }
    recordStartedAt = Date.now()
    // Open the dictation session: capture WHERE the words will land (the
    // composer's caret/selection) and WHAT that span currently holds, so an
    // interim can revise its own words in place and a cancel can put the
    // composer back byte-exactly. A textarea keeps its selection while blurred,
    // so this still reads the user's insertion point after the mic button took
    // focus; null means the composer was never focused → append at the end.
    const composer = ownerTextStore(paneId)
    const anchor = composer.getSelection()
    const draft = composer.getText()
    dictation = {
      gen,
      paneId,
      anchor,
      anchorText: anchor ? draft.slice(anchor.start, anchor.end) : '',
      span: null,
      written: '',
      detached: false,
    }
    set({
      status: 'recording',
      elapsedMs: 0,
      announcement: 'Recording started',
    })
    // Put the caret back where dictation will land and show it: the user must
    // SEE the insertion point for "lands where I'm typing" to mean anything,
    // and a focused textarea scrolls itself as the transcript streams in.
    focusComposer(paneId, anchor ?? undefined)
    // Kick off the interim decode loop (guarded by the same generation token).
    if (live) runInterimTick(gen, intervalMs)
    const maxMs = (capability?.max_clip_seconds ?? 60) * 1000
    elapsedTimer = setInterval(() => {
      const elapsed = Date.now() - recordStartedAt
      set({ elapsedMs: elapsed })
      if (elapsed >= maxMs) {
        void stopRecording()
      }
    }, 200)
  }

  const stopRecording = async () => {
    // The `finalizing` latch closes the re-entrancy window during the onstop
    // await (status/mediaRecorder remain 'live' across it).
    if (get().status !== 'recording' || !mediaRecorder || finalizing) return
    finalizing = true
    clearTimers()
    const recorder = mediaRecorder
    // Supersession token, captured BEFORE the finalization await. cancelRecording
    // (Cancel button or the unmount cleanup) bumps requestGeneration; the
    // Recording UI stays live during MediaRecorder's onstop finalization, so a
    // cancel here (or later during the transcribe POST) is a real race. Every
    // await below re-checks this token and bails if superseded.
    const gen = requestGeneration
    // Await the assembled blob via onstop before we tear the stream down. A
    // fallback timeout guarantees the promise settles even if a concurrent
    // cancel nulled `onstop` (otherwise the frame would hang, leaking the
    // closure); double-resolve is a no-op.
    const recorded = await new Promise<Blob>(resolve => {
      const settle = () =>
        resolve(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }))
      recorder.onstop = settle
      const fallback = setTimeout(settle, 1500)
      void fallback
      try {
        recorder.stop()
      } catch {
        resolve(new Blob(chunks, { type: 'audio/webm' }))
      }
    })
    // Finalization window closed — re-entry past here is already blocked by
    // the status check (status flips to 'transcribing' below).
    finalizing = false
    stopStream()
    chunks = []

    // A cancel/unmount during onstop finalization superseded us — the state
    // was already reset to idle; don't resurrect it into 'transcribing'.
    if (isSuperseded(gen, requestGeneration)) return

    if (recorded.size === 0) {
      fail('No audio was captured — try recording again.')
      return
    }

    set({
      status: 'transcribing',
      stageText: 'Starting voice engine…',
      announcement: 'Transcribing',
    })
    // The same `gen` token guards the transcribe POST below: a POST that
    // resolves AFTER a cancel/unmount is dropped instead of appending its
    // transcript into a composer that has since changed. (The fetch itself
    // isn't aborted — the generated client takes no signal — so this is the
    // safety net.)
    // Cold-start staging: whisper-server may autostart on the first clip, so
    // start with "Starting…" and flip to "Transcribing…" if it lingers.
    stageTimer = setTimeout(() => {
      if (get().status === 'transcribing') set({ stageText: 'Transcribing…' })
    }, 1200)

    try {
      const wav = await recordedBlobToWav16k(recorded)
      const formData = new FormData()
      formData.append('file', wav, 'dictation.wav')
      const result = await ApiClient.Voice.transcribe(formData)
      // A cancel/unmount superseded this transcription while it was in flight
      // — drop the result (state was already reset by cancelRecording).
      if (isSuperseded(gen, requestGeneration)) return
      clearTimers()
      const text = result.text?.trim() ?? ''
      // Insert into the OWNING pane's composer (ITEM-45), not the focused pane.
      const ownerPaneId = get().recordingPaneId
      const caret = commitTranscript(ownerPaneId, text)
      endDictation()
      releaseRecordingLock(ownerPaneId)
      set({
        status: 'idle',
        recordingPaneId: null,
        elapsedMs: 0,
        stageText: '',
        errorMessage: null,
        announcement: text ? 'Transcript added' : 'No speech detected',
      })
      // Return focus to the composer with the caret AFTER the transcript, so
      // the user keeps typing exactly where the words ended.
      focusComposer(ownerPaneId, caret)
    } catch (err) {
      // Superseded by a cancel/unmount — swallow the (now irrelevant) error.
      if (isSuperseded(gen, requestGeneration)) return
      // Keep the raw backend detail (loopback URLs, engine jargon) in the
      // console for debugging; never leak it into the user-facing toast.
      console.error('[voice] transcription failed', err)
      fail('Couldn’t transcribe your recording. Please try again.')
    }
  }

  const cancelRecording = () => {
    // Nothing to unwind from a settled state — avoid a spurious focus-steal /
    // announcement when this runs as an unmount cleanup while already idle.
    const status = get().status
    if (status === 'idle') return
    // 'error' is the ONE non-idle state where this pane has ALREADY released the
    // exclusive lock and cleared its recorder ownership (see `fail`). During the
    // ~2.5s error window ANOTHER pane may have acquired the lock and now owns the
    // shared module recorder/stream/chunks/timers. So an 'error'-state cancel
    // (e.g. this pane unmounting) must touch ONLY this pane's own revert timer +
    // status — never the shared recorder, or it would stop the other pane's live
    // recording, wipe its buffer, and (since recordingPaneId is null here)
    // release nothing, stranding that pane's lock forever.
    if (status === 'error') {
      if (errorRevertTimer !== null) {
        clearTimeout(errorRevertTimer)
        errorRevertTimer = null
      }
      // Deliberately does NOT touch `dictation` either — `fail()` already
      // restored + cleared this pane's session, and any session alive now
      // belongs to whichever pane took the lock during the error window.
      set({
        status: 'idle',
        errorMessage: null,
        elapsedMs: 0,
        stageText: '',
        announcement: 'Recording cancelled',
      })
      return
    }
    finalizing = false
    clearTimers()
    // Abandon a pending getUserMedia prompt so a late resolve discards its
    // stream instead of re-latching the mic (escapes the 'requesting' spinner).
    requestGeneration++
    if (mediaRecorder && status === 'recording') {
      mediaRecorder.ondataavailable = null
      mediaRecorder.onstop = null
      try {
        mediaRecorder.stop()
      } catch {
        /* already stopped */
      }
    }
    stopStream()
    chunks = []
    const ownerPaneId = get().recordingPaneId
    // A cancelled recording leaves the composer EXACTLY as it was (INV-4): take
    // back every provisional word this session streamed in and re-select what
    // the user had selected. A session the user has since edited restores
    // nothing — that text is theirs now (DEC-5).
    let restored: ComposerSpan | undefined
    if (dictation) {
      restoreDictation(dictation)
      restored = dictation.anchor ?? undefined
      endDictation()
    }
    releaseRecordingLock(ownerPaneId) // ITEM-45: free the exclusive lock
    set({
      status: 'idle',
      recordingPaneId: null,
      elapsedMs: 0,
      stageText: '',
      errorMessage: null,
      announcement: 'Recording cancelled',
    })
    focusComposer(ownerPaneId, restored)
  }

  const engine: VoiceEngine = {
    fetchCapability,
    setLiveCaptions,
    startRecording,
    stopRecording,
    cancelRecording,
  }
  engines.set(get, engine)
  return engine
}
