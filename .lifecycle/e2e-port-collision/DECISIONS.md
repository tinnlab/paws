# DECISIONS — e2e-port-collision

All decisions resolved by codebase convention up front. Zero open questions —
this is a mechanical harness fix mirroring existing idioms.

### DEC-1: Which interface does the port bind-check bind on — 0.0.0.0 or 127.0.0.1?
**Resolution:** `0.0.0.0` — reuse the EXISTING `isPortBindable(port)` helper
verbatim (it binds `srv.listen(port, '0.0.0.0')`).
**Basis:** codebase — the helper's own comment: binding on `0.0.0.0` (not
loopback) is required so a docker `0.0.0.0` publish (postgres) is detected. The
vite/backend servers also bind broadly, so 0.0.0.0 is the correct collision
surface.

### DEC-2: Fallback tool order when `lsof` is absent (ITEM-2)?
**Resolution:** `lsof` → `fuser -k <port>/tcp` → `ss` (parse `pid=` and
`kill -9`), each gated by `command -v`. `lsof` stays FIRST so a box that has it
behaves byte-identically to today.
**Basis:** convention — `fuser -k` is the canonical single-shot
kill-whatever-holds-this-port on Linux; `ss` is the modern `netstat` replacement
and a near-universal fallback. Preserving lsof-first guarantees zero behavior
change on the common (lsof-present) box.

### DEC-3: Config-file guard — skip live-lock-owned files, or just raise the TTL?
**Resolution:** SKIP any run-scoped config file whose embedded `runId` maps to a
LIVE `postgres-*.lock` (pid alive via `process.kill(pid, 0)`), regardless of age.
Keep the 5-min TTL for genuinely orphaned files.
**Basis:** codebase — this is the EXACT idiom `global-setup.ts` already uses to
guard docker-container cleanup (`liveRunIds` built from the shared
`postgres-*.lock` dir). Raising the TTL alone is a race, not a fix (a long run
still eventually exceeds any fixed TTL); the live-lock guard is correct at any
duration.

### DEC-4: Operational tunables — fixed constants or admin-configurable settings?
**Resolution:** FIXED constants, NO settings row. The touched values
(`CONFIG_STALE_MS` = 5 min TTL, `MAX_ATTEMPTS` = 100, the port bases) are
TEST-HARNESS constants, not product/server operational tunables. The
cross-session isolation knobs a concurrent session actually needs are ALREADY
env-overridable (`ZIEE_E2E_LOCK_DIR`, `ZIEE_E2E_BASE_VITE_PORT`,
`ZIEE_E2E_BASE_BACKEND_PORT`, `ZIEE_E2E_BASE_PG_PORT`).
**Basis:** convention — the configurable-settings rule targets deployed server
tunables (`code_sandbox_settings` / `session_settings` etc.); a Playwright
fixture has no admin, no REST surface, and no sync entity. Promoting a test
constant to a DB settings row would be nonsensical. This is the explicit-rationale
"fixed constant" case.

### DEC-5: Export surface for testability (ITEM-4)?
**Resolution:** Add `export` to `killProcessOnPort` in `port-manager.ts` (the
only helper the tests need that isn't already exported; `findAvailablePorts`,
`releasePortLock`, `cleanupStaleConfigFiles`, `allocatePostgresPort` are already
exported). No new production call site.
**Basis:** convention — the sibling exported functions in the same module set the
precedent; exporting one more pure helper for a unit test is additive and
idiomatic.
