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

    const meCalls = reqs.filter(r => r.url === '/api/auth/me')
    expect(
      meCalls.length,
      `expected 1 /api/auth/me on a cold profile load, got ${meCalls.length} ` +
        `(the page's mount refresh must collapse onto the boot verification)`,
    ).toBe(1)

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

    await displayName.fill(renamed)
    await page.getByRole('button', { name: /save|update/i }).first().click()

    // The save triggers `refreshCurrentUser()`. The transport's in-flight
    // coalescer must NOT let that join a `/me` that was already on the wire
    // before the PUT — the freshness epoch is bumped when the mutation
    // completes. If it did, the UI would settle back to the OLD name.
    await expect(displayName).toHaveValue(renamed, { timeout: 20000 })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByLabel(/display name/i).first()).toHaveValue(renamed, {
      timeout: 30000,
    })

    // Restore so the shared fixture user is unchanged for other specs.
    const restore = page.getByLabel(/display name/i).first()
    await restore.fill(original)
    await page.getByRole('button', { name: /save|update/i }).first().click()
    await expect(restore).toHaveValue(original, { timeout: 20000 })
  })
})
