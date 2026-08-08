# voice-composer-insert — FIX ROUND 1

Two blind angles ran over `git diff origin/main...HEAD` (excluding the
mechanically-generated gallery/testid artifacts): **design-conformance** (the
required angle — audited against `ui/docs/VOICE_DICTATION_COMPOSER.md` and its
INV-1..INV-5, not against PLAN.md) and **correctness + concurrency/state**.
25 findings in `LEDGER.jsonl`; **13 corroborated by both angles independently**.

The audit was worth the round: it found a **data-destroying** defect in the
shipped diff that all of my own tests were green on.

---

## Promoted to work (corroborated ≥2, or severity data-loss)

### F1 — `spliceTranscript` ate one of the user's characters, unrecoverably (HIGH ×2)
`voiceLogic.ts` — the blank-transcript branch collapsed whitespace across the
seam. Both angles reproduced it; I reproduced it independently before fixing:

```
draft      : "Please book  for next Tuesday."
after blank: "Please book for next Tuesday."     DESTROYED : true
cancel back: "Please book for next Tuesday."     RECOVERED : false
write→blank: "Please book for next Tuesday."     EXACT     : false
```

Reachable on the FIRST interim decode, which commonly returns nothing — so a
draft was corrupted before a single word had been dictated, and INV-4's
"byte-for-byte" promise was false. **Root cause:** the collapse was redundant AND
harmful, because a written span already INCLUDES its join padding — removing the
span is exact by construction. The collapse then removed one character too many.
**Fix:** deleted the collapse; the invariant is now structural rather than
patched, with a comment recording why it must not come back.
**Proof:** TEST-3 rewritten to assert the ROUND TRIP (write → blank ⇒ byte-exact)
plus a table of collapsed-span cases. Mutation-checked: reinstating the collapse
turns it RED (26 pass / 1 fail).

### F2 — cancel re-selected the user's own text at stale offsets (HIGH ×2)
`_engine.ts` — `cancelRecording` passed `dictation.anchor` to `focusComposer`
unconditionally, so after a DETACHED session (the user edited the provisional
words) the composer ended focused with three characters of the **user's own
text** selected; the next keystroke would delete them. It also overwrote the
correct restored selection when the user had typed before the span
(`"call Bob tomorrow"` → selection landed on `"l B"` instead of `"Bob"`).
**Fix:** `restoreDictation` now RETURNS the span it actually restored, or `null`
when it restored nothing; cancel re-selects only that. Nothing restored ⇒ the
selection is left strictly alone.
**Proof:** two new component tests. Mutation-checked: restoring the old
`restored = dictation.anchor` turns both RED.

### F3 — an offset splice could be applied to ANOTHER pane's composer (HIGH/MEDIUM ×2)
`_engine.ts` — `ownerTextStore` fell back to the FOCUSED pane when the owning
pane's handle had been unregistered. That fallback predates this branch, but it
was previously consulted once and could only strand a stray transcript; this
branch consults it on every interim tick, on restore and on commit, with
ABSOLUTE offsets computed against a different draft — so it could delete or
overwrite an arbitrary range of another conversation's text. The correctness
angle reproduced Stop writing `"FINAL TRANSCRIPT"` into the other pane.
**Fix:** `ownerTextStore` returns `null` when the owning pane is gone, and every
write/restore/commit/focus path BAILS instead of falling back.

### F4 — the "nothing in the toolbar" assertions could not fail (MEDIUM ×2)
`dictation-caret-insert.spec.ts` — `[data-testid="chat-input-toolbar"]` **exists
nowhere in the repo**, and the only `[role="group"]` was unmounted by the time
the assertion ran, so `[].join(' ')` made `not.toContain(...)` pass
unconditionally. Four `voice-live-caption` `toHaveCount(0)` assertions were
likewise tautologies against an element this diff deleted. INV-1's headline
clause — the user's actual complaint — was certified by nothing.
**Fix:** a `toolbarRowText()` probe that locates the REAL toolbar row from two
controls that genuinely live in it, reads it **mid-recording** (the only moment
a caption surface could exist), fails loudly if the row cannot be found, and
carries a positive control (`/0:0\d/` — the elapsed timer) proving it is reading
the toolbar and not an empty set. The tautologies are deleted.

### F5 — dictated text was never persisted, so a conversation switch wiped it (MEDIUM ×2)
`composerAccess.ts` — imperative `el.value =` fires no event, and `setDraft` runs
only from `TextInput`'s `onChange`. I had recorded this as out-of-scope (DEC-9)
on the grounds that it was pre-existing. Both angles independently escalated it,
and they are right: this change makes dictation the composer's PRIMARY content
producer, so "dictate a paragraph → switch conversation → come back → the
draft-restore effect writes the stale draft over the whole transcript" is now a
routine data-loss path rather than a corner.
**Fix:** `applyComposerEdit` dispatches a native `input` event, so dictated text
persists exactly as typed text does. DEC-9 revised.

## Promoted on severity (single-angle, data-loss / user-data decision)

