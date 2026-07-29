import { test, expect } from '../../fixtures/test-context'
import { loginAsAdmin, getAdminToken } from '../../common/auth-helpers'
import { byTestId } from '../testid'

/**
 * Memory admin — the master MemorySection card's deployment-wide enable toggle
 * (MemorySection.tsx). Memory ships OFF by default deployment-wide: the seed
 * migration (`memory/migrations/…_memory_seed.sql`) writes `enabled = false`
 * because memory is a privacy-safe deployment-wide OPT-IN (CLAUDE.md: "default
 * OFF"). This asserts that real default and that the master switch persists a
 * change in BOTH directions.
 */
test.describe('Memory admin — master enable toggle', () => {
  test('toggling the master switch on/off and saving persists the change', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    await loginAsAdmin(page, baseURL)

    await page.goto(`${baseURL}/settings/memory-admin`)
    const masterSwitch = byTestId(page, 'memory-admin-enabled-switch')
    await expect(masterSwitch).toBeVisible({ timeout: 20000 })

    // Memory is OFF by default deployment-wide (the seed migration writes
    // `enabled = false` — a deployment-wide opt-in).
    await expect(masterSwitch).toHaveAttribute('aria-checked', 'false')

    const token = await getAdminToken(apiURL)
    const readEnabled = async () => {
      const res = await page.request.get(
        `${apiURL}/api/memory/admin-settings`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
      return (await res.json()).enabled
    }
    expect(await readEnabled()).toBe(false)

    // Turn it ON and save → server persists enabled=true.
    await masterSwitch.click()
    await expect(masterSwitch).toHaveAttribute('aria-checked', 'true')
    await byTestId(page, 'memory-admin-master-save-btn').click()
    await expect(page.locator('[data-sonner-toast]')).toContainText(
      'Memory settings saved.',
    )
    await expect.poll(readEnabled, { timeout: 10000 }).toBe(true)

    // …and back OFF again → server persists enabled=false.
    await masterSwitch.click()
    await expect(masterSwitch).toHaveAttribute('aria-checked', 'false')
    await byTestId(page, 'memory-admin-master-save-btn').click()
    await expect.poll(readEnabled, { timeout: 10000 }).toBe(false)
  })
})
