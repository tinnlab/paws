/**
 * COMPONENT HARNESS for voice dictation → the composer.
 *
 * ## What is real here, and what is not
 *
 * REAL: the shipped voice engine (`voiceStore/actions/_engine.ts`) — its whole
 * dictation-session lifecycle, span relocation and restore; the shipped composer
 * access closures (`text/composerAccess.ts`) that `TextInput` registers; and a
 * real mounted `<textarea>` whose `value` / `selectionStart` / `selectionEnd` /
 * focus are what every assertion reads.
 *
 * STOOD IN FOR: only the external boundary — the microphone (`getUserMedia` +
 * `MediaRecorder`), the WAV encoder (jsdom has no `AudioContext`), the two
 * transcribe endpoints, and the permission lookup. Nothing about WHERE the words
 * go is mocked; that is the thing under test.
 *
 * ## Why a component harness and not only Playwright
 *
 * The e2e specs in `tests/e2e/14-voice/` drive the same behaviour on the real
 * stack and are the primary proof of INV-1/INV-2. What they cannot do cheaply is
 * hold the awkward states still: a byte-exact cancel-restore assertion after a
 * KNOWN number of interim writes, and the detach case where the user edits the
 * provisional text mid-recording. Both are scripted deterministically here.
 *
 * ## Runner
 *
 * Vitest + jsdom. `npm run test:unit` is `node --test "src/**\/*.test.ts"` and
 * cannot load `.tsx` at all, so this file is invisible to it; `vitest.config.ts`
 * includes `src/**\/*.test.tsx`. The two globs are disjoint by extension.
 *
 *   npx vitest run src/modules/chat/extensions/voice/components/DictationComposer.test.tsx
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Textarea } from '@ziee/kit'
import { createComposerAccess } from '@/modules/chat/extensions/text/composerAccess'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// ── the external boundary, and ONLY the external boundary ────────────────────

/** Transcripts the scripted endpoints hand back, in order. */
const script = {
  interim: [] as string[],
  final: '',
  /** Every `/transcribe` (final) call the engine made. */
  finalCalls: 0,
  /** When true the final transcribe REJECTS, driving the engine's fail path. */
  failFinal: false,
}

vi.mock('@/api-client', () => ({
  ApiClient: {
    Voice: {
      capability: async () => ({
        enabled: true,
        runtime_ready: true,
        model_ready: true,
        model: 'base',
        max_clip_seconds: 120,
        can_transcribe: true,
        streaming_enabled: true,
        stream_interval_ms: 1000,
      }),
      transcribeStream: async () => ({
        // Shift one interim off the script; repeat the last once exhausted.
        text: script.interim.length > 1 ? script.interim.shift()! : (script.interim[0] ?? ''),
      }),
      transcribe: async () => {
        script.finalCalls++
        if (script.failFinal) throw new Error('transcribe backend exploded')
        return { text: script.final }
      },
    },
  },
}))

vi.mock('@/core/permissions', () => ({ hasPermissionNow: () => true }))
vi.mock('@/api-client/permissions', () => ({ Permissions: { VoiceTranscribe: 'voice::transcribe' } }))
// Only the toast is stubbed — the REAL kit `Textarea` is what gets mounted, so
// the harness exercises the same element the composer actually renders.
vi.mock('@ziee/kit', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  message: { error: () => undefined },
}))
// jsdom has no AudioContext; the engine only needs *a* Blob back.
vi.mock('@/modules/chat/extensions/voice/audio/wav', () => ({
  recordedBlobToWav16k: async () => new Blob(['x'], { type: 'audio/wav' }),
}))

/**
 * The composer the engine writes into. `chatBridge`'s `Chat.$.TextStore` is the
 * single-pane path the engine takes when `paneId` is null; it is wired to the
 * REAL access closures over the REAL mounted textarea below.
 */
let composerEl: HTMLTextAreaElement | null = null

vi.mock('@/modules/chat/core/stores/chatBridge', () => {
  return {
    paneRegistry: { get: () => undefined },
    Chat: {
      get $() {
        const access = createComposerAccess(() => composerEl)
        return {
          TextStore: {
            getText: access.getMessage,
            setText: access.setMessage,
            getSelection: access.readSelection,
            applyEdit: (text: string, start: number, end?: number) =>
              access.applyComposerEdit(text, start, end ?? start),
            focusInput: access.focusMessage,
          },
        }
      },
    },
  }
})

