# Voice dictation → the composer (design of record)

Where dictated speech goes, and when. This document is the design source for the
`voice-composer-insert` lifecycle; it exists because the previous behaviour was
never written down as a contract, only as an implementation.

---

## §1 — The reported defects (verbatim)

Two defects, reported by the product owner against the shipped feature:

1. > "The voice transcribed, it should be appending in chat input after the last
   > where cursor is put, not on the tools"
2. > "Also make sure that it has real time transcribe"

## §2 — Reproduction (measured on the live rig, before any change)

Driven against a **real** running ziee (`http://127.0.0.1:1520`) with a **real**
whisper runtime (`/api/voice/capability` → `can_transcribe: true`, model `base`,
`streaming_enabled: true`, `stream_interval_ms: 1000`). The only faked component
is the microphone DEVICE — a `MediaRecorder` stand-in feeding real recorded
speech (`server/tests/voice/fixtures/jfk.wav`) — so both `/api/voice/transcribe`
and `/api/voice/transcribe/stream` performed real work. Harness + full log:
`/data/pbya/ziee/tmp/voice-repro/{repro.mjs,REPRO.log}`; frames `01-before.png`,
`02b-toolbar-zoom.png`, `03-after.png`.

Scenario: a half-written message `"Please book  for next Tuesday."` with the
caret at index **12** (between `book ` and ` for`) — i.e. exactly "where the
cursor is put" — then dictate.

```
BEFORE  value="Please book  for next Tuesday." caret= 12
== RECORDING ==
  t+1.2s  composer="Please book  for next Tuesday."  |  toolbarCaption=null
  t+2.4s  composer="Please book  for next Tuesday."  |  toolbarCaption="And so my fellow America"
  t+3.6s  composer="Please book  for next Tuesday."  |  toolbarCaption="And so my fellow America"
  t+4.8s  composer="Please book  for next Tuesday."  |  toolbarCaption="And so my fellow Americans ask"
  t+6.0s  composer="Please book  for next Tuesday."  |  toolbarCaption="And so my fellow Americans ask not what you are coming from\n."
== STOP ==
AFTER   value="Please book  for next Tuesday. And so my fellow Americans, ask not what your country can\n do for you."
AFTER   caret= 101 (== end of value)
```

Both defects reproduce exactly, and the two are ONE story:

- **"not on the tools" is literal.** The live transcript is rendered ONLY in an
  `aria-hidden`, `max-w-48`, `dir="rtl"`-clipped `<span>` **inside the composer
  TOOLBAR row** — inline between the tool icons (`+`, compact, schedule) and the
  recording dot / timer / Stop / Cancel controls (`02b-toolbar-zoom.png`). "The
  tools" is the toolbar. The chat input is untouched at every sample. The source
  states the behaviour as intended: *"Live-caption preview (transient,
  visual-only … **Never written to the composer.**"*
  (`components/MicButton.tsx:186-200`).
- **The final transcript ignores the caret.** `appendTranscript` is
  `current ? \`${current} ${text}\` : text` (`voiceLogic.ts:21-25`) — it has no
  concept of a caret, so the words land at the END of the value (caret 12 →
  inserted at 30), and the caret is left at the end of the value rather than
  after the inserted words.
- **Streaming is not missing — it is mis-routed.** Four `/transcribe/stream`
  calls returned progressively longer REAL transcripts while recording. Defect
  (2) is therefore not "build streaming"; it is that the stream never reaches
  the place the user is looking at.

### §2.1 — A latent defect found while reproducing

`_engine.ts::focusComposer` locates the textarea with
`document.querySelector('[data-testid="chat-message-textarea"]')`. The
production build **strips every `data-test*` attribute**
(`ui/plugins/vite-plugin-remove-data-test.js`, enabled for non-dev/non-test
builds in `vite.config.ts:87`). So focus-return after dictation is a **no-op in
every shipped build** — it only ever worked in dev/e2e. Any design that promises
"the caret ends up where you keep typing" must not depend on a testid query.

## §3 — Intended behaviour

**Dictation is an editor input, not a form submission.** It behaves the way the
platform dictation the user already knows behaves (macOS / Windows / mobile
keyboards): words appear in the field you are editing, at the insertion point,
while you speak, and are revised in place until you stop.

