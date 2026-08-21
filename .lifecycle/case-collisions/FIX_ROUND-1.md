# FIX_ROUND-1.md — case-collisions

Round 1 of the phase-6/7 loop. Tier is **HEAVY** (1031 changed lines at the time of
the phase-5 gate), so the full loop applies rather than the single LIGHT round.

## Angles run (blind, diff-only context, fresh agents)

Three, genuinely different in kind, each handed `git diff main...HEAD` and the
worktree and NOTHING of the author's reasoning:

| angle | roster | why it was chosen |
|---|---|---|
| `correctness` | core | the diff is a resolver-semantics change; "does it still resolve to the same thing" is the primary risk |
| `design-conformance` | core, **REQUIRED** | audited against the DESIGN (`case-collisions.md`) + its 7 non-negotiables, never against PLAN.md |
| `tests-quality` | core | a conditional angle warranted because most of the added lines ARE tests, and a hollow guard would certify its own absence |

## What the round found

**22 findings, 20 triaged `confirmed`, 2 `rejected`/working-as-intended.** Full rows in
`LEDGER.jsonl`. The round was not a formality — it found a defect that invalidates the
branch's headline claim, and two ways the new tests would have lied.

### The one that mattered — a 25th collision, corroborated by 2 angles

`src-app/ui/src/modules/workflow/components/builder/` holds `AgentStepForm.tsx` (the
component) beside `agentStepForm.ts` (its pure helpers). TypeScript probes `.ts`
**before** `.tsx`, so `import { AgentStepForm } from './AgentStepForm'`
(`StepConfigPanel.tsx:5`, `workflow/gallery.tsx:556`) resolves to the **helpers** on a
case-insensitive filesystem — byte-identical mechanism to the 24, one shape over
(file-vs-file instead of file-vs-directory).

Both auditors reproduced the consequence with real `tsc`
(`TS2305: Module '"./AgentStepForm"' has no exported member 'AgentStepForm'`). I
re-verified independently: the pair exists, has exactly two non-self import sites, and
a widened file-vs-file scan over `src-app` + `sdk` + `scripts` + `agent-kit` finds
**this and only this** pair repo-wide.

**The branch's stated outcome was not achieved before this round.** The macOS build
would still have failed — on a different file, for the same reason. The design said
*"Enumerate them yourself; do not trust this count blindly"*; my phase-5 detector
inherited the design's file-vs-directory framing and so re-derived the same 24 without
questioning the shape. That is the lesson from this round: I verified the COUNT and
not the CLASS.

Fixed: `agentStepForm.ts` → `agentStepForm.helpers.ts` (+ its test), mirroring the
existing `messageViewState.helpers.ts` / `downloadProgress.helpers.ts` convention; two
import sites updated. **The guard now reports 25 on the pre-fix tree and 0 on this
one.**

### The guard was blind to the shape that was live in the tree

Rule 1 compared a file stem to a sibling DIRECTORY only, so it called the tree clean
while `AgentStepForm.tsx`/`agentStepForm.ts` sat in it, and its own header asserted
"the tree is at zero findings, so an escape hatch would be a hole with no occupant" —
which was false. Three more guard defects, each reproduced with a fixture:

- **fails OPEN** — `readdirSync` errors were swallowed and the scan count was a single
  aggregate, so `--root=src --root=../desktop/ui/srcXX` printed OK/exit 0, and an
  unreadable directory containing a real collision was reported clean;
- **missed `X.desktop.tsx` vs `x/`** — the desktop resolver probes the `.desktop`
  infix ahead of a directory, and that exact pair
  (`ProviderGroupAssignmentCard.desktop.tsx`) was live on `origin/main` until the
  store move dissolved it incidentally;
