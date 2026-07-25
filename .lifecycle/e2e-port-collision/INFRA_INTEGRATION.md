# INFRA_INTEGRATION — e2e-port-collision

## User-experience walk (the "user" is the e2e harness / the engineer running it)

- **How it's encountered:** an engineer (or the shared-box fleet) runs
  `npm run test:e2e` in one or more worktrees concurrently. Playwright
  `global-setup` allocates a vite+backend port pair via `findAvailablePorts`,
  boots a backend + vite per test, drives the browser, tears down.
- **The failure it fixes:** two concurrent sessions on different lock dirs picked
  the SAME base pair; the second's `test-context` startup `killProcessOnPort`
  killed the first's LIVE backend → victim browser `ERR_CONNECTION_REFUSED` on
  sync/chat SSE → assistant never rendered → chat/split-chat specs timed out.
- **After the fix:** the second session's allocator sees the base ports are
  OS-bound (even though its lock dir has no record of them) and skips to the next
  bindable offset. No kill, no ECONNREFUSED. The single-session experience is
  byte-identical (free base still chosen).

## Infrastructure-integration walk

Subsystems the change touches, and the constraint handled:

- **`findAvailablePorts` caller (`test-context.ts`):** signature unchanged
  (`async (workerIndex) => {vite, backend}`); it already `await`s. No caller edit.
- **`allocatePostgresPort` (sibling in the same file):** the pattern being
  mirrored — acquire lock → `isPortBindable` → release+continue. The vite/backend
  allocator now matches the postgres allocator's TOCTOU-aware shape.
- **`killProcessOnPort` (two copies: `port-manager.ts` + `test-context.ts`):**
  both now probe `command -v` and fall back `lsof`→`fuser`→`ss`. On this dev box
  (`fuser` only, no `lsof`/`ss`) the old code was a SILENT NO-OP — orphan reaping
  did nothing. The win32 arm is untouched (cross-platform parity preserved).
- **`cleanupStaleConfigFiles` ↔ `global-setup.ts` container cleanup:** both now
  read the SAME shared `postgres-*.lock` liveness map (`{pid, runId}` →
  `process.kill(pid,0)`). A concurrent same-`configDir` session's active
  `postgres-<runId>.json` is no longer reaped past-TTL → no `ENOENT` at its
  teardown. The two sweeps (containers + config files) are now consistent.
- **Lock dir / env seams:** `ZIEE_E2E_LOCK_DIR`, `ZIEE_E2E_BASE_*` remain the
  cross-session isolation knobs; the bind-check is the belt that catches sessions
  that set a different lock dir but the same port base.

## Entity-lifecycle walk

The only "entities" are the harness's own artifacts:

- **Port lock (`ports-*.lock`):** ADD = `acquirePortLock`; now on a
  bind-check-fail the just-added lock is REMOVED via `releasePortLock` before
  trying the next offset (no leaked lock for a port we didn't take). Verified by
  TEST-2's log (`🔓 Released port lock: …` then a lock on the +8 pair).
- **Config file (`postgres-<runId>.json` etc.):** REMOVE is gated by the live
  lock — a live-owned file is kept; a genuine orphan (no live lock) is still
  reaped. Verified by TEST-4 (KEEP live / REAP dead).
- **Orphan process on a port:** REMOVE now actually happens (fuser fallback)
  instead of silently not. Verified by TEST-3.
