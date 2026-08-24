import { test, expect } from '../../fixtures/test-context'
import type { Page } from '@playwright/test'
import {
  loginAsAdmin,
  getAdminToken,
  createTestUser,
  login,
} from '../../common/auth-helpers'

/**
 * TEST-14 [negative-perm] [positive-control] — design item 13: the project
 * "References" entry is gone, and so is "Knowledge bases".
 *
 * The subject is an ADMIN holding `*`. The entries are gone because the MODULE
 * is hidden, not because a permission is missing: the grant revokes this branch
 * originally carried were withdrawn (they broke chat for non-admins), so every
 * user still holds `citations::use` and `knowledge_base::use`. An admin is
 * therefore the strongest possible subject for the absence claim.
 *
 * The POSITIVE CONTROL is the point of the spec. "No References entry" passes
 * vacuously when the project page never rendered — a failed route, a login
 * bounce, a crashed section all satisfy it. So the same test must also show the
 * project surface LOADING and its surviving knowledge kind ("Knowledge files",
 * contributed by the `file` module) present. That is what makes "absent" mean
 * "removed" rather than "never rendered".
 *
 * Worth stating plainly: hiding the citations MODULE does not remove this entry.
 * The contribution is registered by an eager glob owned by the PROJECTS module,
 * so it survives the module predicate entirely; the removal happens in
 * `ProjectExtensionRegistry.register()`. This spec is the end-to-end proof of
 * that, and it would still pass if the module were merely hidden — which is
 * exactly why the unit test (TEST-8) pins the registry directly.
 */

const PASSWORD = 'PawsRefsUser12345'

async function signInFreshUser(
  page: Page,
  baseURL: string,
  apiURL: string,
  username: string,
) {
  await loginAsAdmin(page, baseURL)
  const adminToken = await getAdminToken(apiURL)
  await createTestUser(
    apiURL,
    adminToken,
    username,
    `${username}@test.local`,
    PASSWORD,
    [],
  )
  await login(page, baseURL, username, PASSWORD, { completeOnboarding: true })
  await expect(page.locator('[data-testid="app-root"]')).toBeVisible({
    timeout: 15000,
  })
}

test.describe('paws feature surface — project references removed', () => {
  test('a project page loads but offers no References knowledge kind', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    // As the ADMIN, who holds `*`. If the removed knowledge kinds survived for
    // anyone it would be this user, so it is the strongest subject for the
    // absence claim — and projects are OWNER-SCOPED, so the same identity must
    // create the project and view it.
    await loginAsAdmin(page, baseURL)
    await expect(page.locator('[data-testid="app-root"]')).toBeVisible({
      timeout: 15000,
    })

    // Knowledge kinds render on the project DETAIL page, so the spec has to
    // create a project and open it. An earlier draft asserted on /projects (the
    // LIST page), where those labels could never appear regardless — vacuous.
    const adminToken = await getAdminToken(apiURL)
    const projectName = `paws-refs-${Date.now()}`
    const created = await fetch(`${apiURL}/api/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ name: projectName, description: 'paws surface test' }),
    })
    expect(created.ok, `create project: ${created.status}`).toBe(true)
    const project = await created.json()

    await page.goto(`${baseURL}/projects/${project.id}`)
    await page.waitForTimeout(2500)

    // POSITIVE CONTROL — the project DETAIL page loads AND its surviving
    // knowledge kind is present. This is what makes the absences below mean
    // "removed" rather than "the section never rendered": if the registry filter
    // were too broad and dropped `file` too, this fails.
    await expect(
      page.getByText('Knowledge files', { exact: true }).first(),
      'the surviving "Knowledge files" knowledge kind must still render — ' +
        'otherwise the absence assertions prove nothing',
    ).toBeVisible({ timeout: 15000 })

    // The removed knowledge kinds must not appear anywhere on the surface.
    for (const label of ['References', 'Knowledge bases']) {
      await expect(
        page.getByText(label, { exact: true }),
        `"${label}" must be gone from the project knowledge section`,
      ).toHaveCount(0)
    }
  })

  test('the citations and knowledge-base settings pages are unreachable', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    await signInFreshUser(page, baseURL, apiURL, 'pawsrefs2')

    for (const route of ['/settings/citations', '/knowledge']) {
      await page.goto(`${baseURL}${route}`)
      await page.waitForTimeout(1500)
      await expect(
        page.getByTestId('router-route-forbidden-result'),
        `${route} must not render the router 403 — the feature is absent, not gated`,
      ).toHaveCount(0)
    }

    // POSITIVE CONTROL, part 2 — the SAME user can still reach a settings page
    // they legitimately hold. Without this, "the route showed nothing" would be
    // indistinguishable from "this user cannot open any settings page at all".
    await page.goto(`${baseURL}/settings/assistants`)
    await page.waitForTimeout(1500)
    await expect(page.locator('[data-testid="app-root"]')).toBeVisible()
  })
})
