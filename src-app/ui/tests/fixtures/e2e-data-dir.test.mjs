/**
 * Unit tests for the e2e data-dir isolation + key-derived port/lock defaults
 * (run: `node --test`). Covers TESTS.md TEST-8 + TEST-12.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, lstatSync, rmSync, readlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import {
  e2eDataDirFor,
  sharedTestAppDataDir,
  prepareE2eDataDir,
  resolveE2eDefaults,
} from './e2e-data-dir.mjs'
import { PORT_FLOORS } from '../../../../sdk/packages/gallery/scripts/lib/run-key.mjs'

// TEST-8: the data dir is per-worktree/per-test under .ziee-cache, never ~/.ziee,
// and the bin cache is a symlink into the shared test-app-data.
test('TEST-8 e2e data dir is under .ziee-cache and never the home ~/.ziee', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'wt-iso-'))
  try {
    const testId = 'deadbeef'
    const dir = e2eDataDirFor(root, testId)
    assert.equal(dir, resolve(root, '.ziee-cache', 'e2e-app-data', testId))
    // Must NOT resolve into a user home ~/.ziee path.
    assert.ok(!dir.includes(`${resolve(process.env.HOME || '/root')}/.ziee/`))
    assert.ok(dir.includes('/.ziee-cache/e2e-app-data/'))

    const made = prepareE2eDataDir(root, testId)
    assert.equal(made, dir)
    assert.ok(existsSync(dir))
    // bin is a SYMLINK pointing at the shared cache's bin.
    const binLink = resolve(dir, 'bin')
    assert.ok(existsSync(binLink))
    assert.ok(lstatSync(binLink).isSymbolicLink(), 'bin must be a symlink')
    assert.equal(readlinkSync(binLink), resolve(sharedTestAppDataDir(root), 'bin'))
    // idempotent
    assert.equal(prepareE2eDataDir(root, testId), dir)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// TEST-12: env-unset → key-derived defaults (per-worktree); lock dir + ports move
// together; explicit env wins.
test('TEST-12 e2e defaults are key-derived when env unset, explicit env wins', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'wt-iso-'))
  try {
    // env fully unset → all key-derived, lock dir carries the key.
    const d = resolveE2eDefaults({}, root)
    assert.match(d.key, /^[0-9a-f]{8}$/)
    assert.equal(d.lockDir, `/tmp/ziee-test-locks-${d.key}`)
    assert.ok(
      d.baseVitePort >= PORT_FLOORS.webE2eVite.floor &&
        d.baseVitePort < PORT_FLOORS.webE2eVite.floor + PORT_FLOORS.webE2eVite.span,
    )
    assert.ok(
      d.baseBackendPort >= PORT_FLOORS.webE2eBackend.floor &&
        d.baseBackendPort < PORT_FLOORS.webE2eBackend.floor + PORT_FLOORS.webE2eBackend.span,
    )
    assert.ok(
      d.basePgPort >= PORT_FLOORS.webE2ePg.floor &&
        d.basePgPort < PORT_FLOORS.webE2ePg.floor + PORT_FLOORS.webE2ePg.span,
    )

    // A DIFFERENT worktree root → different key → the lock dir AND ports move
    // together (never a shared base while the lock dir isolates).
    const other = mkdtempSync(resolve(tmpdir(), 'wt-iso-b-'))
    try {
      const d2 = resolveE2eDefaults({}, other)
      assert.notEqual(d.key, d2.key)
      assert.notEqual(d.lockDir, d2.lockDir)
      // At least one base differs (they move with the key); realistically all do.
      assert.ok(
        d.baseVitePort !== d2.baseVitePort ||
          d.baseBackendPort !== d2.baseBackendPort ||
          d.basePgPort !== d2.basePgPort,
      )
    } finally {
      rmSync(other, { recursive: true, force: true })
    }

    // Explicit env wins.
    const e = resolveE2eDefaults(
      {
        ZIEE_E2E_BASE_VITE_PORT: '9500',
        ZIEE_E2E_BASE_BACKEND_PORT: '9550',
        ZIEE_E2E_BASE_PG_PORT: '55000',
        ZIEE_E2E_LOCK_DIR: '/tmp/custom-locks',
      },
      root,
    )
    assert.equal(e.baseVitePort, 9500)
    assert.equal(e.baseBackendPort, 9550)
    assert.equal(e.basePgPort, 55000)
    assert.equal(e.lockDir, '/tmp/custom-locks')

    // Partial env (only lock dir) → ports STILL key-derived (per-worktree), so a
    // partial set can never reintroduce a shared base (audit §7).
    const p = resolveE2eDefaults({ ZIEE_E2E_LOCK_DIR: '/tmp/only-lock' }, root)
    assert.equal(p.lockDir, '/tmp/only-lock')
    assert.equal(p.baseVitePort, d.baseVitePort)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
