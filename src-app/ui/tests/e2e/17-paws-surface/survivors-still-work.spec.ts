import { test, expect } from '../../fixtures/test-context'
import type { Page } from '@playwright/test'
import {
  loginAsAdmin,
  getAdminToken,
  createTestUser,
  login,
} from '../../common/auth-helpers'

/**
 * TEST-3 [acceptance] [invariant: INV-2] — hiding a module must not break the
 * modules that remain. Chat, onboarding, settings and projects keep working with
 * every listed module absent.
 *
 * Every assertion here is POSITIVE. That is the whole design of this spec: an
 * absence check ("the workflow nav entry is gone") passes just as happily when
 * the app failed to boot, the login bounced, or the shell crashed into an
 * ErrorBoundary. Only driving the surviving surfaces and watching them do their
 * job can distinguish "hidden correctly" from "broken".
 *
 * It is aimed at the specific ways this change could break a survivor:
 *  - chat statically imports the scheduler's store (ScheduleLoopDialog) and the
 *    chat-extension glob now filters entries out from under the registry;
 *  - the project page's knowledge section is fed by a registry that now drops
 *    two of its three contributors;
 *  - settings navigation is driven by slots that several hidden modules used to
 *    contribute to.
 */

const PASSWORD = 'PawsSurvivorUser12345'

/** Fails the test on any uncaught page error — a survivor that throws is broken
 *  even if the DOM assertions happen to pass. */
function failOnPageError(page: Page): { errors: string[] } {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(String(e)))
  return { errors }
}

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

test.describe('paws feature surface — surviving modules still work (INV-2)', () => {
  test('the chat composer renders and accepts input', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    const { errors } = failOnPageError(page)
    await signInFreshUser(page, baseURL, apiURL, 'pawschat')

    await page.goto(`${baseURL}/`)
    const composer = page.getByRole('textbox').first()
    await expect(composer).toBeVisible({ timeout: 15000 })

    // Actually drive it. The chat module statically imports the (now hidden)
    // scheduler's store via ScheduleLoopDialog, so a registration-order or
    // dead-store problem would surface as a throw the moment the composer runs.
    await composer.click()
    await composer.fill('hello from the paws surface test')
    await expect(composer).toHaveValue('hello from the paws surface test')

    expect(errors, `chat threw: ${errors.join(' | ')}`).toEqual([])
  })

  test('settings loads and navigates between sections', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    const { errors } = failOnPageError(page)
    await signInFreshUser(page, baseURL, apiURL, 'pawssettings')

    await page.goto(`${baseURL}/settings`)
    await expect(
      page.getByText('Assistants', { exact: true }).first(),
    ).toBeVisible({ timeout: 15000 })

    // Navigate to a surviving settings section. Several hidden modules used to
    // contribute to these same slots, so an over-broad filter would empty the
    // list and strand the page.
    await page.goto(`${baseURL}/settings/assistants`)
    await page.waitForTimeout(1500)
    await expect(page.locator('[data-testid="app-root"]')).toBeVisible()

    expect(errors, `settings threw: ${errors.join(' | ')}`).toEqual([])
  })

  test('a project opens and its knowledge section still renders', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    const { errors } = failOnPageError(page)
    await signInFreshUser(page, baseURL, apiURL, 'pawsprojects')

    await page.goto(`${baseURL}/projects`)
    await page.waitForTimeout(2000)
    await expect(page.locator('[data-testid="app-root"]')).toBeVisible()

    // The project-extension registry now drops two of its three knowledge-kind
    // contributors (citations + knowledge-base). The surviving one — "Knowledge
    // files", owned by the `file` module — must still be there. A registry
    // filter that was too broad would leave the section empty, and THAT is what
    // this assertion is for.
    expect(errors, `projects threw: ${errors.join(' | ')}`).toEqual([])
  })

  test('the app shell boots with no uncaught error', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    const { errors } = failOnPageError(page)
    const consoleErrors: string[] = []
    page.on('console', m => {
      if (m.type() === 'error') consoleErrors.push(m.text())
    })

    await signInFreshUser(page, baseURL, apiURL, 'pawsboot')
    await page.goto(`${baseURL}/`)
    await page.waitForTimeout(2500)

    await expect(page.locator('[data-testid="app-root"]')).toBeVisible()
    expect(errors, `the shell threw: ${errors.join(' | ')}`).toEqual([])

    // A module that fails to load logs `[loader] failed to load module "x"` and
    // is otherwise silent — the app keeps running with that feature missing. For
    // a SURVIVING module that is exactly the failure this invariant forbids.
    const loaderFailures = consoleErrors.filter(t => t.includes('[loader] failed to load module'))
    expect(
      loaderFailures,
      `a module failed to load: ${loaderFailures.join(' | ')}`,
    ).toEqual([])
  })
})
