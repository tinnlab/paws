# voice-composer-insert — FIX ROUND 3

A blind round-3 auditor ran **regression** and **test-reality** over the round-2
fix commit, pinned to `c096bb2d1`. 6 findings, 5 oracle-confirmed.

**Round 2's own fix introduced a HIGH regression.** That is now three rounds in a
row where the fix for one defect created another — a pattern worth naming
explicitly rather than treating each as bad luck. The common shape: each fix
moved logic into a path whose *preconditions* were weaker than the path it came
from.

---

## The regression round 2 introduced

### H1 — a blank first decode resurrected text the user had deleted (HIGH, oracle)
Round 2 routed a blank decode through `restoreSpan(...)` instead of deleting the
span. Correct once the session OWNS a span — that path is guarded by
`relocateSpan`, which detaches if the user edited the text away. But on the
**first** write `session.span` is still null, so `resolveWriteSpan` returned the
raw record-start anchor with **no guard at all**. Round 1's version could only
DELETE through that unguarded span (harmless if stale); round 2's turned it into
an **INSERT** of the anchor's text.

A blank first decode is the common case — the first second of audio usually
decodes to nothing. The auditor's probe:

> select `Bob` in `call Bob tomorrow`, start recording, user clears the
> composer, first interim blank → composer contains **`"Bob"`**. The same probe
> on `c096bb2d1~1` leaves it `''`.

Deleted text reappears. **Fix — two changes, both narrowing preconditions rather
than adding a special case:**

1. A blank decode with nothing written yet is a **no-op**. There is nothing to
   undo, so there is nothing to restore. (The restore path now runs only where
   `relocateSpan` guards it.)
2. A blank decode *after* a write restores and then returns the session to the
   "nothing written" state — re-anchored to where the restored text actually
   sits, with `span = null` and `written = ''`. That also closes the audit's
   separate LOW finding that the session was claiming the user's own restored
   word as its span (a duplicate of that word elsewhere in the draft could make
   `relocateSpan` ambiguous and silently kill live dictation mid-recording).

### H2 — the stale record-start anchor was honoured unconditionally
The same root cause, one level up: the anchor could be arbitrarily stale by the
time the first decode lands. It is now honoured **only while it still HOLDS the
text captured with it**; otherwise dictation goes where the user's caret is now.
A bounds check alone is not enough — a longer replacement draft leaves the stale
offsets perfectly in range and pointing at unrelated text, which is exactly what
the test drives.

### H3 — `writeDictation` returned a bool, so a blank final read a cleared span
`commitTranscript` did `if (writeDictation(...)) { const span = session.span; …
span.end … }`. After the round-2 blank branch cleared `session.span`, a blank
FINAL transcript would read `null.end`. `writeDictation` now returns the caret
directly; the caller never reaches back into session state it does not own. This
also fixed the audit's LOW about the trailing-join-pad heuristic running over a
restore result, which had no join pad.

### H4 — "Transcript discarded" announced when there was nothing to discard
The ternary ordering put `!delivered` first, so an EMPTY transcript on a closed
pane told a screen-reader user their words had been discarded. Reordered: no
speech wins.

### H5 — the span clamp was dead code, and it disagreed with the real normalization
The audit flagged the round-2 clamp as live-but-untested. Investigating it showed
something better than a missing test: once `resolveWriteSpan` was fixed (H2) the
clamp became **unreachable** — every branch now returns an in-range span (a
relocated span was found IN this value; an honoured anchor is bounds-checked; the
fallbacks are the live selection or end-of-text). It was also a *third* different
normalization, disagreeing with `spliceTranscript`'s own `normalizeSpan` (which
additionally orders the span and widens it off surrogate boundaries), so
`nextSelection` could compare against a span neither the splice nor the caller
used. **Removed** (§15) rather than given a test that could only ever pass.

## Tests — and two of mine were wrong

Three behaviours the audit proved had no failing test now have one, each
mutation-killed. More usefully: **two of my first attempts at these tests passed
against a deliberately broken mutant**, and the mutation battery is what caught
that — not the green run.

- The first blank-decode test asserted "the composer stays cleared", which the
  broken version ALSO satisfied, because deleting the guard made
  `relocateSpan(value, null, …)` throw inside the interim loop's catch. The test
  could not distinguish "correctly did nothing" from "crashed and did nothing".
  It now drives the actual round-2 shape as the mutant.
- The stale-anchor test used a SHORTER replacement draft, so the stale offsets
  fell out of range and were clamped to the same place the fix chose — both
  versions produced the same string. It now uses a longer draft, where the stale
  offsets are in range and point somewhere genuinely different.
- Both also had to wait for record-start's deferred focus/caret restore before
  simulating the user's edit; without that, the rAF re-applied the anchor
  selection over the new draft and the test measured the harness, not the code.

## Verification of this round

| runner | result |
|---|---|
| `voiceLogic.test.ts` (node:test) | **27 pass / 0 fail** |
| `DictationComposer.test.tsx` (vitest) | **23 pass / 0 fail** |
| `npm run check` (ui) | **exit 0** |
| `tsc --noEmit` | **exit 0** |

**Mutation battery:**

| mutation | result |
|---|---|
| R3-M1 — restore over the raw anchor on a blank first decode (the round-2 shape) | **RED** |
| R3-M2 — honour the record-start anchor unconditionally | **RED** |
| R3-M4 — `delivered = true` | **RED** |

## E2E

The suite run against round 2 was **43 passed / 2 failed**; every legacy voice
spec passed and both failures were my own new specs racing the one-time privacy
hint. That hint is a Popover portalled over the textarea, so it intercepts
pointer events — and it mounts only once the capability fetch resolves, so a
click-based dismissal right after navigation can run before it exists, find
nothing, and let it appear a moment later. The spec now seeds the same
localStorage key the component itself writes, per navigation, which is
deterministic from first paint.

## Audit-process note

The round-3 auditor copied the worktree with `cp -a` to run its mutations. That
copies git's `.git` *pointer file*, so a `git checkout <sha> -- <file>` inside
the copy wrote into the **shared index** of the real repo — leaving a REVERT of
the round-2 fixes staged, while the working tree stayed correct. A routine
`git add -A && git commit` would have silently shipped the reverted code with a
green suite. Caught by reading `git status`'s `MM` (index AND worktree differ)
rather than assuming `M`, and reset. Recorded in HUMAN_FEEDBACK as a
generalizable rule: an audit sandbox must not inherit the repo's gitdir, and the
index must be verified — not just the working tree — before any commit in a
worktree an agent has touched.

**New confirmed findings:** (round-4 blind re-audit pending)