// ── a scripted microphone ────────────────────────────────────────────────────

class FakeMediaRecorder {
  state = 'inactive'
  mimeType = 'audio/webm'
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  start(timeslice?: number) {
    this.state = 'recording'
    const emit = () => this.ondataavailable?.({ data: new Blob(['a'], { type: 'audio/webm' }) })
    emit()
    if (typeof timeslice === 'number' && timeslice > 0) {
      this.timer = setInterval(emit, timeslice)
    }
  }
  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.state = 'inactive'
    this.ondataavailable?.({ data: new Blob(['a'], { type: 'audio/webm' }) })
    this.onstop?.()
  }
  static isTypeSupported() {
    return true
  }
}

// ── mounting ─────────────────────────────────────────────────────────────────

const HARNESS_TESTID = 'dictation-harness-composer'

/**
 * A minimal host that renders a real `<textarea>` — the same element type and
 * the same access closures `TextInput` registers. Mounting `TextInput` itself
 * would drag in the entire chat store graph (drafts, auth, send) for zero extra
 * coverage of the thing under test: where dictated words land in a textarea.
 */
function Composer({ elementRef }: { elementRef: (el: HTMLTextAreaElement | null) => void }) {
  return (
    // The kit's Textarea requires a `data-testid`, but this harness locates the
    // element by ref and never queries it. Passing the id through a VARIABLE
    // keeps it out of the shared kit testid registry, which collects static
    // literals only — a test-only id has no business shipping in it.
    <Textarea
      data-testid={HARNESS_TESTID}
      aria-label="Message"
      ref={elementRef}
      defaultValue=""
    />
  )
}

let container: HTMLDivElement
let root: Root
type Engine = import('../voiceStore/actions/_engine').VoiceEngine
let engine: Engine

/**
 * One interim tick, with headroom. The engine clamps the admin cadence to a
 * 300 ms floor (`clampInterval`), so a settle window shorter than that observes
 * a composer nothing has written to yet — which reads exactly like the defect.
 */
const TICK = 400

/** Give the engine's rAF-deferred focus/selection work a chance to run. */
async function settle(ms = 0) {
  await act(async () => {
    await new Promise(r => setTimeout(r, ms))
  })
}

/** Set the composer's text and caret/selection the way a user would leave it. */
function seedComposer(value: string, start: number, end = start) {
  composerEl!.value = value
  composerEl!.setSelectionRange(start, end)
}

function snapshot() {
  return {
    value: composerEl!.value,
    start: composerEl!.selectionStart,
    end: composerEl!.selectionEnd,
  }
}

beforeEach(async () => {
  script.interim = []
  script.final = ''
  script.finalCalls = 0
  script.failFinal = false

  ;(globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = FakeMediaRecorder
  Object.defineProperty(window, 'isSecureContext', { configurable: true, get: () => true })
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: async () => ({ getTracks: () => [{ stop: () => undefined }] }),
    },
  })

  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(<Composer elementRef={el => { composerEl = el }} />)
  })

  // A fresh engine per test. `voiceEngine` memoizes on the `get` identity, so a
  // new `get` closure yields a new ENGINE — but the dictation session, the
  // recorder, the chunk buffer and the generation token are MODULE scope and are
  // deliberately shared (the exclusive recording lock is what makes that safe).
  // Only `errorRevertTimer` is per-instance. Isolation therefore comes from
  // afterEach's `cancelRecording()`, which tears the live session down; building
  // a second engine does NOT reset module state.
  const { default: voiceEngine } = await import('../voiceStore/actions/_engine')
  let state: Record<string, unknown> = {
    status: 'idle',
    recordingPaneId: null,
    elapsedMs: 0,
    capability: {
      enabled: true,
      can_transcribe: true,
      streaming_enabled: true,
      stream_interval_ms: 300,
      max_clip_seconds: 120,
    },
    capabilityLoaded: true,
    stageText: '',
    errorMessage: null,
    liveCaptions: true,
    announcement: '',
  }
  engine = voiceEngine(
    (patch: unknown) => {
      state = {
        ...state,
        ...(typeof patch === 'function'
          ? (patch as (s: unknown) => Record<string, unknown>)(state)
          : (patch as Record<string, unknown>)),
      }
    },
    (() => state) as never,
  )
})

