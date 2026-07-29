import { test, expect } from '../../fixtures/test-context'
import { loginAsAdmin, getAdminToken } from '../../common/auth-helpers'

/**
 * `/chats` list-fetch ownership (chat-boot-fetch-hygiene lifecycle).
 *
 * A cold `/chats` load used to issue THREE `GET /api/conversations` (measured by
 * call-stack attribution; see `.lifecycle/chat-boot-fetch-hygiene/MEASUREMENTS.md`):
 *
 *   1. the boot request — the sidebar's `loadRecentConversations` and the page's
 *      own `loadConversations` fire concurrently with identical params, so the
 *      transport's in-flight coalescer collapses them onto ONE wire request. This
 *      is the legitimate one, and the only one that should survive.
 *   2. a `reloadQueued` REPLAY — `ConversationList` ALSO fetched on mount. That
 *      second caller hit `loadConversations`' mid-flight guard, which for page 1
 *      does not drop the call but sets `reloadQueued`, replaying the load once the
 *      first settles. A replay that starts after the first request completed is
 *      not concurrent, so the coalescer cannot merge it.
 *   3. a no-op search debounce — `ConversationList`'s 500 ms debounce also runs on
 *      mount and called `setSearchQuery('')` when the store's query was already
 *      `''`; `setSearchQuery` unconditionally re-fetches page 1.
 *
 * Both redundant callers are gone; the route now has a single owner.
 *
 * These specs drive the REAL backend through the UI — no `page.route` mocking, no
 * stubbed responses. TEST-1 counts requests with a PASSTHROUGH `window.fetch`
 * observer installed before navigation: it records the call and then calls the
 * original fetch, so every request still reaches the real server. That is what
 * makes the count attributable to the `/chats` DOCUMENT — Playwright's page-level
 * request log also catches requests the PREVIOUS page had in flight across the
 * navigation, which silently inflates the count by one.
 *
 * - TEST-1 [acceptance / INV-2] a cold `/chats` load issues exactly ONE
 *   `GET /api/conversations`.
 * - TEST-2 [acceptance / INV-1] …and de-duplicating did not cost the page its data.
 * - TEST-3 a conversation created AFTER the store was primed still shows up.
 */

interface ConvCall {
  url: string
  path: string
  t: number
}

/**
 * Install a passthrough `window.fetch` observer that records every
 * `GET /api/conversations?…` together with the pathname of the document that
 * issued it. Must be called BEFORE the navigation being measured.
 */
async function instrumentConversationFetches(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    ;(window as any).__CONV_CALLS__ = []
    const origFetch = window.fetch
    window.fetch = function (this: unknown, ...args: any[]) {
      try {
        const u = typeof args[0] === 'string' ? args[0] : args[0]?.url
        if (typeof u === 'string' && u.includes('/api/conversations?')) {
          ;(window as any).__CONV_CALLS__.push({
            url: u,
            path: location.pathname,
            t: Date.now(),
          })
        }
      } catch {
        /* never let instrumentation break the app */
      }
      return origFetch.apply(this, args as any)
    } as any
  })
}

async function conversationFetchesOn(
  page: import('@playwright/test').Page,
  pathname: string,
): Promise<ConvCall[]> {
  const calls: ConvCall[] = await page.evaluate(
    () => (window as any).__CONV_CALLS__ ?? [],
  )
  return calls.filter(c => c.path === pathname).sort((a, b) => a.t - b.t)
}

const timeline = (calls: ConvCall[]) => {
  const t0 = calls.length ? calls[0].t : 0
  return calls.map((c, i) => `  #${i + 1} +${c.t - t0}ms ${c.url}`).join('\n')
}

async function seedConversation(
  page: import('@playwright/test').Page,
  apiURL: string,
  title: string,
) {
  const token = await getAdminToken(apiURL)
  const res = await page.request.post(`${apiURL}/api/conversations`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { title },
  })
  expect(res.ok(), `seeding "${title}" must succeed`).toBe(true)
}

