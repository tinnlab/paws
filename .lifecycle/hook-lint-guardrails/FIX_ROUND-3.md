# FIX_ROUND-3 — the second round-2 auditor's findings

The blind agent assigned correctness / error-handling / tests-quality /
state-management / security on the lint core returned AFTER `FIX_ROUND-2.md` was
written (its "honest limit" note recorded that its lens had only been self-covered).
It re-verified against the post-rebase HEAD, **dropped** the three findings the
parallel conformance round had already closed (the `Chat`/aliased-factory blind
spot, the `//`-in-a-string opt-out bypass, the missing element-access/hook-handle
coverage), and returned **9 that still reproduced**. All 9 are fixed here.

## Correctness

1. **A real FALSE POSITIVE in `after-early-return` (MEDIUM).** The
   `isFunctionBoundary` stop was applied to the walk's *children* but never to the
   statement itself, and the walk is entered with `forEachChild(stmt, walk)` — so a
   preceding nested **function declaration** was descended into and its own
   `return` marked every later statement as after-early-return. Reproduced at the
   CLI: `function fmt(n) { return String(n) }` followed by an *unconditional*
   `const v = FixtureStore.items` exited 1. (Arrow helpers and class methods were
   unaffected, which is why it survived the earlier rounds.) A blocking gate that
   rejects correct code is the worst failure mode this feature has; fixed by
   skipping statements that are themselves function boundaries.
2. **`catch` bodies were not a conditional context (LOW).** A catch body runs on
   only some renders, so it carries the identical O1/O2 hazard, and it was not even
   in the documented gap list. Added as a seventh context, `catch-clause`.

## State management

3. **The AST cache could still go stale (MEDIUM)** in two paths my own round-1
   comment claimed were safe: with explicit targets, editing a **non-target**
   registry file was invisible (a store that stopped being a proxy still produced a
   finding — and the reverse, a stale MISS); and on the default path the cache is
   filled with `includeFixtures: true` while the target list uses `false`, so files
   under a fixtures dir inside a root were cached and never re-read. Fixed by
   validating every cache hit against disk (`mtimeMs:size` stamp) — a stat is free
   next to a parse — which closes the whole class rather than another special case.

## Tests that could not fail (all mutation-proved by the auditor)

4. The drift-guard test asserted `/siblingDriftError\(\)/` against the source,
   which matches the function's own **declaration**; neutering the call site left
   the suite green. Replaced with a behavioural test that makes the two copies
   genuinely differ, asserts the CLI exits **2** with `DIVERGED`, and restores the
   file in `finally`.
5. The registry-floor test was parameterized on `PROXY_REGISTRY_FLOOR` itself, so
   setting the floor to **0** — disabling the guard — kept it green. Now pinned to
   absolute values plus `assert.ok(PROXY_REGISTRY_FLOOR >= 50)`.
6. The type-only-import test (already rewritten once in round 1) was *still*
   vacuous: `typeof FixtureStore.items` is a TypeQuery the H2 visitor can never
   see. Now uses a real conditional property access on the type-only binding — the
   lint parses but never type-checks, so that shape genuinely reaches it — plus a
   value-import control proving the silence is attributable to `isTypeOnly`.
7. The "SDK in scope" test passed an **explicit target**, bypassing
   `ROOT_CANDIDATES` entirely; deleting both SDK roots left it green. Now asserts
   the SDK is in the **default** root set (`analyze()` returns its resolved roots).
8. **Factor 1 — module resolution, the round-1 fix for the ~44 excluded proxies —
   had no test at all.** Making `resolveSpecifier` return `[]` left the suite green
   while dropping ~14% of recognized proxy bindings. Now tested through two real
   non-`stores/`-path proxies (`Hardware`, `AppLayout`).

## Error handling

9. **`--root=` with an empty value (LOW)** resolved to `process.cwd()` and scanned
   the workspace *including* the fixtures dir, exiting 1 — a typo masquerading as a
   *failing* gate reporting defects that are not the operator's. Now exit 2.

## Verification

`node scripts/lint-hooks.mjs` — 0 violations across 2433 files (300 proxies, 1708
actions), identical from both copies. `npm run test:lint-hooks` — **61/61**
(39 → 51 → 56 → 61 across the rounds). Every one of the ten behaviours fixed or
newly guarded above has a mutation that turns the suite RED:

| mutation | result |
|---|---|
| drift guard never consulted | RED |
| `PROXY_REGISTRY_FLOOR = 0` | RED |
| `isTypeOnly` (element) dropped | RED |
| `isTypeOnly` (import clause) dropped | RED |
| `resolveSpecifier` → `[]` | RED |
| SDK roots removed from `ROOT_CANDIDATES` | RED |
| inner-function boundary skip undone | RED |
| `catch-clause` context removed | RED |
| cache disk-stamp ignored | RED |
| empty `--root=` accepted | RED |

**New confirmed findings:** 0
