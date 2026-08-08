import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as voiceLogic from './voiceLogic.ts'
import {
  appendTranscript,
  insertTranscript,
  isSuperseded,
  micErrorMessage,
  normalizeInterimTranscript,
  relocateSpan,
  resolveLivePref,
  restoreSpan,
  shouldRunInterim,
  spliceTranscript,
} from './voiceLogic.ts'

// ── "insert AT THE CARET, don't send" ─────────────────────────────────────────
// Dictated text lands at the composer's insertion point, replacing a selection
// if there is one, and appends at the end ONLY when there is no insertion point
// at all. The full store flow (record → stream → transcribe → this insert; and
// that sendMessage is never called) is covered by the 14-voice Playwright specs;
// these lock the pure rules the store delegates to.
// Contract: ui/docs/VOICE_DICTATION_COMPOSER.md §3/§4.

// TEST-1 — spliceTranscript replaces the span; caret lands after the transcript.
test('spliceTranscript replaces the span and reports a padding-inclusive written span', () => {
  const edit = spliceTranscript('Please book for Tuesday.', { start: 12, end: 12 }, 'a table')
  assert.equal(edit.value, 'Please book a table for Tuesday.')
  // Caret sits right after "a table", NOT at the end of the value.
  assert.equal(edit.value.slice(0, edit.caret), 'Please book a table')
  // The written span includes the trailing join space, so removing exactly
  // [start, end) restores the original string byte-for-byte.
  assert.equal(edit.value.slice(edit.start, edit.end), 'a table ')
  assert.equal(
    edit.value.slice(0, edit.start) + edit.value.slice(edit.end),
    'Please book for Tuesday.',
  )
})

test('spliceTranscript replaces a SELECTED range, not just a caret', () => {
  const edit = spliceTranscript('call Bob tomorrow', { start: 5, end: 8 }, 'Alice')
  assert.equal(edit.value, 'call Alice tomorrow')
  assert.equal(edit.value.includes('Bob'), false, 'the selected text is gone')
})

// TEST-2 — seam spacing: no doubled space, no glued words, no space before
// closing punctuation, none after an opening bracket, newline counts as space.
test('spliceTranscript joins like a human: no doubled spaces, no glued words', () => {
  const at = (value: string, i: number, text: string) =>
    spliceTranscript(value, { start: i, end: i }, text).value

  assert.equal(at('a ', 2, 'b'), 'a b', 'existing trailing space is not doubled')
  assert.equal(at('a', 1, 'b'), 'a b', 'two words are never glued together')
  assert.equal(at(' b', 0, 'a'), 'a b', 'existing leading space is not doubled')
  assert.equal(at('ab', 1, 'X'), 'a X b', 'both sides padded when both need it')
  // The reproduced case: caret between the two spaces of "book  for".
  assert.equal(
    at('Please book  for next Tuesday.', 12, 'a table'),
    'Please book a table for next Tuesday.',
  )
})

test('spliceTranscript never wedges a space before closing punctuation', () => {
  const at = (value: string, i: number, text: string) =>
    spliceTranscript(value, { start: i, end: i }, text).value

  for (const close of ['.', ',', ';', ':', '!', '?', ')', ']', '}']) {
    assert.equal(at(close, 0, 'hi'), `hi${close}`, `no space before "${close}"`)
  }
  for (const open of ['(', '[', '{', '"']) {
    assert.equal(at(open, 1, 'hi'), `${open}hi`, `no space after "${open}"`)
  }
})

test('spliceTranscript treats a newline as whitespace (no pad added)', () => {
  const edit = spliceTranscript('line one\n\nrest', { start: 9, end: 9 }, 'two')
  assert.equal(edit.value, 'line one\ntwo\nrest')
})

// TEST-3 — a blank transcript REMOVES the span, and removal is byte-EXACT.
// This is the reversibility property the whole session design rests on, and the
// case that shipped broken: an earlier version tidied whitespace across the seam
// and so ate one of the user's own characters.
test('spliceTranscript with a blank transcript removes exactly the span it wrote', () => {
  // Round trip: write over a caret, then blank it out → byte-for-byte original.
  const draft = 'Please book  for next Tuesday.'
  const written = spliceTranscript(draft, { start: 12, end: 12 }, 'a tabl')
  assert.equal(written.value, 'Please book a tabl for next Tuesday.')
  const cleared = spliceTranscript(
    written.value,
    { start: written.start, end: written.end },
    '',
  )
  assert.equal(cleared.value, draft, 'write → blank must restore the draft EXACTLY')
  assert.equal(cleared.start, cleared.end, 'the written span is now empty')
  assert.equal(cleared.caret, cleared.start)
})

