import { test as base } from '@playwright/test'
import { ChildProcess, spawn } from 'child_process'
import crypto from 'crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { dirname, resolve } from 'path'
import pg from 'pg'
import { fileURLToPath } from 'url'
import {
  findAvailablePorts,
  releasePortLock,
  updatePortLockHeartbeat,
} from './port-manager'

const { Pool } = pg
const __dirname = dirname(fileURLToPath(import.meta.url))

// Simple HTML prettifier for test debugging
function prettifyHTML(html: string): string {
  let formatted = ''
  let indent = 0
  const indentStr = '  '

  // Split by tags
  const tokens = html.split(/(<[^>]+>)/g).filter(Boolean)

  for (const token of tokens) {
    if (token.startsWith('</')) {
      // Closing tag - decrease indent first
      indent = Math.max(0, indent - 1)
      formatted += indentStr.repeat(indent) + token + '\n'
    } else if (token.startsWith('<')) {
      // Opening or self-closing tag
      formatted += indentStr.repeat(indent) + token + '\n'

      // Increase indent for non-self-closing tags
      if (
        !token.endsWith('/>') &&
        !token.match(
          /<(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)/i,
        )
      ) {
        indent++
      }
    } else if (token.trim()) {
      // Text content (only if not just whitespace)
      formatted += indentStr.repeat(indent) + token.trim() + '\n'
    }
  }

  return formatted
}

export interface TestInfrastructure {
  databaseName: string
  backendPort: number
  vitePort: number
  baseURL: string
  apiURL: string
  serverProcess: ChildProcess
  viteProcess: ChildProcess
  heartbeatInterval: NodeJS.Timeout

  /**
   * Run a parameterised SQL query against this test's per-database
   * Postgres instance. Use for cases where the only way to set up a
   * fixture is direct DB insertion — e.g. seeding tables that have no
   * E2E-reachable creation API (runtime_versions, code_sandbox cache
   * registry, etc.).
   *
   * Returns `pg.QueryResult` (rows + fields). Reuse the same connection
   * pool across calls in one test; the pool is closed in test teardown.
   *
   * Prefer the real REST API path whenever it's reachable — direct
   * inserts bypass handler validation + event emission, so the test
   * must compensate (e.g. fire its own sync trigger).
   */
  sql: (text: string, params?: unknown[]) => Promise<import('pg').QueryResult>
}

interface TestFixtures {
  testInfra: TestInfrastructure
}

/**
 * Per-spec options (declared as Playwright test options so a spec can opt in
 * via `test.use({ ... })`). Defaults keep every other spec's behaviour
 * identical.
 */
interface TestOptions {
  /**
   * Enable the built-in BioMCP server in this spec's backend config. Off by
   * default (BioMCP is isolated out of E2E — see the `bio_mcp` block below);
   * a dedicated bio spec flips this on to register + exercise the bio admin
   * surface.
   */
  bioMcpEnabled: boolean
  /**
   * DEBUG-ONLY seconds-granularity access-token TTL written as
   * `jwt.access_token_expiry_seconds` into this spec's backend config
   * (honored only in debug server builds — which E2E backends are).
   * Lets the silent-refresh specs exercise REAL token expiry in seconds
   * instead of 24 hours. `undefined` (default) omits the line.
   */
  jwtAccessExpirySeconds: number | undefined
}

