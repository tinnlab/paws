/**
 * Per-run E2E `app.data_dir` isolation + key-derived port/lock defaults
 * (audit §6 / DEC-5 / ITEM-8 + ITEM-12).
 *
 * The Playwright e2e harness historically set NO `app.data_dir`, so every
 * per-test backend wrote files/workflows/skills/temp/models/sandboxes/bin to the
 * single shared `~/.ziee` — cross-worktree pollution + a reaper eating a
 * sibling's live workspace. This module gives the e2e path the same treatment
 * the Rust harness (`ziee-test-harness::make_isolated_data_dir`) already has: a
 * per-test data dir under the per-worktree `.ziee-cache`, with the expensive
 * read-only `bin/`/`lib/` caches SYMLINKED from a per-worktree shared cache so
 * the extract cost isn't paid per test.
 *
 * It ALSO derives the e2e port/lock DEFAULTS from the unified run key so
 * cross-worktree isolation is automatic (not a manual `ZIEE_E2E_*` opt-in).
 *
 * Pure + dependency-light (only `node:fs`/`node:path` + run-key) so it is
 * unit-testable via `node --test` without pulling in Playwright.
 */
import { resolve } from 'node:path'
import { mkdirSync, existsSync, symlinkSync } from 'node:fs'
import {
  worktreeKey,
  resolveWorktreeRoot,
  portBase,
  PORT_FLOORS,
} from '../../../../sdk/packages/gallery/scripts/lib/run-key.mjs'

/** The per-worktree shared read-only cache root (same one the Rust harness
 *  populates), so extracted binaries are shared across tests + across the two
 *  harnesses within a worktree. */
export function sharedTestAppDataDir(root) {
  return resolve(root, '.ziee-cache', 'test-app-data')
}

/** The per-test isolated `app.data_dir` — NEVER `~/.ziee`. */
export function e2eDataDirFor(root, testId) {
  return resolve(root, '.ziee-cache', 'e2e-app-data', testId)
}

/**
 * Create the per-test isolated data dir and symlink the read-only caches
 * (`bin/`, `lib/`) in from the per-worktree shared cache (mirrors the Rust
 * harness `make_isolated_data_dir`). Returns the data-dir path to inject as
 * `app.data_dir`. Idempotent; symlinks only when absent.
 */
export function prepareE2eDataDir(root, testId) {
  const dataDir = e2eDataDirFor(root, testId)
  mkdirSync(dataDir, { recursive: true })
  const shared = sharedTestAppDataDir(root)
  for (const sub of ['bin', 'lib']) {
    const target = resolve(shared, sub)
    mkdirSync(target, { recursive: true })
    const link = resolve(dataDir, sub)
    if (!existsSync(link)) {
      try {
        symlinkSync(target, link, 'dir')
      } catch {
        /* a concurrent test may have created it between the check + call */
      }
    }
  }
  return dataDir
}

/**
 * The e2e port/lock DEFAULTS. When a `ZIEE_E2E_*` env var is unset the default is
 * KEY-DERIVED (per-worktree) — so lock dir + port bases are per-worktree by
 * default and a partial env-set (e.g. only the lock dir) can never reintroduce a
 * shared base (audit §7: they move together). An explicit env still wins.
 *
 * `env` defaults to `process.env`; `cwd` seeds the worktree root (git toplevel).
 */
export function resolveE2eDefaults(env = process.env, cwd = process.cwd()) {
  const root = resolveWorktreeRoot(cwd)
  const key = worktreeKey(root)
  const baseVitePort = portBase(key, PORT_FLOORS.webE2eVite.floor, PORT_FLOORS.webE2eVite.span)
  const baseBackendPort = portBase(
    key,
    PORT_FLOORS.webE2eBackend.floor,
    PORT_FLOORS.webE2eBackend.span,
  )
  const basePgPort = portBase(key, PORT_FLOORS.webE2ePg.floor, PORT_FLOORS.webE2ePg.span)
  const lockDir = `/tmp/ziee-test-locks-${key}`
  return {
    key,
    root,
    baseVitePort: intOr(env.ZIEE_E2E_BASE_VITE_PORT, baseVitePort),
    baseBackendPort: intOr(env.ZIEE_E2E_BASE_BACKEND_PORT, baseBackendPort),
    basePgPort: intOr(env.ZIEE_E2E_BASE_PG_PORT, basePgPort),
    lockDir: env.ZIEE_E2E_LOCK_DIR || lockDir,
  }
}

function intOr(v, dflt) {
  const n = v != null ? parseInt(v, 10) : NaN
  return Number.isFinite(n) && n > 0 ? n : dflt
}
