# DRIFT-1.md — case-collisions (phase 5, authored live while implementing)

Implementation reconciled against PLAN.md's ITEMs **and** the design source's
`## Invariants`. One entry per divergence found while the code was fresh.

- **DRIFT-1.1** — verdict: impl-wins — PLAN's *Files to touch* said the 99 import
  specifiers live across "**44 files**". The codemod's actual count is **62 files**.
  The 44 was an eyeball estimate from the per-store site listing, never a measured
  figure; the measured one is 62. PLAN.md amended to 62. No ITEM changes — ITEM-2
  is defined by the 99 specifiers, which was correct.

- **DRIFT-1.2** — verdict: impl-wins — PLAN's ITEM-3 described the three non-TS
  references as needing only a path substitution. Two of them turned out to need a
  **semantic** edit, not a substitution: `lint-hooks.mjs` (both workspaces' copies)
  cites `AppLayout` from `@/modules/layouts/app-layout/appLayout` precisely as an
  example of a store proxy that the legacy path-shape heuristic MISSES *because its
  path has no `stores/` segment*. After this branch it has one, so substituting the
  path would have left a comment that argues the opposite of what it shows.
  Resolution: the example was replaced with two stores that still live outside
  `stores/` (`AssistantDrawer`, `Hardware` — 12 such stores remain), with a note
  recording why `AppLayout` moved.
  The third, `lint-hooks.test.mjs:535`, was worse than a stale string: that test
  RESOLVES the specifier against the real tree, so the move would have turned it
  **red** (unresolvable → falls back to path-shape → no `stores/` → not recognised
  as a proxy → 0 findings where 1 was asserted). It now carries three cases: the two
  outside-`stores/` proxies that guard the original property, plus `AppLayout` at its
  new path guarding the resolution path. Verified by running the suite: **61/61 pass**.
  *Neither of these was visible from the plan; both were found by opening the files.*

- **DRIFT-1.3** — verdict: impl-wins — PLAN/DECISIONS (DEC-7) specified the guard's
  two rules but not how a caller distinguishes "clean" from "scanned nothing". A
  guard whose roots silently stopped resolving would print the same green line as one
  that really walked the tree — the fail-open shape this repo has been bitten by
  (`gate:ui` printing a confident `103/106 PASS` over stale data). The guard now
  reports `scanned N directories under M root(s)` on **every** run, and TEST-1/TEST-4
  assert `N > 300` (the real trees walk 623). Added to the guard, not to the plan's
  scope; no ITEM changed.

- **DRIFT-1.4** — verdict: impl-wins — PLAN's ITEM-8 said the e2e spec would open
  "each relocated store's overlay surface". Only **14 of the 24** relocated stores
  back a gallery overlay; the other 10 back pages/widgets (`appLayout`,
  `providerGroupAssignmentCard`, `mcpServerGroupsAssignmentCard`, the four `*Widget`
  stores, and the three onboarding `*Step` stores). Rather than narrow the claim, the
  spec gained a **first clause covering all 24**: it imports each relocated store
  module in the browser and asserts the module is a STORE module, not its component —
  `typeof mod[PascalName] !== 'function'` (a `registerLazyStore` proxy is
  `new Proxy({}, …)`, an object; the component exports the same name as a function),
  plus no `default` export. That clause carries a **positive control** — the same
  assertion aimed at the real `EditUserDrawer.tsx`, which must read `'function'` —
  without which "not a function" would pass vacuously for any path that merely failed
  to expose the symbol. ITEM-8's coverage is therefore wider than planned, not
  narrower.

- **DRIFT-1.5** — verdict: none — PLAN assumed `git mv` of a directory would be
  recorded as renames. Confirmed: `git status` reports **148 R** entries and **zero**
  A/D under `src-app/ui/src`. TEST-6 asserts both, and additionally that every rename
  is exactly "insert `/stores` before the last directory segment".

- **DRIFT-1.6** — verdict: none — INV-2 was the highest-risk invariant on paper ("a
  fix that codegen reverts is not a fix"). Reconciled by measurement, not reasoning:
  the sha256 of all `actions.gen.ts` contents was captured before the move
  (`cffae6ec…`) and after (`cffae6ec…`, identical); `npm run gen:store-actions` then
  reported *"generated/updated 0 actions.gen.ts"* and `npm run check:store-actions`
  exited 0. TEST-5 encodes the whole check so it cannot silently regress.

- **DRIFT-1.7** — verdict: none — the design's §4 exclusions (`use-mobile.ts`/`.tsx`,
  `types/` vs `types.ts`, `constants/` vs `constants.tsx`) required **no special
  case** in the guard: none of them differs in the case of any character, so both
  rules skip them structurally. TEST-2(b) pins this with a fixture containing all
  three shapes, so a future "improvement" to the guard that starts flagging them
  turns red.

**Unresolved drifts:** 0
