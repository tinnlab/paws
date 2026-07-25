/**
 * Concurrency + robustness unit tests for the e2e port harness
 * (`port-manager.ts`). These are the REAL proof of the port-collision fix: a
 * single isolated e2e session can never exhibit the race (it needs a SECOND
 * concurrent session on a different lock dir), so the collision is proven here,
 * at the allocator, not in an e2e spec.
 *
 * port-manager is a pure Node module (fs/net/child_process — no React/vite), so
 * this runs under the same `node --test` + strip-types loader as `test:unit`.
 *
 * The module reads its LOCK_DIR from `ZIEE_E2E_LOCK_DIR` ONCE at import, so we
 * set a fresh temp lock dir BEFORE dynamically importing it. The base ports are
 * read per-call, so those are set per test.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, existsSync, chmodSync, utimesSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer, type Server } from 'node:net'

const LOCK_DIR = mkdtempSync(join(tmpdir(), 'pm-lock-'))
process.env.ZIEE_E2E_LOCK_DIR = LOCK_DIR

const pm = await import('./port-manager.ts')

// port-manager logs verbosely (emoji-prefixed) to stdout. Under `node --test`
// that high-volume multibyte output interleaves with the runner's V8-serialized
// IPC on the SAME pipe and intermittently corrupts it ("Unable to deserialize
// cloned data"). Silence the operational logs for this spec — every assertion
// here is against files / return values, never console output.
for (const k of ['log', 'info', 'warn', 'debug'] as const) {
  ;(console as unknown as Record<string, () => void>)[k] = () => {}
}

// --- helpers ---------------------------------------------------------------

/** Resolves true iff `port` is bindable on 0.0.0.0 right now (test-local copy
 *  of the module's private isPortBindable). */
function bindable(port: number): Promise<boolean> {
  return new Promise((res) => {
    const srv = createServer()
    srv.once('error', () => res(false))
    srv.once('listening', () => srv.close(() => res(true)))
    srv.listen(port, '0.0.0.0')
  })
}

/** Restore the base-port env vars (unset when they were previously absent) so a
 *  test never leaks its port base into a sibling test. */
function restoreEnv(saved: { v: string | undefined; b: string | undefined }): void {
  if (saved.v === undefined) delete process.env.ZIEE_E2E_BASE_VITE_PORT
  else process.env.ZIEE_E2E_BASE_VITE_PORT = saved.v
  if (saved.b === undefined) delete process.env.ZIEE_E2E_BASE_BACKEND_PORT
  else process.env.ZIEE_E2E_BASE_BACKEND_PORT = saved.b
}

/** Hold `port` with a real listener (simulates a concurrent session's live
 *  server). Resolves the Server so the caller can close it. */
function hold(port: number): Promise<Server> {
  return new Promise((res, rej) => {
    const srv = createServer()
    srv.once('error', rej)
    srv.listen(port, '0.0.0.0', () => res(srv))
  })
}

/** Find a vite base V such that V, V+8 and the backend base B=V+1000, B+8 are
 *  ALL bindable — so offset 0 and the next offset (8) are both usable. */
async function findFreeBase(): Promise<{ V: number; B: number }> {
  let V = 20000 + Math.floor(Math.random() * 2000)
  for (let i = 0; i < 400; i++, V += 16) {
    const B = V + 1000
    if (
      (await bindable(V)) &&
      (await bindable(V + 8)) &&
      (await bindable(B)) &&
      (await bindable(B + 8))
    ) {
      return { V, B }
    }
  }
  throw new Error('could not find a free port base for the test')
}

// --- ITEM-1: findAvailablePorts ------------------------------------------

// TEST-1 — happy path: a free base is returned unchanged (the bind-check does
// not perturb the free case).
test('TEST-1 findAvailablePorts returns the base pair when it is free', async () => {
  const savedEnv = { v: process.env.ZIEE_E2E_BASE_VITE_PORT, b: process.env.ZIEE_E2E_BASE_BACKEND_PORT }
  const { V, B } = await findFreeBase()
  process.env.ZIEE_E2E_BASE_VITE_PORT = String(V)
  process.env.ZIEE_E2E_BASE_BACKEND_PORT = String(B)

  const got = await pm.findAvailablePorts(0)
  try {
    assert.equal(got.vite, V, 'free base vite port is chosen as-is')
    assert.equal(got.backend, B, 'free base backend port is chosen as-is')
  } finally {
    pm.releasePortLock(got.vite, got.backend)
    restoreEnv(savedEnv)
  }
})

