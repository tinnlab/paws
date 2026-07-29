import { test, expect } from '../../fixtures/test-context'
import {
  loginAsAdmin,
  getAdminToken,
  createTestUser,
  login,
} from '../../common/auth-helpers'

/**
 * Second boot tier — the permission self-gate is LOAD-BEARING
 * (chat-boot-fetch-hygiene lifecycle, Rank-4 finding).
 *
 * `GET /api/auth/me` and `GET /api/app/setup/status` are already parallel
 * (net-hygiene TEST-5). What remains is a SECOND tier — `server-update`,
 * `notification`, `onboarding` store `init()` — that waits on identity or on a
 * permission only `/api/auth/me` can supply. A live-UI audit flagged that as a
 * serialization worth removing ("fire optimistically, tolerate a 403").
 *
 * It is not. `hasPermissionNow` reads `authStoreProxy().$.permissions`, which
 * ONLY `/api/auth/me` populates, so there is nothing to parallelize — the input
 * genuinely does not exist earlier. And firing anyway would break the repo's
 * standing **no-403 rule** (CLAUDE.md §"Realtime Sync → Frontend"): `server_update::`
 * is granted by no migration, so it reaches only administrators via `*`, and every
 * ordinary user's boot would carry a guaranteed 403.
 *
 * These specs make that verdict executable rather than a comment. They come in
 * two positive/negative PAIRS, because ziee gates this at two independent layers
 * and a single pair cannot tell them apart:
 *
 * - TEST-4 / TEST-5 — the `server-update` tier. TEST-4 is the positive control
 *   (an admin DOES issue the request, and only after `/api/auth/me` resolves);
 *   TEST-5 asserts an unpermitted user issues ZERO. This proves the OUTCOME the
 *   no-403 rule promises, but it does NOT isolate the store gate: `server-update`'s
 *   module declares `shouldLoad: ctx => … && ctx.can(ServerUpdateRead)`, so for an
 *   unpermitted user the module never loads and the store's `init()` never runs.
 *   Delete the store's `hasPermissionNow` line and TEST-5 still passes.
 * - TEST-7 / TEST-8 — the `memory` tier, which DOES isolate the store gate. That
 *   module loads for every authenticated user, so its store `init()` genuinely runs
 *   and `hasPermissionNow(MemoryAdminRead)` is the only thing preventing the
 *   request. TEST-8 carries the `[acceptance / INV-3]` tag for that reason: it is
 *   the one that goes red if the gate is dropped.
 *
 * Real backend driven through the UI; no `page.route` mocking.
 */

interface Req {
  url: string
  method: string
  start: number
  end: number
  status: number
}

async function recordApi(
  page: import('@playwright/test').Page,
  body: () => Promise<void>,
) {
  const started = new Map<unknown, number>()
  const reqs: Req[] = []
  const onReq = (r: import('@playwright/test').Request) => {
    if (r.url().includes('/api/')) started.set(r, Date.now())
  }
  const onRes = (r: import('@playwright/test').Response) => {
    const t = started.get(r.request())
    if (t === undefined) return
    reqs.push({
      url: new URL(r.url()).pathname,
      method: r.request().method(),
      start: t,
      end: Date.now(),
      status: r.status(),
    })
  }
  page.on('request', onReq)
  page.on('response', onRes)
  try {
    await body()
  } finally {
    page.off('request', onReq)
    page.off('response', onRes)
  }
  return reqs
}

const first = (reqs: Req[], path: string) =>
  reqs.filter(r => r.url === path).sort((a, b) => a.start - b.start)[0]

/** The permission-gated second-tier endpoint: `server_update::read`. */
const GATED = '/api/server-update/status'

/**
 * The endpoint that isolates the STORE-LEVEL gate: `memory::admin::read`.
 *
 * `server-update`'s module declares `shouldLoad: ctx => … && ctx.can(ServerUpdateRead)`,
 * so for an unpermitted user that module never loads and its store `init()` never
 * runs. TEST-5 therefore proves the OUTCOME (no request, no 403) but cannot
 * attribute it to the store's own `hasPermissionNow` gate — delete that gate and
 * TEST-5 would still pass.
 *
 * `memory`'s module declares only `shouldLoad: ctx => ctx.isAuthenticated`, so its
 * store DOES initialize for every authenticated user — and `MemoryStatusPill`
 * reads `MemoryAdmin.settings` before its own `canUse` early-return, so the read
 * happens even for a user who will never see the pill. `memory::admin::read` is
 * granted by no migration, so it is absent from the default Users group that
 * `createTestUser` lands a new user in. The ONLY thing standing between a
 * restricted user and a 403 on `/api/memory/admin-settings` is
 * `hasPermissionNow(Permissions.MemoryAdminRead)` in that store's `init()`.
 */
const STORE_GATED = '/api/memory/admin-settings'

/**
 * Enough to boot the app and render the chat page, WITHOUT `server_update::read`
 * (which no migration grants — only administrators hold it, via the `*` wildcard).
 */
const RESTRICTED_PERMISSIONS = [
  'conversations::create',
  'conversations::read',
  'conversations::edit',
  'messages::create',
  'messages::read',
  'llm_models::read',
  'profile::read',
]

