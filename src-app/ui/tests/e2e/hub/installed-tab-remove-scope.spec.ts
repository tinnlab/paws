import { test, expect } from '../../fixtures/test-context'
import { loginAsAdmin } from '../../common/auth-helpers'
import { loginWithPerms } from '../permissions/fixtures'
import { Permissions } from '../../../src/api-client/permissions'
import { navigateToHub, waitForHubDataLoad } from './helpers/hub-navigation'
import { createAssistantFromHub, getAssistantCards } from './helpers/hub-assistants'

/**
 * E2E — the Hub "Installed" tab must never present a Remove control that
 * cannot succeed.
 *
 * Two dead affordances lived here:
 *
 *  1. A TEMPLATE install (`Use as Template` → `assistants` row with
 *     `created_by IS NULL`) was sent to the USER route
 *     `DELETE /api/assistants/{id}`, whose ownership check rejects
 *     `created_by != caller` with 403 ACCESS_DENIED "You can only delete your
 *     own assistants". No caller — admin included — could ever complete it.
 *     It has to go to `DELETE /api/assistant-templates/{id}`.
 *
 *  2. Remove was rendered regardless of whether the caller holds the DELETE
 *     endpoint's permission, so a read/install-only user got a button that
 *     could only 403.
 *
 * `installed-tab-actions.spec.ts` covers the happy user-scoped path; this spec
 * covers the system-scoped path and the permission gate.
 */

test.describe('Hub — Installed tab Remove is scope- and permission-correct', () => {
  test('Remove on a TEMPLATE install hits the template endpoint and succeeds', async ({
    page,
    testInfra,
  }) => {
    const { baseURL } = testInfra
    await loginAsAdmin(page, baseURL)

    // --- Install a hub assistant as a system-wide TEMPLATE ---------------
    await navigateToHub(page, baseURL, 'assistants')
    await waitForHubDataLoad(page)

    const firstCard = (await getAssistantCards(page)).first()
    await expect(firstCard).toBeVisible({ timeout: 15000 })

    const templateBtn = firstCard.getByRole('button', {
      name: 'Use as Template',
    })
    await expect(templateBtn).toBeVisible({ timeout: 10000 })
    await templateBtn.click()

    await expect(
      page.locator('[data-sonner-toast][data-type="success"]').first(),
    ).toBeVisible({ timeout: 15000 })

    // --- The Installed tab shows it as a System-scoped row ---------------
    await page.goto(`${baseURL}/hub/installed`)
    await expect(page).toHaveURL(/\/hub\/installed/)

    const row = page.getByTestId(/^hub-installed-row-/).first()
    await expect(row).toBeVisible({ timeout: 15000 })
    // Prove this is the template (created_by IS NULL) row, not a personal copy.
    await expect(row.getByTestId(/^hub-installed-system-tag-/)).toBeVisible()

    // --- Remove is offered, enabled, and actually completes ---------------
    const removeBtn = row.getByRole('button', { name: 'Remove' })
    await expect(removeBtn).toBeVisible()
    await expect(removeBtn).toBeEnabled()

    await removeBtn.click()
    const confirmOk = page.locator(
      '[data-testid^="hub-installed-remove-confirm-"][data-testid$="-confirm"]',
    )
    await expect(confirmOk).toBeVisible({ timeout: 5000 })

    // The request MUST go to the template route. Before the fix it went to
    // `/api/assistants/{id}` and came back 403, so this wait times out.
    const deleteResp = page.waitForResponse(
      r =>
        /\/api\/assistant-templates\//.test(r.url()) &&
        r.request().method() === 'DELETE',
      { timeout: 15000 },
    )
    await confirmOk.click()

    const resp = await deleteResp
    expect(resp.status()).toBeLessThan(300)

    await expect(
      page.locator('[data-sonner-toast][data-type="success"]').first(),
    ).toBeVisible({ timeout: 10000 })
    await expect(page.getByTestId(/^hub-installed-row-/)).toHaveCount(0, {
      timeout: 15000,
    })
  })

  test('Remove is not offered to a user without the delete permission', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra

    // Read + install, but deliberately NO `assistants::delete`. This user can
    // legitimately create a personal hub install and see it on the Installed
    // tab; deleting it is what they cannot do.
    await loginWithPerms(
      page,
      baseURL,
      apiURL,
      [
        Permissions.HubAssistantsRead,
        Permissions.HubAssistantsVersionRead,
        Permissions.HubAssistantsCreate,
        Permissions.AssistantsRead,
        Permissions.AssistantsCreate,
      ],
      'nodelete',
    )

    await navigateToHub(page, baseURL, 'assistants')
    await waitForHubDataLoad(page)

    const firstCard = (await getAssistantCards(page)).first()
    await expect(firstCard).toBeVisible({ timeout: 15000 })
    const testId = await firstCard.getAttribute('data-testid')
    const hubAssistantId = testId?.replace('hub-assistant-card-', '') ?? ''
    expect(hubAssistantId).toBeTruthy()

    await createAssistantFromHub(page, hubAssistantId)

    // --- The install is listed, but carries no Remove affordance ----------
    await page.goto(`${baseURL}/hub/installed`)
    await expect(page).toHaveURL(/\/hub\/installed/)

    const row = page.getByTestId(/^hub-installed-row-/).first()
    await expect(row).toBeVisible({ timeout: 15000 })

    await expect(row.getByRole('button', { name: 'Remove' })).toHaveCount(0)
    // Re-install stays — that one they DO hold the permission for, so the page
    // still distinguishes what this user can and cannot do.
    await expect(
      row.getByRole('button', { name: 'Re-install' }),
    ).toBeVisible()
  })
})
