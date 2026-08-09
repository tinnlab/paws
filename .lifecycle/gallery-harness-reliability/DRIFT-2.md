# DRIFT-2 — round 2 (ITEM-23, ITEM-24) implementation vs plan

Round 2 exists because the owner ruled on the three items phase 3 was holding
RED (DEC-D2) and directed two further fixes that the branch had FOUND but not
FIXED — both recorded as open human feedback rather than quietly shipped:
FB-6 (the React-warning severity misclassification) and FB-7 (the parity guard's
own consumer coupling). Both are now ITEMs with tests, not loose fixes.

Authored DURING implementation, item by item, not backfilled.

---

## ITEM-23 — channel-independent console classification

- **DRIFT-2.1** — verdict: none — implemented as planned: `REACT_WARNING`,
  `errSeverity` and the whole console decision moved into
  `lib/finding-classify.mjs::classifyConsoleMessage(type, state, text)`, which
  both crawl copies now call. Red-then-green observed verbatim: the new test
  first failed with `SyntaxError: The requested module './finding-classify.mjs'
  does not provide an export named 'classifyConsoleMessage'`, then 23/23 pass.

- **DRIFT-2.2** — verdict: impl-wins — the plan said "fix the severity"; the
  implementation ALSO deletes the per-copy duplicates of `REACT_WARNING` and
  `errSeverity`. That is more than the stated fix, and deliberately so: leaving
  the list duplicated would mean the next React-version change has to be made in
  two files again, which is the exact drift INV-6 is about. PLAN's ITEM-23 was
  amended to say so rather than leaving the extra scope undeclared.

- **DRIFT-2.3** — verdict: none — `ERRORBOUNDARY` became an unused import in both
  crawl copies once the classification moved; removed (CODING_GUIDELINES §15,
  dead code is unfinished work). It remains exported from the classifier, where
  it is used.

- **DRIFT-2.4** — verdict: impl-wins — a new `console-classification` parity core
  was added, which the plan did not call for. Without it this fix is exactly the
  kind that can land in one copy only — the failure INV-6 names. Verified it
  actually bites: the consumer test mutates the desktop copy's
  `classifyConsoleMessage` away and asserts the guard goes RED, and the guard now
  reports `4 live copies … all 5 behavioural cores` (was 4).

## ITEM-24 — parity guard config inversion

- **DRIFT-2.5** — verdict: none — `LIVE_COPIES` / `REQUIRED` / `ROLE` are gone
  from the shared package; `checkParity(readFile, copies)` takes the copies it is
  handed, and `resolveHarnessCopies(cfg)` reads them from `gallery.config.json`.
  `CORES` (the behaviour vocabulary) correctly STAYS shared — it is not a
  consumer fact.

- **DRIFT-2.6** — verdict: impl-wins — the plan's option was "consumer supplies
  paths via config", which read naturally as an inline array per workspace. Two
  workspaces would then each carry the same 4-entry list — re-creating, in the
  guard's own configuration, the duplication the guard exists to catch. The
  implementation therefore also supports a manifest STRING resolved against the
  MANIFEST's directory, and ziee points both workspaces at one root
  `gallery-harness-copies.json`. Inline arrays still work for a single-workspace
  consumer. PLAN's ITEM-24 amended to state the manifest form.

- **DRIFT-2.7** — verdict: none — B6 checked explicitly: the manifest is a
  committed product-tree file at the repo root, NOT a `.lifecycle/` artifact, so
  it survives the merge strip that would otherwise break `npm run check` on main
  permanently.

- **DRIFT-2.8** — verdict: resolved — the inversion opened a vacuous-pass hole
  the original did not have: "no copies configured" could mean "standalone
  package" (legitimately nothing to check) or "someone deleted the config key"
  (a gate that has silently stopped gating). Closed three ways, each with a test:
  a configured-but-unreadable manifest THROWS, a malformed one THROWS, and an
  unknown core id is an ERROR rather than a skipped check. The remaining
  "no key at all ⇒ exit 0" case is the standalone one and says so on stdout;
  ziee's own tree is protected by the consumer acceptance test, which asserts the
  key is present and resolves to the committed manifest.

- **DRIFT-2.9** — verdict: impl-wins — the plan spoke only of the guard. Its TEST
  had the same defect (it read ziee's real tree from inside the shared package),
  so the split had to cover the test too: the package test now drives synthetic
  fixtures, and the real-tree acceptance case moved to
  `src-app/ui/scripts/check-harness-parity.consumer.test.mjs`. TESTS.md's TEST-6
  file reference was updated to follow the acceptance assertion to its new home
  rather than leaving it pointing at a file that no longer makes it.

- **DRIFT-2.10** — verdict: none — measured red→green rather than asserted. On a
  standalone copy of `sdk/packages/gallery` with no consumer tree: BEFORE, guard
  exit 1 / 4 violations and the package test 3 pass 3 fail; AFTER, guard exit 0
  and the package test 12/12. In ziee's tree the guard still enforces from both
  workspace cwds (exit 0, 4 copies × 5 cores).

## Round-3 fixes (from the blind audit) — see FIX_ROUND-3.md

- **DRIFT-2.11** — verdict: plan-wins — the round-2 implementation of ITEM-23 was
  WRONG in a way the plan did not sanction: it downgraded on the error channel
  using the full historical (deliberately loose) list, opening a gate hole on real
  errors whose text merely contains `is deprecated` / `findDOMNode` / a leading
  `Warning:`. Re-implemented to the plan's actual intent — fix the React-warning
  misclassification, do NOT relax the error channel — via a narrow
  `REACT_WARNING_STRICT`. Both blind angles found this independently.
- **DRIFT-2.12** — verdict: plan-wins — round 2 dropped the channel filter
  entirely rather than narrowing it, so `log`/`info`/`debug` became recordable.
  Restored via `DIAGNOSTIC_CHANNELS`.
- **DRIFT-2.13** — verdict: resolved — the ITEM-24 inversion left three
  silent-degradation holes (a core declared by no copy; an empty `cores`; an
  unvalidated `role`), plus a closed-world enumeration and a vacuous negative
  control. All closed with tests, each mutation-verified.
- **DRIFT-2.14** — verdict: none — CLAUDE.md updated: an operator now has a
  manifest to maintain, and the strict/loose asymmetry is a deliberate design
  choice that must not be "simplified" away by a later reader.

---

**Unresolved drifts:** 0
