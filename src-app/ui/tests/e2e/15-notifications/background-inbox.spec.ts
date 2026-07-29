import { test, expect } from '../../fixtures/test-context'
import { loginAsAdmin } from '../../common/auth-helpers'
import { byTestId } from '../testid'

/**
 * TEST-129 (ITEM-26) — the agent/background inbox ("Background results").
 *
 * asserts (TESTS.md): the inbox lists live task status + result; needs_input
 * bubbled top w/ reply; light/dark + 390px.
 *
 * The no-LLM half proven here (the task's core ask): the `/notifications/background`
 * AgentInboxPage — a focused VIEW over the shared notification inbox, narrowed to
 * the agent/background kinds (`AGENT_INBOX_KINDS`) — LISTS a real agent
 * notification and renders at a 390px mobile width. Notifications are
 * server-emitted (no create API), so the row is seeded directly into the per-test
 * DB via `sql()` — the page's mount-time `load()` then fetches it through the real
 * REST endpoint.
 *
 * UPDATED: there is no longer a "Background results" sidebar nav entry — the
 * BELL is the single central surface for background/agent results and the
 * `/notifications/background` route is its deep-link target. This spec therefore
 * asserts the bell-based route into the inbox (and the absence of the old nav
 * entry) instead of a nav click. Permission gating for both is asserted by
 * `15-background/background-negative-perm.spec.ts`.
 *
 * ("needs_input bubbled top w/ reply" is a live `waiting` background-run state and
 * is reported separately; the inbox here proves the listing + gating + responsive.)
 */
test.describe('Agent/background inbox — lists agent notifications (ITEM-26)', () => {
  test('lists a seeded agent notification reached from the bell, renders at 390px', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL, sql } = testInfra
    void apiURL

    await loginAsAdmin(page, baseURL)

    // The "Background results" nav entry is GONE by design; the bell replaces it.
    // The admin holds `*`, so this absence is the design, not a permission filter.
    await expect(byTestId(page, 'layout-sidebar-nav-menu-item-agent-inbox')).toHaveCount(0)
    await expect(byTestId(page, 'notification-bell-badge')).toBeVisible({ timeout: 30000 })

    // Seed a real agent-kind notification for the admin (kind ∈ AGENT_INBOX_KINDS).
    const adminId = (
      await sql(`SELECT id FROM users WHERE username = 'admin' LIMIT 1`)
    ).rows[0].id as string
    const title = 'Weekly digest ran'
    const body = '3 new CRISPR papers since last run.'
    const inserted = await sql(
      `INSERT INTO notifications (user_id, kind, title, body, interrupt, payload)
       VALUES ($1, 'scheduled_task_result', $2, $3, true, '{}'::jsonb)
       RETURNING id`,
      [adminId, title, body],
    )
    const notifId = inserted.rows[0].id as string

    // The BELL is the route in: open it and use its "View all" affordance, which
    // is how a user reaches background results now that the nav entry is gone.
    await page.reload()
    await byTestId(page, 'notification-bell-badge').click()
    const viewAll = byTestId(page, 'notification-bell-view-all')
    await expect(viewAll).toBeVisible({ timeout: 15000 })
    await viewAll.click()
    await expect(page).toHaveURL(/\/notifications/, { timeout: 15000 })

    // The AgentInboxPage loads the inbox on entry and narrows to agent kinds.
    await page.goto(`${baseURL}/notifications/background`)
    await expect(byTestId(page, 'agent-inbox-page')).toBeVisible({ timeout: 30000 })

    // The seeded agent notification is listed (card + its content). Scope the text
    // to the card — the same notification also feeds the app-shell bell, so a bare
    // getByText would be a strict-mode multi-match.
    const card = byTestId(page, `agent-inbox-card-${notifId}`)
    await expect(card).toBeVisible({ timeout: 15000 })
    await expect(card).toContainText(title)
    await expect(card).toContainText(body)

    // Renders at a 390px mobile width (the card + page survive the narrow viewport).
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(byTestId(page, 'agent-inbox-page')).toBeVisible()
    await expect(card).toBeVisible()
    await expect(card).toContainText(title)
  })
})