export const test = base.extend<TestFixtures & TestOptions>({
  bioMcpEnabled: [false, { option: true }],
  jwtAccessExpirySeconds: [undefined, { option: true }],

  // Auto-capture HTML snapshot, console logs, and network requests on test failure
  // Auto-capture HTML snapshot, console logs, and network requests on test failure
  page: async ({ page }, use, testInfo) => {
    // Capture console logs
    const consoleLogs: string[] = []
    page.on('console', msg => {
      const logEntry = `[${msg.type().toUpperCase()}] ${msg.text()}`
      consoleLogs.push(logEntry)
      // Also log to test output for real-time debugging
      console.log(`[Browser Console] ${logEntry}`)
    })

    // Capture network requests
    const networkRequests: string[] = []
    page.on('request', request => {
      const entry = `${request.method()} ${request.url()}`
      networkRequests.push(entry)
      // Log API requests (not static assets)
      if (request.url().includes('/api/')) {
        console.log(`[Network Request] ${entry}`)
      }
    })

    // Capture network responses with body for API calls
    page.on('response', async response => {
      const entry = `${response.status()} ${response.url()}`
      networkRequests.push(entry)
      // Log API responses (not static assets)
      if (response.url().includes('/api/')) {
        console.log(`[Network Response] ${entry}`)
        // Capture response body for failed tests
        try {
          const body = await response.text()
          if (body) {
            networkRequests.push(
              `  Response Body: ${body.substring(0, 500)}${body.length > 500 ? '...' : ''}`,
            )
          }
        } catch (e) {
          // Body not available or already consumed
        }
      }
    })

    await use(page)

    // After test completes, save artifacts if it failed
    if (testInfo.status !== testInfo.expectedStatus) {
      // Save HTML
      const htmlContent = await page.content()
      const prettifiedHTML = prettifyHTML(htmlContent)
      const htmlPath = testInfo.outputPath('page.html')
      writeFileSync(htmlPath, prettifiedHTML)
      testInfo.attachments.push({
        name: 'page.html',
        path: htmlPath,
        contentType: 'text/html',
      })

      // Save console logs
      if (consoleLogs.length > 0) {
        const consoleLogPath = testInfo.outputPath('console.log')
        writeFileSync(consoleLogPath, consoleLogs.join('\n'))
        testInfo.attachments.push({
          name: 'console.log',
          path: consoleLogPath,
          contentType: 'text/plain',
        })
      }

      // Save network logs
      if (networkRequests.length > 0) {
        const networkLogPath = testInfo.outputPath('network.log')
        writeFileSync(networkLogPath, networkRequests.join('\n'))
        testInfo.attachments.push({
          name: 'network.log',
          path: networkLogPath,
          contentType: 'text/plain',
        })
      }
    }
  },

  testInfra: async ({ bioMcpEnabled, jwtAccessExpirySeconds }, use, testInfo) => {
    const testId = crypto.randomBytes(4).toString('hex')
    const databaseName = `ziee_test_${testId}`
    const workerIndex = testInfo.workerIndex

    // Dynamically find and lock available ports for this worker
    // Automatically cleans up stale locks from crashed processes
    const ports = await findAvailablePorts(workerIndex)
    const backendPort = ports.backend
    const vitePort = ports.vite

    // Read PostgreSQL port from global-setup config
    const runId = process.env.TEST_RUN_ID
    if (!runId) {
      throw new Error('TEST_RUN_ID not set - global-setup may have failed')
    }
    const postgresConfigPath = resolve(
      __dirname,
      `../.test-configs/postgres-${runId}.json`,
    )
    const postgresConfig = JSON.parse(readFileSync(postgresConfigPath, 'utf-8'))
    const postgresPort = postgresConfig.port
    // Optional migrated template DB built once in global-setup. When present,
    // the per-test DB is CLONED from it (schema ready → no per-boot migrations);
    // when absent, fall back to a raw CREATE DATABASE (server migrates on boot).
    const templateName: string | undefined = postgresConfig.templateName

    console.log(`\n🔧 Setting up test infrastructure for: ${testInfo.title}`)
    console.log(`   Database: ${databaseName}`)
    console.log(`   PostgreSQL: port ${postgresPort}`)
    console.log(`   Backend: http://localhost:${backendPort}`)
    console.log(`   Vite: http://localhost:${vitePort}\n`)

    // 1. Kill any orphaned processes still on our ports (even though lock was freed)
    await killProcessOnPort(vitePort)
    await killProcessOnPort(backendPort)

    // 2. Create database
    const pool = new Pool({
      host: 'localhost',
      port: postgresPort,
      user: 'postgres',
      password: 'password',
      database: 'postgres',
    })

    try {
      if (templateName) {
        // Clone the fully-migrated template. Postgres locks the template during
        // a copy, so a concurrent clone (raised PLAYWRIGHT_WORKERS) can transiently
        // fail with 55006 "source database is being accessed by other users" —
        // bounded-retry it. Per-test DB name stays unique → isolation preserved.
        let created = false
        let lastErr: unknown
        for (let attempt = 0; attempt < 5 && !created; attempt++) {
          try {
            await pool.query(`CREATE DATABASE ${databaseName} TEMPLATE ${templateName}`)
            created = true
          } catch (err) {
            lastErr = err
            const code = (err as { code?: string })?.code
            if (code === '55006') {
              await new Promise(r => setTimeout(r, 200))
              continue
            }
            throw err
          }
        }
        if (!created) throw lastErr
        console.log(`✅ Created database ${databaseName} from template ${templateName}`)
      } else {
        await pool.query(`CREATE DATABASE ${databaseName}`)
        console.log(`✅ Created database: ${databaseName}`)
      }
    } catch (error) {
      console.error(`❌ Failed to create database ${databaseName}:`, error)
      throw error
    } finally {
      await pool.end()
    }

    // 2. Clear Vite cache to ensure fresh builds
    // const viteCacheDir = resolve(__dirname, '../../node_modules/.vite')
    // if (existsSync(viteCacheDir)) {
    //   console.log(`🗑️  Clearing Vite cache...`)
    //   rmSync(viteCacheDir, { recursive: true, force: true })
    // }

    // 3. Create backend config file
    const configDir = resolve(__dirname, '../.test-configs')
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true })
    }

    const configPath = resolve(configDir, `test-${testId}.yaml`)
    const configContent = `postgresql:
  use_embedded: false

  external:
    host: "localhost"
    port: ${postgresPort}
    username: "postgres"
    password: "password"
    database: "${databaseName}"

  pool:
    # The SPA cold-load fires ~15-25 parallel API calls; under host load
    # (many sequential per-test backends) a 5-connection / 3s-acquire pool
    # could not absorb that burst (postgres slow to respond), so requests
    # hit "pool timed out while waiting for an open connection", the backend
    # looked unhealthy, and the test-context retried until the test cap.
    # Give the pool headroom + a more forgiving acquire timeout.
    max_connections: 20
    min_connections: 2
    acquire_timeout_secs: 15
    idle_timeout_secs: 10
    max_lifetime_secs: 60

server:
  host: "127.0.0.1"
  port: ${backendPort}
  api_prefix: "/api"

  # Trust the vite-preview proxy's X-Forwarded-Host (it sets xfwd:true) so the
  # OAuth callback redirect_uri is built on the frontend origin (vite, 9000),
  # not the backend port — otherwise social-login lands on the API port where
  # the SPA isn't served. Mirrors config/dev.yaml. Safe here: the backend is
  # only reachable behind the test proxy.
  trust_forwarded_headers: true

  # Disable rate limiting for E2E tests — a single test peer-IP can
  # legitimately make many requests in quick succession (page reloads,
  # data refresh after mutations) and would otherwise trip the default
  # 5-req/s + 60-burst limit. The rate-limit logic itself is exercised
  # in the dedicated A3 backend regression test.
  rate_limit:
    per_second: 10000
    burst_size: 10000

  cors:
    allow_origins:
      - "http://127.0.0.1:${vitePort}"
      - "http://localhost:${vitePort}"
    allow_methods:
      - "GET"
      - "POST"
      - "PUT"
      - "DELETE"
      - "OPTIONS"
    allow_headers:
      - "Content-Type"
      - "Authorization"

logging:
  level: "info"
  format: "json"

# Skip the per-boot api.github.com "latest release" update-check. It's a
# notification-only poll (server_update module) that adds ~110ms to every one of
# the hundreds of per-test backend boots and — sharing one egress IP across a run
# — risks tripping GitHub's unauthenticated rate limit. Nothing in E2E depends on
# it. (UpdateCheckConfig.enabled; default true in production.)
update_check:
  enabled: false

jwt:
  secret: "test-secret-key-for-jwt-tokens-min-32-chars-long-${testId}"
  issuer: "ziee-test"
  audience: "ziee-test-api"
  access_token_expiry_hours: 24
  refresh_token_expiry_days: 30
${
  // DEBUG-ONLY short access-token TTL for the silent-refresh specs
  // (test.use({ jwtAccessExpirySeconds: 8 })). Omitted by default.
  jwtAccessExpirySeconds != null
    ? `  access_token_expiry_seconds: ${jwtAccessExpirySeconds}
