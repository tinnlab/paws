# PLAN_AUDIT — net-hygiene (plan vs. the actual codebase)

Audited against the worktree at `60b0db310` by reading every file the plan names
and by MEASURING the live app (`.lifecycle/net-hygiene/boot-probe.mjs` against a
production build of this branch served on `:1547`).

## Breakage risk

- **ITEM-1/2/3 (transport coalescer)** — `callAsync`
  (`sdk/packages/framework/src/api-client/core.ts:166`) is the single transport
  for EVERY app request in all three consumers (`src-app/ui`,
  `src-app/desktop/ui`, CytoAnalyst). A wrong coalescer is a whole-app
  correctness bug. Mitigations verified against the code: (a) join only when
  `method === 'GET'` and `!sseFunction` and `!(params instanceof FormData)` —
  all three are already computed inside `callAsync` before the request is built;
  (b) key includes the resolved path+query AND the auth token, so a user switch
  cannot inherit an in-flight response; (c) the freshness epoch means a caller
  can only join a request started in the current epoch. The riskiest realistic
  case — "component refetches after a mutation and gets the pre-mutation
  response" — is precisely what the epoch closes, and it is the acceptance test
  for INV-1.
- **`/api/auth/refresh` interaction** — `callAsync`'s 401 path
  (`core.ts:500-521`) awaits `onUnauthorized()` then retries ONCE. A coalesced
  GET that 401s would deliver the same rejection to all joiners, each of which
  would then… no: the retry happens INSIDE the coalesced runner, so joiners see
  the already-retried outcome. That is the correct behaviour (one refresh, not
  N) and is strictly better than today. Recorded as a test.
- **GET retry loop** (`core.ts:474-489`, up to 6 attempts) sits inside the same
  runner — a coalesced GET performs ONE retry ladder instead of N. Improvement,
  no behaviour change for a single caller.
- **ITEM-4 (store-kit dispatch)** — `store-kit.ts` is shared by every store in
  every app. Restricting the coalescing to the *chunk-load window only* means
  once `implPromise` has settled the dispatcher behaves byte-identically to
  today, so no steady-state behaviour (including repeated mutations like
  `deleteX(id)` twice) can change. Verified: `makeBuilder`'s `resolveImpl`
  already memoizes `implPromise`, so "has it settled" is knowable.
- **ITEM-5 (boot session verify)** — the ONLY breakage risk is desktop, where
  `AuthGuard.desktop.tsx` documents (reason 3) that a persisted token from a
  previous launch is stale because the desktop server regenerates its JWT secret
  per launch. Calling `initAuth()` there would `endSession()` and wipe a token
  the auto-login loop owns. Mitigated structurally, not by a runtime flag: the
  `.desktop.ts` twin is a no-op and the desktop bundle never contains the web
  body (tier-2 resolution in
  `src-app/desktop/ui/plugins/vite-plugin-local-override.ts`). A runtime
  `AppMode.multiUserMode` check would NOT be safe — `main.tsx` flips that flag
  after `loadDesktopModules()`, which can race a module `initialize()`.
- **ITEM-6 (`buildLoadContext`)** — widening `isAuthenticated` widens WHICH
  modules register in wave 1. Risk: a module gated on `ctx.isAuthenticated`
  alone would load its chunk for a holder of an expired/revoked token. Bounded:
  the predicate requires a token that is present AND not past its persisted
  `expiresAt`, i.e. exactly what the Auth store itself would call a live
  session; and modules are code, not data — every fetch behind them is still
  permission-gated (`hasPermissionNow`) and server-authorized. Permission-gated
  modules are untouched because permissions remain non-persisted.
