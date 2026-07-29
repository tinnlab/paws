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
 * SCOPE of the "exactly one" claim, stated honestly:
 *   - It is measured on the PRODUCTION build the harness serves (`vite preview`).
 *     Under a DEV build React.StrictMode double-invokes effects, so the surviving
 *     page effect calls `loadConversations` twice and the second call still
 *     replays via `reloadQueued`. That is a pre-existing property of the store's
 *     mid-flight guard, unchanged by this work, and not what ships.
 *   - It covers a COLD load. Re-entering `/chats` by client-side navigation while
 *     the store still holds a non-empty `searchQuery` legitimately produces a
 *     second request (the list mounts filtered, its debounce then commits the
 *     empty input). Also pre-existing and out of scope here.
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

    // Scope to the LIST ROWS. The sidebar's recent-conversations widget renders
    // the same titles from a separate `recentConversations` cursor on every
    // authenticated route, so an unscoped `getByText` would be satisfied by the
    // sidebar even if this page's own list never loaded — the assertion would
    // pass while proving nothing about /chats.
    const rows = page.getByTestId('chat-conversation-list-rows')
    await expect(rows.getByText(title, { exact: false }).first()).toBeVisible({
      timeout: 30000,
    })
    // A VISIBLE ROW inside that container is itself proof the list settled with
    // data: `chat-conversation-list-rows` is rendered only on the non-spinner
    // branch (ConversationList renders the spinner instead while
    // `loading && !isInitialized`). So a stuck-loading list cannot satisfy the
    // assertion above — no separate "not spinning" check is needed, and adding
    // one keyed on a testid the spinner does not have would be vacuous.
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

    // Prime the store: visit /chats with one conversation present.
    const first = `primed-${Date.now()}`
    await seedConversation(page, apiURL, first)
    await page.goto(`${baseURL}/chats`, { waitUntil: 'domcontentloaded' })
    const rows = page.getByTestId('chat-conversation-list-rows')
    await expect(rows.getByText(first, { exact: false }).first()).toBeVisible({
      timeout: 30000,
    })

    // Create one OUT OF BAND — the case the removed ConversationList comment
    // cited ("created later by another tab, an MCP tool, or a test that seeds
    // before navigating here").
    const later = `created-later-${Date.now()}`
    await seedConversation(page, apiURL, later)

    // Leave and return by CLIENT-SIDE navigation (sidebar links), NOT page.goto.
    // A full document navigation reloads the SPA and wipes every in-memory store,
    // which would destroy this test's whole premise: it would no longer be "the
    // store was already primed", just another cold load identical to TEST-2.
    // Clicking the nav keeps the store alive across the round trip, so this
    // genuinely exercises a remount against a primed store.
    // Out via the header's new-chat button (router `navigate('/chat')` = a
    // pushState), back via a history POP. Both are handled by the router in-page,
    // so no document is reloaded and the store survives the round trip.
    const storeAliveMarker = await page.evaluate(() => {
      ;(window as any).__SPA_MARKER__ = 'alive'
      return (window as any).__SPA_MARKER__
    })
    expect(storeAliveMarker).toBe('alive')

    await page.getByTestId('chat-history-header-new-chat-btn').click()
    await expect(page).toHaveURL(/\/chat$/, { timeout: 15000 })
    await page.goBack()
    await expect(page).toHaveURL(/\/chats$/, { timeout: 15000 })

    // Proves the round trip never reloaded the document — if it had, the marker
    // would be gone and this test would silently degrade into another cold load
    // (which is TEST-2), no longer exercising a remount against a primed store.
    expect(
      await page.evaluate(() => (window as any).__SPA_MARKER__),
      'the /chats round trip must be client-side; a full reload would wipe the ' +
        'store and destroy this test\'s premise',
    ).toBe('alive')

    // Scoped to the list rows: the sidebar's recent-conversations widget renders
    // the same titles from a separate cursor and would satisfy an unscoped match
    // even if this page's own list never refetched.
    await expect(rows.getByText(later, { exact: false }).first()).toBeVisible({
      timeout: 30000,
    })
  })
})