afterEach(async () => {
  // Leave no live recording behind (it would hold the exclusive recording lock).
  engine.cancelRecording()
  await act(async () => {
    root.unmount()
  })
  container.remove()
  composerEl = null
  vi.restoreAllMocks()
})

// ── TEST-12 — the production access closures drive a REAL textarea ───────────

describe('TEST-12 — composer access closures (ITEM-5, ITEM-6)', () => {
  test('read the real selection, write value AND selection, and focus', () => {
    const access = createComposerAccess(() => composerEl)

    seedComposer('Please book  for next Tuesday.', 12)
    expect(access.readSelection()).toEqual({ start: 12, end: 12 })
    expect(access.getMessage()).toBe('Please book  for next Tuesday.')

    seedComposer('call Bob tomorrow', 5, 8)
    expect(access.readSelection()).toEqual({ start: 5, end: 8 })

    // applyComposerEdit moves the CARET with the value — the whole point.
    access.applyComposerEdit('call Alice tomorrow', 10, 10)
    expect(snapshot()).toEqual({ value: 'call Alice tomorrow', start: 10, end: 10 })

    // …and can restore a SELECTION, not just a caret.
    access.applyComposerEdit('call Bob tomorrow', 5, 8)
    expect(snapshot()).toEqual({ value: 'call Bob tomorrow', start: 5, end: 8 })

    expect(document.activeElement).not.toBe(composerEl)
    access.focusMessage()
    expect(document.activeElement).toBe(composerEl)
  })

  test('out-of-range offsets are clamped instead of throwing', () => {
    const access = createComposerAccess(() => composerEl)
    access.applyComposerEdit('abc', 99, 120)
    expect(snapshot()).toEqual({ value: 'abc', start: 3, end: 3 })
    access.applyComposerEdit('abc', -5, -1)
    expect(composerEl!.selectionStart).toBe(0)
  })

  test('every closure no-ops safely when the element is gone', () => {
    const access = createComposerAccess(() => null)
    expect(access.getMessage()).toBe('')
    expect(access.readSelection()).toBeNull()
    expect(() => {
      access.setMessage('x')
      access.clearMessage()
      access.applyComposerEdit('x', 0, 0)
      access.focusMessage()
    }).not.toThrow()
  })

  test('the voice store carries no interimText field (the toolbar channel is gone)', async () => {
    const { voiceStoreState } = await import('../voiceStore/state')
    expect('interimText' in voiceStoreState).toBe(false)
  })
})

// ── TEST-13 [acceptance, INV-2] — progressive writes INTO the composer ───────

describe('TEST-13 [acceptance INV-2] — real-time dictation lands in the composer', () => {
  test('successive interims each replace the previous provisional span', async () => {
    seedComposer('Please book  for next Tuesday.', 12)
    script.interim = ['And so', 'And so my fellow', 'And so my fellow Americans']

    await act(async () => {
      await engine.startRecording(null)
    })

    const seen: string[] = []
    for (let i = 0; i < 3; i++) {
      await settle(TICK)
      seen.push(composerEl!.value)
    }

    // The words appeared IN THE COMPOSER while still recording — this is the
    // whole of INV-2. Before the fix the value never changed until Stop.
    expect(seen[seen.length - 1]).toBe('Please book And so my fellow Americans for next Tuesday.')
    expect(seen[seen.length - 1]).not.toBe('Please book  for next Tuesday.')

    // Each interim REPLACED the last: no superseded wording accumulated, and
    // the surrounding draft survived verbatim at both ends.
    for (const value of seen) {
      expect(value.startsWith('Please book ')).toBe(true)
      expect(value.endsWith(' for next Tuesday.')).toBe(true)
      expect(value.match(/And so/g)?.length ?? 0).toBeLessThanOrEqual(1)
    }
  })

  test('an interim that comes back blank takes the provisional words away', async () => {
    seedComposer('keep this', 9)
    script.interim = ['provisional', '']

    await act(async () => {
      await engine.startRecording(null)
    })
    await settle(TICK)
    expect(composerEl!.value).toBe('keep this provisional')
    await settle(TICK * 2)
    expect(composerEl!.value).toBe('keep this')
  })
})

