/**
 * Pure decision helpers for the voice-dictation state machine, extracted from
 * `Voice.store.ts` so they can be unit-tested without the store's browser +
 * `defineExtensionStore` graph (the store itself is exercised end-to-end by the
 * `14-voice/` Playwright specs). Each encodes one load-bearing contract:
 *
 *  - `spliceTranscript` / `insertTranscript` — the "insert AT THE CARET, don't
 *    send" rule: a transcript is written at the composer's insertion point
 *    (replacing a selection if there is one), never replacing the whole draft
 *    and — by construction — never triggering a send. With no caret at all it
 *    appends at the end (`appendTranscript`).
 *  - `relocateSpan` / `restoreSpan` — the dictation SESSION's span bookkeeping:
 *    what to do when the user types around (or into) the provisional text, and
 *    how to put the composer back byte-exactly when a recording is cancelled.
 *  - `isSuperseded` — the generation-token guard: a result whose request was
 *    superseded (by cancel / unmount / a newer request) must be DROPPED.
 *  - `micErrorMessage` — maps a `getUserMedia` rejection to the user-facing
 *    error, distinguishing a permission denial from a no-microphone failure.
 *
 * The behaviour these encode is specified in `ui/docs/VOICE_DICTATION_COMPOSER.md`
 * (§3 intended behaviour, §4 invariants, §5 mechanism).
 */

// ── caret-aware composer editing ─────────────────────────────────────────────

/** A composer caret (`start === end`) or selection range. */
export interface ComposerSpan {
  start: number
  end: number
}

/**
 * The result of a composer edit.
 *
 * `start`/`end` bound the text this edit WROTE **including any join padding**,
 * which is what makes the edit reversible: removing exactly `[start, end)`
 * restores the surrounding text byte-for-byte. `caret` sits after the
 * transcript but BEFORE a trailing pad, so the user keeps typing where the
 * words ended rather than after a stray space.
 */
export interface ComposerEdit {
  value: string
  caret: number
  start: number
  end: number
}

/**
 * Characters after which a leading join space must NOT be added — an opening
 * bracket or quote already sits flush against what follows it.
 */
const NO_LEADING_PAD_AFTER = '([{"‘“'
/**
 * Characters before which a trailing join space must NOT be added — closing
 * punctuation attaches to the word it follows (`"hello."`, never `"hello ."`).
 */
const NO_TRAILING_PAD_BEFORE = '.,;:!?)]}"’”'

function clampIndex(i: number, length: number): number {
  if (!Number.isFinite(i)) return length
  return Math.min(length, Math.max(0, Math.trunc(i)))
}

/**
 * True when `i` lands BETWEEN the two halves of a surrogate pair. JS string
 * indices are UTF-16 code units, so slicing there would split one astral
 * character (an emoji, most CJK extension B+) into two lone surrogates.
 */
function splitsSurrogatePair(value: string, i: number): boolean {
  if (i <= 0 || i >= value.length) return false
  const hi = value.charCodeAt(i - 1)
  const lo = value.charCodeAt(i)
  return hi >= 0xd800 && hi <= 0xdbff && lo >= 0xdc00 && lo <= 0xdfff
}

/**
 * Normalize a possibly-reversed / out-of-range span against `value`, and move it
 * off any surrogate-pair boundary so a splice can never leave a lone surrogate
 * behind.
 *
 * A COLLAPSED span (a caret) is SNAPPED past the pair — it stays collapsed, so
 * an insertion point lands beside the character rather than swallowing it. A
 * real RANGE is widened outward to cover whichever pair it straddles, so a
 * replacement never cuts a character in half.
 */
function normalizeSpan(value: string, span: ComposerSpan): ComposerSpan {
  const a = clampIndex(span.start, value.length)
  const b = clampIndex(span.end, value.length)
  let start = Math.min(a, b)
  let end = Math.max(a, b)
  if (start === end) {
    if (splitsSurrogatePair(value, start)) start = end = start + 1
    return { start, end }
  }
  if (splitsSurrogatePair(value, start)) start -= 1
  if (splitsSurrogatePair(value, end)) end += 1
  return { start, end }
}

