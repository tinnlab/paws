# TESTS — e2e-port-collision

The fix is about CONCURRENCY of harness port allocation, so the real proof is a
concurrency-shaped UNIT test (TEST-2). A single isolated e2e session cannot
exhibit the collision (the collision needs a SECOND concurrent session on a
different lock dir), so the enumerated e2e (TEST-6) is a NO-BREAK / regression
guard proving the fixed harness still boots + serves a normal single session —
NOT a reproduction of the race. This is stated explicitly per the task.

No permission is introduced by this diff (no `modules/*/permissions.rs`, no
migration grant), so A9/A10 negative-perm specs are N/A.

## Tests

- **TEST-1** (tier: unit) [covers: ITEM-1] file: `src-app/ui/tests/fixtures/port-manager.concurrency.test.ts` — asserts: HAPPY PATH — with a fresh empty lock dir and a free port base, `findAvailablePorts(0)` returns EXACTLY the base pair `{vite: base, backend: baseBackend}` (the bind-check does not perturb the free-base case).
- **TEST-2** (tier: unit) [covers: ITEM-1] file: `src-app/ui/tests/fixtures/port-manager.concurrency.test.ts` — asserts: COLLISION — when a concurrent session (represented by real listeners bound on the base vite+backend ports, whose lock lives in a DIFFERENT/invisible lock dir) already holds the base pair, `findAvailablePorts(0)` does NOT return the base pair; it skips to the next OS-bindable offset and returns a distinct, bindable pair. This is the enumerable regression guard for the kill-the-sibling race.
- **TEST-3** (tier: unit) [covers: ITEM-2, ITEM-4] file: `src-app/ui/tests/fixtures/port-manager.concurrency.test.ts` — asserts: `killProcessOnPort` (now exported) FALLBACK — with `PATH` scoped so `lsof` is ABSENT but a fake `fuser` is present, calling it INVOKES `fuser -k <port>/tcp` (recorded by the fake) instead of silently no-opping; and with `lsof` present the lsof arm is still selected (no fuser call). Proves the previously-silent no-op is now a functional kill.
- **TEST-4** (tier: unit) [covers: ITEM-3] file: `src-app/ui/tests/fixtures/port-manager.concurrency.test.ts` — asserts: `cleanupStaleConfigFiles` LIVE-LOCK GUARD — an OLD (mtime > 5-min TTL) `postgres-<runId>.json` whose `runId` has a LIVE `postgres-<port>.lock` (pid = current process) is NOT deleted; a control OLD config whose runId has NO live lock (dead/absent pid) IS deleted. Proves an active concurrent session's config survives while genuine orphans are still reaped.
- **TEST-6** (tier: e2e) [covers: ITEM-1] file: `src-app/ui/tests/e2e/auth/auth.spec.ts` — asserts: NO-BREAK harness guard — a representative existing single-session spec still allocates ports through the fixed `findAvailablePorts`, boots the real backend + vite, and drives the real login flow end-to-end. Confirms the bind-check + release-on-skip change did not regress the normal (free-base) allocation path. (A single session cannot trigger the collision; TEST-2 is the collision proof.)

## Coverage map

- ITEM-1 → TEST-1 (happy), TEST-2 (collision), TEST-6 (e2e no-break)
- ITEM-2 → TEST-3 (fuser fallback)
- ITEM-3 → TEST-4 (live-lock guard)
- ITEM-4 → TEST-3 (imports the newly-exported `killProcessOnPort`)
