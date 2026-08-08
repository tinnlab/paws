# voice-composer-insert — FIX ROUND 5

A blind round-5 auditor ran **regression** and **test-reality** over the round-4
commit. 6 findings (2 HIGH, 4 LOW).

Round 4 deleted the stale-anchor mechanism as a WRITE TARGET. Round 5 found that
it left the same anchor's text in place as the RESTORE PAYLOAD — and those two
had previously been paired by construction.

---

## The regression

`restoreSpan`'s whole invariant is "this span once contained this text". While
the anchor decided both where to write AND what to restore, that pairing held
automatically. Once round 4 changed where-to-write to the LIVE selection but
left what-to-restore captured at record start, the two could describe different
regions — and cancel then spliced seconds-old text over whatever the user had
since put there.

Reproduced: select `Bob` in `call Bob tomorrow`, start recording, re-select
`tomorrow`, let a decode land there, cancel → `tomorrow` is replaced by a second
`Bob`. **A blank decode did the same thing mid-recording with no user action at
all** — and a blank decode is the most common decode there is, since the first
second of audio usually decodes to nothing.

**Fix: restore the pairing rather than guard it.** The payload is captured at
FIRST-WRITE time, from the span actually being replaced. The invariant then
holds by construction again. The session no longer remembers anything from
record start, and the now-unread `anchor` field is deleted.

## A conclusion of mine that the audit falsified

Round 4 removed the `final` caret flag, reasoning that `focusComposer` applies
the caret `writeDictation` returns, so the flag had no observable effect. The
auditor showed that reasoning is wrong: that deferred pass is generation-guarded
and DROPPED when superseded, which strands the caret at the mid-recording
position permanently. The post-Stop caret is now applied **synchronously**, and
the test asserts it BEFORE any settle — so it fails if the work is left to the
deferred pass. Recorded because the earlier justification is in the round-4
commit message and was wrong.

## Verification

| runner | result |
|---|---|
| `voiceLogic.test.ts` (node:test) | **27 pass / 0 fail** |
| `DictationComposer.test.tsx` (vitest) | **30 pass / 0 fail** |
| `npm run check` (ui) | **exit 0** |
| `npm run check` (desktop/ui) | **exit 0** |
| e2e `tests/e2e/14-voice` (post-merge, 45 tests) | **44 pass / 1 fail — flaky, see below** |

| mutation | result |
|---|---|
| capture the restore payload at RECORD START (the round-4 shape) | 3 tests **RED** |
| drop the synchronous post-Stop caret apply | 1 test **RED** |

## The one e2e failure is a pre-existing flake, not a regression

`visual-states.spec.ts` fails exactly one of its four tests per run, and **which
one changes between runs of the same commit**:

- run A — `admin page renders cleanly (unprovisioned empty state)`:
  `console-error: Error calling endpoint GET /api/mcp/defaults: TypeError: Failed to fetch`
- run B — `composer mic states render cleanly (idle → record → transcribe)`:
  `console-error: Error calling endpoint GET /api/memory/admin/fts/rebuild/status: TypeError: Failed to fetch`

Both are `Failed to fetch` — connection refused — on background pollers
(`/api/mcp/defaults`, `/api/memory/admin/fts/rebuild/status`) firing while the
per-test backend shuts down, collected by `attachHealthProbe`'s console-error
listener. Neither endpoint has anything to do with voice or the composer, and
this branch touches neither subsystem.

**Measured on pristine `origin/main` (`3af6120ef`), not inferred.** The same
spec file, run in a separate worktree checked out at main with this branch's
changes entirely absent:

```
✓ composer mic states render cleanly (idle → record → transcribe)   14.9s
✓ live-caption recording state renders cleanly                      16.5s
✓ admin page renders cleanly (provisioned)                          14.1s
✘ admin page renders cleanly (unprovisioned empty state)            13.8s
  1 failed, 3 passed (10.3m)
```

So `visual-states.spec.ts` does NOT pass cleanly on main either — the same
1-of-4 shape. Its failure there is a THIRD distinct assertion
(`expect(received).toBeGreaterThanOrEqual(expected): Expected >= 3, Received 0`),
which strengthens rather than weakens the conclusion: three runs across two
commits produced three different failures in one spec file. The honest claim is
therefore the narrow one — this spec file is unstable on this box independent of
this branch, so "44/45" is not evidence of a regression. It is NOT a claim that
the branch and main fail identically; they do not.

For contrast, the full 45-test suite passed **45/45 on this branch immediately
before merging current main**, which is when those background pollers arrived.

## Loop status — five rounds, five regressions

| round | findings |
|---|---|
| 1 | 25 |
| 2 | 10 |
| 3 | 6 |
| 4 | 9 |
| 5 | 6 |

Decaying overall but not monotonically, and every round has found a regression
introduced by the previous round's fix — all of them in one function's handling
of the record-start anchor. Rounds 4 and 5 both responded structurally (delete
the mechanism; restore the pairing) rather than with another guard, which is the
re-scope the ABORT rule prescribes, applied before the rule fired. A sixth round
is running against round 5's diff; the skill's cap is six, so if it is not clean
this escalates rather than continuing.

**New confirmed findings:** 0 — earned. The round-6 blind re-audit found **no new
defect** in the round-5 commit; it drove 18 probe scenarios through the shipped
component harness across all four hunts and every one came back clean, with the
mutation battery confirming the round-5 tests kill their defects (M2 — reverting
to the round-4 record-start capture — reddens exactly the three new TEST-24
tests, verifying the commit message's claim verbatim). Its six findings were all
low: two documentation, three provably-inert/equivalent mutants, and one
pre-existing surrogate issue that fails identically on the parent commit. The
actionable ones are closed in `bd457e6ca`. **The loop is converged.**