test('spliceTranscript with a blank transcript at a COLLAPSED span changes nothing', () => {
  // The first interim decode commonly comes back empty, and it is applied over
  // the zero-length anchor span. Removing "nothing" must remove NOTHING — this
  // previously deleted one of the two spaces in the user's untouched draft, and
  // no cancel could put it back.
  for (const draft of ['Please book  for next Tuesday.', 'a b', ' ', '', 'trailing ']) {
    for (const i of [0, 1, Math.floor(draft.length / 2), draft.length]) {
      const edit = spliceTranscript(draft, { start: i, end: i }, '')
      assert.equal(
        edit.value,
        draft,
        `blank at collapsed span ${i} of ${JSON.stringify(draft)} must be a no-op`,
      )
    }
  }
})

test('spliceTranscript never splits a surrogate pair', () => {
  // JS indices are UTF-16 code units; a naive slice at 2 would cut the emoji in
  // half and leave two lone surrogates in the user's message.
  const value = 'a\u{1F44D}b'
  const edit = spliceTranscript(value, { start: 2, end: 2 }, 'X')
  assert.equal([...edit.value].every(c => c.codePointAt(0)! < 0xd800 || c.codePointAt(0)! > 0xdfff), true)
  assert.equal(edit.value.includes('\u{1F44D}'), true, 'the emoji survives intact')
})

// TEST-4 [acceptance, INV-1] — the transcript lands AT THE CARET, and the caret
// is left after it. Append-at-end (the shipped defect) cannot satisfy this.
test('insertTranscript writes at the caret, NOT at the end of the value', () => {
  const value = 'Please book  for next Tuesday.'
  const edit = insertTranscript(value, { start: 12, end: 12 }, 'a table')
  assert.equal(edit.value, 'Please book a table for next Tuesday.')
  assert.equal(
    edit.value.endsWith('a table'),
    false,
    'INV-1: the transcript must NOT be appended at the end',
  )
  assert.equal(edit.value.slice(0, edit.caret), 'Please book a table')
})

// TEST-5 — a selection is REPLACED.
test('insertTranscript replaces an existing selection', () => {
  const edit = insertTranscript('call Bob tomorrow', { start: 5, end: 8 }, 'Alice')
  assert.equal(edit.value, 'call Alice tomorrow')
  assert.equal(edit.value.slice(0, edit.caret), 'call Alice')
})

// TEST-6 [acceptance, INV-5] — no insertion point → append at the end, exactly
// as before, WITH a negative control proving the two paths really differ.
test('insertTranscript with NO caret appends at the end (INV-5), and the caret path does not', () => {
  const value = 'Please book  for next Tuesday.'
  const transcript = 'a table'

  // The state a never-focused composer ACTUALLY reports. A mounted <textarea>
  // whose value was assigned imperatively (which is how the draft-restore effect
  // fills it) reports selectionStart === value.length — so this, not `null`, is
  // the shape production hands in for "the user never put a caret anywhere".
  const atEnd = insertTranscript(value, { start: value.length, end: value.length }, transcript)
  assert.equal(atEnd.value, 'Please book  for next Tuesday. a table')
  assert.equal(atEnd.caret, atEnd.value.length, 'caret at the end')
  assert.equal(
    atEnd.value,
    appendTranscript(value, transcript),
    'the never-focused composer appends, exactly as it always has',
  )

  // `null` is the DEFENSIVE case only (no element / a control with no selection
  // API); it must behave identically so the fallback can never diverge.
  const appended = insertTranscript(value, null, transcript)
  assert.equal(appended.value, atEnd.value)
  assert.equal(appended.caret, atEnd.caret)

  // NEGATIVE CONTROL: if insert-at-caret ever silently degrades back to
  // append-at-end, these two become equal and this fails.
  const atCaret = insertTranscript(value, { start: 12, end: 12 }, transcript)
  assert.notEqual(
    atCaret.value,
    appended.value,
    'insert-at-caret must not produce the append-at-end result',
  )
})

