# FIX_ROUND-2.md — case-collisions

Round 2 of the phase-6/7 loop: a blind re-audit **of round 1's fix diff only**
(`6eae3f8c3..HEAD`, `.lifecycle/` excluded), per phase 7's scope rule — not the whole
tree again.

## Angles run

Two, blind, fresh, diff-only context, no access to my reasoning or to round 1's ledger:
`correctness` and `design-conformance` (the required angle, judged against
`case-collisions.md` and its seven non-negotiables — never against PLAN.md).

## The headline: the bug class IS gone, verified without trusting my guard

The design-conformance auditor refused to take `lint-case-collisions.mjs`'s word for
it and built two independent detectors with a **wider** probe set, plus a
**case-insensitive resolution simulator**: for every import specifier in both
workspaces (with each tsconfig's full `paths` map applied) it resolves twice — once
against the real case-sensitive filesystem, once through a case-INSENSITIVE sibling
lookup in TypeScript's probe order — and diffs the results.

```
origin/main : FINDINGS=26   (24 file-vs-dir + AgentStepForm + 1 dup line)
branch HEAD : FINDINGS=0
whole repo on disk (1245 dirs, incl. sdk/agent-kit/server/.lifecycle): 0
specifiers examined=10331  resolved=10324  DIVERGENT=0
```

The simulator is not vacuous — its self-test reproduces both real shapes
(`linux=index.ts / macos=EditUserDrawer.tsx`, `linux=AgentStepForm.tsx /
macos=agentStepForm.ts`). `tsc --noEmit` exit 0 in both workspaces; a real
`vite build` of the desktop app succeeded (8856 modules). The `sdk` gitlink is
byte-identical to `origin/main` and `git -C sdk status` is clean, so the design's
STOP-and-report condition was never triggered.

**That is the strongest evidence available short of a macOS runner**, and it is
external to my own guard.

## What round 2 found — 22 findings, 20 confirmed, 2 rejected

Three MEDIUM+ items, all in **round 1's own work**. The pattern is worth naming: round
1 fixed the product and then introduced its defects in the fixing.

### The one I got wrong twice — a permanent gate carrying a one-time claim

Round 1 discovered that `TEST-6`/`TEST-7` asserted `git diff origin/main...HEAD` was
non-empty, and would fail on main forever. I fixed the post-merge case and called it
done. The correctness auditor then reproduced **two more triggers I had not closed**,
using a `git` shim on `PATH` rather than touching the worktree:

- **any future branch that relocates a store** takes the branch path and hits
  `assert.equal(dirs.size, 24)` — a number that describes this diff and nothing else;
- **any branch cut from a stale base** re-sees these 24 renames *plus* its own
  additions and trips `assert.deepEqual(srcAD, [])`.

Both would have broken `npm run check` for people whose changes had nothing to do with
this work. The real defect was structural, not a missing guard clause: **a permanent
gate cannot carry a one-time claim.** The provenance assertions now live in their own
`lint-case-collisions.provenance.test.mjs` with its own runner, deliberately unchained,
and the chained suite reads no git at all (grepping it for `origin/main` returns only
comments). TEST-3 asserts both halves of that separation so it cannot quietly erode.

### An identity check that did not identify

My round-1 overlay assertion used title regexes. The design-conformance auditor tested
the spec's own docstring claim adversarially — navigate to slug A, assert slug B's
regex — and found **8 of 10 cross-pairings PASSED**: `/group/i` matched three different
drawers, `/provider/i` two. So swapping two gallery entries, precisely the "wrong store
resolved" outcome the spec exists to catch, would have kept it green.

Replaced with per-drawer `data-testid` markers captured from the live gallery, plus
TEST-13 asserting the markers are mutually exclusive so they cannot drift back. Re-ran
the same adversarial cross-pairing after the fix: **0 of 132 wrong pairings pass, 12 of
12 correct ones do.**

### A guard about case, comparing case-sensitively

`resolverStems` used case-SENSITIVE `endsWith` for both the extension and the
`.desktop` infix — modelling a case-insensitive filesystem with case-sensitive suffix
comparisons. Two reproduced false negatives: `Foo.Desktop.tsx` beside `foo/` (the
desktop resolver builds the literal `foo.desktop.tsx`, which stats as that on macOS)
and `Widget.TSX` beside `widget/`, both exit 0. Fixed and pinned by TEST-2(g).

### The rest

- **sdk was blocking with no exit.** Both workspaces compile `sdk/packages/*/src`, so a
  collision there really would break the macOS build — but `ziee-ai/sdk` is not
  pushable from here and the guard has no allowlist, so a finding would have made
  `npm run check` unpassable until an upstream release. sdk roots are now **advisory**:
  reported in full, naming the upstream repo, not blocking. The eight owned trees stay
  fail-closed, and TEST-1 asserts they are not advisory so the classification cannot be
  inverted. (DEC-15.)
- **sdk absent → silent OK**, dropping 7 of 11 roots while the adjacent case
  (`sdk/packages` empty) was FATAL. Now an explicit NOTE.
- **`test:case-collisions:tsc` ran nowhere**, so its anti-vacuity assertions — the ones
  guarding against a `tsconfig` that compiles nothing — did not exist on main. Chained
  into `check`; DEC-13 CORRECTION records that my original reasoning was wrong about
  *which* of its assertions were duplicates.
- Under-reporting when several files share a stem (only one named — the operator fixes
  half a pair); symlinked directories skipped without saying so; roots not deduped by
  realpath; the `plugins/` and `scripts/` trees missing from a root list whose docstring
  claimed "every compiled tree"; magic thresholds (`>= 110`, `>= 90`) one and five above
  the measured values, replaced by the ratio the claim actually makes; one dead config
  branch. All fixed and pinned.

**Rejected (2):** TEST-3 being a wiring-only proof (correct, and stated at its site —
TEST-2 carries the logic, and 13 independent mutations of guard behaviour were all
killed by it); and the `.desktop` infix rule applying in trees where no resolver probes
it (over-strict, can only false-POSITIVE, and scoping it per-root would add a branch to
buy nothing).

## Independent corroboration of the guard's non-vacuity

The design-conformance auditor built a symlink overlay of the workspace and applied
**eight** targeted mutations to the guard. **All eight turned the suite RED** — including
the two that had walked straight through round 1's threshold (`SKIP_DIRS += components`,
and inflating the self-reported count). That is the property the anti-vacuity rewrite
was for, confirmed by someone who did not write it.

