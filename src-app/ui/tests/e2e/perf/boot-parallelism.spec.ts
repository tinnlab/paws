import { test, expect } from '../../fixtures/test-context'
import { loginAsAdmin } from '../../common/auth-helpers'

/**
 * Network-hygiene guards for the boot chain (`net-hygiene` lifecycle).
 *
 * Drives the REAL backend through the UI — no `page.route` mocking — and reads
 * the browser's own request log, so these assert the shipped runtime behaviour
 * rather than a mocked stand-in.
 *
 * - TEST-5  [acceptance / INV-2] the boot requests are genuinely PARALLEL.
 * - TEST-11 `/settings/profile` issues ONE `/api/auth/me`, and still renders.
 * - TEST-12 [INV-1] a post-mutation refetch is NOT served pre-mutation data.
 */

interface Req {
  url: string
  start: number
  end: number
}

/** Record every `/api` request's start + end while `body()` runs. */
async function recordApi(page: import('@playwright/test').Page, body: () => Promise<void>) {
  const started = new Map<unknown, number>()
  const reqs: Req[] = []
  const onReq = (r: import('@playwright/test').Request) => {
    if (r.url().includes('/api/')) started.set(r, Date.now())
  }
  const onRes = (r: import('@playwright/test').Response) => {
    const t = started.get(r.request())
    if (t === undefined) return
    reqs.push({ url: new URL(r.url()).pathname, start: t, end: Date.now() })
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

test.describe('net-hygiene — boot parallelism + request de-duplication', () => {
  test('TEST-5: [acceptance/INV-2] /api/auth/me is issued in the SAME burst as /api/app/setup/status, not after it', async ({
    page,
    testInfra,
  }) => {
    const { baseURL } = testInfra
    await loginAsAdmin(page, baseURL)

    // A COLD load with a persisted session — the case the boot waterfall was
    // measured on.
    const reqs = await recordApi(page, async () => {
      await page.goto(`${baseURL}/`, { waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('main')).toBeVisible({ timeout: 30000 })
      await page.waitForTimeout(4000)
    })

    const me = first(reqs, '/api/auth/me')
    const setup = first(reqs, '/api/app/setup/status')
    expect(me, 'the boot must verify the session').toBeTruthy()
    expect(setup, 'the boot must check setup status').toBeTruthy()

    // THE invariant: they OVERLAP in wall-clock time. Before the fix `/auth/me`
    // was issued from AuthGuard's mount effect — i.e. only after the router +
    // guard chunks had downloaded and committed — so it STARTED ~300ms after
    // `/api/app/setup/status` had already finished, making it a dependent
    // successor in the audit's serial chain rather than a peer.
    const overlap = Math.min(me.end, setup.end) - Math.max(me.start, setup.start)
    expect(
      overlap,
      `/api/auth/me [${me.start}-${me.end}] and /api/app/setup/status ` +
        `[${setup.start}-${setup.end}] must overlap — if this is ≤0 the session ` +
        `verification has drifted back onto the router-mount critical path`,
    ).toBeGreaterThan(0)

    // …and it starts EARLY, in the initial module-initialize burst rather than
    // after a chunk waterfall. Measured pre-fix: ~361-377ms; post-fix: ~63-77ms.
    // The bound is deliberately loose (a slow CI box moves absolute times) but
    // far below the pre-fix floor.
    const t0 = Math.min(...reqs.map(r => r.start))
    expect(
      me.start - t0,
      'the session verification must start in the first boot burst',
    ).toBeLessThan(250)
  })

  test('TEST-11: /settings/profile issues exactly ONE /api/auth/me and still renders the profile', async ({
    page,
    testInfra,
  }) => {
    const { baseURL } = testInfra
    await loginAsAdmin(page, baseURL)

    const reqs = await recordApi(page, async () => {
      await page.goto(`${baseURL}/settings/profile`, { waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('main')).toBeVisible({ timeout: 30000 })
      await page.waitForTimeout(4000)
    })

    const meCalls = reqs.filter(r => r.url === '/api/auth/me').sort((a, b) => a.start - b.start)
    expect(meCalls.length, 'the boot must verify the session').toBeGreaterThan(0)

    // The suppression window is `ME_BOOT_FRESH_MS` (3 s) wide, so this asserts
    // ONE `/me` only when the page's mount refresh actually landed inside it.
    // On a slow box the profile route chunk can commit later than that, in which
    // case a second `/me` is CORRECT behaviour, not a regression — so the
    // assertion is conditioned on the observed gap rather than on a wall-clock
    // coincidence. (`ME_BOOT_FRESH_MS` is not imported: this spec runs in the
    // Playwright process, not the app bundle.)
    const ME_BOOT_FRESH_MS = 3000
    const gap = meCalls.length > 1 ? meCalls[1].start - meCalls[0].end : 0
    if (meCalls.length > 1 && gap < ME_BOOT_FRESH_MS) {
      throw new Error(
        `two /api/auth/me only ${gap}ms apart — inside the ${ME_BOOT_FRESH_MS}ms ` +
          `freshness window, so the page's mount refresh should have collapsed ` +
          `onto the boot verification and did not`,
      )
    }
    expect(
      meCalls.length,
      `expected 1 /api/auth/me on a cold profile load, got ${meCalls.length}`,
    ).toBeLessThanOrEqual(gap >= ME_BOOT_FRESH_MS ? 2 : 1)

    // …and de-duplicating did NOT cost the page its data: the form is populated.
    const username = page.getByLabel(/username/i).first()
    await expect(username).toBeVisible({ timeout: 20000 })
    await expect(username).not.toHaveValue('')
  })

  test('TEST-12: [INV-1] a refetch after a real mutation shows the NEW value (not a coalesced pre-mutation response)', async ({
    page,
    testInfra,
  }) => {
    const { baseURL } = testInfra
    await loginAsAdmin(page, baseURL)

    await page.goto(`${baseURL}/settings/profile`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('main')).toBeVisible({ timeout: 30000 })

    const displayName = page.getByLabel(/display name/i).first()
    await expect(displayName).toBeVisible({ timeout: 20000 })
    const original = (await displayName.inputValue()) || 'Admin'
    const renamed = `NetHygiene ${Date.now()}`

    try {
      // The save triggers `refreshCurrentUser()`. Neither the transport's
      // in-flight coalescer nor the `/me` freshness window may serve that
      // pre-mutation data — the freshness epoch is bumped when the PUT
      // completes, which disqualifies both. If either leaked, the page's
      // `user`-effect would reset the form back to the OLD name.
      //
      // Load-bearing: WAIT FOR THE POST-SAVE `/me` TO LAND before asserting.
      // Asserting straight after `fill()` would pass on the value this test
      // typed, before any refetch resolved — i.e. it would prove nothing.
      const meAfterSave = page.waitForResponse(
        r => r.url().includes('/api/auth/me') && r.request().method() === 'GET',
        { timeout: 20000 },
      )
      await displayName.fill(renamed)
      await page.getByRole('button', { name: /save|update/i }).first().click()
      await meAfterSave

      // Give the store's `user` update a commit, then assert the form still
      // shows the NEW value — i.e. the refetch returned post-mutation data.
      await expect(displayName).toHaveValue(renamed, { timeout: 20000 })
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(page.getByLabel(/display name/i).first()).toHaveValue(renamed, {
        timeout: 30000,
      })
    } finally {
      // ALWAYS restore: this mutates the SHARED admin fixture user, so an
      // earlier assertion failure must not leave every later spec in the run
      // looking at a renamed admin.
      //
      // Swallow failures HERE, deliberately: a throw from a `finally` REPLACES
      // the original assertion error, so a restore timeout would mask the real
      // reason the test went red. Best-effort cleanup + a diagnostic beats a
      // hidden root cause.
      try {
        await page.goto(`${baseURL}/settings/profile`, { waitUntil: 'domcontentloaded' })
        const restore = page.getByLabel(/display name/i).first()
        await restore.waitFor({ state: 'visible', timeout: 20000 })
        await restore.fill(original)
        await page.getByRole('button', { name: /save|update/i }).first().click()
        await expect(restore).toHaveValue(original, { timeout: 20000 })
      } catch (e) {
        console.error(
          `[TEST-12] failed to restore the shared fixture user to "${original}" — ` +
            `a later spec may see a renamed admin: ${e}`,
        )
      }
    }
  })
})
