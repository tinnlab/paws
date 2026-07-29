import { test, expect } from '../../fixtures/test-context'
import {
  loginAsAdmin,
  getAdminToken,
  getCurrentUserToken,
  createTestUser,
  login,
} from '../../common/auth-helpers'

/** Create a conversation AS the currently-logged-in user and return its id. */
async function createOwnConversation(
  page: import('@playwright/test').Page,
  apiURL: string,
  title: string,
): Promise<string> {
  const token = await getCurrentUserToken(page)
  const res = await page.request.post(`${apiURL}/api/conversations`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { title },
  })
  if (!res.ok()) {
    throw new Error(`createOwnConversation failed: ${res.status()} ${await res.text()}`)
  }
  return (await res.json()).id as string
}

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
  /** Wall-clock at the `request` event. */
  start: number
  /** Wall-clock at the `response` event; undefined if no response arrived in-window. */
  end?: number
  /** undefined when the request was issued but never answered inside the window. */
  status?: number
}

/**
 * Record every `/api` request while `body()` runs.
 *
 * Recorded on the **`request`** event, not the `response` event. That matters for
 * the assertions below: they are of the form "an unpermitted user issued ZERO
 * requests to X", and a response-keyed recorder cannot see a request that is
 * issued but aborted, still in flight at the cutoff, or fails at the network
 * layer — so a genuinely-issued gated request could vanish and the test would
 * green. The response event only fills in `end`/`status`.
 */
async function recordApi(
  page: import('@playwright/test').Page,
  body: () => Promise<void>,
) {
  const byRequest = new Map<unknown, Req>()
  const reqs: Req[] = []
  const onReq = (r: import('@playwright/test').Request) => {
    if (!r.url().includes('/api/')) return
    const rec: Req = {
      url: new URL(r.url()).pathname,
      method: r.method(),
      start: Date.now(),
    }
    byRequest.set(r, rec)
    reqs.push(rec)
  }
  const onRes = (r: import('@playwright/test').Response) => {
    const rec = byRequest.get(r.request())
    if (!rec) return
    rec.end = Date.now()
    rec.status = r.status()
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

/**
 * Browser-side Resource Timing for an `/api` path, on the PAGE's clock.
 *
 * Ordering must not be judged from `recordApi`'s timestamps: those are taken in
 * the Node process when Playwright delivers a CDP event, and CDP delivery is
 * asynchronous and can reorder under load — a busy box could fail (or mask) a
 * causality assertion that is actually about what the browser did. Resource
 * Timing is recorded by the browser itself, so `startTime`/`responseEnd` reflect
 * real in-page ordering.
 */
async function apiTiming(page: import('@playwright/test').Page, path: string) {
  return page.evaluate(p => {
    const hit = performance
      .getEntriesByType('resource')
      .filter(e => new URL(e.name, location.origin).pathname === p)
      .sort((a, b) => a.startTime - b.startTime)[0] as PerformanceResourceTiming | undefined
    return hit ? { start: hit.startTime, end: hit.responseEnd } : null
  }, path)
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
    // permission set exists, and only `/api/auth/me` supplies it. Judged on the
    // BROWSER's clock (Resource Timing), not on Playwright's CDP event stamps —
    // see `apiTiming`.
    const meT = await apiTiming(page, '/api/auth/me')
    const gatedT = await apiTiming(page, GATED)
    expect(meT, 'Resource Timing for /api/auth/me').toBeTruthy()
    expect(gatedT, `Resource Timing for ${GATED}`).toBeTruthy()
    expect(
      gatedT!.start,
      `${GATED} [${gatedT!.start.toFixed(0)}-${gatedT!.end.toFixed(0)}] started ` +
        `before /api/auth/me [${meT!.start.toFixed(0)}-${meT!.end.toFixed(0)}] ` +
        `resolved — the permission set it self-gates on did not exist yet, so ` +
        `either the gate was dropped or /auth/me is no longer its source`,
    ).toBeGreaterThanOrEqual(meT!.end)
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

  test('TEST-7: an ADMIN on the pill surface DOES issue the store-gated request (positive control)', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    await loginAsAdmin(page, baseURL)
    const convId = await createOwnConversation(page, apiURL, `pill-admin-${Date.now()}`)

    const reqs = await recordApi(page, async () => {
      await page.goto(`${baseURL}/chat/${convId}`, { waitUntil: 'domcontentloaded' })
      await expect(page.getByTestId('memory-status-pill')).toBeVisible({ timeout: 30000 })
      await page.waitForTimeout(4000)
    })

    // Load-bearing: establishes that THIS surface initializes the MemoryAdmin
    // store and reaches its gate. Without it, TEST-8's zero would be vacuous.
    expect(
      first(reqs, STORE_GATED),
      `an admin holds memory::admin::read via '*', so this surface MUST reach ` +
        `${STORE_GATED}. Its absence would mean the surface no longer initializes ` +
        `the MemoryAdmin store, and TEST-8 would have stopped proving anything`,
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
    const convId = await createOwnConversation(page, apiURL, `pill-restricted-${stamp}`)

    const reqs = await recordApi(page, async () => {
      await page.goto(`${baseURL}/chat/${convId}`, { waitUntil: 'domcontentloaded' })
      // SAME-PERSONA WITNESS. The pill rendering for THIS user is the proof that
      // the MemoryAdmin store was initialized on this boot: MemoryStatusPill reads
      // `MemoryAdmin.settings` at the top of its body, before every early return.
      // Asserting it here — rather than inferring store initialization from the
      // ADMIN run in TEST-7 — is what stops this test going vacuously green if the
      // pill ever stops mounting for a non-admin (a module-manifest change, an
      // error boundary, a composer layout change).
      await expect(page.getByTestId('memory-status-pill')).toBeVisible({ timeout: 30000 })
      await page.waitForTimeout(4000)
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
        `(shouldLoad: ctx => ctx.isAuthenticated) and the pill above proves its ` +
        `store DID initialize on this very boot — so the only thing that can have ` +
        `stopped this request is hasPermissionNow(Permissions.MemoryAdminRead) in ` +
        `the store's init(). Removing that gate turns this red, which is the ` +
        `no-403 rule (CLAUDE.md §"Realtime Sync → Frontend") enforced executably.`,
    ).toBe(0)

    expect(
      reqs.filter(r => r.url === STORE_GATED && r.status === 403).length,
      `403(s) on ${STORE_GATED} during a restricted-user boot`,
    ).toBe(0)
  })
})