- **roots too narrow** — `tests/` (in both tsconfigs' `include`) and `sdk/packages/*/src`
  (compiled through `@ziee/*`) were unscanned.

The rewrite adds one rule per real resolver probe (three total, each mapped to a
documented probe order — a bounded rule set, not a growing pile of predicates), fails
closed on any root or directory it cannot walk, reports **per-root** counts, dedupes
roots and findings, handles symlinks, and covers **11 roots / 728 directories**.

### Two ways the new tests would have lied

- **B6, in my own test file.** `TEST-6`/`TEST-7` asserted
  `git diff origin/main...HEAD` was non-empty. Post-merge `HEAD == origin/main`, the
  diff is empty, and `npm run check` fails on main **permanently** — rule B6's exact
  failure mode, reached through a branch-relative git assumption instead of a
  `.lifecycle/` path, and sitting three lines from the test that exists to prevent it.
  Reproduced by an auditor on a simulated merged tree (5 pass / 2 fail). Both tests now
  fall back to a durable tree-shape assertion when there is no base diff. **Verified by
  pointing `refs/remotes/origin/main` at HEAD and re-running: 7/7, then restored.**
- **A vacuity floor that a real mutation walked straight through.** The anti-vacuity
  check was `scannedDirs > 300` against a real 623 — so adding `components` to the
  guard's `SKIP_DIRS`, skipping every subtree the 24 collisions lived in, left the
  whole suite green; so did hardcoding the counter to a lie. The test now
  **recomputes** the directory count per contracted root and `deepEqual`s it against
  the guard's per-root report. **I re-ran both mutations after the fix: both now turn
  TEST-1 RED.**

### The e2e spec proved less than it claimed

Clause 1 imported an explicit `/<path>/index.ts` — which skips extension probing, *the
entire mechanism of the bug* — so its failure message ("the case collision is back")
could not fire on any platform. Its discriminator was also satisfied by an ABSENT
value for 5 of 24 stores, and the `.not.toContain('default')` leg's premise was false
for 20 of 24 components.

Rewritten: it now imports the **bare directory specifier** (verified served —
`curl` of `/modules/.../stores/editUserDrawer` returns the store index, so Vite runs
the same probe walk the compiler does), pairs each store with its component module,
and asserts (a) the store exports something the component does not, (b) the component
exports ≥1 function — a **per-store** control, so no pair's assertion is vacuous, and
(c) any shared name is not a function in the store. Each overlay case now also asserts
**which** drawer opened. The unproven `appLayoutSeam` claim was removed from the header
rather than backed by a self-fulfilling assertion.

Also fixed: `TEST-8` passed against a `tsconfig` that compiled **nothing** (reproduced
with `files: []`) — it now asserts `--listFilesOnly` > 1000 files including the named
moved modules; `TEST-5`'s write leg was tautological *and* wrote into the tracked tree
during `npm run check` — it now regenerates from a wiped copy in a temp dir; the spec
and the tsc oracle were run by nothing — both now have runners
(`gallery.config.json` `visualSpecs`, `test:case-collisions:tsc`), asserted by TEST-3.

### Deliberately not fixed (recorded, not silently dropped)

- **No CI runs the guard.** True, and out of scope: this repo ships exactly two
  tag-triggered workflows by design (CLAUDE.md). Adding UI CI is a separate change.
- **The two hub detail-drawer gallery entries mount nothing** (rendered prop-less; both
  components `return null` without props). Pre-existing; neither component file is in
  this diff.
- **`user/gallery.tsx:101`'s `surface:` typo.** I began fixing it and stopped: every
  generated registry already carries the PascalCase surface and
  `overlay-allowlist.json` allow-lists it as "not a standalone story", so correcting
  the typo makes that entry stale and fails `check:overlay-registry` until several
  generated artifacts are regenerated. A generated-artifact cascade over pre-existing
  debt is what design §4 rules out.

All three are in `HUMAN_FEEDBACK.md` and go in the PR body.

## Verification of this round (scoped to the round's diff, per phase 7)

- `node --test scripts/lint-case-collisions.test.mjs` — **7/7**
- the two mutations above re-applied and reverted — **both now RED**, confirming the
  vacuity fix bites
- post-merge simulation (`origin/main` → HEAD) — **7/7**, ref restored and re-verified
- `npm run test:case-collisions:tsc` — **2/2**
- `npx playwright test -c playwright.visual.config.ts store-case-collision.spec.ts` — **13/13**
- `node scripts/lint-case-collisions.mjs` — 0 findings across 11 roots / 728 dirs; **25**
  findings when aimed at the unfixed parent clone

**New confirmed findings:** PENDING — round 2 (blind, over THIS round's diff) has not
run yet. This number is written only after it does; anything else here would be a
number I made up.