// TEST-7 — a blank decode is a true no-op and must not eat a selection.
test('insertTranscript is a no-op for blank speech and never eats a selection', () => {
  const value = 'keep my selected draft'
  const selection = { start: 5, end: 16 } // "my selected"
  for (const blank of ['', '   ', '\n\t ']) {
    const edit = insertTranscript(value, selection, blank)
    assert.equal(edit.value, value, `blank transcript ${JSON.stringify(blank)} changes nothing`)
    assert.equal(edit.start, selection.start, 'the selection is preserved')
    assert.equal(edit.end, selection.end)
  }
  assert.equal(insertTranscript(value, null, '  ').value, value)
})

// TEST-8 — relocate / detach.
test('relocateSpan keeps, relocates, or detaches the span the session owns', () => {
  // Exact hit → unchanged.
  const value = 'Hello provisional words end'
  assert.deepEqual(relocateSpan(value, { start: 6, end: 23 }, 'provisional words'), {
    start: 6,
    end: 23,
  })
  // The user typed BEFORE the span → re-adopt the shifted offsets.
  const shifted = 'Hi! Hello provisional words end'
  assert.deepEqual(relocateSpan(shifted, { start: 6, end: 23 }, 'provisional words'), {
    start: 10,
    end: 27,
  })
  // The user edited our text away → detach.
  assert.equal(relocateSpan('Hello edited-by-user end', { start: 6, end: 23 }, 'provisional words'), null)
  // An EXACT hit at the recorded offsets wins even if the same text also
  // appears elsewhere — those offsets are the strongest evidence it is ours.
  assert.deepEqual(relocateSpan('ab ab', { start: 0, end: 2 }, 'ab'), { start: 0, end: 2 })
  // But once the offsets no longer hold it, an ambiguous search detaches rather
  // than guessing which occurrence was ours.
  assert.equal(relocateSpan('ab ab', { start: 6, end: 8 }, 'ab'), null)
  // Nothing written yet → only an in-bounds zero-length span is locatable.
  assert.deepEqual(relocateSpan('abc', { start: 3, end: 3 }, ''), { start: 3, end: 3 })
  assert.equal(relocateSpan('abc', { start: 0, end: 2 }, ''), null, 'non-empty span, nothing written')
  assert.equal(relocateSpan('abc', { start: 9, end: 9 }, ''), null, 'out of bounds')
})

// TEST-9 — cancel restores byte-exactly (INV-4's pure half).
test('restoreSpan reproduces the pre-dictation string byte-for-byte', () => {
  // A session that replaced the selection "Bob" and added a trailing join pad.
  const before = 'call Bob tomorrow'
  const written = spliceTranscript(before, { start: 5, end: 8 }, 'Alice Smith')
  assert.equal(written.value, 'call Alice Smith tomorrow')

  const restored = restoreSpan(written.value, { start: written.start, end: written.end }, 'Bob')
  assert.equal(restored.value, before, 'byte-for-byte back to the original draft')
  // …and the originally-selected text is re-selected.
  assert.equal(restored.value.slice(restored.start, restored.end), 'Bob')
})

test('restoreSpan also unwinds an insertion made at a bare caret', () => {
  const before = 'Please book  for next Tuesday.'
  const written = spliceTranscript(before, { start: 12, end: 12 }, 'a table')
  const restored = restoreSpan(written.value, { start: written.start, end: written.end }, '')
  assert.equal(restored.value, before)
  assert.equal(restored.start, restored.end, 'a bare caret is restored, not a selection')
})

// TEST-10 — appendTranscript's four historical contracts, UNCHANGED. These are
// the tests that previously certified the append-at-end defect; they are kept as
// the specification of the NO-CARET path (INV-5), not deleted.
test('appendTranscript appends onto existing composer text, space-joined', () => {
  assert.equal(appendTranscript('Hello', 'world'), 'Hello world')
})

test('appendTranscript does NOT replace existing text', () => {
  // Regression guard for the "insert not overwrite" contract.
  assert.notEqual(appendTranscript('draft in progress', 'new words'), 'new words')
  assert.equal(appendTranscript('draft in progress', 'new words'), 'draft in progress new words')
})

test('appendTranscript into an empty composer yields just the transcript', () => {
  assert.equal(appendTranscript('', 'hello there'), 'hello there')
})

test('appendTranscript trims the transcript and is a no-op for blank speech', () => {
  assert.equal(appendTranscript('kept', '   '), 'kept', 'blank transcript leaves text unchanged')
  assert.equal(appendTranscript('kept', ''), 'kept')
  assert.equal(appendTranscript('a', '  b  '), 'a b', 'surrounding whitespace is trimmed')
  // Additionally correct now that the join is seam-aware: a draft that already
  // ends in whitespace no longer gets a doubled space.
  assert.equal(appendTranscript('a ', 'b'), 'a b', 'no doubled space')
})

