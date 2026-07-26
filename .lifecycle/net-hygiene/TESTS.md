# TESTS — net-hygiene

Every ITEM is covered; every `INV-N` is pinned by an `[acceptance]` test that
asserts the DESIGN's promise (so flipping the invariant off turns the test red),
not merely whatever the implementation happens to do.

No permission is introduced by this branch (no `modules/*/permissions.rs` change,
no migration grant), so A9/A10 do not apply — but INV-5 (the *existing*
permission gate must survive) is pinned by TEST-6 anyway.

## Unit

- **TEST-1** (tier: unit) [acceptance] [invariant: INV-3] [covers: ITEM-1, ITEM-3] file: `src-app/ui/src/api-client/inflight.test.ts` — asserts: N concurrent callers of the SAME key run the underlying runner exactly ONCE and all receive the same resolved value (and the same rejection on failure); a different key, a non-GET, an SSE call and a different auth token each get their OWN run; and a call made AFTER the first settles runs again (no caching).
- **TEST-2** (tier: unit) [acceptance] [invariant: INV-1] [covers: ITEM-2] file: `src-app/ui/src/api-client/inflight.test.ts` — asserts: a GET issued after `bumpFetchEpoch()` (i.e. after a mutation completed) does NOT join an in-flight GET of the same key that started in the previous epoch — it runs its own request and observes the post-mutation value. Would FAIL if the coalescer were a plain key→promise map.
- **TEST-3** (tier: unit) [acceptance] [invariant: INV-1] [covers: ITEM-2] file: `src-app/ui/src/api-client/inflight.test.ts` — asserts: an inbound realtime-sync frame bumps the epoch, so a `sync:<entity>`-driven refetch that races an in-flight GET started before the frame gets its own round-trip (the notify-and-refetch contract is not silently collapsed).
- **TEST-4** (tier: unit) [covers: ITEM-4] file: `src-app/ui/src/api-client/lazy-dispatch.test.ts` — asserts: two synchronous calls to a lazy store action whose chunk has not yet resolved invoke the action body ONCE (so its own `if (loading) return` guard is not bypassed); once the chunk HAS resolved, two successive calls invoke the body twice (steady-state dispatch unchanged).
- **TEST-6** (tier: unit) [acceptance] [invariant: INV-5] [covers: ITEM-6] file: `src-app/ui/src/modules/liveSession.test.ts` — asserts: with a live persisted token but NO permissions, `buildLoadContext()` reports `isAuthenticated: true` AND `can(P) === false` for every permission, so a manifest entry gated on `ctx.can(P)` is NOT eligible (its code is not delivered) while one gated on `ctx.isAuthenticated` alone IS; an expired/absent token yields `isAuthenticated: false`. Would FAIL if permissions were persisted to speed boot up.
- **TEST-7** (tier: unit) [acceptance] [invariant: INV-1] [covers: ITEM-7] file: `src-app/ui/src/modules/auth/meFreshness.test.ts` — asserts: the boot-window predicate suppresses a `/me` refetch only while a `/me` landed inside the window AND no mutation/sync epoch bump has happened since; after a profile mutation (epoch bump) or outside the window it does NOT suppress — i.e. `updateProfile`'s refresh always runs.
- **TEST-8** (tier: unit) [covers: ITEM-9] file: `src-app/ui/src/modules/auth/syncBackoff.test.ts` — asserts: the reconnect-delay function returns a jittered delay ≥ the capacity floor for a 429, the 1 s transient floor for any other failure, and never exceeds `MAX_BACKOFF_MS` in either case.
- **TEST-9** (tier: unit) [acceptance] [invariant: INV-4] [covers: ITEM-11] file: `.lifecycle/net-hygiene/tests/excluded-endpoints.test.mjs` — asserts: `git diff <base>...HEAD` contains NO changed file that references `projects/by-conversation` or `llm-models` call sites, and no `openapi.json` / `apiEndpoints.ts` / `api-client/types.ts` change — the two excluded fixes are mechanically untouched. Would FAIL the moment this branch edited either owner's surface.
- **TEST-10** (tier: unit) [covers: ITEM-8, ITEM-10] file: `src-app/ui/src/api-client/shared-infra.test.ts` — asserts: (a) two synchronous calls to the notification store's `load` action produce ONE underlying list call and a third after settle produces a second; (b) registering the same store name twice through the module system yields the SAME proxy instance (single-owner contract), not two independent ref-counted lifecycles.

## e2e

- **TEST-5** (tier: e2e) [acceptance] [invariant: INV-2] [covers: ITEM-5, ITEM-6] file: `src-app/ui/tests/e2e/perf/boot-parallelism.spec.ts` — asserts: on a cold authenticated load of `/`, `GET /api/auth/me` **starts before `GET /api/app/setup/status` finishes** (they genuinely overlap in wall-clock time) and `/api/auth/me` is NOT the sole predecessor of the shell's first data burst; measured from the real browser request log, and additionally that the longest strictly-serial `/api` run (the audit's own detector, 20 ms slack) is shorter than the recorded pre-fix baseline. Would FAIL if `/auth/me` were still issued from a mount effect after the router chunk lands.
- **TEST-11** (tier: e2e) [covers: ITEM-1, ITEM-7] file: `src-app/ui/tests/e2e/perf/boot-parallelism.spec.ts` — asserts: on a cold load of `/settings/profile` the browser issues exactly ONE `GET /api/auth/me`, and the rendered profile form still shows the user's display name + username and the password section reflects `has_password` (de-dup did not cost the page its data).
- **TEST-12** (tier: e2e) [covers: ITEM-1, ITEM-2, ITEM-3] file: `src-app/ui/tests/e2e/perf/boot-parallelism.spec.ts` — asserts: after a real mutation through the UI (rename the display name on `/settings/profile`), the page shows the NEW value — proving the post-mutation refetch was not coalesced onto the pre-mutation in-flight request. This is the end-to-end form of TEST-2 on the real transport.

## Not separately tested (and why)

- **ITEM-11**'s `boot-probe.mjs` / `audit-diff.mjs` are measurement tools, not
  product code; TEST-9 is the one behaviour among them worth asserting. Their
  correctness is established by construction — the waterfall/duplicate detectors
  are transcribed from `live-ui-audit.mjs:873-940` and cross-checked against a
  real audit run of the same build (recorded in `TEST_RESULTS.md`).