function needsLeadingPad(before: string): boolean {
  if (!before) return false
  const ch = before[before.length - 1]
  return !/\s/.test(ch) && !NO_LEADING_PAD_AFTER.includes(ch)
}

function needsTrailingPad(after: string): boolean {
  if (!after) return false
  const ch = after[0]
  return !/\s/.test(ch) && !NO_TRAILING_PAD_BEFORE.includes(ch)
}

/**
 * Replace `[span.start, span.end)` in `value` with `transcript`, joined into the
 * surrounding text the way a human would type it: a space is added on a side
 * ONLY when that side needs one, so this never produces a doubled space, never
 * glues two words together, and never wedges a space before a closing `.`/`,`.
 *
 * A BLANK transcript REMOVES the span (the interim-shrink case: a decode that
 * came back empty must take the previous provisional words away rather than
 * leaving them stranded).
 *
 * Removal is EXACTLY `[start, end)` — no seam tidying. That is what makes the
 * operation reversible, and it is safe precisely BECAUSE the span this function
 * returns already includes the join padding it added: deleting the span deletes
 * the pads with it, leaving the surrounding text byte-for-byte as it was. An
 * earlier version also collapsed whitespace across the seam, which silently ate
 * one of the user's OWN characters — on a zero-length span (an empty first
 * decode, which is common) it corrupted a draft before a single word had been
 * dictated, and `restoreSpan` could not undo it. Do not reintroduce it.
 */
export function spliceTranscript(
  value: string,
  span: ComposerSpan,
  transcript: string,
): ComposerEdit {
  const { start, end } = normalizeSpan(value, span)
  const before = value.slice(0, start)
  const after = value.slice(end)
  const text = transcript.trim()

  if (!text) {
    return {
      value: before + after,
      caret: before.length,
      start: before.length,
      end: before.length,
    }
  }

  const padLeft = needsLeadingPad(before) ? ' ' : ''
  const padRight = needsTrailingPad(after) ? ' ' : ''
  const written = padLeft + text + padRight
  return {
    value: before + written + after,
    caret: before.length + padLeft.length + text.length,
    start: before.length,
    end: before.length + written.length,
  }
}

/**
 * Compose the next composer value after a transcription, at the user's
 * insertion point.
 *
 *  - a caret or selection → the transcript is written THERE, replacing any
 *    selected text, with the caret left immediately after it;
 *  - `selection === null` (the composer was never focused, so there is no
 *    insertion point) → the transcript is APPENDED at the end — the historical
 *    behaviour, unchanged;
 *  - a blank transcript → a true no-op that does NOT eat the user's selection.
 *
 * There is deliberately NO send path here — dictation only ever edits text.
 */
export function insertTranscript(
  value: string,
  selection: ComposerSpan | null,
  transcript: string,
): ComposerEdit {
  if (!transcript.trim()) {
    const span = selection
      ? normalizeSpan(value, selection)
      : { start: value.length, end: value.length }
    return { value, caret: span.end, start: span.start, end: span.end }
  }
  const span = selection ?? { start: value.length, end: value.length }
  return spliceTranscript(value, span, transcript)
}

/**
 * Compose the next composer value by appending a transcript at the END.
 *
 * Retained as the named contract for the no-insertion-point case (a composer
 * that was never focused). Expressed via `spliceTranscript` at the end position
 * so the join is seam-aware — identical to the historical `${current} ${text}`
 * for every case that contract covered, and additionally correct when the draft
 * already ends in whitespace (which used to yield a doubled space).
 */
export function appendTranscript(current: string, transcript: string): string {
  if (!transcript.trim()) return current
  return spliceTranscript(
    current,
    { start: current.length, end: current.length },
    transcript,
  ).value
}

/**
 * Re-locate the span a dictation session owns, before overwriting it.
 *
 * The session records the exact string it last wrote; the user may have typed
 * around it in the meantime.
 *
 *  - the recorded offsets still hold exactly that string → unchanged;
 *  - it moved but is still findable UNAMBIGUOUSLY → its new offsets;
 *  - it is gone, or now appears more than once (so we cannot tell which is
 *    ours) → `null`, meaning DETACH: the user has taken ownership of that text
 *    and dictation must stop writing over it.
 *
 * A session that has written nothing yet (`written === ''`) is locatable only as
 * an in-bounds zero-length span — there is no text to search for.
 */
