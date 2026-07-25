# PLAN_AUDIT — e2e-port-collision

Audit of PLAN.md against the codebase before writing code.

## Breakage risk

- `findAvailablePorts` (ITEM-1) has ONE production caller
  (`test-context.ts` via the harness). Its signature `(workerIndex) =>
  Promise<{vite, backend}>` is UNCHANGED; it stays `async` (already is). The only
  behavioral change is that a base port already OS-bound by a sibling is skipped
  instead of returned — a strict improvement; the happy path (free base) returns
  the identical pair. No caller change needed.
- `killProcessOnPort` (ITEM-2) is internal to each file; adding a fallback chain
  does not change its `(port) => void` / `Promise<void>` signatures. Existing
  call sites unaffected. On a box WITH `lsof` the behavior is byte-identical
  (lsof arm still chosen first).
- `cleanupStaleConfigFiles` (ITEM-3) signature `(configDir) => void` unchanged.
  The guard only PREVENTS deletion of live-owned files — it never deletes more
  than before, so no new data loss risk; a genuinely stale file (dead pid / no
  lock) is still reaped.
- Exporting `killProcessOnPort` (ITEM-4) is additive; no existing import breaks.

## Pattern conformance

- ITEM-1 mirrors `allocatePostgresPort` in the SAME file (acquire → bind-check →
  release+continue) and reuses the existing `isPortBindable`. Fully conformant;
  the reference implementation at
  `/data/pbya/ziee/tmp/integration-verify-wt/.../port-manager.ts` proves the shape.
- ITEM-3 mirrors the `liveRunIds` guard already in `global-setup.ts`
  (`postgres-*.lock` → `process.kill(pid, 0)` → runId set). Same idiom, applied
  to the config sweep.
- ITEM-2's `command -v` tool probe is standard POSIX; the win32 arm is untouched,
  preserving cross-platform parity.

## Migration collisions

None — this feature adds NO migration and touches NO SQL. N/A.

## OpenAPI regen

Not required — no Rust type/handler change, no `openapi.json` /
`api-client/types.ts` delta in either workspace.

## Per-item verdicts

- **ITEM-1** — verdict: PASS — mirrors `allocatePostgresPort`'s bind-check in the
  same file; reuses `isPortBindable`; happy path preserved; single caller
  unaffected.
- **ITEM-2** — verdict: PASS — additive Unix fallback chain (`lsof`→`fuser`→`ss`)
  gated by `command -v`; win32 arm and signatures unchanged; identical behavior
  where lsof exists.
- **ITEM-3** — verdict: PASS — reuses the exact `liveRunIds` idiom from
  `global-setup.ts`; only narrows deletion (never widens); stale files still
  reaped.
- **ITEM-4** — verdict: PASS — additive `export` for testability; no production
  call-site change.
