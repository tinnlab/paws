import { test, expect } from '../../fixtures/test-context'
import { loginAsAdmin, getAdminToken } from '../../common/auth-helpers'
import { byTestId } from '../testid'
import {
  adminUserId,
  openTasksPanel,
  seedConversationRun,
  seedConversationWithMessage,
} from './helpers/background-helpers'

/**
 * The in-conversation background surfaces: the `message_list_footer` affordance
 * and the right-panel "Tasks" tab it opens.
 *
 * Runs are seeded directly into `workflow_runs` (there is no create API — the
 * agent/sandbox backbone spawns them) and then read back by the UI through the
 * REAL `GET /api/background/runs?conversation_id=…` endpoint, so the disjoint
 * server-side scope, the store slice, the panel renderer registration and the
 * slot are all exercised end-to-end. No API mocking.
 */
test.describe('background runs — in conversation (Tasks panel + footer)', () => {
  /**
   * TEST-11 [acceptance / INV-1] — a CONVERSATION's sub-agents appear IN that
   * conversation, and nowhere else.
   *
   * Two conversations, one run each. Each conversation's Tasks panel must show
   * its OWN run and NOT the other's. This is the executable form of the design's
   * disjoint-scoping promise: it fails if the runs were surfaced globally (both
   * panels would list both runs) or if the scope were dropped anywhere between
   * the panel, the store and the endpoint.
   */
  test('each conversation shows only its own sub-agent runs', async ({ page, testInfra }) => {
    const { baseURL, apiURL, sql } = testInfra
    await loginAsAdmin(page, baseURL)
    const token = await getAdminToken(apiURL)
    const userId = await adminUserId(sql)

    const convA = await seedConversationWithMessage(page, apiURL, token, sql, 'Conversation A')
    const convB = await seedConversationWithMessage(page, apiURL, token, sql, 'Conversation B')

    const runA = await seedConversationRun(sql, userId, convA, { task: 'Analyse dataset A' })
    const runB = await seedConversationRun(sql, userId, convB, { task: 'Analyse dataset B' })

    // Conversation A: its own run, never B's.
    await openTasksPanel(page, baseURL, convA)
    await expect(byTestId(page, `background-run-card-${runA}`)).toBeVisible({ timeout: 15_000 })
    await expect(byTestId(page, `background-run-card-${runB}`)).toHaveCount(0)

    // Conversation B: the mirror image — proves A's result was not just "the only
    // runs that existed".
    await openTasksPanel(page, baseURL, convB)
    await expect(byTestId(page, `background-run-card-${runB}`)).toBeVisible({ timeout: 15_000 })
    await expect(byTestId(page, `background-run-card-${runA}`)).toHaveCount(0)
  })

  /**
   * TEST-15 — the footer adds NO chrome to an ordinary chat, and appears with a
   * live indicator once the conversation has a non-terminal task.
   */
  test('the footer is absent without tasks and summarises running ones with them', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL, sql } = testInfra
    await loginAsAdmin(page, baseURL)
    const token = await getAdminToken(apiURL)
    const userId = await adminUserId(sql)

    const quiet = await seedConversationWithMessage(page, apiURL, token, sql, 'Quiet chat')
    // Wait for the footer's OWN round-trip to resolve before asserting absence —
    // otherwise a regression that rendered the row for a zero-task conversation
    // would still satisfy the assertion by firing before the fetch landed.
    const [quietResponse] = await Promise.all([
      page.waitForResponse(
        r =>
          r.url().includes('/api/background/runs') &&
          r.url().includes(`conversation_id=${quiet}`),
        { timeout: 30_000 },
      ),
      page.goto(`${baseURL}/chat/${quiet}`),
    ])
    expect(quietResponse.status()).toBe(200)
    await expect(byTestId(page, 'chat-messages')).toBeVisible({ timeout: 30_000 })
    // The list rendered and the scope was fetched; the footer deliberately
    // contributes nothing for a conversation with no tasks.
    await expect(byTestId(page, 'background-footer-open')).toHaveCount(0)

    const busy = await seedConversationWithMessage(page, apiURL, token, sql, 'Busy chat')
    await seedConversationRun(sql, userId, busy, { task: 'Long crawl', status: 'running' })
    await seedConversationRun(sql, userId, busy, { task: 'Second crawl', status: 'running' })
    await page.goto(`${baseURL}/chat/${busy}`)
    const footer = byTestId(page, 'background-footer-open')
    await expect(footer).toBeVisible({ timeout: 30_000 })
    // The label counts from the SERVER total (not just the loaded page), so a
    // conversation with more tasks than one page cannot under-report.
    await expect(footer).toContainText('2 of 2 tasks running')
  })

  /**
   * TEST-14 — the panel's real states: empty for a conversation with no runs,
   * populated with a "Showing N of M" count, and a Load-more that APPENDS the
   * next page (page size is 20, so 22 runs span two pages).
   */
  test('the panel renders empty, populated, and pages with Load more', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL, sql } = testInfra
    await loginAsAdmin(page, baseURL)
    const token = await getAdminToken(apiURL)
    const userId = await adminUserId(sql)

    // 22 runs → two pages at PANEL_PAGE_SIZE=20. The list is newest-first, so
    // the FIRST-inserted run lands on page 2 and the LAST-inserted on page 1 —
    // holding both ids lets us prove the second page was APPENDED to the first
    // rather than replacing it.
    const seeded = await seedConversationWithMessage(page, apiURL, token, sql, 'Paged tasks')
    const oldestRun = await seedConversationRun(sql, userId, seeded, { task: 'Run 00' })
    let newestRun = oldestRun
    for (let i = 1; i < 22; i++) {
      newestRun = await seedConversationRun(sql, userId, seeded, {
        task: `Run ${String(i).padStart(2, '0')}`,
      })
    }

    // Populated + count + paging.
    await openTasksPanel(page, baseURL, seeded)
    await expect(byTestId(page, 'background-panel-count')).toContainText('Showing 20 of 22')
    // Page 1 holds the newest run and NOT the oldest (which is on page 2).
    await expect(byTestId(page, `background-run-card-${newestRun}`)).toBeVisible()
    await expect(byTestId(page, `background-run-card-${oldestRun}`)).toHaveCount(0)

    const loadMore = byTestId(page, 'background-panel-load-more')
    await expect(loadMore).toBeVisible()
    await loadMore.click()
    await expect(byTestId(page, 'background-panel-count')).toContainText('Showing 22 of 22', {
      timeout: 15_000,
    })
    // APPENDED, not replaced: page 2's oldest run has arrived AND page 1's
    // newest run is still on screen. Asserting only the former would also pass
    // if the second page had replaced the first.
    await expect(byTestId(page, `background-run-card-${oldestRun}`)).toBeVisible()
    await expect(byTestId(page, `background-run-card-${newestRun}`)).toBeVisible()
    await expect(loadMore).toHaveCount(0)

    // ── empty state ──────────────────────────────────────────────────────────
    // Reached the way it actually happens in production: the Tasks tab is
    // PERSISTED per conversation, so a reopened conversation rehydrates the tab
    // and refetches. If the tasks are gone by then, the panel shows its empty
    // state. (There is no footer without tasks, so this rehydrated tab is the only
    // route to it — which is why the state is not dead code.)
    //
    // This leg is only meaningful because the panel's empty branch is gated on
    // "fetched AND empty" (`runs !== undefined`), not on `loaded.length === 0`:
    // with the latter, the pre-fetch first paint rendered `background-panel-empty`
    // for a frame and the assertion below passed no matter what the server said.
    // The populated assertions above are the control that the fetch works at all.
    await sql(`DELETE FROM workflow_runs WHERE conversation_id = $1`, [seeded])
    await page.reload()
    // The list must genuinely go away, and the empty state must appear AFTER the
    // refetch resolved (the spinner is what renders before it).
    await expect(byTestId(page, 'background-panel-empty')).toBeVisible({ timeout: 30_000 })
    await expect(byTestId(page, 'background-panel-list')).toHaveCount(0)
    await expect(byTestId(page, `background-run-card-${newestRun}`)).toHaveCount(0)
  })

  /**
   * TEST-16 — new-rendering-context affordance audit. The card inside the Tasks
   * panel must NOT offer "Open conversation": every task the panel lists belongs
   * to the conversation the user is already reading (the endpoint's disjoint
   * scope guarantees it), so the button was a no-op that, inside a split pane,
   * would have navigated the whole window. It is therefore removed from the card
   * outright rather than conditionally hidden.
   *
   * The assertion is paired with a POSITIVE control on the affordances that DO
   * remain, so it cannot pass by the card failing to render at all.
   */
  test('a run card offers steer/cancel but no Open-conversation navigation', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL, sql } = testInfra
    await loginAsAdmin(page, baseURL)
    const token = await getAdminToken(apiURL)
    const userId = await adminUserId(sql)

    const conv = await seedConversationWithMessage(page, apiURL, token, sql, 'Self-context')
    const runId = await seedConversationRun(sql, userId, conv, { task: 'Own-context task' })

    await openTasksPanel(page, baseURL, conv)
    await expect(byTestId(page, `background-run-card-${runId}`)).toBeVisible({ timeout: 15_000 })

    // Positive control: the card rendered its real affordances...
    await expect(byTestId(page, `background-run-steer-toggle-${runId}`)).toBeVisible()
    await expect(byTestId(page, `background-run-cancel-${runId}`)).toBeVisible()
    // ...and there is no navigate-away affordance anywhere in the panel.
    await expect(byTestId(page, `background-run-open-${runId}`)).toHaveCount(0)
    await expect(page.locator('[data-testid^="background-run-open-"]')).toHaveCount(0)
  })
})