export function relocateSpan(
  value: string,
  span: ComposerSpan,
  written: string,
): ComposerSpan | null {
  if (!written) {
    const collapsed = span.start === span.end
    const inBounds = span.start >= 0 && span.start <= value.length
    return collapsed && inBounds ? span : null
  }
  if (value.slice(span.start, span.end) === written) return span
  const first = value.indexOf(written)
  if (first < 0) return null
  if (value.indexOf(written, first + 1) >= 0) return null
  return { start: first, end: first + written.length }
}

/**
 * Put `original` back over the span a dictation session wrote — the cancel /
 * supersede path. Because the span's bounds include the join padding the
 * session added, this reproduces the pre-dictation string byte-for-byte. The
 * returned `start`/`end` bound the restored text so the caller can re-select
 * exactly what the user had selected before dictation began.
 */
export function restoreSpan(
  value: string,
  span: ComposerSpan,
  original: string,
): ComposerEdit {
  const { start, end } = normalizeSpan(value, span)
  return {
    value: value.slice(0, start) + original + value.slice(end),
    caret: start + original.length,
    start,
    end: start + original.length,
  }
}

/**
 * True when the generation token captured at a request's start no longer
 * matches the current token — i.e. a cancel/unmount/newer-request superseded it,
 * so its (recording or transcription) result must be discarded.
 */
export function isSuperseded(genAtStart: number, currentGen: number): boolean {
  return genAtStart !== currentGen
}

/**
 * User-facing error for a `getUserMedia` rejection. A `NotAllowedError` /
 * `SecurityError` `DOMException` is a permission denial; anything else is a
 * missing/unavailable microphone.
 */
export function micErrorMessage(err: unknown): string {
  const denied =
    err instanceof DOMException &&
    (err.name === 'NotAllowedError' || err.name === 'SecurityError')
  return denied
    ? 'Microphone access was denied. Allow it in your browser to dictate.'
    : 'Could not start recording — no microphone available.'
}

// ── streaming (live-caption) decision helpers ─────────────────────────────────
// Pure logic for the interim loop, extracted so the store's cadence/gate is
// unit-testable without the browser + MediaRecorder graph.

/** The subset of `VoiceCapability` the interim decision needs (avoids a store cycle). */
export interface InterimCapability {
  streaming_enabled: boolean
  stream_interval_ms: number
}

/**
 * True when the composer should run the live-caption interim loop: only while
 * actively `recording`, only when the deployment offers streaming captions, and
 * only when this device's user pref has them ON. Any other status (idle,
 * requesting, transcribing, error) must NOT decode interim frames.
 */
export function shouldRunInterim(
  status: string,
  capability: InterimCapability | null | undefined,
  livePref: boolean,
): boolean {
  return status === 'recording' && !!capability?.streaming_enabled && livePref
}

/**
 * Resolve the per-device "Live captions" preference. A stored `'1'`/`'0'` wins;
 * with nothing stored the default FOLLOWS the deployment `streaming_enabled`
 * (on when available — the opt-out default, DEC-11). Anything else → the default.
 */
export function resolveLivePref(stored: string | null, streamingEnabled: boolean): boolean {
  if (stored === '1') return true
  if (stored === '0') return false
  return streamingEnabled
}

/**
 * Normalize one interim decode before it is written into the composer. Trimmed;
 * a blank decode normalizes to the empty string, which `spliceTranscript` then
 * treats as "remove the provisional span" rather than "write whitespace".
 *
 * (Formerly `composeInterimCaption`, when the interim transcript was rendered as
 * a toolbar caption instead of being written into the chat input — see
 * `ui/docs/VOICE_DICTATION_COMPOSER.md` §2.)
 */
export function normalizeInterimTranscript(
  text: string | null | undefined,
): string {
  return (text ?? '').trim()
}