`
    : ''
}
bio_mcp:
  # Disabled in E2E for isolation (BioMCP is ON by default in production, but
  # leaving it on here would register the bio server in every system-server
  # list and auto-attach it — spawning the biomcp sidecar — in every
  # tool-capable chat). A dedicated bio spec enables it explicitly via
  # test.use({ bioMcpEnabled: true }).
  enabled: ${bioMcpEnabled}
${
  // Code sandbox is OFF by default in E2E (enabling it spawns squashfuse and
  // requires a mounted rootfs). The real-sandbox-via-chat E2E
  // (09-chat/mcp-chat-sandbox-real-llm.spec.ts) opts in explicitly with
  // ZIEE_E2E_SANDBOX=1 (alongside ANTHROPIC_API_KEY + a mounted rootfs).
  process.env.ZIEE_E2E_SANDBOX === '1'
    ? `code_sandbox:
  enabled: true
`
    : ''
}`

    writeFileSync(configPath, configContent)

    // 4. Start backend server
    console.log(`🚀 Starting backend server on port ${backendPort}...`)

    // Spawn cargo directly without shell to ensure we can kill the process properly
    // Using shell: true creates a shell parent that orphans child processes when killed
    console.log(`Using cargo from PATH (cross-platform)`)

    const cargoPath =
      process.platform === 'win32'
        ? `${process.env.USERPROFILE}\\.cargo\\bin\\cargo`
        : `${process.env.HOME}/.cargo/bin/cargo`

    // Spawn the PREBUILT server binary (warmed once in global-setup) rather than
    // `cargo run` per test. `cargo run` pays a per-test cargo graph-check and
    // contends on the cross-worktree build lock; the binary boots in ~0.8s. The
    // binary lives at src-app/target/debug/ziee (this file is at
    // src-app/ui/tests/fixtures/ → ../../../target). Mirrors the Rust harness
    // (ziee-test-harness/src/lib.rs:471-503). Fall back to `cargo run` if the
    // binary is absent (warmup skipped/failed) — same server code either way, so
    // per-test isolation is identical.
    const serverBinary = resolve(
      __dirname,
      '../../../target/debug',
      process.platform === 'win32' ? 'ziee.exe' : 'ziee',
    )
    const usePrebuilt = existsSync(serverBinary)
    const spawnCmd = usePrebuilt ? serverBinary : cargoPath
    const spawnArgs = usePrebuilt
      ? ['--config-file', configPath]
      : ['run', '--bin', 'ziee', '--', '--config-file', configPath]
    console.log(
      usePrebuilt
        ? `   Spawning prebuilt binary: ${serverBinary}`
        : `   Prebuilt binary absent — falling back to cargo run`,
    )

    // Isolate the hub catalog dir per test. The hub catalog
    // (`current/`) is durable global state; a refresh/activate in one
    // spec would otherwise rotate the shared dir and leak the new
    // version into other specs (and across runs). The override is
    // debug-gated in the server (compiled out of release).
    const hubDataDir = resolve(configDir, `hub-${testId}`)

    const serverProcess = spawn(
      spawnCmd,
      spawnArgs,
      {
        cwd: resolve(__dirname, '../../../server'),
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
        env: {
          ...process.env,
          ZIEE_HUB_DATA_DIR_OVERRIDE: hubDataDir,
          // E2E tests drive engine start/stop themselves; the model
          // validator's 90s spawn-and-kill cycle (TIER2_HEALTH_DEADLINE_SECS)
          // races with the test's Start click — backend returns 409
          // "already running" if Start fires while the validator
          // owns the engine, and Stop button toggles unstably.
          // Short-circuit validation to a no-op (debug-only env;
          // compiled out of release builds).
          ZIEE_DISABLE_MODEL_VALIDATION: '1',
          // E2E specs that exercise MCP chip / list flows create
          // system MCP servers with fake URLs (e.g.
          // `https://chip-test.example.invalid/mcp`). The
          // connection_health probe on create + enable-transition
          // would auto-disable them and break every downstream chip
          // assertion. Skip the probe in tests; the real flow stays
          // on in dev/release builds (debug-only env, compiled out
          // via `cfg!(debug_assertions)`).
          ZIEE_DISABLE_MCP_HEALTH_CHECK: '1',
          PATH:
            process.platform === 'win32'
              ? `${process.env.USERPROFILE}\\.cargo\\bin;${process.env.PATH}`
              : `${process.env.HOME}/.cargo/bin:${process.env.PATH}`,
        },
      },
    )

    serverProcess.on('error', error => {
      console.error(`❌ Backend server error:`, error)
    })

    // Log backend stdout
    serverProcess.stdout?.on('data', data => {
      const message = data.toString()
      console.log(`[Backend stdout] ${message}`)
    })

    // Log backend stderr to help debug issues
    serverProcess.stderr?.on('data', data => {
      const message = data.toString()
      // Log errors, warnings, and info messages (but not debug)
      if (
        message.includes('"level":"error"') ||
        message.includes('"level":"warn"') ||
        message.includes('"level":"info"')
      ) {
        console.error(`[Backend stderr] ${message}`)
      }
    })

    // Wait for backend to be STABLY ready (120s budget; the prebuilt binary
    // boots in ~1s, but the budget also covers the `cargo run` fallback's
    // compile). Deep gate (not just a single 200): a cold-loading server
    // answers /api/health while still churning, and SSE streams opened in that
    // window get reset → flaky `waitFor` timeouts. Require a stable, fast window.
    const backendReady = await waitForServerStable(
      `http://127.0.0.1:${backendPort}/api/health`,
      120,
    )
    if (!backendReady) {
      serverProcess.kill('SIGKILL')
      throw new Error(`Backend server failed to start on port ${backendPort}`)
    }
    console.log(`✅ Backend server ready on port ${backendPort}`)

    // 5. Create Vite config file
    const viteConfigPath = resolve(configDir, `vite-${testId}.ts`)
    const projectRoot = resolve(__dirname, '../..')
    const srcRoot = resolve(projectRoot, 'src')
    // Serve the static build produced once in global-setup via `vite preview`.
    // A static server handles multiple concurrent browser contexts; the HMR dev
    // server refuses a 2nd context, which broke the multi-context sync specs.
    // `/api` proxies to THIS test's backend.
    const distDir = resolve(projectRoot, 'dist-e2e')
    const viteConfigContent = `import { defineConfig } from 'vite'

export default defineConfig({
  root: ${JSON.stringify(srcRoot)},
  build: { outDir: ${JSON.stringify(distDir)} },
  plugins: [
    {
      // vite 8's preview server gzips static assets via @polka/compression,
      // serving them Transfer-Encoding: chunked (no Content-Length). Under the
      // app's long-lived SSE reconnect churn (/api/sync, /api/chat/stream) the
      // compressed asset stream gets cut mid-response
      // (ERR_INCOMPLETE_CHUNKED_ENCODING) and the SPA bundle fails to load ->
      // the page blanks and every testid vanishes. Stripping Accept-Encoding
      // here (this hook body runs BEFORE vite installs the compression
      // middleware) forces uncompressed, Content-Length responses that cannot
      // be truncated the same way.
      name: 'e2e-disable-preview-compression',
      configurePreviewServer(server) {
        server.middlewares.use((req, _res, next) => {
          delete req.headers['accept-encoding']
          next()
        })
        // Harden the node preview server against cutting long-lived SSE streams
        // (/api/sync, /api/chat/stream) under load: node's default keepAlive
        // (5s), headers (60s) and request (300s) timeouts can abort an otherwise
        // healthy proxied SSE response, forcing the app into a reconnect storm.
        // 0 = disabled. (SSE stays open on a settled page already; this removes
        // the timeout-driven cuts that appear under concurrent-test load.)
        const s = server.httpServer
        if (s) {
          s.keepAliveTimeout = 0
          s.headersTimeout = 0
          s.requestTimeout = 0
        }
      },
    },
  ],
  preview: {
    port: ${vitePort},
    strictPort: true,
    host: '127.0.0.1',
    proxy: {
      '/api/': {
        // 127.0.0.1, NOT localhost: the backend binds IPv4-only (host
        // 127.0.0.1 above). On node 17+ \`localhost\` resolves \`::1\` first and
        // the Happy-Eyeballs fallback to IPv4 is flaky under the cold-load +
        // long-lived-SSE connection churn, so some proxied /api calls hit ::1
        // and ECONNREFUSED non-deterministically.
        target: 'http://127.0.0.1:${backendPort}',
        changeOrigin: true,
        // X-Forwarded-* for the backend OAuth redirect_uri (social-login E2E).
        xfwd: true,
        // Never time out the long-lived SSE stream (/api/sync/subscribe); a
        // proxy timeout would cut it mid-stream (ERR_INCOMPLETE_CHUNKED_ENCODING)
        // and trigger a reconnect-resync burst.
        timeout: 0,
        proxyTimeout: 0,
      },
    },
  },
})
`

    writeFileSync(viteConfigPath, viteConfigContent)

    // 6. Start Vite preview (static) server. Spawn vite DIRECTLY (node + the
    //    vite.js bin), NOT via `npx`: npx orphans its vite child, so killing
    //    the npx process on teardown leaks a live preview per test that drains
    //    the host. Spawning node directly makes viteProcess the server itself,
    //    so SIGKILL actually kills it.
    console.log(`🎨 Starting Vite preview on port ${vitePort}...`)
    const viteBin = resolve(projectRoot, '../../node_modules/vite/bin/vite.js')
    const viteProcess = spawn(
      process.execPath,
      [viteBin, 'preview', '--config', viteConfigPath],
      {
        cwd: projectRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
      },
    )

    viteProcess.on('error', error => {
      console.error(`❌ Vite server error:`, error)
    })

    // Wait for Vite to be ready
    const viteReady = await waitForServer(`http://127.0.0.1:${vitePort}`, 60)
    if (!viteReady) {
      viteProcess.kill('SIGKILL')
      serverProcess.kill('SIGKILL')
      throw new Error(`Vite server failed to start on port ${vitePort}`)
    }
    console.log(`✅ Vite server ready on port ${vitePort}`)

    // Start heartbeat to keep lock alive
    // Update lock every 5 seconds with process PIDs and timestamp
    const heartbeatInterval = setInterval(() => {
      updatePortLockHeartbeat(
        vitePort,
        backendPort,
        viteProcess.pid,
        serverProcess.pid,
      )
    }, 5000) // HEARTBEAT_INTERVAL_MS

    // Initial heartbeat with PIDs
    updatePortLockHeartbeat(
      vitePort,
      backendPort,
      viteProcess.pid,
      serverProcess.pid,
    )
    console.log(`💓 Heartbeat started for ports ${vitePort}/${backendPort}`)

    // Lazy per-test connection pool against the test's own database.
    // Created on first `sql()` call and closed in cleanup below. Using
    // a single pool per test avoids the cost of one connection per
    // query while still being scoped to a single test's lifetime.
    //
    // Holder box because TS would otherwise narrow a `let pool: Pool |
    // null = null` to `never` after the if-block (closure flow
    // analysis limitation), making `.end()` unreachable.
    const dbPoolHolder: { pool: InstanceType<typeof Pool> | null } = {
      pool: null,
    }
    const sql: TestInfrastructure['sql'] = async (text, params) => {
      if (!dbPoolHolder.pool) {
        dbPoolHolder.pool = new Pool({
          host: 'localhost',
          port: postgresPort,
          user: 'postgres',
          password: 'password',
          database: databaseName,
        })
      }
      return dbPoolHolder.pool.query(text, params as any)
    }

    const infrastructure: TestInfrastructure = {
      databaseName,
      backendPort,
      vitePort,
      baseURL: `http://127.0.0.1:${vitePort}`,
      apiURL: `http://127.0.0.1:${backendPort}`,
      serverProcess,
      viteProcess,
      heartbeatInterval,
      sql,
    }

    console.log(`✅ Test infrastructure ready!\n`)

    // Run the test
    await use(infrastructure)

    // Cleanup after test
    console.log(`\n🧹 Cleaning up test infrastructure for: ${testInfo.title}`)

    // Close the per-test sql() pool (only created if any test actually
    // called sql()). Without this, the pool's open connections would
    // prevent the DROP DATABASE below from succeeding cleanly.
    if (dbPoolHolder.pool) {
      try {
        await dbPoolHolder.pool.end()
      } catch (err) {
        console.warn(`⚠️  test sql() pool .end() failed: ${err}`)
      }
    }

    // Stop heartbeat
    clearInterval(infrastructure.heartbeatInterval)
    console.log(`💔 Heartbeat stopped`)

    // Graceful shutdown driven by the child `exit` EVENT rather than a fixed
    // sleep: SIGTERM, then await the process actually exiting (bounded); on
    // timeout escalate to SIGKILL and await again (bounded). This returns as
    // soon as the process is gone instead of always burning ~2s. The
    // killProcessOnPort() calls below remain the unconditional port-release
    // guarantee, so no port can leak even if a wait times out.
    await Promise.all([
      terminateChild(serverProcess),
      terminateChild(viteProcess),
    ])

    // Kill any remaining processes on our ports (handles orphaned processes)
    console.log(
      `🔪 Ensuring all processes on ports ${vitePort} and ${backendPort} are killed...`,
    )
    await killProcessOnPort(vitePort)
    await killProcessOnPort(backendPort)

    // Drop database
    const cleanupPool = new Pool({
      host: 'localhost',
      port: postgresPort,
      user: 'postgres',
      password: 'password',
      database: 'postgres',
    })

    try {
      // Terminate all connections to the database
      await cleanupPool.query(`
        SELECT pg_terminate_backend(pg_stat_activity.pid)
        FROM pg_stat_activity
        WHERE pg_stat_activity.datname = '${databaseName}'
          AND pid <> pg_backend_pid()
      `)
      await cleanupPool.query(`DROP DATABASE IF EXISTS ${databaseName}`)
      console.log(`✅ Dropped database: ${databaseName}`)
    } catch (error) {
      console.error(`⚠️  Failed to drop database ${databaseName}:`, error)
    } finally {
      await cleanupPool.end()
    }

    // Clean up config files
    try {
      rmSync(configPath, { force: true })
      rmSync(viteConfigPath, { force: true })
      // Per-test Vite cacheDir; safe to nuke after the test ends.
      rmSync(resolve(projectRoot, 'node_modules/.vite-test', testId), {
        recursive: true,
        force: true,
      })
      // Per-test isolated hub catalog dir.
      rmSync(resolve(configDir, `hub-${testId}`), {
        recursive: true,
        force: true,
      })
    } catch {}

    // Release port lock so other test runs can use these ports
    releasePortLock(vitePort, backendPort)

    console.log(`✅ Cleanup complete\n`)
  },
})