// ── TEST-14 [acceptance, INV-4] — cancel restores byte-exactly ───────────────

describe('TEST-14 [acceptance INV-4] — a cancelled recording leaves the composer exactly as it was', () => {
  test('after interim writes, cancel restores value AND caret byte-for-byte', async () => {
    seedComposer('Please book  for next Tuesday.', 12)
    const before = snapshot()
    script.interim = ['And so', 'And so my fellow']

    await act(async () => {
      await engine.startRecording(null)
    })
    await settle(TICK * 2)
    expect(composerEl!.value).not.toBe(before.value) // provisional text landed

    await act(async () => {
      engine.cancelRecording()
    })
    await settle(30)

    expect(snapshot()).toEqual(before)
    expect(script.finalCalls).toBe(0)
  })

  test('a cancelled selection-replace puts the selected text back, re-selected', async () => {
    seedComposer('call Bob tomorrow', 5, 8) // "Bob" selected
    const before = snapshot()
    script.interim = ['Alice Smith']

    await act(async () => {
      await engine.startRecording(null)
    })
    await settle(TICK * 2)
    expect(composerEl!.value).toBe('call Alice Smith tomorrow')

    await act(async () => {
      engine.cancelRecording()
    })
    await settle(30)

    expect(snapshot()).toEqual(before)
    expect(composerEl!.value.slice(5, 8)).toBe('Bob')
  })

  test('cancel re-selects the restored text even after the user typed BEFORE it', async () => {
    seedComposer('call Bob tomorrow', 5, 8) // "Bob" selected
    script.interim = ['Alice Smith']

    await act(async () => {
      await engine.startRecording(null)
    })
    await settle(TICK * 2)
    expect(composerEl!.value).toBe('call Alice Smith tomorrow')

    // The user types at the very start, shifting our span right by 2.
    composerEl!.value = `AB${composerEl!.value}`
    await settle(TICK)

    await act(async () => {
      engine.cancelRecording()
    })
    await settle(30)

    expect(composerEl!.value).toBe('ABcall Bob tomorrow')
    // The selection must follow the text to {7,10}; the stale anchor {5,8}
    // would select "l B" — the wrong three characters.
    const after = snapshot()
    expect(after.value.slice(after.start, after.end)).toBe('Bob')
  })
})

// ── TEST-15 — the final transcript replaces the provisional one ──────────────

describe('TEST-15 — the authoritative transcript supersedes the interim (ITEM-9)', () => {
  test('the interim wording is gone from the final value, caret sits after it', async () => {
    seedComposer('Please book  for next Tuesday.', 12)
    script.interim = ['a tabl']
    script.final = 'a table for four'

    await act(async () => {
      await engine.startRecording(null)
    })
    await settle(TICK * 2)
    await act(async () => {
      await engine.stopRecording()
    })
    await settle(30)

    expect(composerEl!.value).toBe('Please book a table for four for next Tuesday.')
    // No duplicated provisional fragment left behind.
    expect(composerEl!.value.match(/a tabl/g)!.length).toBe(1)
    // Caret immediately after the transcript, NOT at the end of the value.
    expect(composerEl!.value.slice(0, composerEl!.selectionStart)).toBe(
      'Please book a table for four',
    )
    expect(document.activeElement).toBe(composerEl)
  })

  test('with live captions off the final transcript still lands at the caret', async () => {
    seedComposer('Please book  for next Tuesday.', 12)
    script.final = 'a table'

    await act(async () => {
      await engine.setLiveCaptions(false)
      await engine.startRecording(null)
    })
    await settle(TICK)
    // Nothing streamed in — captions are off.
    expect(composerEl!.value).toBe('Please book  for next Tuesday.')

    await act(async () => {
      await engine.stopRecording()
    })
    await settle(30)
    expect(composerEl!.value).toBe('Please book a table for next Tuesday.')
  })
})

// ── TEST-17 — a backend failure does not destroy the user's words ────────────