// TEST-2 — collision: a concurrent session (real listeners on the base pair,
// whose lock lives in a DIFFERENT/invisible lock dir → our acquirePortLock still
// succeeds) already holds the base ports. The allocator must NOT return that
// pair (the old code did, then test-context killed the sibling) — it skips to
// the next OS-bindable offset. This is the enumerable regression guard.
test('TEST-2 findAvailablePorts skips a base held by a concurrent session (no collision)', async () => {
  const savedEnv = { v: process.env.ZIEE_E2E_BASE_VITE_PORT, b: process.env.ZIEE_E2E_BASE_BACKEND_PORT }
  const { V, B } = await findFreeBase()
  process.env.ZIEE_E2E_BASE_VITE_PORT = String(V)
  process.env.ZIEE_E2E_BASE_BACKEND_PORT = String(B)

  // Session A comes up on the base pair. Its lock is NOT in our lock dir, so our
  // acquirePortLock(V,B) will succeed — only the OS bind-check can catch it.
  const a1 = await hold(V)
  const a2 = await hold(B)
  try {
    const got = await pm.findAvailablePorts(0)
    try {
      // Robust skip-invariant (not a hard `=== V+8`, which flakes if another
      // process grabs the +8 offset between the probe and the allocation): the
      // allocator must NEVER hand out the held base pair, must move FORWARD by a
      // whole offset step (multiple of 8), and must apply the SAME offset to both
      // ports (they move together).
      assert.notEqual(got.vite, V, 'must NOT hand out the vite port a sibling holds')
      assert.notEqual(got.backend, B, 'must NOT hand out the backend port a sibling holds')
      assert.ok(got.vite >= V + 8, `skipped forward past the held base (got ${got.vite}, base ${V})`)
      assert.equal((got.vite - V) % 8, 0, 'skipped by a whole worker-offset step')
      assert.equal(got.backend - got.vite, B - V, 'the same offset is applied to vite + backend')
    } finally {
      pm.releasePortLock(got.vite, got.backend)
    }
  } finally {
    a1.close()
    a2.close()
    restoreEnv(savedEnv)
  }
})

// --- ITEM-2 / ITEM-4: killProcessOnPort fallback --------------------------

// TEST-3 — the fuser fallback. Before the fix, killProcessOnPort ran `lsof`
// ONLY and swallowed the throw when lsof was absent → a silent no-op. Now, with
// PATH scoped so lsof is ABSENT but fuser present, it must actually invoke
// `fuser -k <port>/tcp`; and with lsof present, lsof must still win (fuser
// untouched).
// POSIX-only: writes `#!/bin/sh` fake binaries + relies on `command -v` and the
// exec bit. Genuinely incompatible with Windows `test:unit` (no /bin/sh, no
// chmod exec bit, `command -v` is not cmd) — a legitimate platform gate, not a
// go-green skip. The win32 arm of killProcessOnPort is unchanged by this diff.
test('TEST-3 killProcessOnPort falls back to fuser when lsof is absent, prefers lsof when present', { skip: process.platform === 'win32' }, async () => {
  const bin = mkdtempSync(join(tmpdir(), 'pm-bin-'))
  const fuserMarker = join(bin, 'fuser.called')
  const lsofMarker = join(bin, 'lsof.called')
  // Fake fuser: record args to a file, emit nothing to stdout.
  writeFileSync(join(bin, 'fuser'), `#!/bin/sh\necho "$*" > "${fuserMarker}"\nexit 0\n`)
  chmodSync(join(bin, 'fuser'), 0o755)
  const savedPath = process.env.PATH

  try {
    // Leg A — only fuser on PATH → fallback fires.
    process.env.PATH = bin
    pm.killProcessOnPort(45671)
    assert.ok(existsSync(fuserMarker), 'fuser fallback was invoked (no longer a silent no-op)')
    const recorded = (await import('node:fs')).readFileSync(fuserMarker, 'utf8').trim()
    assert.equal(recorded, '-k 45671/tcp', 'fuser called with -k <port>/tcp')

    // Leg B — fake lsof ALSO on PATH → lsof preferred, fuser NOT re-invoked.
    rmSync(fuserMarker, { force: true })
    writeFileSync(join(bin, 'lsof'), `#!/bin/sh\necho called > "${lsofMarker}"\nexit 0\n`)
    chmodSync(join(bin, 'lsof'), 0o755)
    pm.killProcessOnPort(45672)
    assert.ok(existsSync(lsofMarker), 'lsof arm ran when lsof is present')
    assert.equal(existsSync(fuserMarker), false, 'fuser NOT called when lsof is present (lsof-first)')
  } finally {
    process.env.PATH = savedPath
    rmSync(bin, { recursive: true, force: true })
  }
})

// --- ITEM-3: cleanupStaleConfigFiles live-lock guard ----------------------

// TEST-4 — an OLD (past-TTL) postgres-<runId>.json whose runId has a LIVE
// postgres lock is KEPT; a control OLD config with no live lock is reaped.
test('TEST-4 cleanupStaleConfigFiles keeps a live-locked config, reaps a genuine orphan', async () => {
  const configDir = mkdtempSync(join(tmpdir(), 'pm-cfg-'))
  const tenMinAgo = (Date.now() - 10 * 60 * 1000) / 1000 // seconds, past the 5-min TTL

  // LIVE: a config owned by a still-running session (pid = this process).
  const liveCfg = join(configDir, 'postgres-LIVE.json')
  writeFileSync(liveCfg, JSON.stringify({ runId: 'LIVE', port: 59999 }))
  utimesSync(liveCfg, tenMinAgo, tenMinAgo)
  writeFileSync(
    join(LOCK_DIR, 'postgres-59999.lock'),
    JSON.stringify({ pid: process.pid, timestamp: Date.now(), port: 59999, runId: 'LIVE' }),
  )

  // ORPHAN: an old config with no live lock at all.
  const deadCfg = join(configDir, 'postgres-DEAD.json')
  writeFileSync(deadCfg, JSON.stringify({ runId: 'DEAD', port: 58888 }))
  utimesSync(deadCfg, tenMinAgo, tenMinAgo)

  try {
    pm.cleanupStaleConfigFiles(configDir)
    assert.equal(existsSync(liveCfg), true, 'active session config is KEPT despite being past TTL')
    assert.equal(existsSync(deadCfg), false, 'a genuine orphan is still reaped')
  } finally {
    rmSync(configDir, { recursive: true, force: true })
    rmSync(join(LOCK_DIR, 'postgres-59999.lock'), { force: true })
  }
})