export { expect } from '@playwright/test'

/**
 * Terminate a child process, driven by its `exit` event instead of a fixed
 * sleep. Sends SIGTERM and waits up to `graceMs` for the process to exit; if it
 * is still alive, escalates to SIGKILL and waits up to `killMs`. Resolves as
 * soon as the process has exited (or the bounded waits elapse) — a clean
 * shutdown returns almost immediately rather than always waiting the full grace.
 *
 * Note: this bounds the WAIT only. The caller still force-kills anything left on
 * the ports afterwards (killProcessOnPort), which is the real port-release
 * guarantee; this helper never weakens it.
 */
async function terminateChild(
  child: ChildProcess,
  graceMs = 4000,
  killMs = 2000,
): Promise<void> {
  // Already exited (exitCode/signalCode set) — nothing to wait for.
  if (child.exitCode !== null || child.signalCode !== null) return

  const waitForExit = (timeoutMs: number): Promise<boolean> =>
    new Promise<boolean>(resolveExit => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolveExit(true)
        return
      }
      let done = false
      const finish = (exited: boolean) => {
        if (done) return
        done = true
        clearTimeout(timer)
        child.removeListener('exit', onExit)
        resolveExit(exited)
      }
      const onExit = () => finish(true)
      const timer = setTimeout(() => finish(false), timeoutMs)
      child.once('exit', onExit)
    })

  try {
    child.kill('SIGTERM')
  } catch {}
  const exited = await waitForExit(graceMs)
  if (exited) return

  // Still running after the grace window — force kill and confirm exit.
  try {
    child.kill('SIGKILL')
  } catch {}
  await waitForExit(killMs)
}

