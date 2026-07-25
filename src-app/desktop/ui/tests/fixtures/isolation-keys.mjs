/**
 * Desktop-e2e isolation keys — pure, node-testable helpers derived from the
 * unified run key (audit §3/§5/§7). ONE source for: the per-worktree lock dir,
 * the desktop backend/postgres port bases (disjoint from the web-e2e 9100/54331),
 * the docker container namespace + reap filter, and the shared-lock liveness
 * check. `port-manager.ts` + `global-setup.ts` import these; `node --test` unit-
 * tests them without docker/playwright.
 *
 * Everything keys off `worktreeKey()` so N concurrent worktrees never collide,
 * and every value is env-overridable (CI) — the lock dir and the port bases MOVE
 * TOGETHER (both derive from the same key), so isolating one never leaves the
 * other on a shared default (the bug the web port-manager warns about).
 */
// The byte-identical FNV twin + port math (cross-language parity-tested).
import { worktreeKey, portBase, PORT_FLOORS, isPortBindable } from '../../../../../sdk/packages/gallery/scripts/lib/run-key.mjs'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'

export { isPortBindable, worktreeKey }

/** Desktop e2e backend port base — OFF the web-e2e 9100 overlap (9600 floor). */
export function desktopBackendBase(env = process.env) {
  const e = Number(env.ZIEE_DESKTOP_E2E_BASE_BACKEND_PORT)
  if (Number.isFinite(e) && e > 0) return e
  const { floor, span } = PORT_FLOORS.desktopE2eBackend
  return portBase(worktreeKey(), floor, span)
}

/** Desktop e2e postgres port base — OFF the web-e2e 54331 overlap (54600 floor). */
export function desktopPgBase(env = process.env) {
  const e = Number(env.ZIEE_DESKTOP_E2E_BASE_PG_PORT)
  if (Number.isFinite(e) && e > 0) return e
  const { floor, span } = PORT_FLOORS.desktopE2ePg
  return portBase(worktreeKey(), floor, span)
}

/** Per-worktree lock dir — env-overridable, else keyed by worktreeKey so two
 *  worktrees never share `/tmp/ziee-desktop-test-locks` (moves WITH the bases). */
export function desktopLockDir(env = process.env) {
  return env.ZIEE_DESKTOP_E2E_LOCK_DIR || resolve(tmpdir(), `ziee-desktop-test-locks-${worktreeKey()}`)
}

/** Container namespace: `pg<pgBase>` — scopes the docker filter to THIS session
 *  so a reaper can never see (let alone `docker rm -f`) a sibling's container. */
export function desktopSessionNs(env = process.env) {
  return `pg${desktopPgBase(env)}`
}

/** The scoped `docker ps --filter name=` prefix (NEVER the bare, un-namespaced
 *  `ziee-desktop-test-postgres-`). */
export function desktopContainerFilter(env = process.env) {
  return `ziee-desktop-test-postgres-${desktopSessionNs(env)}-`
}

/** runId embedded in a scoped container name (the part after the filter). */
export function runIdFromContainer(name, env = process.env) {
  return name.replace(desktopContainerFilter(env), '')
}

/**
 * KEEP a container iff a STILL-LIVE session owns its runId (judged from the
 * SHARED lock dir, never the local .test-configs — that's the tailtest twin).
 */
export function shouldKeepContainer(name, liveRunIds, env = process.env) {
  return liveRunIds.has(runIdFromContainer(name, env))
}

/** Set of runIds whose owning PID is still alive, from the shared postgres locks. */
export function collectLiveRunIds(env = process.env) {
  const dir = desktopLockDir(env)
  const live = new Set()
  if (!existsSync(dir)) return live
  for (const f of readdirSync(dir)) {
    if (!f.startsWith('postgres-') || !f.endsWith('.lock')) continue
    try {
      const lock = JSON.parse(readFileSync(resolve(dir, f), 'utf-8'))
      if (!lock.runId) continue
      try {
        process.kill(lock.pid, 0)
        live.add(lock.runId)
      } catch {
        // owner gone — reapable
      }
    } catch {
      // corrupted lock — ignore
    }
  }
  return live
}
