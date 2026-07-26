# PLAN — net-hygiene

## Design source

- Realizes `.lifecycle/net-hygiene/DESIGN.md` §"Root causes" 1–6 and §"Approach"
  (written this round; there was no prior design doc — the upstream input is an
  evidence report, not a design).
- Grounded in the upstream evidence report
  `/data/pbya/ziee/tmp/live-ui-audit-2026-07-26/findings.{md,jsonl}` (machine-local)
  and the detector definitions in `agent-kit/skills/live-ui-audit/SKILL.md`
  §"The check battery" item 6 + `live-ui-audit.mjs:873-940`.
- Conforms to `agent-kit/docs/CODING_GUIDELINES.md` §7 (realtime sync —
  notify-and-refetch), §12 (frontend store discipline), §16 (kill-switch /
  cross-platform), §15 (no dead code).

## Invariants

- **INV-1**: Do NOT regress correctness for the sake of fewer requests (a stale/missing refetch is worse than a duplicate) — keep the sync/refetch semantics intact.
- **INV-2**: Identify the chain and parallelize what doesn't truly depend on a predecessor (or prefetch/coalesce).
- **INV-3**: De-duplicate: one shared store read / in-flight request de-dupe rather than N independent callers.
- **INV-4**: EXCLUDE two endpoints owned by another agent right now: `/api/projects/by-conversation/{id}` (N+1) and `/api/llm-models` (duplicate ×3) — do NOT touch those two fixes.
- **INV-5**: A permission-gated predicate (`ctx.can(Permissions.X)`) means the module's code never reaches a user who lacks the permission.

## Items

