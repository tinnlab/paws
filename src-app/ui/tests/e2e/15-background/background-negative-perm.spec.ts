import { test, expect } from '../../fixtures/test-context'
import { loginAsAdmin, getAdminToken } from '../../common/auth-helpers'
import { loginWithPerms } from '../permissions/fixtures'
import { byTestId } from '../testid'
import {
  adminUserId,
  seedConversationRun,
  seedConversationWithMessage,
} from './helpers/background-helpers'

/**
 * Two distinct assertions about the Background surfaces live here.
 *
 * TEST-12 [acceptance / INV-2] — the design's "no global Background tasks page
 * and no Background results sidebar entry" promise, asserted against an ADMIN.
 * The admin holds the `*` wildcard, so NOTHING is permission-filtered for them:
 * if either nav entry were still registered, the admin would see it. That is what
 * makes this an invariant proof rather than a permission check — a
 * restricted-user assertion would pass even if both entries were merely gated.
 * It also asserts the design's stated REPLACEMENT still works (the bell + the
 * `/notifications/background` deep-link it targets), so "removed" can't be
 * satisfied by deleting the replacement too.
 *
 * TEST-13 [negative-perm] — the surfaces that DO remain (the in-conversation
 * footer + Tasks panel, the bell, and the inbox route) are still gated: a user
 * stripped of the default group sees none of them. `background::use` is granted
 * to the default `users` group, so the subject is created with
 * `loginWithPerms(..., [])`, which removes it from that group (see
 * `permissions/fixtures.ts`), leaving only profile perms.
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

  test('TEST-12 — an admin sees NEITHER background nav entry, and /background-tasks is gone', async ({
    page,
    testInfra,
  }) => {
    const { baseURL } = testInfra

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

    // The route is gone too — /background-tasks no longer resolves to the page.
    await page.goto(`${baseURL}/background-tasks`)
    await expect(byTestId(page, 'background-tasks-page')).toHaveCount(0)

    // ...while the design's stated REPLACEMENT survives: the notification bell and
    // the deep-link route it targets both still work for the admin.
    await page.goto(`${baseURL}/chat`)
    await expect(appShell(page)).toBeVisible({ timeout: 45000 })
    await expect(byTestId(page, 'notification-bell-badge')).toBeVisible({ timeout: 30000 })
    await page.goto(`${baseURL}/notifications/background`)
    await expect(byTestId(page, 'agent-inbox-page')).toBeVisible({ timeout: 30000 })
  })

  test('TEST-13 — a user without the grants sees no background surface at all', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL, sql } = testInfra

    // Seed, as the ADMIN, a conversation that HAS a background run — so the
    // absence asserted below is a real gate and not "there was nothing to show".
    await loginAsAdmin(page, baseURL)
    const adminToken = await getAdminToken(apiURL)
    const adminId = await adminUserId(sql)
    const seededConv = await seedConversationWithMessage(
      page,
      apiURL,
      adminToken,
      sql,
      'Admin conversation with a run',
    )
    await seedConversationRun(sql, adminId, seededConv, { task: 'Admin background work' })

    // Positive control: the admin DOES see the footer for that conversation, so
    // the surface exists and is reachable before we strip the permission.
    await page.goto(`${baseURL}/chat/${seededConv}`)
    await expect(byTestId(page, 'background-footer-open')).toBeVisible({ timeout: 30000 })

    // Negative subject: no group perms, only profile::{read,edit}. Lacks
    // background::use AND notifications::read.
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

    // Layers 3/4 (the in-conversation surfaces): opening the admin's conversation
    // yields no background footer and no Tasks panel — the store self-gates its
    // fetch on `background::use`, so there is no request, no 403, and no
    // affordance. This is the leg the sidebar assertions cannot cover, since the
    // footer + panel are rendered inside chat rather than in the nav.
    await page.goto(`${baseURL}/chat/${seededConv}`)
    await page.waitForLoadState('load')
    await expect(byTestId(page, 'background-footer-open')).toHaveCount(0)
    await expect(byTestId(page, 'background-panel-list')).toHaveCount(0)
  })
})