- **ITEM-7 (`refreshCurrentUser` freshness)** — the one caller with real intent
  is `ProfileSettingsPage` ("refresh `/me` on mount so `has_password` is
  accurate even when the user arrived via an in-session login"). A window of a
  few seconds cannot break that: an in-session login's `/me` IS the response
  that would fill `has_password`, and any later visit is far outside the window.
  `updateProfile` also calls it — but AFTER a mutation, which bumps the epoch,
  so it must not be short-circuited: the freshness check must therefore live
  where it can see the epoch, or be strictly boot-scoped. **Resolved in
  DECISIONS (DEC-5): scope the skip to the boot window only.**
- **ITEM-9 (429 backoff)** — a longer backoff delays recovery when a slot frees.
  Bounded by the existing `MAX_BACKOFF_MS` (30 s) and jittered, so it is never
  slower than today's worst case. Non-429 drops keep the 1 s floor, so ordinary
  stream recovery is unchanged.
- **ITEM-10 (`registerModule` proxy reuse)** — today `state.stores` is read by
  NOTHING in either app (verified: the only reads are inside
  `module-system/store.ts` itself; the global `Stores` facade was removed). So
  the second proxy is currently inert and this item is hygiene, not a live bug
  fix. Keeping it is still correct (it restores the documented single-owner
  contract before someone re-introduces a reader) but it must NOT be sold as a
  duplicate-request fix. Downgraded accordingly; no measured request delta is
  claimed for it.

## Pattern conformance

- ITEM-1's `inflight.ts` mirrors `net-idle.ts` exactly: a module-scoped registry
  + tiny exported functions, imported by `callAsync`, no React, no store.
  ✔ conforms.
- ITEM-5's `.desktop.ts` twin mirrors `AuthGuard.desktop.tsx` /
  `loader.desktop.ts` / `lazyWithPreload.desktop.ts` (14 existing co-located
  overrides). It must be imported through the `@/` alias or the override plugin
  will not rewrite it — the same trap `auth/module.tsx` already documents for
  `AuthGuard`. ✔ conforms, with that constraint recorded.
- ITEM-8 mirrors `loadRecentConversations.ts`'s guard shape. ✔
- ITEM-9 extends the existing named-constant block in `SyncClient.ts`
  (`INITIAL_BACKOFF_MS`/`MAX_BACKOFF_MS`/`STABLE_AFTER_MS`/
  `RESYNC_MIN_INTERVAL_MS`) — no magic numbers. ✔
- Unit tests mirror `src/lib/validation.test.ts` (`node:test`, run by
  `npm run test:unit` via `scripts/node-test-loader.mjs`). Confirmed working in
  this worktree. Note: `src/modules/workflow/stores/*.test.ts` fail on the
  UNMODIFIED base — a pre-existing red, not caused by this branch; recorded so
  phase 8 reports the scoped result honestly.
- e2e spec mirrors `tests/e2e/perf/entry-slimming.spec.ts` (the existing perf
  spec, same directory). ✔

## Migration collisions

None — this branch adds no migration and touches no `src-app/server/**` file.
Migrations on this lineage are per-module and date-prefixed
(`src-app/server/src/modules/*/migrations/`), so nothing is claimed. ✔

## OpenAPI regen

**Not required.** No Rust type, handler, permission, or `SyncEntity` changes, so
`openapi.json` + `api-client/types.ts` stay byte-identical in BOTH `src-app/ui`
and `src-app/desktop/ui`. This is also what keeps INV-4 mechanically safe: the
concurrent `feat/live-ui-audit-fixes` branch DOES regenerate both, and a
regen here would collide with it for no benefit.

## Per-item verdicts

- **ITEM-1** — verdict: PASS — `callAsync` already computes `method`, `sseFunction` and the FormData branch before dispatch, so the join predicate needs no restructuring; `inflight.ts` mirrors `net-idle.ts`.
- **ITEM-2** — verdict: PASS — the epoch is the mechanism that makes INV-1 provable rather than argued; both bump sites exist (`callAsync`'s non-GET completion, `SyncClient.handleFrame`) and neither is on a hot path.
- **ITEM-3** — verdict: PASS — SSE/FormData/non-GET exclusions map 1:1 onto flags already present in `callAsync`; token-in-key closes the user-switch hole.
- **ITEM-4** — verdict: CONCERN — store-kit is shared by ~130 stores in three apps. Scoping the change to the chunk-load window keeps steady state byte-identical, but this is the item that most needs the blind audit's `concurrency` + `state-management` angles. Proceeding with that flag raised.
- **ITEM-5** — verdict: CONCERN — needs the `.desktop.ts` twin AND a regenerated `core/overrides/OVERRIDE_MANIFEST.md` (`npm run check` runs `check:override-registry`, which FAILS on an orphaned `*.desktop.ts` with no core sibling). Budgeted.
- **ITEM-6** — verdict: PASS — bounded by a live-token predicate; permissions stay non-persisted so INV-5's code-delivery gate is untouched. Pinned by TEST-6.
- **ITEM-7** — verdict: CONCERN — must not short-circuit the post-mutation refresh in `updateProfile`. Resolved by DEC-5 (boot-window scope only); pinned by TEST-7.
- **ITEM-8** — verdict: PASS — a straight port of the sibling guard into an action that has none.
- **ITEM-9** — verdict: PASS — additive constant + a branch on `response.status === 429`; bounded by the existing MAX cap.
- **ITEM-10** — verdict: CONCERN — currently inert (nothing reads `state.stores`), so it earns no measured delta. Keep as a correctness/hygiene fix, and do NOT attribute any request reduction to it in the results.
- **ITEM-11** — verdict: PASS — measurement-only, lives entirely under `.lifecycle/`, wired into no product gate (B6-safe: nothing in `npm run check` reads it).
