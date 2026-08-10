# DRIFT-1 — implementation vs plan (authored during phase 5)

- **DRIFT-1.1** — verdict: impl-wins — PLAN ITEM-3 said "Reset the boundary when
  the location changes", assuming a `useLocation()`-style signal. `AppShell` sits
  ABOVE the router (the router is one of the module components it renders), so
  react-router context does not exist at that level. Implemented as
  `useHistoryEpoch` (a `useSyncExternalStore` over `popstate`/`hashchange` plus a
  call-through patch of `pushState`/`replaceState`), passed to the boundary as
  `resetKeys`. PLAN + DECISIONS DEC-3 amended; behaviour matches the intent
  exactly. Also added an explicit user-driven "Try again" affordance, because the
  router crash removes the nav UI, so an automatic-only recovery would leave a user
  with nothing to click.

- **DRIFT-1.2** — verdict: impl-wins — DEC-5 asserted both workspaces `extends`
  `sdk/packages/config/biome.base.json`, so enabling the rule there would cover
  both. FALSE for the desktop workspace: `src-app/desktop/ui/biome.json` has no
  `extends` and is a standalone copy. Enabling only in the base would have left
  desktop unguarded — the same "configured somewhere that does not run" failure the
  branch exists to fix. Rule now set in BOTH; TEST-6 asserts both independently so
  the wrong assumption cannot silently return.

- **DRIFT-1.3** — verdict: impl-wins — PLAN ITEM-4 assumed enabling the rule in
  biome config was sufficient. It is not: `npm run check`'s biome step is
  `biome lint --only=style/noRestrictedImports src`, which runs ONLY that rule, so
  a newly-enabled rule would execute nowhere. This is precisely the defect class
  under repair (a guard deferred to a rule that was never switched on), so it was
  treated as a first-class finding rather than a config detail: added a chained
  `lint:hooks-top-level` script in both workspaces, and TEST-6 asserts the chaining
  itself, not merely the config value.

- **DRIFT-1.4** — verdict: impl-wins — a SECOND, independent guard hole was found
  while validating ITEM-4 and became ITEM-6: `lint-hooks.mjs` could not see a store
  proxy exported as a bare-identifier alias (`export const File = FileInner`), so it
  reported "OK — 0 violations across 2597 files" while 15 real violations existed.
  Added to PLAN as ITEM-6 with a verdict, covered by TEST-6's alias known-positive +
  negative control, and the 15 sites fixed. Scope grew deliberately: leaving the
  hole open would have meant declaring the defect class closed while the guard that
  is supposed to enforce it still lied.

- **DRIFT-1.5** — verdict: resolved — TESTS.md originally claimed TEST-7 was a
  crash regression test for `SearchKnowledgeToolResultCard`. Measured against the
  pre-fix file, the spec PASSES, so that claim was false: the component's other
  hook is a `useContext`, which occupies no hook-list slot, making the real
  transition 1 slot → 0 — a direction React's leftover check cannot detect. Rather
  than delete the test or leave an inflated claim, its purpose was narrowed to
  behaviour-preservation for the split (which is the real risk the refactor
  carries), the measurement was recorded in both the spec header and TESTS.md, and
  static detection for that site was attributed to TEST-6 where it belongs. The
  siblings in the same sweep were later MEASURED too (DRIFT-1.7).

- **DRIFT-1.6** — verdict: none — ITEM-1 and ITEM-2 landed exactly as planned,
  each with an observed RED before the fix and GREEN after, plus (for ITEM-2) a
  negative control re-introducing `fallback={() => null}` and confirming all four
  specs fail.

- **DRIFT-1.7** — verdict: resolved — a claim I had propagated into PLAN, TESTS,
  DRIFT, the ledger and two spec headers was WRONG: that `ImageContent` (0↔4) and
  `MessageFilesView` (0↔2) were crash-capable "because growing the slot count IS
  detected". Measuring the full matrix in this environment (React 19 + jsdom)
  disproved it — `0→1, 1→0, 0→2, 2→0` are all silent; only `1→2, 2→1, 1→3, 3→1`
  throw. `renderWithHooks` picks the MOUNT dispatcher when the previous render left
  `memoizedState === null`, so a zero-slot render is compared against nothing. The
  correct account: those two sites were a SILENT defect (orphaned
  `useEffect`/`useSyncExternalStore` ratcheting `FileStore.__refCount`, plus React's
  own `Expected static flag was missing` internal error), and `ChatMessage` (7 → 6)
  is the sole crash and sole white-screen source. Every artifact and spec header
  carrying the wrong claim was corrected rather than left standing.

**Unresolved drifts:** 0
