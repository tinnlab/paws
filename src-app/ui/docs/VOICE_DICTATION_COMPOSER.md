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

### §2.2 — The same run, after the change

Identical harness, identical audio, identical rig backend (a dev server for the
fixed frontend proxied at `/api` to the same running ziee, so whisper is the
same real runtime). Log: `/data/pbya/ziee/tmp/voice-repro/after/REPRO.log`.

```
BEFORE  value="Please book  for next Tuesday." caret= 12
== RECORDING ==
  t+2.4s  composer="Please book  for next Tuesday."                                          | toolbarCaption=null
  t+3.6s  composer="Please book And so my fellow America for next Tuesday."                   | toolbarCaption=null
  t+4.8s  composer="Please book And so my fellow Americans ask for next Tuesday."             | toolbarCaption=null
  t+7.2s  composer="Please book And so my fellow Americans ask not what you are coming from\n. for next Tuesday."
== STOP ==
AFTER   value="Please book And so my fellow Americans, ask not what your country can\n do for you. for next Tuesday."
AFTER   caret= 82 (len 100)
```

Every promise in §3 is visible in that trace: the words appear in the CHAT INPUT
while recording (INV-2), each interim revises the previous one in place rather
than accumulating, the text lands at index 12 — where the caret was — with the
draft's own words intact on both sides (INV-1), the final transcript supersedes
the interim, and the caret ends at 82 of 100 rather than at the end.
`toolbarCaption` is `null` at every sample: nothing transcript-shaped renders in
the toolbar any more. Frames: `after/02-recording.png`, `after/03-after.png`.

### §2.3 — What the audit loop cost, and what it bought

Six blind audit rounds ran over this change. **Rounds 1-5 each found a defect
introduced by the previous round's fix**, and every one of them was in the same
mechanism: a caret/selection remembered at record start.

| round | the defect that round's fix introduced |
|---|---|
| 1 → 2 | removing a seam-collapse fixed a caret anchor but produced a doubled space for a selection anchor |
| 2 → 3 | routing a blank decode through "restore" was safe only once a span was owned; on the first write it re-inserted text the user had deleted |
| 3 → 4 | the staleness guard was vacuous for a bare caret, so a replaced draft still "held" and the final transcript landed mid-word |
| 4 → 5 | deleting the anchor as a WRITE target left its text as the RESTORE payload, decoupling a pair that had held by construction |
| 5 → 6 | *(none — clean)* |

Rounds 4 and 5 stopped adding guards and changed the structure instead: delete
the mechanism, then restore the pairing. Round 6 found no new defect, which is
what ended the loop.

The lesson is recorded here rather than in a commit message because it is a
property of the DESIGN, not of any one fix: **state remembered at time T and
consulted at time T+n is a defect generator when the user can edit in between.**
The composer already holds the live insertion point; reading it is always
correct and never goes stale. Anything this feature must remember (what was
replaced) is captured at the moment it is known to be true.

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
restores exactly" possible. It holds exactly two things: the `[start, end)` span
this session has WRITTEN (padding included) with the exact string written there,
and the text that span REPLACED, for cancel to put back.

**It deliberately remembers nothing from record start.** An earlier design
captured the caret/selection when recording began and consulted it to decide
where to write. Five successive audit rounds each found a defect in that one
mechanism, always the same shape: the remembered position goes stale — the user
types, deletes, or replaces the draft while the first second of audio decodes —
and every guard against staleness is incomplete. For a bare caret a guard is not
merely incomplete but *vacuous*: the captured text is `''`, and
`value.slice(n, n) === ''` for any in-range `n`, so a wholly replaced draft
still "holds". The anchor was never needed: nothing overwrites the user's
selection until dictation itself does, and once it has, the written span is the
thing to relocate. See §2.3.

- **write** — resolve the target as either the span this session owns
  (relocated) or, owning none, the composer's LIVE caret/selection. Splice the
  transcript over it, then adopt the new span. The caret follows the words only
  if the user was editing inside them; a caret elsewhere is left alone (rule 7).
- **capture** — on the FIRST write, record what is being replaced, taken from
  the same normalized span the splice uses. This pairing — *this span once held
  this text* — is the invariant restore depends on, and capturing it at write
  time makes it hold by construction rather than by a check.
- **relocate** — before each write, verify the owned span still holds exactly
  what was written. If the user typed elsewhere and shifted it, find it and
  re-adopt its offsets.
- **detach** — if the written text can no longer be found, the user has edited
  what dictation wrote. Dictation gives it up: it stops writing interims, and
  the final transcript is inserted at the user's CURRENT caret instead. The
  user's edit is never overwritten.
- **restore** — cancel/supersede/blank-decode puts the captured text back into
  the owned span and re-selects it. A blank decode is a restore, not a deletion:
  deleting the span is only equivalent when a bare caret was replaced. A
  detached session restores nothing (the text is the user's now); a FAILED
  transcription also restores nothing, because the audio is gone and the
  streamed words are the only record of what was said (DEC-13).

Span bounds INCLUDE the join padding, so removing a span restores the
surrounding text byte-for-byte. Span normalization (ordering, and widening off
UTF-16 surrogate boundaries) is applied ONCE and shared by the capture, the
splice and the caret comparison — three different normalizations would let the
restore payload be sized differently from what was replaced.