### F6 — a failed transcription DELETED the words the user had watched appear
`_engine.ts` — my own DRIFT-1.6 had extended INV-4's restore to the `fail()`
path. The design-conformance angle correctly objected that INV-4 enumerates
*cancelled / superseded / unmounted* — all cases where the USER asked for the
recording to go away — and that a backend error is not one of them. When
transcription fails the audio is already gone, so the streamed words are the
only surviving record of what the user said; discarding them to tidy up after
our own failure destroys the user's only copy.
**Fix:** `fail()` keeps the provisional words and surfaces the error beside them;
it only closes the session. It now also clears the session ONLY when this pane
owns it, since `fail()` can run before the recording lock is taken.
**Proof:** new component test TEST-17.

### F7 — every interim tick yanked the caret away from a user typing elsewhere
`_engine.ts` — §3 rule 7 ("the user's own typing always wins") was implemented
for span ownership but not CARET ownership. With live dictation on, a user
editing at position 3 while dictation writes at position 50 had their caret
moved about once a second, so their keystrokes landed inside the dictated span —
which then tripped `relocateSpan` into detaching.
**Fix:** `nextSelection()` — the caret follows the words only when it was inside
the span being rewritten; a caret before the span is untouched, one after it is
shifted by the length delta so it stays on the same characters.
**Proof:** new component test. Mutation-checked: forcing the old
always-follow behaviour turns it RED.

### F8 — the INV-5 acceptance tests were hollow (HIGH, single angle, verified)
Both TEST-19 (e2e) and TEST-6 (unit) manufactured the no-caret state with
`Object.defineProperty(el, 'selectionStart', { get: () => null })`. The angle
verified in Chromium that a mounted `<textarea>` NEVER reports that: one whose
value was assigned imperatively — exactly what the draft-restore effect does —
reports `selectionStart === value.length`. So production `readSelection()` never
returns `null`, the whole null branch was unreachable, and the REAL never-focused
path was untested; a regression putting dictation at the FRONT of a restored
draft would have left both green.
**Fix:** TEST-19 now drives the genuine never-focused composer with nothing about
the DOM fabricated (and asserts the textarea is not the active element). TEST-6
pins the REAL production shape (caret at end) as the primary case and keeps
`null` explicitly as the defensive no-element fallback, asserting the two agree
so they cannot diverge. INV-5 turns out to hold genuinely — but now for a
reason a test actually demonstrates.

## Fixed as cheap hardening (single angle, low)

- **rAF focus helper had no epoch guard** — a conversation switch during the
  deferred frame could force a stale caret into the new draft and steal focus.
  Now guarded by the generation token, and applied synchronously when `rAF` is
  absent rather than dropping the caret restore entirely.
- **UTF-16 surrogate splitting** — a span landing between the halves of an emoji
  could leave lone surrogates. `normalizeSpan` now SNAPS a collapsed caret past
  the pair and WIDENS a real range outward. (My first attempt widened the caret
  too, which deleted the emoji — caught by the new test, which is why it is a
  test and not an assertion of intent.)
- **Non-finite selection offsets** silently meant "append at the end";
  `readSelection` now rejects them so they mean "no insertion point", like every
  other unusable-selection case.
- **The live toggle still said "Turn live captions on/off"** — naming a surface
  this change deleted, while actually gating whether real-time dictation happens
  at all. Relabelled to "Turn on/off live dictation — show words in the message
  as you speak". The state field + storage key keep the `liveCaptions` name so no
  user's stored preference is churned.
- **A false comment in the component harness** claimed a new engine yields clean
  module-scope session state. It does not — the session, recorder and generation
  token are module scope by design (the recording lock is what makes that safe).
  Corrected; isolation comes from `afterEach`'s `cancelRecording()`.
- **`mic-button-gating.spec.ts`'s trivially-true** `toHaveValue('')` on an
  unpermitted user's untouched composer — deleted.

## Rejected / not promoted

- **`acquireRecordingLock(null)` always succeeds** (single angle, low) — correct
  as designed: `null` is the single-pane route, where there is exactly one
  composer and nothing to exclude. The `DictationSession` doc comment leans on
  the lock only for the MULTI-pane case, which does hold. No change.
- **Captions-OFF inserts at the caret at STOP time rather than the RECORD-time
  anchor** (single angle, low) — the auditor called it defensible and it is: it
  is MORE consistent with rule 7 (the user's current position wins). Documented
  in the design doc's §5 rather than changed, so the divergence is deliberate
  and stated.
- **The three pre-existing `data-testid` runtime dependencies elsewhere in the
  tree** (`keyboard/extension.tsx`, `CitationChip.tsx`,
  `BuilderValidationPanel.tsx`) — the same latent class as §2.1, correctly
  identified, but outside this diff. Recorded in HUMAN_FEEDBACK as a
  generalizable follow-up rather than scope-crept into this branch.

## Verification of this round

Every fix was landed first, then measured once:

| runner | result |
|---|---|
| `voiceLogic.test.ts` (node:test) | **27 pass / 0 fail** |
| `DictationComposer.test.tsx` (vitest) | **16 pass / 0 fail** |
| `npm run check` (ui) | **exit 0** |
| `npm run check` (desktop/ui) | **exit 0** |
| `tsc --noEmit` | **exit 0** |

**Mutation battery** — each fix was reverted in turn to prove its test can fail:

| mutation | result |
|---|---|
| `nextSelection` always follows the words | caret-ownership test **RED** |
| `restored = dictation.anchor` (old cancel) | detach + shifted-restore tests **RED** (2) |
| reinstate the seam collapse | round-trip test **RED** |

**New confirmed findings:** (round-2 blind re-audit pending — see FIX_ROUND-2.md)