// TEST-11 — the module's exported surface matches the contract its header
// documents, so a renamed/removed helper cannot leave a stale doc-comment
// describing a contract the code no longer has. (The companion half — that the
// voice STORE no longer carries an `interimText` field — asserts against the
// live store instance in `components/DictationComposer.test.tsx`, because this
// node:test runner cannot resolve the store's `@/api-client` import graph.)
test('voiceLogic exports exactly the surface its header documents', () => {
  assert.deepEqual(
    Object.keys(voiceLogic).sort(),
    [
      'appendTranscript',
      'insertTranscript',
      'isSuperseded',
      'micErrorMessage',
      'normalizeInterimTranscript',
      'normalizeSpan',
      'relocateSpan',
      'resolveLivePref',
      'restoreSpan',
      'shouldRunInterim',
      'spliceTranscript',
    ],
    'a renamed/removed helper must be reflected in the module doc-comment too',
  )
})

// ── generation-token guard: a superseded result is dropped ────────────────────

test('isSuperseded is false while the request is still current (result kept)', () => {
  assert.equal(isSuperseded(5, 5), false)
})

test('isSuperseded is true once a cancel/newer request bumped the token (result dropped)', () => {
  assert.equal(isSuperseded(5, 6), true)
  assert.equal(isSuperseded(0, 1), true)
})

// ── getUserMedia rejection → user-facing error classification ─────────────────

test('micErrorMessage maps a permission denial to the "denied" message', () => {
  for (const name of ['NotAllowedError', 'SecurityError']) {
    const msg = micErrorMessage(new DOMException('nope', name))
    assert.match(msg, /denied/i, `${name} should be a permission denial`)
    assert.match(msg, /allow it in your browser/i)
  }
})

test('micErrorMessage maps a non-permission failure to the no-microphone message', () => {
  const generic = micErrorMessage(new DOMException('boom', 'NotFoundError'))
  assert.match(generic, /no microphone available/i)
  // A plain Error (not a DOMException) is also treated as no-microphone.
  assert.match(micErrorMessage(new Error('whatever')), /no microphone available/i)
})

// ── streaming (live-caption) decision helpers (TEST-9) ────────────────────────

const cap = (streaming_enabled: boolean, stream_interval_ms = 1000) => ({
  streaming_enabled,
  stream_interval_ms,
})

test('shouldRunInterim is true ONLY while recording with streaming available + pref on', () => {
  assert.equal(shouldRunInterim('recording', cap(true), true), true)
  // Off in every other status even with everything else on.
  for (const s of ['idle', 'requesting', 'transcribing', 'error']) {
    assert.equal(shouldRunInterim(s, cap(true), true), false, `status ${s} must not run interim`)
  }
  // Off when the deployment doesn't offer streaming, or the pref is off, or no capability.
  assert.equal(shouldRunInterim('recording', cap(false), true), false, 'deployment streaming off')
  assert.equal(shouldRunInterim('recording', cap(true), false), false, 'device pref off')
  assert.equal(shouldRunInterim('recording', null, true), false, 'no capability')
})

test('resolveLivePref honors a stored value and otherwise follows streaming_enabled', () => {
  // Stored value wins.
  assert.equal(resolveLivePref('1', false), true, "stored '1' → on")
  assert.equal(resolveLivePref('0', true), false, "stored '0' → off")
  // Unset → default follows the deployment toggle (opt-out default).
  assert.equal(resolveLivePref(null, true), true, 'unset + streaming on → default on')
  assert.equal(resolveLivePref(null, false), false, 'unset + streaming off → default off')
  // Any unexpected stored value falls back to the default.
  assert.equal(resolveLivePref('yes', true), true, 'garbage stored → default')
})

test('normalizeInterimTranscript trims, and a blank decode normalizes to empty', () => {
  assert.equal(normalizeInterimTranscript('  hello world  '), 'hello world')
  // Empty is what `spliceTranscript` reads as "take the provisional words away".
  assert.equal(normalizeInterimTranscript('   '), '')
  assert.equal(normalizeInterimTranscript(null), '')
  assert.equal(normalizeInterimTranscript(undefined), '')
})