## GUARD-SUB check (phase-7 tripwire)

Round 2's confirmed findings by file: guard ≈ 8, tests ≈ 5, spec ≈ 1 — **~57% on the
guard, under the 60% threshold**, and round 1 is exempt anyway. I am treating this as a
warning rather than a trip, for a specific reason: each guard finding is a decidable
property of a filesystem walk that maps to a documented resolver probe, not another
spelling of a semantic pattern — the unbounded-evasion-space shape GUARD-SUB exists to
stop. The behavioural check GUARD-SUB would prescribe already exists **and was run by
an auditor**: the case-insensitive resolution simulator over 10,324 live specifiers.
If round 3 again lands ≥60% on this one file, that is a trip and I escalate rather than
running round 4.

## Verification of this round (scoped to the round's diff)

- `node --test scripts/lint-case-collisions.test.mjs` — **6/6**
- `node --test scripts/lint-case-collisions.provenance.test.mjs` — **2/2**
- `npm run test:case-collisions:tsc` — **2/2**
- gallery spec — **14/14** (12 overlays + module identity + marker exclusivity)
- adversarial cross-pairing — **0/132 wrong pass, 12/12 correct pass**
- guard on the real trees — 0 findings, 15 roots, 732 dirs, sdk correctly labelled advisory
- each newly-fixed guard behaviour re-verified against a fixture: `Foo.Desktop.tsx`,
  `Widget.TSX`, `Thing.MTS`, the multi-owner stem, and the symlink NOTE

**New confirmed findings:** 20
