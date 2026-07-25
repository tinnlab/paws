# PLAN — e2e-port-collision

Fix a pre-existing e2e-harness reliability bug: concurrent e2e sessions on the
shared box collide on the default vite/backend port base (9000/9100) and one
session's startup `killProcessOnPort()` kills the other session's LIVE backend
mid-test → the victim's browser gets `ERR_CONNECTION_REFUSED` on its sync +
chat-stream SSE → the assistant never renders → chat / `14-split-chat` specs
time out. Root cause: `findAvailablePorts()` allocates ports from ITS lock-dir
file only, never OS-bind-checking, so two sessions with different lock dirs pick
the same ports.

This is a test-harness-only change (`src-app/ui/tests/fixtures/**`). No product
UI, no backend, no migration, no OpenAPI.

## Items

- **ITEM-1**: `findAvailablePorts()` in `port-manager.ts` — after `acquirePortLock`
  succeeds, require BOTH the vite AND backend ports to be OS-`isPortBindable`
  (mirror the bind-check `allocatePostgresPort` already uses). If either isn't
  bindable (a sibling session on a different lock dir holds it), `releasePortLock`
  and try the next offset. Preserve the happy path: base ports are still chosen
  when free.
- **ITEM-2**: `killProcessOnPort()` (in BOTH `port-manager.ts` and
  `test-context.ts`) — currently silently no-ops when `lsof` is absent
  (`execSync` throws, swallowed), so orphan cleanup does nothing on a box without
  lsof. Add a Unix fallback chain: `lsof` → `fuser -k <port>/tcp` → `ss`, chosen
  by `command -v` availability, so a functional kill always runs when any tool is
  present. Windows path (`netstat`/`taskkill`) unchanged.
- **ITEM-3**: `cleanupStaleConfigFiles()` in `port-manager.ts` — the 5-min-TTL
  sweep can delete a concurrent same-`configDir` session's ACTIVE
  `postgres-<runId>.json` (and other run-scoped files), causing `ENOENT` setup/
  teardown failures. Guard by the live-PID lock the container-cleanup path
  already uses: build a `liveRunIds` set from the shared `postgres-*.lock` files
  (each carries `{pid, runId}`; a live pid ⇒ in-use) and SKIP any run-scoped
  config file whose embedded `runId` is still live, regardless of age. Mirrors
  the existing `global-setup.ts` container-liveness guard exactly.
- **ITEM-4**: Export `killProcessOnPort` (and the `isPortBindable` /
  liveness helpers as needed) from `port-manager.ts` ONLY as far as the tests
  require, so the concurrency + fallback + live-lock behaviors are unit-testable
  without spinning the full stack. (No production call-site change.)

## Files to touch

- `src-app/ui/tests/fixtures/port-manager.ts` — ITEM-1, ITEM-2, ITEM-3, ITEM-4
- `src-app/ui/tests/fixtures/test-context.ts` — ITEM-2 (the second copy of
  `killProcessOnPort`)
- `src-app/ui/tests/fixtures/port-manager.concurrency.test.ts` — NEW unit test
  (concurrency + fallback + live-lock guard)

## Patterns to follow

- **ITEM-1** mirrors `allocatePostgresPort()` in the SAME file: `acquire lock →
  isPortBindable → on fail release + continue`. Reuse the existing
  `isPortBindable(port)` helper (bind on `0.0.0.0`) verbatim; do not invent a new
  bind check.
- **ITEM-3** mirrors the `liveRunIds` guard already in
  `src-app/ui/tests/global-setup.ts` (build a runId→live-pid set from the shared
  `postgres-*.lock` dir via `process.kill(pid, 0)`), applied to the config-file
  sweep instead of the docker-container sweep.
- **ITEM-2** mirrors the existing win32/unix branch shape in the two
  `killProcessOnPort` copies; add a `command -v`-gated tool-selection chain on the
  unix arm.
- **Unit test** mirrors the existing `node --test` TS specs run by
  `src-app/ui`'s `test:unit` loader (`scripts/node-test-loader.mjs`); the file is
  a plain `node:test` + `node:assert` spec (port-manager is a pure Node module —
  `fs`/`net`/`child_process`, no React/vite), run with the same loader.

## UI-surface checklist

N/A — this feature adds NO user-facing UI surface (page/drawer/card/panel). It is
a change to the Playwright test harness fixtures only. There is no populated
render, no responsive behavior, no permission, and no JTBD surface to design. The
only "user" is the e2e harness itself; its job-to-be-done (allocate a
non-colliding port pair; clean up only its own orphans) is covered by the
concurrency unit test.
