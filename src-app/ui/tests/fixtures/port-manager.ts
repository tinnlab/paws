import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, readdirSync, statSync } from 'fs'
import { resolve } from 'path'
import { tmpdir } from 'os'
import { execSync } from 'child_process'
import { createServer } from 'net'
// @ts-ignore — key-derived e2e defaults (ITEM-12): when ZIEE_E2E_* is unset the
// default is per-worktree (audit §7), so isolation isn't a manual opt-in.
import { resolveE2eDefaults } from './e2e-data-dir.mjs'

// Resolved ONCE per process from the run key. An explicit ZIEE_E2E_* env still
// wins inside resolveE2eDefaults; lock dir + port bases are per-worktree by
// default so a partial env-set can never reintroduce a shared base.
const E2E_DEFAULTS = resolveE2eDefaults()

/**
 * True when `port` can actually be bound on 0.0.0.0 right now.
 *
 * The lock file alone is NOT sufficient: a sibling worktree's postgres
 * docker container can keep holding the port (0.0.0.0:port) AFTER the
 * process that launched it exits — at which point its lock is reaped as
 * "orphaned PID" and the port looks free to the lock allocator, but
 * `docker compose up` then fails with "port is already allocated". Mirror
 * the backend harness's portpicker bind-verify: try a real bind. Bind on
 * 0.0.0.0 (not 127.0.0.1) so a docker 0.0.0.0 publish is detected.
 */
function isPortBindable(port: number): Promise<boolean> {
  return new Promise((res) => {
    const srv = createServer()
    srv.once('error', () => res(false))
    srv.once('listening', () => srv.close(() => res(true)))
    srv.listen(port, '0.0.0.0')
  })
}

// Lock dir is env-overridable so concurrent git worktrees can isolate
// their E2E runs from each other. Without this, every worktree shares
// `/tmp/ziee-test-locks` + the same 9000/9100 port base, and one run's
// stale-lock cleanup kills a sibling worktree's just-starting backend
// (observed as a graceful "Shutdown signal received" ~20s into startup).
// Pair with ZIEE_E2E_BASE_VITE_PORT / ZIEE_E2E_BASE_BACKEND_PORT.
// Default is per-worktree (`/tmp/ziee-test-locks-<key>`); ZIEE_E2E_LOCK_DIR wins
// (handled inside resolveE2eDefaults). `tmpdir()` retained via the key-path only
// when the derived default is used. Pairs with the key-derived port bases below.
const LOCK_DIR = E2E_DEFAULTS.lockDir || resolve(tmpdir(), 'ziee-test-locks')
const LOCK_TIMEOUT_MS = 1800000 // 30 minutes - covers a full dir run; postgres locks are not heartbeat-refreshed
// @ts-ignore - Reserved for future use
const _HEARTBEAT_INTERVAL_MS = 5000 // 5 seconds - heartbeat update frequency (reserved for future use)
const HEARTBEAT_STALE_MS = 10000 // 10 seconds - consider stale if no heartbeat
const CONFIG_STALE_MS = 300000 // 5 minutes - clean up config files older than this

interface PortLock {
  pid: number // Main test process PID
  timestamp: number // Last heartbeat timestamp
  vitePort: number
  backendPort: number
  vitePid?: number // Vite process PID
  backendPid?: number // Backend process PID
}

interface PostgresPortLock {
  pid: number
  timestamp: number
  port: number
  runId: string
}

/**
 * Check if a process is still running
 * Uses signal 0 which doesn't kill the process, just checks existence
 * Works on both Linux and Windows
 */
function isProcessAlive(pid: number): boolean {
  try {
    // Send signal 0 to check if process exists without killing it
    process.kill(pid, 0)
    return true
  } catch (e) {
    // ESRCH = no such process
    return false
  }
}

/**
 * Kill a process by PID
 * Works on both Linux and Windows
 * Note: Currently unused in favor of killProcessOnPort for better reliability
 */