- **ITEM-1**: Add an in-flight GET coalescer to the framework transport: two callers issuing the same `method + resolved URL` while a request is already on the wire share ONE round-trip. New module `sdk/packages/framework/src/api-client/inflight.ts` (pure, unit-testable), consumed by `callAsync`.
- **ITEM-2**: Guard the coalescer with a monotonic **freshness epoch**: `bumpFetchEpoch()` on every completed non-GET request and on every inbound sync frame; a caller may only join an in-flight GET recorded in the CURRENT epoch. This is what makes ITEM-1 provably unable to serve a response that predates the caller's own mutation or a cross-device change (INV-1).
- **ITEM-3**: Never coalesce SSE streams, uploads (`FormData`), or non-GET methods; key on the auth token identity so a user switch cannot inherit the previous identity's in-flight response.
- **ITEM-4**: Close store-kit's lazy-dispatch race — calls to the same lazy action made WHILE its chunk is still loading share one invocation, so the action's own `if (loading) return` guard is not bypassed. Steady-state (chunk already resolved) dispatch behaviour is unchanged.
- **ITEM-5**: Issue the session verification (`GET /api/auth/me`) at module-initialize time so it overlaps `/api/app/setup/status` + `/api/onboarding/progress` instead of heading a serial chain — via a new `modules/auth/bootSessionVerify.ts` with a `.desktop.ts` NO-OP twin (desktop's auto-login owns the token; a persisted desktop token is stale by design). `AuthGuard` keeps its call as the mount-time backstop (`initAuth` is self-guarded).
- **ITEM-6**: `buildLoadContext()` reports `isAuthenticated` from a LIVE persisted token (present and not past `expiresAt`) so auth-gated modules register in wave 1 in parallel with `/auth/me`, instead of strictly after it. Permissions stay non-persisted, so `ctx.can(...)`-gated modules are unaffected (INV-5).
- **ITEM-7**: Stop `/settings/profile` refetching `/auth/me` ~380 ms after boot's: `Auth.refreshCurrentUser()` becomes a no-op when a `/me` response landed within a short freshness window (it already single-flights concurrent callers; this covers the near-miss).
- **ITEM-8**: Give `notification-ui`'s `load` action the in-flight guard it lacks (every sibling store action has one).
- **ITEM-9**: `SyncClient` backs off differently for a capacity refusal: a `429` reconnects on a longer jittered delay instead of the 1 s transient-drop floor, so the client stops hammering a rate-limited endpoint. Non-429 drops keep the fast 1 s recovery.
- **ITEM-10**: `registerModule` reuses an already-registered store proxy instead of building a SECOND `createStoreProxy` for the same store name — restoring the documented single-owner contract in `stores.ts` (a second proxy carries its own `storeInitialized` + ref-count, so it can re-run `init` and re-register `sync:*` listeners).
- **ITEM-11**: A repeatable measurement harness committed with the branch — `.lifecycle/net-hygiene/boot-probe.mjs` (audit-identical `waterfall`/`duplicate` detectors, seconds instead of an hour) plus `.lifecycle/net-hygiene/audit-diff.mjs` to render before→after from two audit runs.

## Files to touch

- `sdk/packages/framework/src/api-client/inflight.ts` (new)
- `sdk/packages/framework/src/lazy-dispatch.ts` (new — DRIFT-1.1: extracted from
  store-kit so the dispatcher is unit-testable without the zustand/EventBus graph)
- `sdk/packages/framework/src/sync/backoff.ts` (new — DRIFT-1.2: same, for the
  reconnect policy)
- `sdk/packages/framework/src/__test-stubs__/permissions.ts` (new — DRIFT-1.5)
- `sdk/packages/framework/src/api-client/core.ts`
- `sdk/packages/framework/src/sync/SyncClient.ts`
- `sdk/packages/framework/src/store-kit.ts`
- `sdk/packages/framework/src/module-system/store.ts`
- `sdk/packages/notification-ui/src/store/actions/load.ts`
- `src-app/ui/src/modules/auth/bootSessionVerify.ts` (new)
- `src-app/ui/src/modules/auth/bootSessionVerify.desktop.ts` (new)
- `src-app/ui/src/modules/auth/module.tsx`
- `src-app/ui/src/modules/auth/Auth.store.ts`
- `src-app/ui/src/modules/loadContext.ts`
- `src-app/ui/src/modules/liveSession.ts` (new — DRIFT-1.3: the predicate, kept
  dependency-free so it is testable without the Auth store graph)
- `src-app/ui/scripts/node-test-hooks.mjs` (DRIFT-1.5, sdk-scoped)
- `src-app/ui/src/dev/gallery/{stateMatrix.generated.ts,STATE_MATRIX.md}`
  (regenerated — DRIFT-1.7)
- `src-app/ui/src/core/overrides/OVERRIDE_MANIFEST.md` (regenerated)
- tests: `src-app/ui/src/api-client/inflight.test.ts`,
  `src-app/ui/src/modules/liveSession.test.ts`,
  `src-app/ui/src/api-client/{lazy-dispatch,shared-infra}.test.ts`,
  `src-app/ui/src/modules/auth/{meFreshness,syncBackoff}.test.ts`,
  `src-app/ui/tests/e2e/perf/boot-parallelism.spec.ts`,
  `.lifecycle/net-hygiene/tests/excluded-endpoints.test.mjs`

## Patterns to follow

- **Transport change** — mirror the existing seam style in
  `sdk/packages/framework/src/api-client/core.ts`: a module-scoped registry +
  small exported functions (`setAuthToken`/`getAuthToken`,
  `setUnauthorizedHandler`), and the `netRequestStart/netRequestEnd` bracketing
  in `net-idle.ts` — same "pure module, imported by `callAsync`" shape.
- **Desktop divergence** — mirror `modules/auth/AuthGuard.desktop.tsx` and
  `modules/loader.desktop.ts`: a co-located `X.desktop.ts` twin resolved by
  `src-app/desktop/ui/plugins/vite-plugin-local-override.ts` tier 2, indexed by
  `scripts/gen-override-registry.mjs` (regenerate + commit
  `OVERRIDE_MANIFEST.md`).
- **Store action guard** — mirror
  `modules/chat/stores/chatHistory/actions/loadRecentConversations.ts`'s
  `if (state.recentLoading …) return` shape for ITEM-8.
- **SyncClient backoff** — extend the existing `INITIAL_BACKOFF_MS` /
  `MAX_BACKOFF_MS` / `STABLE_AFTER_MS` named-constant style already in
  `sdk/packages/framework/src/sync/SyncClient.ts`; no magic numbers.
- **Unit tests** — mirror `src-app/ui/src/lib/validation.test.ts` /
  `src-app/ui/src/modules/smartLoader.test.ts` (`node:test` + the
  `scripts/node-test-loader.mjs` `@/` resolver, run by `npm run test:unit`).
- **e2e perf spec** — mirror `src-app/ui/tests/e2e/perf/entry-slimming.spec.ts`
  (the only existing perf spec).

### UI-surface plan checklist

This feature adds **no UI surface** — no page, drawer, card, panel, route,
permission, migration, or API endpoint. Every item is a change to when/how
existing requests are issued. Consequently: no precedent/scale/responsive/
populated-render/progress/input-economy/JTBD/multi-instance/URL-focus/platform-
affordance question applies. The user-visible contract is exactly "the same
screens, same data, fewer and earlier requests" — which is what the acceptance
tests assert (unchanged rendered data + measured concurrency), and what the
re-run of the live audit measures end-to-end.
