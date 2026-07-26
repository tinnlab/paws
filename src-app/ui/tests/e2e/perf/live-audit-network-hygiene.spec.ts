import { test, expect } from '../../fixtures/test-context'
import { loginAsAdmin, getAdminToken } from '../../common/auth-helpers'
import { byTestId } from '../testid'

/**
 * REGRESSION GUARDS for the network-hygiene defects the `live-ui-audit` battery
 * measured against the live app, expressed as the audit's OWN signals:
 *
 *   - `n+1`       — "many ids on one endpoint template in a burst": the sidebar
 *                   conversation list fired one
 *                   `GET /api/projects/by-conversation/{id}` per row (19-42 in a
 *                   single step). It must now issue ZERO of those and ONE
 *                   batched `POST /api/projects/by-conversations`.
 *   - `duplicate` — "same url+method ≥2× in a step": `GET /api/llm-models`
 *                   fired 3× on every app load (memory-admin ×2 +
 *                   summarization-admin). It must now fire ONCE.
 *
 * Drives the REAL backend through the UI (no `page.route` mocks) — a mocked
 * request count would prove nothing about what the app actually asks for.
 */

async function seedConv(apiURL: string, token: string, title: string): Promise<string> {
  const res = await fetch(`${apiURL}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ title }),
  })
  if (!res.ok) throw new Error(`seed conv failed: ${res.status}`)
  return (await res.json()).id
}

async function seedProject(apiURL: string, token: string, name: string): Promise<string> {
  const res = await fetch(`${apiURL}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) throw new Error(`seed project failed: ${res.status}`)
  return (await res.json()).id
}

test.describe('live-ui-audit network hygiene — regression guards', () => {
  test.describe('touch device (the burst case)', () => {
    // A TOUCH context is the case the audit measured and the worst case for the
    // burst: `ConversationCard` seeds its lazy trailing as already-hovered when
    // `(hover: none)` matches, so EVERY visible row asks for its membership in
    // one mount wave instead of one-per-hover. Reproducing that is the only way
    // to assert the burst collapses to a single request.
    test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })

    test('TEST-6: a many-row conversation list resolves project membership in ONE batched request (no n+1)', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    await loginAsAdmin(page, baseURL)
    const token = await getAdminToken(apiURL)

    // Enough rows that the OLD per-id path would trip the audit's n+1 threshold
    // (≥4 distinct ids on one templated endpoint in a step) many times over.
    const projectId = await seedProject(apiURL, token, 'Batch lookup project')
    const ids: string[] = []
    for (let i = 0; i < 12; i += 1) {
      ids.push(await seedConv(apiURL, token, `Batch lookup conv ${i}`))
    }
    // A couple of them ARE filed, so the batch must return real links, not just
    // an empty answer that would trivially "pass".
    for (const cid of ids.slice(0, 3)) {
      const res = await fetch(`${apiURL}/api/projects/${projectId}/conversations/${cid}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(res.ok, `attach ${cid} failed: ${res.status}`).toBeTruthy()
    }

    const perId: string[] = []
    const batched: string[] = []
    page.on('request', req => {
      const u = new URL(req.url())
      if (u.pathname.startsWith('/api/projects/by-conversation/')) perId.push(u.pathname)
      if (u.pathname === '/api/projects/by-conversations') batched.push(u.pathname)
    })

    await page.goto(`${baseURL}/chats`)
    await page.waitForLoadState('load')

    // On touch there is no hover: every rendered card mounts its trailing
    // immediately, so the whole visible page asks at once — the burst.
    await expect(byTestId(page, `chat-conversation-card-${ids[0]}`)).toBeVisible({
      timeout: 20000,
    })

    // The badge for a FILED conversation actually renders its project tag —
    // proof the batched answer is CONSUMED, not merely requested (a fix that
    // just stopped asking would pass a request-count-only assertion).
    const filedCard = byTestId(page, `chat-conversation-card-${ids[0]}`)
    await expect(byTestId(filedCard, 'project-trailing-remove-tag')).toBeVisible({
      timeout: 20000,
    })
    // ...and an UNFILED one still offers "Add to project", i.e. the batch
    // answered "no project" rather than failing silently.
    const unfiledCard = byTestId(page, `chat-conversation-card-${ids[11]}`)
    await expect(byTestId(unfiledCard, 'project-trailing-add-button')).toBeVisible({
      timeout: 20000,
    })

    expect(
      perId,
      `no per-conversation lookup may be issued any more; got:\n${perId.join('\n')}`,
    ).toEqual([])
    // The whole point: ONE request for the whole mount wave, not one per row.
    expect(
      batched.length,
      `a 12-row list must resolve membership in ONE batched request; got ${batched.length}`,
    ).toBe(1)
    })
  })

  test('TEST-8: an app load fetches GET /api/llm-models exactly once (no duplicate)', async ({
    page,
    testInfra,
  }) => {
    const { baseURL } = testInfra

    const modelListCalls: string[] = []
    page.on('request', req => {
      const u = new URL(req.url())
      if (req.method() === 'GET' && u.pathname === '/api/llm-models') {
        modelListCalls.push(u.search || '(no query)')
      }
    })

    await loginAsAdmin(page, baseURL)
    await expect(page.getByRole('main')).toBeVisible({ timeout: 20000 })
    await page.waitForTimeout(2000)

    // Measure ONE page load of a surface that DEFINITELY reads the catalog, so
    // the assertion can never pass vacuously at zero: the memory-admin page
    // alone used to fire TWO of the three calls (unfiltered + text_embedding).
    // Counting a single load window mirrors the audit's per-step semantics —
    // the 2 s coalescing window is not meant to span separate page loads.
    modelListCalls.length = 0
    await page.goto(`${baseURL}/settings/memory-admin`)
    await page.waitForLoadState('load')
    await expect(page.getByRole('main')).toBeVisible({ timeout: 20000 })
    await page.waitForTimeout(4000)

    expect(
      modelListCalls.length,
      `GET /api/llm-models must be fetched, and fetched exactly ONCE per load; got ${modelListCalls.length}:\n${modelListCalls.join('\n')}`,
    ).toBe(1)
  })
})
