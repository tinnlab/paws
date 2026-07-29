/**
 * Unit tests for desktop-e2e isolation helpers (run: `node --test`).
 * Covers TESTS.md TEST-10 (reaper namespacing + liveness-keep) and TEST-11
 * (allocator bind-verify + disjoint base + lock-dir override). Pure — no docker,
 * no playwright.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import {
  desktopBackendBase,
  desktopPgBase,
  desktopLockDir,
  desktopSessionNs,
  desktopContainerFilter,
  shouldKeepContainer,
  runIdFromContainer,
  isPortBindable,
} from './isolation-keys.mjs'
import { PORT_FLOORS } from '../../../../../sdk/packages/gallery/scripts/lib/run-key.mjs'

// ── TEST-10: reaper filter is namespaced by the port base; live runId is KEPT ──
test('TEST-10 container filter is namespaced by the pg base (not the bare prefix)', () => {
  const env = { ZIEE_DESKTOP_E2E_BASE_PG_PORT: '54650' }
  const filter = desktopContainerFilter(env)
  assert.equal(filter, 'ziee-desktop-test-postgres-pg54650-')
  // Crucially NOT the un-namespaced prefix that reaps siblings.
  assert.notEqual(filter, 'ziee-desktop-test-postgres-')
  assert.equal(desktopSessionNs(env), 'pg54650')
})

test('TEST-10 shouldKeepContainer keeps a container whose runId is in the live set', () => {
  const env = { ZIEE_DESKTOP_E2E_BASE_PG_PORT: '54650' }
  const name = 'ziee-desktop-test-postgres-pg54650-abcd1234'
  assert.equal(runIdFromContainer(name), 'pg54650-abcd1234')
  const live = new Set(['pg54650-abcd1234'])
  assert.equal(shouldKeepContainer(name, live, env), true)
  // A different session's live runId does NOT keep this one → it can be reaped
  // ONLY within its own namespace (this filter never lists it anyway).
  assert.equal(shouldKeepContainer(name, new Set(['pg54650-ffff0000']), env), false)
})

// ── TEST-11: allocator bind-verify + base disjoint from web + lock-dir override ─
test('TEST-11 isPortBindable skips a held port (the allocator bind-verify)', async () => {
  const held = await new Promise((res) => {
    const s = createServer()
    s.listen(0, '0.0.0.0', () => res(s))
  })
  const heldPort = held.address().port
  assert.equal(await isPortBindable(heldPort), false, 'a held port is NOT bindable')
  held.close()
  // and a fresh ephemeral port IS bindable.
  const freePort = await new Promise((res) => {
    const s = createServer()
    s.listen(0, '0.0.0.0', () => {
      const p = s.address().port
      s.close(() => res(p))
    })
  })
  assert.equal(await isPortBindable(freePort), true)
})

test('TEST-11 desktop backend base is OFF the web-e2e 9100 overlap', () => {
  const base = desktopBackendBase({})
  assert.ok(base >= 9600, `desktop backend base ${base} must be >= 9600 (desktopE2eBackend floor)`)
  // disjoint from the web-e2e backend range [9100, 9300)
  const webHi = PORT_FLOORS.webE2eBackend.floor + PORT_FLOORS.webE2eBackend.span
  assert.ok(base >= webHi, `desktop backend base ${base} must not fall in the web range < ${webHi}`)
  // pg base likewise disjoint from web 54331 range.
  const pg = desktopPgBase({})
  assert.ok(pg >= 54600, `desktop pg base ${pg} must be >= 54600`)
})

test('TEST-11 explicit env overrides base + lock dir (env wins over key)', () => {
  assert.equal(desktopBackendBase({ ZIEE_DESKTOP_E2E_BASE_BACKEND_PORT: '9777' }), 9777)
  assert.equal(desktopPgBase({ ZIEE_DESKTOP_E2E_BASE_PG_PORT: '54888' }), 54888)
  assert.equal(desktopLockDir({ ZIEE_DESKTOP_E2E_LOCK_DIR: '/tmp/custom-lock' }), '/tmp/custom-lock')
  // default lock dir is per-worktree keyed (moves WITH the base) — never the
  // shared un-keyed /tmp/ziee-desktop-test-locks.
  const def = desktopLockDir({})
  assert.match(def, /ziee-desktop-test-locks-[0-9a-f]{8}$/)
})