test.describe('chat-boot-fetch-hygiene — /chats issues ONE list fetch', () => {
  test('TEST-1: [acceptance/INV-2] a cold /chats load issues exactly one GET /api/conversations', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    // Instrument before ANY navigation so every document is covered.
    await instrumentConversationFetches(page)
    await loginAsAdmin(page, baseURL)
    // Seed BEFORE navigating so the list actually mounts — an empty `/chats`
    // never renders `ConversationList` at all, so neither redundant caller would
    // exist and the count would be trivially 1, proving nothing.
    await seedConversation(page, apiURL, `single-fetch-${Date.now()}`)

    await page.goto(`${baseURL}/chats`, { waitUntil: 'domcontentloaded' })
    // Wait until the list has fully rendered — the page has gone all the way
    // through fetch → render, so a `reloadQueued` replay (which can only fire
    // AFTER the first load settles) has had its chance…
    await expect(page.getByTestId('chat-conversation-search-input')).toBeVisible({
      timeout: 30000,
    })
    // …and settle well past the 500 ms search debounce, whose mount pass was the
    // third request. 5 s leaves generous headroom on a loaded box.
    await page.waitForTimeout(5000)

    const calls = await conversationFetchesOn(page, '/chats')
    expect(
      calls.length,
      `expected exactly ONE GET /api/conversations from the /chats document, got ` +
        `${calls.length}:\n${timeline(calls)}\n` +
        `>1 means a second independent caller of the route-level list fetch has ` +
        `been reintroduced (INV-2: one shared store read, not N callers). The two ` +
        `historically-removed callers were ConversationList's mount fetch (which ` +
        `replayed via reloadQueued) and its search debounce firing a no-op ` +
        `setSearchQuery('') on mount.`,
    ).toBe(1)
  })

  test('TEST-2: [acceptance/INV-1] the de-duplicated /chats still renders its conversations', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    await loginAsAdmin(page, baseURL)
    const title = `renders-after-dedupe-${Date.now()}`
    await seedConversation(page, apiURL, title)

    await page.goto(`${baseURL}/chats`, { waitUntil: 'domcontentloaded' })

    // The seeded conversation is listed…
    await expect(page.getByText(title, { exact: false }).first()).toBeVisible({
      timeout: 30000,
    })
    // …and the page did NOT fall through to the empty state, which is what a
    // fetch lost to over-eager de-duplication would look like.
    await expect(page.getByText('No chat history yet')).toHaveCount(0)
  })

  test('TEST-6: the no-op debounce guard did not break real search (filter, then clear)', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    await loginAsAdmin(page, baseURL)
    const stamp = Date.now()
    const alpha = `zqalpha-${stamp}`
    const beta = `zqbeta-${stamp}`
    await seedConversation(page, apiURL, alpha)
    await seedConversation(page, apiURL, beta)

    await page.goto(`${baseURL}/chats`, { waitUntil: 'domcontentloaded' })
    const search = page.getByTestId('chat-conversation-search-input')
    await expect(search).toBeVisible({ timeout: 30000 })

    // Scope every assertion to the LIST rows. The sidebar's recent-conversations
    // widget renders the same titles from a SEPARATE, deliberately unfiltered
    // cursor (`recentConversations`), so an unscoped `getByText` would still find
    // the filtered-out conversation there and this test would assert nothing
    // about the search at all.
    const rows = page.getByTestId('chat-conversation-list-rows')
    await expect(rows.getByText(alpha, { exact: false }).first()).toBeVisible({
      timeout: 30000,
    })

    // Typing a query still reaches the store → server-side filter applies.
    await search.fill(alpha)
    await expect(rows.getByText(beta, { exact: false })).toHaveCount(0, {
      timeout: 30000,
    })
    await expect(rows.getByText(alpha, { exact: false }).first()).toBeVisible()

    // CLEARING back to '' is the load-bearing leg: `localSearchQuery` is now
    // identical to a mount pass (''), but the STORE still holds the old query.
    // A guard written as "skip the first run" would pass the count assertion in
    // TEST-1 and still strand the user here in a permanently filtered list.
    await search.fill('')
    await expect(rows.getByText(beta, { exact: false }).first()).toBeVisible({
      timeout: 30000,
    })
  })

  test('TEST-3: a conversation created AFTER the store was primed still appears', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    await loginAsAdmin(page, baseURL)

    // Prime the store first: visit /chats with one conversation present.
    const first = `primed-${Date.now()}`
    await seedConversation(page, apiURL, first)
    await page.goto(`${baseURL}/chats`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByText(first, { exact: false }).first()).toBeVisible({
      timeout: 30000,
    })

    // Now create one OUT OF BAND (the case the removed ConversationList comment
    // cited: "created later by another tab, an MCP tool, or a test that seeds
    // before navigating here"), navigate away, and come back.
    const later = `created-later-${Date.now()}`
    await seedConversation(page, apiURL, later)
    await page.goto(`${baseURL}/settings/profile`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('main')).toBeVisible({ timeout: 30000 })
    await page.goto(`${baseURL}/chats`, { waitUntil: 'domcontentloaded' })

    await expect(page.getByText(later, { exact: false }).first()).toBeVisible({
      timeout: 30000,
    })
  })
})
