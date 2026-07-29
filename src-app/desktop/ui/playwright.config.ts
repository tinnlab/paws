import { defineConfig, devices } from '@playwright/test'
import crypto from 'crypto'
// @ts-ignore — key-derived desktop dev port (audit §7; no fixed 1420)
import { resolveGalleryPort, pickBindablePort } from '@ziee/gallery/scripts/lib/run-key.mjs'

// Per-worktree, bind-checked desktop dev-server port. The vite CLI `--port`
// override makes vite honor exactly this port, so playwright's baseURL/webServer
// url match. Two desktop-e2e worktrees derive DIFFERENT ports (distinct keys).
const DEV_PORT: number = await pickBindablePort(
  resolveGalleryPort({ env: process.env.VITE_DEV_PORT, cfgPort: null, which: 'desktopGallery' }),
)
const DEV_URL = `http://localhost:${DEV_PORT}`

// Organize test results by test run ID to avoid conflicts between parallel test runs
const testRunId = process.env.TEST_RUN_ID || crypto.randomBytes(4).toString('hex')
const outputDir = `test-results/${testRunId}`
const reportDir = `playwright-report/${testRunId}`

// Make test run ID available to global-setup
if (!process.env.TEST_RUN_ID) {
  process.env.TEST_RUN_ID = testRunId
}

export default defineConfig({
  testDir: './tests/e2e',
  // Gallery specs run backend-free under playwright.gallery.config.ts (no
  // Postgres global-setup) — keep them out of the real-backend run here.
  testIgnore: /gallery-desktop-.*\.spec\.ts$/,

  // Organize test artifacts by test run ID
  outputDir,

  // Run tests in files in parallel
  fullyParallel: true,

  // Fail the build on CI if you accidentally left test.only
  forbidOnly: !!process.env.CI,

  // Retry on CI only
  retries: process.env.CI ? 2 : 0,

  // Desktop tests run with fewer workers since Tauri manages backend
  workers: 4,

  // Reporter to use
  reporter: [
    ['html', { outputFolder: reportDir, open: 'never' }],
    ['junit', { outputFile: `${reportDir}/results.xml` }],
    ['list'],
  ],

  // Shared settings for all projects
  use: {
    // Base URL for desktop app's Vite dev server
    baseURL: DEV_URL,

    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',

    // Timeout for actions (clicks, fills, etc.)
    actionTimeout: 10000,
  },

  // Global setup and teardown
  globalSetup: './tests/global-setup.ts',
  globalTeardown: './tests/global-teardown.ts',

  // Configure projects for major browsers
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
      },
    },
  ],

  // Global timeout for each test. Bumped from 120s so the first
  // real-backend test (which has to wait for `cargo run --bin ziee`
  // cold-build) doesn't fail purely on build time. Subsequent tests
  // benefit from cargo's incremental cache. Pre-warm with
  // `cd src-app && cargo build -p ziee` if you want fast first runs.
  timeout: 300000, // 5 minutes per test

  // Timeout for expect() assertions
  expect: {
    timeout: 10000,
  },

  // Dev server configuration - start Tauri dev server for tests
  webServer: {
    command: `npm run dev -- --port ${DEV_PORT} --strictPort`,
    url: DEV_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120000, // 2 minutes for server to start
  },
})
