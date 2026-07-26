# FIX_ROUND-1 — net-hygiene

The phase-6 blind audit ran four fresh, diff-only agents across 17 angles
(correctness, concurrency, state-management, error-handling, security, perms,
api-contract, perf, patterns-conformance, modularity, extensibility,
maintainability, api-friendliness, design-conformance, tests-quality,
wired-and-behaving). It produced **95 findings**, of which the ones below were
confirmed and fixed. Two were deliberately declined with a recorded rationale.

## What was fixed (each traced to a finding, each with a test)

| # | Finding (angle, severity) | Fix |
|---|---|---|
| 1 | `callAsync` async→plain arrow made pre-flight throws SYNCHRONOUS, so every `.catch()` call site in three apps lost that path (error-handling, HIGH) | `callAsync` is `async` again; coalescing moved inside the body. `isFormData()` guards the `instanceof` for runtimes with no global `FormData`. |
| 2 | A hung GET pinned its key forever — on a quiet page the epoch never moves, so the endpoint became permanently unreadable (concurrency, HIGH) | `MAX_JOIN_AGE_MS` (15 s) bound on joinability, pinned by a clock-controlled test. |
| 3 | Joiners aliased the issuer's parsed object; one store's in-place `sort()` would corrupt another's data (state-management, HIGH) | Joiners get an isolated `structuredClone`; test mutates a joiner's copy and asserts the issuer's is untouched. |
| 4 | `JSON.stringify` does not throw on a function, so cold-window calls with DIFFERENT callbacks keyed identically and the second callback never ran (correctness, HIGH) | The cold-window merge was **removed entirely** (see 5). |
| 5 | The cold-window merge applied to MUTATIONS too, collapsing two deliberate identical dispatches while both callers resolved successfully (api-contract, HIGH) | Removed. The duplicate NETWORK requests are handled at the transport, which can tell a read from a mutation. Tests now assert both callbacks fire and two identical mutation dispatches both run. |
| 6 | A rejected chunk load was memoized forever, bricking the action for the session (error-handling, MEDIUM) | Failed loads clear the memo; test asserts the retry succeeds. |
| 7 | `reconnectDelayMs`'s 429 branch ignored the escalated backoff, so a capacity refusal could SHORTEN the wait to ~12 s and never escalate (correctness, HIGH) | `min(max(currentBackoffMs, capacityFloor), MAX)`; a test pins the raise-the-floor property at 30 s and 20 s. |
| 8 | `noteMeLoaded` stamped the epoch at RESPONSE time, so a `/me` in flight across a mutation was marked fresh and suppressed the refresh that mutation triggered (concurrency, HIGH) | `meRequestEpoch()` captures before issuing; a dedicated acceptance case drives exactly that interleaving. |
| 9 | `refreshCurrentUser`'s in-flight join had no epoch check, so a post-mutation caller received pre-mutation data (concurrency, MEDIUM) | The join now requires the current epoch. |
| 10 | `notification-ui`'s new bare guard DROPPED a page change, a filter toggle, and the `sync:notification`/`sync:reconnect` reload — a direct INV-1 violation (design-conformance, HIGH) | The guard was **reverted**; TEST-10a rewritten to assert a differing-intent reload IS issued. |
| 11 | The always-allow permissions test stub was a resolvable PUBLIC subpath of `@ziee/framework` for all three consumers (perms, HIGH) | Moved into the app's own test tree, which is not a published package. |
| 12 | Deriving `isAuthenticated` from a persisted token delivers the authenticated-tier module surface to a revoked-but-unexpired token, and contradicts this branch's own desktop reasoning (security ×2 + design-conformance, MEDIUM) | **ITEM-6 DESCOPED** (DEC-15, approved disposition). Re-measurement showed it moved no number. TEST-14 keeps the widening out. |
| 13 | TEST-6 was TAUTOLOGICAL — it hardcoded `can: () => false` and never touched `buildLoadContext`, so persisting permissions would have left it green (tests-quality, HIGH) | Removed with ITEM-6; replaced by TEST-14, which asserts on the shipped source. |
| 14 | The HMR branch of `registerModule` still destroyed + replaced a self-owned proxy (api-contract, MEDIUM) | `selfOwnedStores` tracking; both branches now honour the single-owner contract, and a genuine name collision warns in DEV. |
| 15 | The coalescing key omitted the resolved base URL, which is a dynamic port on desktop (correctness, MEDIUM) | The origin is now part of the key. |
| 16 | `__resetInflightForTests` rewound a counter documented as monotonic (api-friendliness, MEDIUM) | It bumps instead. |
| 17 | `LazyDispatcher` collided by name with store-kit's differently-shaped public type in the same package (api-friendliness, MEDIUM) | Renamed `LazyActionDispatcher`. |
| 18 | `syncBackoff.test.ts` re-declared `MAX_BACKOFF_MS` locally, so the bound assertion could not catch a source change (tests-quality, LOW) | Imported from the module under test. |
| 19 | TEST-9 silently skipped the entire sdk submodule if uninitialised and still passed (tests-quality, MEDIUM) | Asserts the submodule was scanned; and the generated-index exemption is now backed by a check that their delta is line-number-only. |
| 20 | TEST-12 mutated the SHARED fixture user with no `try/finally` (tests-quality, MEDIUM) | Restore moved into a `finally`. |
| 21 | `SubscribeRefused` was documented as capacity-only but thrown for every non-ok status (patterns-conformance, LOW) | Doc corrected; the capacity decision demonstrably lives in `reconnectDelayMs`. |

## Declined, with rationale (recorded, not silently dropped)

- **Global epoch granularity** — an unrelated sync frame or POST disables
  coalescing for every key. Narrowing it per-entity is the direction that risks a
  STALE join; over-invalidation is the safe failure mode under INV-1. Declined
  deliberately (`LEDGER.jsonl` status `wontfix-safe-direction`).
- **The coalescer also collapses `/api/llm-models`** — an endpoint the other
  branch owned. A per-endpoint carve-out inside a shared transport is exactly the
  hidden cross-module coupling `CODING_GUIDELINES.md` §9 forbids. DEC-11 records
  the choice; the results report it explicitly (and that branch has since LANDED,
  so its own caller-level catalog is in the measured baseline).

## Re-audit

A FULL fresh blind round was re-run against the fixed diff (all 8 angle groups,
diff-only context, no reasoning handed over). Result recorded below.

**New confirmed findings:** 0
