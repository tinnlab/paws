# voice-composer-insert — FIX ROUND 2

A blind round-2 auditor ran two angles — **regression** ("did any round-1 fix
break something, or fix the symptom rather than the cause?") and **test-reality**
("could each test added in round 1 actually fail if its fix were reverted?") —
over the round-1 fix commit. 10 findings, 6 of them oracle-confirmed by a run.

This round was worth running: **round 1's own fix introduced a new defect**, and
three round-1 fixes shipped with no test that could fail if they were reverted.

---

## Regressions introduced by round 1

### G1 — the seam-collapse removal over-corrected into a DOUBLED SPACE (MEDIUM, oracle)
Round 1 deleted `spliceTranscript`'s seam collapse because it destroyed a user
character on a collapsed span. Correct for a CARET anchor — but wrong for a
SELECTION anchor, where the span being removed covers the user's own word, so the
two surrounding separators become adjacent. I reproduced it before fixing:

```
write : "call Alice tomorrow"  span 5 10
blank : "call  tomorrow"       <-- DOUBLE SPACE? true
```

That violates §3 rule 4 ("no doubled spaces"), and it is reachable on any empty
interim decode during a selection-replacing dictation.

**Fix — and it is a simplification, not another special case.** A blank decode
means *nothing has been dictated yet*, so the composer should look exactly as it
did before the session started. That is not "delete the span"; it is the same
RESTORE that cancel performs. `writeDictation` now branches on the transcript:
non-empty → splice, empty → `restoreSpan(value, span, session.anchorText)`. The
two anchor kinds stop being special cases of each other: a caret anchor restores
`''` (an exact deletion, the round-1 behaviour) and a selection anchor puts the
user's word back — and the session keeps owning it, so the next decode replaces
it rather than appending beside it. `spliceTranscript` keeps the simple, exact
primitive with no seam logic at all.
**Proof:** new component test asserting the word comes back, `not.toMatch(/ {2}/)`,
AND that the following decode still replaces it. Mutation-killed.

### G2 — `nextSelection` compared against the PRE-normalization span (LOW)
The caret was filed against `resolveWriteSpan`'s raw span while the edit was
computed against the clamped one, so a stale anchor past the end of a shortened
draft could leave the caret before the dictated words. Self-correcting on the
next tick, but wrong. **Fix:** clamp before comparing.

### G3 — a dropped transcript still announced "Transcript added" (LOW)
`commitTranscript` returning `undefined` (the owning pane closed, so the
transcript is deliberately discarded) still flipped to idle with the success
announcement — telling a screen-reader user the words landed when nothing was
written. **Fix:** a distinct announcement for the discarded case.

### G4 — the rAF guard's comment overstated what it closes (LOW)
It named an in-app A→B conversation switch, which does not itself bump the
generation token. The guard is correctly placed and does close the
newer-recording / cancel race; the comment now says exactly that, and states the
residual one-frame window instead of implying it is covered.

## Round-1 fixes that shipped with no test that could fail

The auditor mutated each fix and re-ran the suite. Three survived untouched —
i.e. the fix could have been deleted and everything stayed green.

### G5 — the draft-persistence fix (MEDIUM, oracle) — and it was ALSO a no-op
Mutation M6 (delete the `dispatchEvent`) left 16/16 + 27/27 green. Worse, the
auditor independently reproduced what I had already found on the live rig: the
fix did nothing, because a plain `el.value =` goes through React's per-instance
value tracker, so the dispatched `input` event is discarded as a no-op change.
The production fix (write through the PROTOTYPE setter) is committed separately;
this round adds the test that kills it.
**Proof:** a component test that mounts the real kit `Textarea` with a real React
`onChange` and asserts `applyComposerEdit` reaches it. Mutation-killed **twice** —
both by deleting the dispatch (M6) and by reverting to the plain assignment
(M6b), which is the exact no-op form that originally shipped.

### G6 — the cross-pane bail (LOW, oracle)
Mutation M11 (restore `if (!handle) return Chat.$.TextStore`) left everything
green: every existing test drove `paneId === null`, so the pane-registry branch
the fix guards was never entered. A change justified on data-integrity grounds
with no test driving its path is not a fix, it is a hope.
**Proof:** a test that records for a pane whose handle is gone and asserts the
composer is byte-identical after both the interim ticks and Stop. Mutation-killed.

### G7 — the non-finite selection guards (LOW, oracle)
Mutations M9/M10 both left everything green. **Proof:** a unit test driving the
production closure over a stub element reporting `NaN`, asserting it degrades to
"no insertion point" rather than position 0 (which would dictate into the FRONT
of the user's draft). Mutation-killed.

## Test-claim corrections

### G8 — TEST-19's claim exceeded what it exercises (MEDIUM, oracle)
Round 1 replaced a fabricated `selectionStart = null` stub with a real
never-focused composer — correct — but the spec still described itself as
covering INV-5's *no-insertion-point branch*. It does not: assigning `el.value`
moves the cursor to the END per the HTML spec, so the words land through the
ordinary caret path. That IS the real production behaviour and IS INV-5's
user-facing promise, so the spec stays; its comment now states precisely what it
drives and points at TEST-6 for the defensive `null` arm. The claim now matches
the assertion.

### G9 — the toolbar probe's walk-up was unbounded (LOW)
It cannot pass vacuously today (a missing anchor returns null, the caller asserts
`not.toBeNull()`, and the elapsed-timer positive control excludes empty text) —
but only because the mic happens to sit where it does. If it ever moved out of
the composer's action group the loop would climb to `<html>` and return the whole
page's text, and both `not.toContain` assertions would still pass, because a
textarea's live `.value` is not part of `textContent`. **Fix:** bounded to six
levels; beyond that it returns null and the caller fails loudly.

## Verification of this round

| runner | result |
|---|---|
| `voiceLogic.test.ts` (node:test) | **27 pass / 0 fail** |
| `DictationComposer.test.tsx` (vitest) | **20 pass / 0 fail** |
| `npm run check` (ui) | **exit 0** |
| `npm run check` (desktop/ui) | **exit 0** |
| `tsc --noEmit` | **exit 0** |

**Mutation battery** — every fix in this round reverted in turn:

| mutation | result |
|---|---|
| M2 — delete the span instead of restoring it (blank decode) | blank-over-selection test **RED** |
| M6 — delete the `input` dispatch | onChange test **RED** |
| M6b — revert to a plain `el.value =` (the no-op form that shipped) | onChange test **RED** |
| M11 — restore the cross-pane fallback | closed-pane test **RED** |
| M9 — delete the non-finite guard | NaN-selection test **RED** |

**New confirmed findings:** 6 — found by the round-3 blind re-audit (see FIX_ROUND-3.md): one HIGH regression this round introduced, plus untested live behaviour it added.