test.describe('chat-boot-fetch-hygiene — the second boot tier self-gates on permission', () => {
  test('TEST-4: an ADMIN boot issues the gated request, and only after /api/auth/me resolves', async ({
    page,
    testInfra,
  }) => {
    const { baseURL } = testInfra
    await loginAsAdmin(page, baseURL)

    const reqs = await recordApi(page, async () => {
      await page.goto(`${baseURL}/`, { waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('main')).toBeVisible({ timeout: 30000 })
      await page.waitForTimeout(5000)
    })

    const me = first(reqs, '/api/auth/me')
    const gated = first(reqs, GATED)
    expect(me, 'the boot must verify the session').toBeTruthy()
    expect(
      gated,
      `an admin holds server_update::read via the '*' wildcard, so the gated ` +
        `request MUST be issued — its absence would mean this spec is no longer ` +
        `measuring the tier it claims to measure`,
    ).toBeTruthy()

    // The measured serialization: the gated fetch cannot start before the
    // permission set exists, and only `/api/auth/me` supplies it.
    expect(
      gated.start,
      `${GATED} [${gated.start}-${gated.end}] started before /api/auth/me ` +
        `[${me.start}-${me.end}] resolved — the permission set it self-gates on ` +
        `did not exist yet, so either the gate was dropped or /auth/me is no ` +
        `longer its source`,
    ).toBeGreaterThanOrEqual(me.end)
  })

  test('TEST-5: a user LACKING server_update::read issues ZERO requests to the gated endpoint', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    const adminToken = await getAdminToken(apiURL)
    const stamp = Date.now()
    const username = `bootgate${stamp}`
    const password = 'BootGate!123'
    await createTestUser(
      apiURL,
      adminToken,
      username,
      `${username}@example.com`,
      password,
      RESTRICTED_PERMISSIONS,
    )

    await login(page, baseURL, username, password)

    const reqs = await recordApi(page, async () => {
      await page.goto(`${baseURL}/`, { waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('main')).toBeVisible({ timeout: 30000 })
      await page.waitForTimeout(5000)
    })

    // Sanity: this user really did boot (otherwise "zero gated requests" would
    // be vacuously true because nothing ran at all).
    expect(
      first(reqs, '/api/auth/me'),
      'the restricted user must have completed a real boot',
    ).toBeTruthy()

    const gatedCalls = reqs.filter(r => r.url === GATED)
    expect(
      gatedCalls.length,
      `a user WITHOUT server_update::read issued ${gatedCalls.length} request(s) ` +
        `to ${GATED} — the no-403 rule (CLAUDE.md §"Realtime Sync → Frontend") ` +
        `says an unpermitted user must never reach it. Note this is the LAYERED ` +
        `outcome (module shouldLoad gate + store self-gate); TEST-8 is the one ` +
        `that isolates the store gate specifically`,
    ).toBe(0)

    // …and the gated endpoint returned no 403 to this user, because it was never
    // asked. (Scoped to the gated path: this asserts THIS gate, not a repo-wide
    // 403-freedom claim that other modules would own.)
    const forbidden = reqs.filter(r => r.url === GATED && r.status === 403)
    expect(
      forbidden.length,
      `${forbidden.length} 403(s) on ${GATED} during a restricted-user boot`,
    ).toBe(0)
  })

  test('TEST-7: an ADMIN boot DOES issue the store-gated request (positive control for TEST-8)', async ({
    page,
    testInfra,
  }) => {
    const { baseURL } = testInfra
    await loginAsAdmin(page, baseURL)

    const reqs = await recordApi(page, async () => {
      await page.goto(`${baseURL}/`, { waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('main')).toBeVisible({ timeout: 30000 })
      await page.waitForTimeout(5000)
    })

    // Load-bearing: this establishes that booting `/` really does initialize the
    // MemoryAdmin store and reach its gate. Without it, TEST-8's "zero requests"
    // would be vacuous — it could pass simply because nothing ever ran.
    expect(
      first(reqs, STORE_GATED),
      `an admin holds memory::admin::read via '*', so booting / MUST reach ` +
        `${STORE_GATED}. If this is absent the surface no longer initializes the ` +
        `MemoryAdmin store and TEST-8 has stopped proving anything`,
    ).toBeTruthy()
  })

  test('TEST-8: [acceptance/INV-3] the STORE self-gate alone keeps an unpermitted user off the endpoint', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    const adminToken = await getAdminToken(apiURL)
    const stamp = Date.now()
    const username = `storegate${stamp}`
    const password = 'StoreGate!123'
    await createTestUser(
      apiURL,
      adminToken,
      username,
      `${username}@example.com`,
      password,
      RESTRICTED_PERMISSIONS,
    )

    await login(page, baseURL, username, password)

    const reqs = await recordApi(page, async () => {
      await page.goto(`${baseURL}/`, { waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('main')).toBeVisible({ timeout: 30000 })
      await page.waitForTimeout(5000)
    })

    expect(
      first(reqs, '/api/auth/me'),
      'the restricted user must have completed a real boot',
    ).toBeTruthy()

    const calls = reqs.filter(r => r.url === STORE_GATED)
    expect(
      calls.length,
      `a user WITHOUT memory::admin::read issued ${calls.length} request(s) to ` +
        `${STORE_GATED}. The memory module is NOT permission-gated at load time ` +
        `(shouldLoad: ctx => ctx.isAuthenticated), so its store DID initialize — ` +
        `the only thing that can have stopped this request is ` +
        `hasPermissionNow(Permissions.MemoryAdminRead) in the store's init(). ` +
        `Removing that gate turns this red, which is exactly the no-403 rule ` +
        `(CLAUDE.md §"Realtime Sync → Frontend") being enforced executably.`,
    ).toBe(0)

    expect(
      reqs.filter(r => r.url === STORE_GATED && r.status === 403).length,
      `403(s) on ${STORE_GATED} during a restricted-user boot`,
    ).toBe(0)
  })
})
