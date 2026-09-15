import { test, expect } from '../../fixtures/test-context'
import { loginAsAdmin, getAdminToken } from '../../common/auth-helpers'
import { byTestId } from '../testid.ts'

/**
 * E2E — SkillDetailDrawer view + async SKILL.md body loading + error state
 * (SkillDetailDrawer.tsx:81-107, 226-244). Opening an installed skill renders
 * its frontmatter summary immediately and lazily fetches the SKILL.md body
 * (GET /api/skills/{id}/body), showing "Skill content (SKILL.md)" on success and
 * "Couldn't load skill content." on failure.
 */

/**
 * Wait for a skill to exist that the drawer can open.
 *
 * This used to install `io.github.ziee/effective-prompting` from the hub seed.
 * paws removed that entry — the hub UI is hidden on this instance
 * (`docs/design/paws-feature-surface.md` item 11), so a hub-only skill ships as
 * dead weight — and the install then 404'd, failing this spec for a reason
 * unrelated to the drawer.
 *
 * The built-in capability skills are a better fixture anyway: they are synced
 * on boot with a real `extracted_path` + `entry_point`, which is exactly what
 * the body endpoint under test reads, and they remove this spec's dependency on
 * the hub entirely. The sync is a spawned task, so poll rather than assume.
 */
async function waitForAnInstalledSkill(apiURL: string, token: string) {
  for (let i = 0; i < 40; i++) {
    const res = await fetch(`${apiURL}/api/skills`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) {
      const body = await res.json()
      if ((body.skills ?? []).length > 0) return
    }
    await new Promise(r => setTimeout(r, 250))
  }
  throw new Error('no skills appeared within ~10s — the boot sync never ran')
}

test.describe('Skills — detail drawer', () => {
  test('opening a skill loads its SKILL.md body', async ({ page, testInfra }) => {
    const { baseURL, apiURL } = testInfra
    await loginAsAdmin(page, baseURL)
    await waitForAnInstalledSkill(apiURL, await getAdminToken(apiURL))

    await page.goto(`${baseURL}/settings/skills`)
    const card = page.locator('[data-testid^="skill-list-card-"]').first()
    await expect(card).toBeVisible({ timeout: 30000 })
    await card.click()

    // The drawer opens and the SKILL.md body resolves (body section renders).
    const drawer = byTestId(page, 'skill-detail-sheet-loaded')
    await expect(drawer).toBeVisible({ timeout: 10000 })
    await expect(byTestId(drawer, 'skill-detail-body')).toBeVisible({
      timeout: 15000,
    })
    await expect(byTestId(drawer, 'skill-detail-body-error')).toHaveCount(0)
  })

  test('a failed SKILL.md fetch shows the error state', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    await loginAsAdmin(page, baseURL)
    await waitForAnInstalledSkill(apiURL, await getAdminToken(apiURL))

    // Force the body fetch to fail so the drawer's error branch renders.
    await page.route(/\/api\/skills\/[^/]+\/body$/, async (route, req) => {
      if (req.method() === 'GET') {
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: { message: 'boom' } }),
        })
      }
      return route.fallback()
    })

    await page.goto(`${baseURL}/settings/skills`)
    const card = page.locator('[data-testid^="skill-list-card-"]').first()
    await expect(card).toBeVisible({ timeout: 30000 })
    await card.click()

    const drawer = byTestId(page, 'skill-detail-sheet-loaded')
    await expect(drawer).toBeVisible({ timeout: 10000 })
    await expect(byTestId(drawer, 'skill-detail-body-error')).toBeVisible({
      timeout: 15000,
    })
  })
})