describe('TEST-17 — a failed transcription keeps the provisional transcript', () => {
  test('the streamed words survive a /transcribe error, with the draft intact', async () => {
    seedComposer('Please book  for next Tuesday.', 12)
    script.interim = ['a table for four']
    script.failFinal = true

    await act(async () => {
      await engine.startRecording(null)
    })
    await settle(TICK * 2)
    expect(composerEl!.value).toBe('Please book a table for four for next Tuesday.')

    await act(async () => {
      await engine.stopRecording()
    })
    await settle(60)

    // The audio is gone; these words are the only surviving record of what the
    // user said. Deleting them to tidy up after our own error would destroy the
    // user's only copy.
    expect(composerEl!.value).toBe('Please book a table for four for next Tuesday.')
  })
})

// ── TEST-16 — the user's own typing always wins ──────────────────────────────

describe("TEST-16 — the user's typing wins over dictation (ITEM-3, ITEM-8, ITEM-10)", () => {
  test('typing BEFORE the provisional span relocates it instead of corrupting it', async () => {
    seedComposer('book  for Tuesday.', 5)
    script.interim = ['a tabl', 'a table']

    await act(async () => {
      await engine.startRecording(null)
    })
    await settle(TICK)
    expect(composerEl!.value).toBe('book a tabl for Tuesday.')

    // The user types at the very start, shifting our span right by 7.
    composerEl!.value = `Please ${composerEl!.value}`

    await settle(TICK * 2)
    expect(composerEl!.value).toBe('Please book a table for Tuesday.')
  })

  test('an interim write leaves the caret alone when the user is editing elsewhere', async () => {
    seedComposer('draft start and the end', 23) // caret at the very end
    script.interim = ['one', 'one two']

    await act(async () => {
      await engine.startRecording(null)
    })
    await settle(TICK * 2)

    // Dictation owns a span at the END; put the user's caret near the START.
    composerEl!.setSelectionRange(5, 5)
    const marked = composerEl!.value.slice(0, 5)
    await settle(TICK * 2)

    // The words kept flowing, but the user's caret did NOT move to follow them.
    expect(composerEl!.value).toContain('one two')
    expect(composerEl!.value.slice(0, composerEl!.selectionStart)).toBe(marked)
  })

  test('editing INSIDE the provisional span detaches: no overwrite, and cancel restores nothing', async () => {
    seedComposer('keep this', 9)
    script.interim = ['provisional']

    await act(async () => {
      await engine.startRecording(null)
    })
    await settle(TICK)
    expect(composerEl!.value).toBe('keep this provisional')

    // The user edits OUR words — they are the user's now.
    composerEl!.value = 'keep this MY OWN EDIT'
    script.interim = ['something else entirely']
    await settle(TICK * 2)

    expect(composerEl!.value).toBe('keep this MY OWN EDIT')

    const beforeCancel = snapshot()
    await act(async () => {
      engine.cancelRecording()
    })
    await settle(30)
    // A detached session restores NOTHING — it must not delete the user's text.
    expect(composerEl!.value).toBe('keep this MY OWN EDIT')
    // …and must not SELECT any of it either. Re-selecting the anchor's stale
    // offsets would highlight the user's own characters and arm the next
    // keystroke to delete them.
    expect(snapshot().start).toBe(snapshot().end)
    expect(snapshot().value).toBe(beforeCancel.value)
  })

  test('a detached selection-anchored session never re-selects the user text', async () => {
    seedComposer('call Bob tomorrow', 5, 8) // "Bob" selected
    script.interim = ['Alice Smith']

    await act(async () => {
      await engine.startRecording(null)
    })
    await settle(TICK * 2)
    expect(composerEl!.value).toBe('call Alice Smith tomorrow')

    // The user edits our words → detach.
    composerEl!.value = 'call Alice EDITED tomorrow'
    await settle(TICK)

    await act(async () => {
      engine.cancelRecording()
    })
    await settle(30)

    expect(composerEl!.value).toBe('call Alice EDITED tomorrow')
    // A collapsed caret, NOT a 3-character selection at the stale anchor {5,8}
    // (which would be "l A" here, and the next keypress would delete it).
    expect(snapshot().start).toBe(snapshot().end)
  })
})
