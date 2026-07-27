import { test, expect } from '../../fixtures/test-context'
import { loginAsAdmin, getAdminToken, getCurrentUserToken } from '../../common/auth-helpers'
import { loginWithPerms } from '../permissions/fixtures'
import { byTestId } from '../testid'
import {
  adminUserId,
  seedConversationRun,
  seedConversationWithMessage,
  userIdForToken,
} from './helpers/background-helpers'

/**
 * Two distinct assertions about the Background surfaces live here.
 *
 * TEST-12 [acceptance / INV-2] — the design's "no global Background tasks page
 * and no Background results sidebar entry" promise, asserted against an ADMIN.
 * The admin holds the `*` wildcard, so NOTHING is permission-filtered for them:
 * if either nav entry were still registered, the admin would see it.
 *
 * TEST-13 [negative-perm] — the surfaces that DO remain are still gated. The
 * subject is created by `loginWithPerms(..., [])`, which strips the default
 * `users` group (see `permissions/fixtures.ts`) so it lacks `background::use`
 * AND `notifications::read`, leaving only profile perms.
 */
test.describe('Background surfaces — design absence + permission gating', () => {
  // Left-sidebar nav items derive `<menu-testid>-item-<id>` from the kit Menu
  // (`layout-sidebar-nav-menu`). These two ids are the ones the design removed.
  const BACKGROUND_TASKS_NAV = 'layout-sidebar-nav-menu-item-background-tasks'
  const BACKGROUND_RESULTS_NAV = 'layout-sidebar-nav-menu-item-agent-inbox'

  const appShell = (page: import('@playwright/test').Page) =>
    page
      .getByRole('button', { name: /New Chat/ })
      .or(byTestId(page, 'layout-sidebar-toggle-button'))
      .first()

  test('TEST-12 — an admin sees NEITHER background nav entry, and no global page lists runs', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, sql } = testInfra

    await loginAsAdmin(page, baseURL)
    await expect(appShell(page)).toBeVisible({ timeout: 45000 })

    // Positive control that the sidebar nav itself rendered: a sibling entry the
    // design KEPT is present. So the two absences below are genuinely "these are
    // gone", not "the menu never rendered".
    await expect(byTestId(page, 'layout-sidebar-nav-menu-item-scheduled-tasks')).toBeVisible({
      timeout: 30000,
    })

    // INV-2: neither entry exists for a user who is filtered by nothing.
    await expect(byTestId(page, BACKGROUND_TASKS_NAV)).toHaveCount(0)
    await expect(byTestId(page, BACKGROUND_RESULTS_NAV)).toHaveCount(0)

    // INV-2, the page half — asserted WITHOUT naming the deleted page's testid
    // (which no longer exists anywhere, so a `toHaveCount(0)` on it could never
    // fail). Instead: seed a conversation-LESS run — precisely what a global page
    // would list — then visit /background-tasks and assert its CARD does not
    // render. The card testid is still live (the in-conversation panel uses it),
    // so a reintroduced global page under ANY testid would fail this.
    const adminId = await adminUserId(sql)
    const detachedRun = await seedConversationRun(sql, adminId, null, {
      task: 'Detached run a global page would list',
    })
    await page.goto(`${baseURL}/background-tasks`)
    await page.waitForLoadState('load')
    await expect(byTestId(page, `background-run-card-${detachedRun}`)).toHaveCount(0)
    await expect(page.locator('[data-testid^="background-run-card-"]')).toHaveCount(0)
    await expect(byTestId(page, 'background-panel-list')).toHaveCount(0)

    // ...while the design's stated REPLACEMENT survives: the notification bell and
    // the inbox route both still work for the admin.
    await page.goto(`${baseURL}/chat`)
    await expect(appShell(page)).toBeVisible({ timeout: 45000 })
    await expect(byTestId(page, 'notification-bell-badge')).toBeVisible({ timeout: 30000 })
    await page.goto(`${baseURL}/notifications/background`)
    await expect(byTestId(page, 'agent-inbox-page')).toBeVisible({ timeout: 30000 })
  })

  test('TEST-13 — a user without background::use sees no in-conversation task surface', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL, sql } = testInfra

    // ── Positive control: an ADMIN with a run in their OWN conversation DOES see
    // the footer, so the surface exists and is reachable before we strip perms.
    await loginAsAdmin(page, baseURL)
    const adminToken = await getAdminToken(apiURL)
    const adminId = await adminUserId(sql)
    const adminConv = await seedConversationWithMessage(
      page,
      apiURL,
      adminToken,
      sql,
      'Admin conversation with a task',
    )
    await seedConversationRun(sql, adminId, adminConv, { task: 'Admin background work' })
    await page.goto(`${baseURL}/chat/${adminConv}`)
    await expect(byTestId(page, 'background-footer-open')).toBeVisible({ timeout: 30000 })

    // ── Negative subject: no group perms, only profile::{read,edit}.
    await loginWithPerms(page, baseURL, apiURL, [], 'bg-noperm')
    await expect(appShell(page)).toBeVisible({ timeout: 45000 })

    // Layer 1 (slot): the removed nav entries are absent for them too...
    await expect(byTestId(page, BACKGROUND_TASKS_NAV)).toHaveCount(0)
    await expect(byTestId(page, BACKGROUND_RESULTS_NAV)).toHaveCount(0)
    // ...and so is the bell, which rides `notifications::read`.
    await expect(byTestId(page, 'notification-bell-badge')).toHaveCount(0)

    // Layer 2 (route): /notifications/background is 403-gated (notifications::read).
    await page.goto(`${baseURL}/notifications/background`)
    await expect(byTestId(page, 'router-route-forbidden-result')).toBeVisible({
      timeout: 15000,
    })
    await expect(byTestId(page, 'agent-inbox-page')).toHaveCount(0)

    // Layers 3/4 (the in-conversation surfaces) — the leg the nav assertions
    // cannot cover, because the footer + panel are rendered inside chat.
    //
    // CRITICAL: the conversation must belong to THIS user and must HAVE a task.
    // Pointing them at the admin's conversation would confound the test — that
    // conversation is owner-scoped and would not load at all, so the absent
    // footer would be explained by the inaccessible conversation and the
    // assertion would still pass with the store's permission gate deleted.
    const subjectToken = await getCurrentUserToken(page)
    const subjectId = await userIdForToken(page, apiURL, subjectToken)
    const ownConv = await seedConversationWithMessage(
      page,
      apiURL,
      subjectToken,
      sql,
      'Restricted user’s own conversation',
    )
    await seedConversationRun(sql, subjectId, ownConv, { task: 'Their own background work' })

    await page.goto(`${baseURL}/chat/${ownConv}`)
    // The conversation itself DOES load (it is theirs) — that is the control that
    // makes the absences below attributable to `background::use` alone.
    await expect(byTestId(page, 'chat-messages')).toBeVisible({ timeout: 30000 })
    // The store self-gates on `background::use`, so no request is made, no 403 is
    // raised, and neither surface appears.
    await expect(byTestId(page, 'background-footer-open')).toHaveCount(0)
    await expect(byTestId(page, 'background-panel-list')).toHaveCount(0)
    await expect(page.locator('[data-testid^="background-run-card-"]')).toHaveCount(0)
  })
})