// @ts-ignore - Reserved for future use
function _killProcess(pid: number): void {
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' })
    } else {
      execSync(`kill -9 ${pid}`, { stdio: 'ignore' })
    }
    console.log(`🔪 Killed process PID ${pid}`)
  } catch (e) {
    // Process might already be dead
  }
}

/**
 * True when `cmd` resolves on PATH (POSIX `command -v`). Used to pick an
 * AVAILABLE port-killer on Unix so cleanup still works on a box WITHOUT `lsof`.
 */
function hasCmd(cmd: string): boolean {
  try {
    execSync(`command -v ${cmd}`, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * Kill all processes using a specific port
 * More reliable than killing by PID for parent/child process trees.
 *
 * On Unix the original implementation used `lsof -ti :port` ONLY, and swallowed
 * the throw when `lsof` was absent — so on a box without lsof (common on minimal
 * CI images and, e.g., this dev box which ships `fuser` but not `lsof`/`ss`) the
 * orphan cleanup silently did NOTHING. Fall back `lsof` → `fuser -k` → `ss` by
 * `command -v` availability so a functional kill always runs when any of them is
 * present. Windows (`netstat`/`taskkill`) is unchanged.
 */
export function killProcessOnPort(port: number): void {
  // Defense-in-depth: `port` is typed number but callers pass values read from
  // lock files (lock.vitePort/backendPort); refuse a non-numeric value before
  // it is interpolated into a shell string.
  if (!Number.isInteger(port) || port <= 0) return

  if (process.platform === 'win32') {
    try {
      const output = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8', stdio: 'pipe' }).trim()
      if (!output) return
      // Windows: extract PID from netstat output
      const pids = new Set<string>()
      for (const line of output.split('\n')) {
        const match = line.trim().match(/\s+(\d+)$/)
        if (match) pids.add(match[1])
      }
      for (const pid of pids) {
        try {
          execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' })
        } catch {}
      }
      console.log(`🔪 Killed processes on port ${port}`)
    } catch {
      // No process on port or command failed - that's ok
    }
    return
  }

  // Unix: prefer lsof (explicit PID list → kill -9), else fuser (kills holders
  // directly), else ss (parse pid= → kill -9). command -v gates each so an
  // absent tool falls through instead of silently no-opping.
  if (hasCmd('lsof')) {
    try {
      const output = execSync(`lsof -ti :${port}`, { encoding: 'utf8', stdio: 'pipe' }).trim()
      if (!output) return
      for (const pid of output.split('\n').filter(Boolean)) {
        try {
          execSync(`kill -9 ${pid}`, { stdio: 'ignore' })
        } catch {}
      }
      console.log(`🔪 Killed processes on port ${port} (lsof)`)
    } catch {
      // lsof present but matched nothing / errored — nothing to kill.
    }
    return
  }

  if (hasCmd('fuser')) {
    try {
      // `fuser -k` sends SIGKILL to every process holding the TCP port directly.
      execSync(`fuser -k ${port}/tcp`, { stdio: 'ignore' })
      console.log(`🔪 Killed processes on port ${port} (fuser)`)
    } catch {
      // No holder / fuser errored — ok.
    }
    return
  }

  if (hasCmd('ss')) {
    try {
      const output = execSync(`ss -H -ltnp 'sport = :${port}'`, { encoding: 'utf8', stdio: 'pipe' }).trim()
      if (!output) return
      const pids = new Set<string>()
      for (const m of output.matchAll(/pid=(\d+)/g)) pids.add(m[1])
      for (const pid of pids) {
        try {
          execSync(`kill -9 ${pid}`, { stdio: 'ignore' })
        } catch {}
      }
      if (pids.size) console.log(`🔪 Killed processes on port ${port} (ss)`)
    } catch {
      // ss errored — ok.
    }
    return
  }

  // No port-killer tool available — cannot reap; leave a trace instead of
  // silently doing nothing (the old lsof-only behavior).
  console.warn(`⚠️  no lsof/fuser/ss available to free port ${port}; leaving it`)
}

/**
 * Validate if a lock is still valid.
 *
 * A lock is valid if either:
 *   1. The heartbeat timestamp is recent (within HEARTBEAT_STALE_MS), OR
 *   2. The recorded process PIDs are still alive (signal-0 probe).
 *
 * The PID liveness check (#2) is critical: under load (cargo cold-start
 * compilation, vite optimize-deps reload, the test node event loop
 * pegged waiting on a long fetch handler) the heartbeat interval can
 * drift past the 10 s stale threshold even while the test is healthy
 * mid-execution. If we treated that as stale and killed the processes,
 * we'd take down ANOTHER worker's running backend and vite — that's
 * exactly the symptom users saw as "ERR_CONNECTION_REFUSED" /
 * "TypeError: Failed to fetch" cascades during parallel runs.
 *
 * Only treat the lock as stale when BOTH the heartbeat is gone AND
 * the registered processes are gone.
 */
function isLockValid(lock: PortLock): boolean {
  const now = Date.now()

  if (now - lock.timestamp <= HEARTBEAT_STALE_MS) {
    return true
  }

  // Heartbeat is stale — but check if the registered processes are
  // actually still running. A live process means the worker is just
  // blocked (event loop), not crashed.
  const mainAlive = isProcessAlive(lock.pid)
  const viteAlive = lock.vitePid ? isProcessAlive(lock.vitePid) : false
  const backendAlive = lock.backendPid ? isProcessAlive(lock.backendPid) : false

  if (mainAlive || viteAlive || backendAlive) {
    // Workers still alive — heartbeat just hasn't ticked yet. Treat as
    // valid; the worker will catch up.
    return true
  }

  console.log(
    `🧹 Lock heartbeat stale AND all registered PIDs are dead ` +
      `(last update: ${new Date(lock.timestamp).toISOString()}, ` +
      `age: ${now - lock.timestamp}ms, main pid=${lock.pid}, ` +
      `vite pid=${lock.vitePid ?? 'unset'}, backend pid=${lock.backendPid ?? 'unset'})`,
  )
  return false
}

/**
 * Try to acquire a lock for a specific port pair
 * Returns true if lock was acquired, false if ports are in use
 * If lock is stale, kills processes on those ports before acquiring
 */
function acquirePortLock(vitePort: number, backendPort: number): boolean {
  if (!existsSync(LOCK_DIR)) {
    mkdirSync(LOCK_DIR, { recursive: true })
  }

  const lockFile = resolve(LOCK_DIR, `ports-${vitePort}-${backendPort}.lock`)

  // Check existing lock
  if (existsSync(lockFile)) {
    try {
      const existingLock: PortLock = JSON.parse(readFileSync(lockFile, 'utf-8'))

      if (isLockValid(existingLock)) {
        // Lock is valid, ports are in use
        return false
      } else {
        // Lock is stale, kill processes on these ports
        console.log(`🧹 Removing stale lock: ${lockFile}`)
        console.log(`🔪 Killing processes on ports ${vitePort} and ${backendPort}`)

        // Kill by port instead of PID - more reliable for parent/child process trees
        try {
          killProcessOnPort(vitePort)
          killProcessOnPort(backendPort)
        } catch (e) {
          // Best effort
        }

        unlinkSync(lockFile)
      }
    } catch (e) {
      // Corrupted lock file, remove it
      console.log(`🧹 Removing corrupted lock: ${lockFile}`)
      unlinkSync(lockFile)
    }
  }

  // Acquire lock
  const lock: PortLock = {
    pid: process.pid,
    timestamp: Date.now(),
    vitePort,
    backendPort,
  }

  writeFileSync(lockFile, JSON.stringify(lock, null, 2))
  return true
}

/**
 * Update the heartbeat for a port lock
 * Updates timestamp and process PIDs to keep lock alive
 */
export function updatePortLockHeartbeat(
  vitePort: number,
  backendPort: number,
  vitePid?: number,
  backendPid?: number
): void {
  const lockFile = resolve(LOCK_DIR, `ports-${vitePort}-${backendPort}.lock`)

  try {
    if (existsSync(lockFile)) {
      const lock: PortLock = JSON.parse(readFileSync(lockFile, 'utf-8'))

      // Only update if we own the lock
      if (lock.pid === process.pid) {
        lock.timestamp = Date.now()
        if (vitePid !== undefined) {
          lock.vitePid = vitePid
        }
        if (backendPid !== undefined) {
          lock.backendPid = backendPid
        }

        writeFileSync(lockFile, JSON.stringify(lock, null, 2))
      }
    }
  } catch (e) {
    // Best effort heartbeat update
  }
}

/**
 * Release a port lock
 * Only releases if we own the lock (matching PID)
 */
export function releasePortLock(vitePort: number, backendPort: number): void {
  const lockFile = resolve(LOCK_DIR, `ports-${vitePort}-${backendPort}.lock`)

  try {
    if (existsSync(lockFile)) {
      const lock: PortLock = JSON.parse(readFileSync(lockFile, 'utf-8'))

      // Only release if we own the lock
      if (lock.pid === process.pid) {
        unlinkSync(lockFile)
        console.log(`🔓 Released port lock: ${vitePort}/${backendPort}`)
      }
    }
  } catch (e) {
    // Best effort cleanup
  }
}

/**
 * Find and lock an available port pair for this test worker
 * Tries multiple port ranges to find free ports
 * Automatically cleans up stale locks from crashed processes
 */
export async function findAvailablePorts(
  workerIndex: number
): Promise<{ vite: number; backend: number }> {
  // Try up to 100 port pairs
  const MAX_ATTEMPTS = 100
  // Per-worktree KEY-DERIVED base (ITEM-12): default is `portBase(key, floor)` so
  // two worktrees never share a base; ZIEE_E2E_BASE_* still overrides (resolved
  // in E2E_DEFAULTS, which moves the lock dir with these bases — audit §7).
  const BASE_VITE_PORT = E2E_DEFAULTS.baseVitePort
  const BASE_BACKEND_PORT = E2E_DEFAULTS.baseBackendPort

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // Spread workers across port range to reduce collisions
    // First try: worker 0 = 9000, worker 1 = 9001, etc.
    // Second try: worker 0 = 9008, worker 1 = 9009, etc.
    const offset = workerIndex + attempt * 8
    const vitePort = BASE_VITE_PORT + offset
    const backendPort = BASE_BACKEND_PORT + offset

    if (acquirePortLock(vitePort, backendPort)) {
      // Lock acquired — but the lock file only coordinates sessions that SHARE
      // this lock dir. A concurrent e2e session on the same box using a DIFFERENT
      // lock dir (the cross-worktree isolation recipe sets ZIEE_E2E_LOCK_DIR but
      // often leaves the default port base) doesn't see our lock, so both race to
      // the SAME default base and one session's test-context step-1
      // killProcessOnPort() then kills the other's LIVE backend/vite mid-test →
      // its browser's SSE + /api calls get ECONNREFUSED. Mirror the postgres
      // allocator (allocatePostgresPort → isPortBindable): a lock-free port is not
      // necessarily bind-free, so verify BOTH ports are actually bindable at the
      // OS level before handing them out. If a sibling holds either, release our
      // just-taken lock and try the next offset. NOTE this bind probe is TOCTOU
      // (same accepted caveat as allocatePostgresPort): two sessions on different
      // lock dirs could both pass the probe and race for the same port — it
      // strongly REDUCES, but cannot fully eliminate, cross-session collisions.
      const bindable =
        (await isPortBindable(vitePort)) && (await isPortBindable(backendPort))
      if (bindable) {
        console.log(`🔒 Locked ports for worker ${workerIndex}: vite ${vitePort}, backend ${backendPort}`)
        return { vite: vitePort, backend: backendPort }
      }
      console.log(
        `⚠️  ports ${vitePort}/${backendPort} are lock-free but already bound at the OS level (a concurrent session on a different lock dir); skipping`,
      )
      releasePortLock(vitePort, backendPort)
    }
  }

  throw new Error(
    `Could not find available ports after ${MAX_ATTEMPTS} attempts for worker ${workerIndex}`
  )
}

/**
 * Clean up all stale port locks from crashed/killed test processes
 * This should be called in global-setup to ensure a clean state before tests start
 * Kills processes on stale ports before removing locks
 */
export function cleanupStaleLocks(): void {
  if (!existsSync(LOCK_DIR)) {
    return
  }

  console.log('🧹 Cleaning up stale port locks...')

  const lockFiles = readdirSync(LOCK_DIR).filter(file => file.endsWith('.lock') && file.startsWith('ports-'))
  let removed = 0
  let kept = 0

  for (const lockFile of lockFiles) {
    const lockPath = resolve(LOCK_DIR, lockFile)

    try {
      const lock: PortLock = JSON.parse(readFileSync(lockPath, 'utf-8'))

      if (!isLockValid(lock)) {
        // Kill processes on these ports before removing lock
        console.log(`   🔪 Killing processes on ports ${lock.vitePort}/${lock.backendPort}`)
        try {
          killProcessOnPort(lock.vitePort)
          killProcessOnPort(lock.backendPort)
        } catch (e) {
          // Best effort
        }

        unlinkSync(lockPath)
        console.log(`   🗑️  Removed stale lock: ${lockFile} (PID ${lock.pid})`)
        removed++
      } else {
        console.log(`   ✅ Kept valid lock: ${lockFile} (PID ${lock.pid})`)
        kept++
      }
    } catch (e) {
      // Corrupted lock file, remove it
      unlinkSync(lockPath)
      console.log(`   🗑️  Removed corrupted lock: ${lockFile}`)
      removed++
    }
  }

  console.log(`✅ Cleanup complete: ${removed} removed, ${kept} kept\n`)
}

/**
 * Validate PostgreSQL port lock
 */
function isPostgresLockValid(lock: PostgresPortLock): boolean {
  const now = Date.now()

  // Check if lock is expired (timeout fallback)
  if (now - lock.timestamp > LOCK_TIMEOUT_MS) {
    console.log(`🧹 PostgreSQL lock expired (timestamp: ${lock.timestamp}, now: ${now})`)
    return false
  }

  // Check if process is still alive
  if (!isProcessAlive(lock.pid)) {
    console.log(`🧹 PostgreSQL lock orphaned (PID ${lock.pid} not running)`)
    return false
  }

  return true
}

/**
 * Try to acquire a lock for a specific PostgreSQL port
 * Returns true if lock was acquired, false if port is in use
 */
function acquirePostgresPortLock(port: number, runId: string): boolean {
  if (!existsSync(LOCK_DIR)) {
    mkdirSync(LOCK_DIR, { recursive: true })
  }

  const lockFile = resolve(LOCK_DIR, `postgres-${port}.lock`)

  // Check existing lock
  if (existsSync(lockFile)) {
    try {
      const existingLock: PostgresPortLock = JSON.parse(readFileSync(lockFile, 'utf-8'))

      if (isPostgresLockValid(existingLock)) {
        // Lock is valid, port is in use
        return false
      } else {
        // Lock is stale, remove it
        console.log(`🧹 Removing stale PostgreSQL lock: ${lockFile}`)
        unlinkSync(lockFile)
      }
    } catch (e) {
      // Corrupted lock file, remove it
      console.log(`🧹 Removing corrupted PostgreSQL lock: ${lockFile}`)
      unlinkSync(lockFile)
    }
  }

  // Acquire lock
  const lock: PostgresPortLock = {
    pid: process.pid,
    timestamp: Date.now(),
    port,
    runId,
  }

  writeFileSync(lockFile, JSON.stringify(lock, null, 2))
  return true
}

/**
 * Allocate a PostgreSQL port for this test run
 * Tries multiple ports starting from base port 54331
 * Returns the allocated port number
 */
export async function allocatePostgresPort(runId: string): Promise<number> {
  // Env-overridable base (mirrors ZIEE_E2E_BASE_VITE_PORT / _BACKEND_PORT). The
  // per-run lock only coordinates allocations that SHARE a lock dir; a concurrent
  // e2e session on the same box using a different lock dir doesn't see our
  // postgres lock, so both race to bind the same base port (the OS-bindable check
  // is TOCTOU — both see it free before either `docker compose up` binds it) and
  // one run's postgres dies with "port already allocated" → ECONNREFUSED. Give a
  // concurrent session its OWN base (e.g. ZIEE_E2E_BASE_PG_PORT=54600) so it can
  // never collide with the default-54331 sessions.
  const BASE_PORT = E2E_DEFAULTS.basePgPort
  const MAX_ATTEMPTS = 100

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const port = BASE_PORT + attempt

    if (!acquirePostgresPortLock(port, runId)) {
      continue
    }

    // Lock acquired — but ALSO verify the port is free at the OS level. A
    // sibling worktree's leftover docker container can still hold the port
    // even though its lock was reaped (its launching PID is gone), so a
    // lock-free port is not necessarily bind-free. Without this check the
    // allocator hands out an already-bound port and globalSetup's
    // `docker compose up` dies with "port is already allocated", failing
    // the ENTIRE run.
    if (await isPortBindable(port)) {
      console.log(`🔒 Locked PostgreSQL port ${port} for test run ${runId}`)
      return port
    }

    // Bound by something else (almost always a sibling's orphaned
    // container) — release our just-taken lock and try the next port.
    console.log(
      `⚠️  PostgreSQL port ${port} is lock-free but already bound at the OS level; skipping`,
    )
    releasePostgresPortLock(port)
  }

  throw new Error(
    `Could not find available PostgreSQL port after ${MAX_ATTEMPTS} attempts (base: ${BASE_PORT})`
  )
}

/**
 * Release a PostgreSQL port lock
 * Only releases if we own the lock (matching PID)
 */
export function releasePostgresPortLock(port: number): void {
  const lockFile = resolve(LOCK_DIR, `postgres-${port}.lock`)

  try {
    if (existsSync(lockFile)) {
      const lock: PostgresPortLock = JSON.parse(readFileSync(lockFile, 'utf-8'))

      // Only release if we own the lock
      if (lock.pid === process.pid) {
        unlinkSync(lockFile)
        console.log(`🔓 Released PostgreSQL port lock: ${port}`)
      }
    }
  } catch (e) {
    // Best effort cleanup
  }
}

/**
 * Clean up stale test config files from crashed/killed test processes
 * Removes vite-*.ts and test-*.yaml files older than CONFIG_STALE_MS
 * This should be called in global-setup to ensure a clean state before tests start
 */
export function cleanupStaleConfigFiles(configDir: string): void {
  if (!existsSync(configDir)) {
    return
  }

  console.log('🧹 Cleaning up stale config files...')

  const now = Date.now()
  const allFiles = readdirSync(configDir)
  const files = allFiles.filter(
    file => (file.startsWith('vite-') && file.endsWith('.ts')) ||
            (file.startsWith('test-') && file.endsWith('.yaml')) ||
            (file.startsWith('docker-compose-') && file.endsWith('.yaml')) ||
            (file.startsWith('postgres-') && file.endsWith('.json'))
  )

  console.log(`   Found ${files.length} test config files to check (${allFiles.length} total files)`)

  // Build the set of runIds owned by a STILL-LIVE session from the shared
  // postgres-*.lock dir (each lock carries {pid, runId}; a live pid ⇒ in-use).
  // This guards against a concurrent same-configDir session's ACTIVE
  // `postgres-<runId>.json` / `docker-compose-<runId>.yaml` being deleted merely
  // because it aged past the 5-min TTL → its teardown then ENOENTs. Mirrors the
  // container-cleanup liveRunIds guard in global-setup.ts.
  const liveRunIds = collectLiveRunIds()

  let removed = 0
  let kept = 0

  for (const file of files) {
    const filePath = resolve(configDir, file)

    // If a LIVE postgres lock still owns the run/test id embedded in this
    // filename, the file belongs to an in-flight session — skip it regardless
    // of age (a genuine orphan has no live lock and still falls through to the
    // TTL check below).
    const embeddedId = extractConfigId(file)
    if (embeddedId && liveRunIds.has(embeddedId)) {
      console.log(`   ✅ Kept active config: ${file} (live lock owns ${embeddedId})`)
      kept++
      continue
    }

    try {
      const stats = statSync(filePath)
      const age = now - stats.mtimeMs

      // Remove files older than 5 minutes
      if (age > CONFIG_STALE_MS) {
        unlinkSync(filePath)
        console.log(`   🗑️  Removed stale config: ${file} (age: ${Math.round(age / 1000)}s)`)
        removed++
      }
    } catch (e) {
      // Error reading file, try to remove it anyway
      try {
        unlinkSync(filePath)
        console.log(`   🗑️  Removed corrupted config: ${file}`)
        removed++
      } catch {}
    }
  }

  if (removed > 0 || kept > 0) {
    console.log(`✅ Config cleanup complete: ${removed} removed, ${kept} kept\n`)
  } else {
    console.log('✅ No stale config files found\n')
  }
}

/**
 * The run/test id embedded in a `.test-configs` filename, or null. Used by the
 * live-lock guard in cleanupStaleConfigFiles. `postgres-<runId>.json` /
 * `docker-compose-<runId>.yaml` yield a runId (matchable against a live
 * postgres lock); `test-<testId>.yaml` / `vite-<testId>.ts` yield a testId
 * (never in the runId set → TTL still governs them, unchanged).
 */
export function extractConfigId(file: string): string | null {
  if (file.startsWith('postgres-') && file.endsWith('.json')) return file.slice('postgres-'.length, -'.json'.length)
  if (file.startsWith('docker-compose-') && file.endsWith('.yaml')) return file.slice('docker-compose-'.length, -'.yaml'.length)
  if (file.startsWith('test-') && file.endsWith('.yaml')) return file.slice('test-'.length, -'.yaml'.length)
  if (file.startsWith('vite-') && file.endsWith('.ts')) return file.slice('vite-'.length, -'.ts'.length)
  return null
}

/**
 * Set of runIds whose owning session is STILL ALIVE, read from the shared
 * `postgres-*.lock` files (each carries `{pid, runId}`). Mirrors the
 * container-cleanup liveness map in global-setup.ts so both the container sweep
 * and the config-file sweep keep an in-flight concurrent session's artifacts.
 */
export function collectLiveRunIds(): Set<string> {
  const live = new Set<string>()
  if (!existsSync(LOCK_DIR)) return live
  for (const f of readdirSync(LOCK_DIR)) {
    if (!f.startsWith('postgres-') || !f.endsWith('.lock')) continue
    try {
      const lock = JSON.parse(readFileSync(resolve(LOCK_DIR, f), 'utf-8'))
      if (!lock.runId) continue
      if (isProcessAlive(lock.pid)) live.add(lock.runId)
    } catch {
      // Corrupted lock file — ignore.
    }
  }
  return live
}