async function waitForServer(
  url: string,
  maxAttempts: number,
): Promise<boolean> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await fetch(url)
      if (response.status < 500) {
        return true
      }
    } catch (error) {
      // Server not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  return false
}

/**
 * Deep readiness gate (vs `waitForServer`, which returns on the FIRST non-5xx
 * response — i.e. the instant the server binds).
 *
 * A freshly `cargo run` backend answers `/api/health` while still churning
 * through cold-load (module init settling, background `tokio::spawn`ed work,
 * embedded-binary/hub-seed handling). SSE streams (`/api/sync/subscribe`,
 * chat-stream) opened during that busy window get reset client-side
 * (`stream ended; reconnecting`), and a test whose `waitFor` depends on
 * SSE-delivered data then times out. Health stays answerable the whole time, so
 * a single 200 is not a reliable "ready" signal.
 *
 * This gate instead requires an UNINTERRUPTED window of `consecutive` health
 * checks that are BOTH successful (<500) AND fast (<= `fastMs`) — a slow or
 * dropped probe means the event loop is still saturated, which is precisely when
 * SSE churns. Any blip resets the streak. Returns false on timeout.
 */
async function waitForServerStable(
  url: string,
  maxSeconds: number,
  opts: {
    consecutive?: number
    intervalMs?: number
    fastMs?: number
    abortMs?: number
    stabilizeSeconds?: number
  } = {},
): Promise<boolean> {
  // 3 consecutive fast/healthy probes (~750ms window) is still a deep gate
  // (strictly stronger than the old single-200 check) but ~1s cheaper per boot
  // than the previous 6. The blip-reset + best-effort stabilizeSeconds fallback
  // below keep it from ever becoming a new "failed to start".
  const consecutive = opts.consecutive ?? 3
  const intervalMs = opts.intervalMs ?? 250
  const fastMs = opts.fastMs ?? 800
  const abortMs = opts.abortMs ?? 3000
  // Once bound, only spend up to this long chasing the stable window before
  // proceeding best-effort — so an over-strict window can never become a NEW
  // "failed to start". (Distinct from the overall budget, which also covers the
  // cargo compile/boot wait before the port opens.)
  const stabilizeSeconds = opts.stabilizeSeconds ?? 30
  const deadline = Date.now() + maxSeconds * 1000

  let streak = 0
  let boundAt = 0 // timestamp the server first answered (<500)

  while (Date.now() < deadline) {
    const start = Date.now()
    let status = 0
    let elapsed = abortMs
    try {
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), abortMs)
      const res = await fetch(url, { signal: ac.signal })
      clearTimeout(timer)
      status = res.status
      elapsed = Date.now() - start
    } catch {
      // ECONNREFUSED (not bound yet) or aborted (too slow)
    }

    const bound = status > 0 && status < 500
    if (bound && boundAt === 0) boundAt = Date.now()
    streak = bound && elapsed <= fastMs ? streak + 1 : 0
    if (streak >= consecutive) return true // stable, fast window achieved

    // Best-effort fallback: a server that's BOUND but stays jittery past
    // `stabilizeSeconds` is still usable — proceed (don't hard-fail). This keeps
    // the gate strictly >= the old single-200 gate, never worse.
    if (boundAt > 0 && Date.now() - boundAt >= stabilizeSeconds * 1000) {
      console.log(
        `⚠️  backend bound but never reached a stable fast-health window in ${stabilizeSeconds}s; proceeding best-effort`,
      )
      return true
    }

    // Poll slowly while waiting for the port (cargo compile/boot); once bound,
    // poll at `intervalMs` to measure the stability window quickly.
    await new Promise(resolve => setTimeout(resolve, boundAt > 0 ? intervalMs : 500))
  }
  // Budget elapsed: usable iff the server ever bound.
  return boundAt > 0
}

async function killProcessOnPort(port: number): Promise<void> {
  try {
    const { execSync } = await import('child_process')
    // Find process using the port
    const cmd =
      process.platform === 'win32'
        ? `netstat -ano | findstr :${port}`
        : `lsof -ti :${port}`

    const output = execSync(cmd, { encoding: 'utf8', stdio: 'pipe' }).trim()

    if (!output) return

    if (process.platform === 'win32') {
      // Windows: extract PID from netstat output
      const lines = output.split('\n')
      const pids = new Set<string>()
      for (const line of lines) {
        const match = line.trim().match(/\s+(\d+)$/)
        if (match) pids.add(match[1])
      }
      for (const pid of pids) {
        try {
          execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' })
        } catch {}
      }
    } else {
      // Unix: lsof returns PIDs directly
      const pids = output.split('\n').filter(Boolean)
      for (const pid of pids) {
        try {
          execSync(`kill -9 ${pid}`, { stdio: 'ignore' })
        } catch {}
      }
    }

    // Wait for port to be released
    await new Promise(resolve => setTimeout(resolve, 1000))
  } catch (error) {
    // No process on port or command failed - that's ok
  }
}
