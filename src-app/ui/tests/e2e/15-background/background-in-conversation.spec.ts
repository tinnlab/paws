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
   * TEST-15 — the footer is invisible chrome-free on an ordinary chat, and
   * appears with a live indicator once the conversation has a non-terminal run.
   */
  test('the footer is absent without runs and summarises running agents with them', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL, sql } = testInfra
    await loginAsAdmin(page, baseURL)
    const token = await getAdminToken(apiURL)
    const userId = await adminUserId(sql)

    const quiet = await seedConversationWithMessage(page, apiURL, token, sql, 'Quiet chat')
    await page.goto(`${baseURL}/chat/${quiet}`)
    await expect(byTestId(page, 'chat-messages')).toBeVisible({ timeout: 30_000 })
    // The list rendered; the footer deliberately contributes nothing.
    await expect(byTestId(page, 'background-footer-open')).toHaveCount(0)

    const busy = await seedConversationWithMessage(page, apiURL, token, sql, 'Busy chat')
    await seedConversationRun(sql, userId, busy, { task: 'Long crawl', status: 'running' })
    await seedConversationRun(sql, userId, busy, { task: 'Second crawl', status: 'running' })
    await page.goto(`${baseURL}/chat/${busy}`)
    const footer = byTestId(page, 'background-footer-open')
    await expect(footer).toBeVisible({ timeout: 30_000 })
    await expect(footer).toContainText('2 agents running')
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

    const seeded = await seedConversationWithMessage(page, apiURL, token, sql, 'Paged tasks')
    const firstRun = await seedConversationRun(sql, userId, seeded, { task: 'Run 00' })
    for (let i = 1; i < 22; i++) {
      await seedConversationRun(sql, userId, seeded, {
        task: `Run ${String(i).padStart(2, '0')}`,
      })
    }

    // Populated + count + paging.
    await openTasksPanel(page, baseURL, seeded)
    await expect(byTestId(page, 'background-panel-count')).toContainText('Showing 20 of 22')
    const loadMore = byTestId(page, 'background-panel-load-more')
    await expect(loadMore).toBeVisible()
    await loadMore.click()
    await expect(byTestId(page, 'background-panel-count')).toContainText('Showing 22 of 22', {
      timeout: 15_000,
    })
    // Appended, not replaced — the first page's oldest-visible run is still there.
    await expect(byTestId(page, `background-run-card-${firstRun}`)).toBeVisible()
    await expect(loadMore).toHaveCount(0)

    // ── empty state ──────────────────────────────────────────────────────────
    // Reached the way it actually happens in production: the Tasks tab is
    // PERSISTED per conversation, so a reopened conversation rehydrates the tab
    // and refetches. If the runs are gone by then, the panel shows its empty
    // state. (There is no footer without runs, so this rehydrated tab is the only
    // route to it — which is why the state is not dead code.)
    await sql(`DELETE FROM workflow_runs WHERE conversation_id = $1`, [seeded])
    await page.reload()
    await expect(byTestId(page, 'background-panel-empty')).toBeVisible({ timeout: 30_000 })
    await expect(byTestId(page, 'background-panel-list')).toHaveCount(0)
  })

  /**
   * TEST-16 — new-rendering-context affordance audit: inside conversation A's own
   * Tasks panel, A's run card must NOT offer "Open conversation" (a no-op that,
   * in a split pane, would navigate the whole window). Its other affordances are
   * unaffected.
   */
  test('a run card in its own conversation hides the Open-conversation affordance', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL, sql } = testInfra
    await loginAsAdmin(page, baseURL)
    const token = await getAdminToken(apiURL)
    const userId = await adminUserId(sql)

    const conv = await seedConversationWithMessage(page, apiURL, token, sql, 'Self-context')
    const runId = await seedConversationRun(sql, userId, conv, { task: 'Own-context run' })

    await openTasksPanel(page, baseURL, conv)
    await expect(byTestId(page, `background-run-card-${runId}`)).toBeVisible({ timeout: 15_000 })
    await expect(byTestId(page, `background-run-open-${runId}`)).toHaveCount(0)
    // The rest of the card is intact — a running run still offers steering.
    await expect(byTestId(page, `background-run-steer-toggle-${runId}`)).toBeVisible()
  })
})