1. **Lands at the insertion point.** Dictated text is inserted at the composer's
   caret. A selection is REPLACED by it. The caret is left immediately AFTER the
   inserted text so the user keeps typing naturally.
2. **Appends when there is no insertion point.** If the composer was never
   focused there is no caret; dictation then appends at the end — the historical
   behaviour, preserved exactly.
3. **Streams into the composer.** While recording, each interim decode REPLACES
   the provisional span written by the previous decode, in place, in the chat
   input. The final authoritative transcript replaces that same span on Stop.
   Nothing about the transcript is rendered in the toolbar.
4. **Joins like a human would.** No doubled spaces, no glued-together words, no
   space wedged before a closing `.`/`,`/`)`.
5. **A cancelled or superseded recording leaves the composer EXACTLY as it was**
   — byte-for-byte value, and the original caret/selection restored.
6. **Dictation never sends.** It only ever edits the composer's text.
7. **The user's own typing always wins.** If the user edits the span dictation
   owns, dictation gives that text up rather than clobbering it.

## §4 — Invariants (non-negotiable)

- **INV-1**: "it should be appending in chat input after the last where cursor is
  put, not on the tools" — dictated text is inserted at the composer's caret (a
  selection is replaced), the caret is left after the inserted text, and NO
  transcript text is rendered in the composer toolbar.
- **INV-2**: "Also make sure that it has real time transcribe" — while the user
  is speaking, the transcript appears progressively IN THE CHAT INPUT, not only
  when recording stops.
- **INV-3**: "a transcript is … never replacing it and — by construction — never
  triggering a send" (`voiceLogic.ts:8-9`, verbatim) — dictation only ever edits
  the composer's text; it has no send path.
- **INV-4**: "Every await below re-checks this token and bails if superseded."
  (`voiceStore/actions/_engine.ts:422`, verbatim) — a cancelled / superseded /
  unmounted recording must leave the composer exactly as it was, and no late
  result may write into it.
- **INV-5**: when the composer has no caret at all (never focused), dictation
  appends at the end — `appendTranscript`'s existing contract, unchanged.

> **INV-3 amendment, on the owner's instruction.** `voiceLogic.ts`'s docstring
> also said the transcript is "APPENDED to the existing composer text
> (space-joined)". Defect report (1) overrides that clause: append-at-end is
> replaced by insert-at-caret, with append-at-end retained as the no-caret case
> (INV-5). The never-replace-the-draft and never-send clauses are UNCHANGED and
> remain binding. Recorded as DEC-1.

## §5 — Mechanism

Three layers, each independently testable:

| layer | file | role |
|---|---|---|
| pure policy | `extensions/voice/voiceLogic.ts` | caret/selection splice + seam spacing + span relocation. No DOM. |
| DOM access | `extensions/text/textStore/` | registered closures over the composer `ref` — read the selection, apply a value+selection, focus. No testid query. |
| orchestration | `extensions/voice/voiceStore/actions/_engine.ts` | owns the per-recording **dictation session** and calls the two above. |

**The dictation session** is the state that makes "revise in place" and "cancel
restores exactly" possible. Captured at record start: the anchor selection and
the text it covered. Maintained across interim ticks: the `[start, end)` span
this session has WRITTEN (padding included) and the exact string written there.

- **write** — splice the new transcript over the owned span (first write splices
  over the anchor, replacing a selection if there was one), then adopt the new
  span. The caret is placed after the transcript, before any trailing pad.
- **relocate** — before each write, verify the owned span still holds exactly
  what was written. If the user typed elsewhere and shifted it, find it and
  re-adopt its offsets.
- **detach** — if the written text can no longer be found, the user has edited
  what dictation wrote. Dictation gives it up: it stops writing interims, and
  the final transcript is inserted at the user's CURRENT caret instead. The
  user's edit is never overwritten.
- **restore** — cancel/supersede puts the anchor's original text back into the
  owned span and re-selects it. A detached session restores nothing (the text is
  the user's now).

Span bounds INCLUDE the join padding, so removing a span restores the
surrounding text byte-for-byte.
