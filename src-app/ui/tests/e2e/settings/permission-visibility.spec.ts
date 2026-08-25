import { test, expect } from '../../fixtures/test-context'
import { loginWithPerms } from '../permissions/fixtures'
import { Permissions } from '../../../src/api-client/permissions'
import { byTestId } from '../testid.ts'

/**
 * E2E — SettingsPage sidebar permission filtering (SettingsPage.tsx:34-53). The
 * menu is built from settingsUserPages/settingsAdminPages slots filtered by
 * `isAllowed`; a user lacking a section's permission must not see its entry.
 */

test.describe('Settings — permission visibility', () => {
  test('a profile-only user sees ungated sections but not admin-gated ones', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    // Only profile perms: General (ungated) shows; Hardware (hardware::read) and
    // Users (users::read) must be filtered out of the sidebar.
    //
    // `users` replaced `web-search` as the second control here. paws hides the
    // web-search module outright, so `settings-nav-menu-item-web-search` is now
    // absent for EVERY user — the assertion would have gone on passing while
    // proving nothing about permission filtering, which is the only thing this
    // spec exists to prove. A control has to be a section that a permitted user
    // WOULD see.
    await loginWithPerms(page, baseURL, apiURL, [
      Permissions.ProfileRead,
      Permissions.ProfileEdit,
    ])

    await page.goto(`${baseURL}/settings`)
    await expect(page).toHaveURL(/\/settings\/[a-z-]+/, { timeout: 15000 })

    // Ungated user section is present.
    await expect(
      byTestId(page, 'settings-nav-menu-item-general'),
    ).toBeVisible({ timeout: 15000 })

    // Admin/permission-gated sections are NOT in this user's sidebar.
    await expect(
      byTestId(page, 'settings-nav-menu-item-hardware'),
    ).toHaveCount(0)
    await expect(
      byTestId(page, 'settings-nav-menu-item-users'),
    ).toHaveCount(0)
  })
})
