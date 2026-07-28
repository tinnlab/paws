import { expect, test } from '../../fixtures/test-context'
import { loginAsAdmin } from '../../common/auth-helpers'
import { byTestId } from '../testid'
import {
  collectStarvedLabels,
  describeStarvedLabel,
  measureLabels,
} from '../helpers/label-starvation'

/**
 * E2E — `/settings/scheduler` layout fidelity, against the REAL backend.
 *
 * The reported defect: "the form layout is horrendous and does not look like any
 * other settings pages" — every label wrapped to one word per line beside a
 * ~780px input for a two-digit number, and the Save floated inside the card body.
 *
 * This spec pins the fixed composition to the house conventions it must now
 * match (`file-rag`'s RetrievalLimitsSection + `auth`'s SessionSettingsPage):
 * a fixed label column, bounded numeric controls, Save/Cancel in the card
 * FOOTER, dirty-gated Save, a stacked (not starved) mobile render, and a real
 * save round-trip that survives a reload.
 *
 * No `page.route()` mocking — the real GET/PUT /api/scheduler/admin-settings is
 * exercised.
 */

const SCHEDULER_TESTIDS = [
  'scheduler-max-active',
  'scheduler-min-interval',
  'scheduler-max-horizon',
  'scheduler-max-failures',
  'scheduler-retention',
] as const

/** The five Limits labels, verbatim — the units live in the control `suffix`. */
const LIMIT_LABELS = [
  'Max active tasks per user',
  'Minimum interval',
  'Self-paced loop horizon',
  'Auto-pause after',
  'Notification retention',
] as const

async function openSettings(page: import('@playwright/test').Page, baseURL: string) {
  await page.goto(`${baseURL}/settings/scheduler`)
  await expect(byTestId(page, 'scheduler-admin-page')).toBeVisible({ timeout: 20000 })
  // The form seeds from the store after the GET resolves.
  await expect(byTestId(page, 'scheduler-max-active')).not.toHaveValue('', {
    timeout: 20000,
  })
}

test('TEST-5a: desktop — labels are not starved and numeric controls are bounded', async ({
  page,
  testInfra,
}) => {
  const { baseURL } = testInfra
  await page.setViewportSize({ width: 1280, height: 900 })
  await loginAsAdmin(page, baseURL)
  await openSettings(page, baseURL)

  // (a) no starved label anywhere on the page
  const starved = await collectStarvedLabels(page)
  expect(
    starved.map(describeStarvedLabel),
    'the Limits form must not starve its label column',
  ).toEqual([])

  // …and specifically: each of the FIVE Limits labels is present and fits on ONE
  // or TWO lines. Scoped to the five known texts on purpose — a page-wide "every
  // multi-word label" assertion would blame this page for an unrelated label in
  // the shared settings chrome.
  const measured = await measureLabels(page)
  for (const text of LIMIT_LABELS) {
    const m = measured.find(x => x.text === text)
    expect(m, `the Limits form renders the "${text}" label`).toBeTruthy()
    expect(m!.lines, `"${text}" wrapped to ${m!.lines} lines`).toBeLessThanOrEqual(2)
  }

  // (b) a two-digit limit does not sit in a full-bleed box — the house numeric
  // width is `w-40` (160px); allow headroom for the unit suffix + borders.
  for (const id of SCHEDULER_TESTIDS) {
    const box = await byTestId(page, id).boundingBox()
    expect(box, `${id} is rendered`).toBeTruthy()
    expect(box!.width, `${id} width`).toBeLessThanOrEqual(260)
  }
})

test('TEST-5b: Save/Cancel live in the card footer and Save is dirty-gated', async ({
  page,
  testInfra,
}) => {
  const { baseURL } = testInfra
  await page.setViewportSize({ width: 1280, height: 900 })
  await loginAsAdmin(page, baseURL)
  await openSettings(page, baseURL)

  const save = byTestId(page, 'scheduler-admin-save')
  const cancel = byTestId(page, 'scheduler-admin-cancel')
  await expect(save).toBeVisible()
  await expect(cancel).toBeVisible()

  // Both actions are in the card FOOTER (below the form), not inside the body.
  const form = await byTestId(page, 'scheduler-admin-form').boundingBox()
  const saveBox = await save.boundingBox()
  expect(form && saveBox).toBeTruthy()
  expect(saveBox!.y, 'Save sits below the form (card footer)').toBeGreaterThanOrEqual(
    form!.y + form!.height - 2,
  )
  // Cancel precedes Save on the same row (SettingsFormActions order).
  const cancelBox = await cancel.boundingBox()
  expect(Math.abs(cancelBox!.y - saveBox!.y)).toBeLessThan(8)

  // Pristine → Save disabled; after an edit → enabled.
  await expect(save).toBeDisabled()
  const maxActive = byTestId(page, 'scheduler-max-active')
  await maxActive.fill('37')
  await expect(save).toBeEnabled()

  // Cancel restores the loaded value and re-disables Save.
  await cancel.click()
  await expect(save).toBeDisabled()
  await expect(maxActive).not.toHaveValue('37')
})

test('TEST-5c: mobile (390px) — the form stacks, nothing is starved, no h-overflow', async ({
  page,
  testInfra,
}) => {
  const { baseURL } = testInfra
  await page.setViewportSize({ width: 390, height: 844 })
  await loginAsAdmin(page, baseURL)
  await openSettings(page, baseURL)

  const starved = await collectStarvedLabels(page)
  expect(starved.map(describeStarvedLabel), 'no starved label at 390px').toEqual([])

  // Stacked: the first label's bottom is ABOVE the control's top (label above
  // control), rather than sharing a row with it.
  const geom = await page.evaluate(() => {
    const input = document.querySelector('[data-testid="scheduler-max-active"]')
    const row = input?.closest('[data-slot="field"]')
    const label = row?.querySelector('[data-slot="field-label"]')
    if (!input || !label) return null
    const i = input.getBoundingClientRect()
    const l = label.getBoundingClientRect()
    return { labelBottom: l.bottom, inputTop: i.top }
  })
  expect(geom, 'the first field row resolves').toBeTruthy()
  expect(geom!.labelBottom, 'label stacks above the control at 390px').toBeLessThanOrEqual(
    geom!.inputTop + 1,
  )

  // No horizontal document overflow.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow, 'no horizontal page overflow at 390px').toBeLessThanOrEqual(1)
})

test('TEST-5e: the pre-data window shows a loading state, never fabricated defaults', async ({
  page,
  testInfra,
}) => {
  const { baseURL } = testInfra
  await page.setViewportSize({ width: 1280, height: 900 })
  await loginAsAdmin(page, baseURL)

  // THROTTLE, not mock: the REAL backend still serves the real body (route.continue),
  // we only hold it long enough to observe what the page renders meanwhile. This is
  // the window the store's `loading:false` initial state leaves open — `useForm`'s
  // `defaultValues` are the server's own defaults (20/300/7/5/30), so a form painted
  // here would show plausible, authoritative-looking numbers it does not have, and a
  // single edit + Save would PUT the other four over the real row.
  await page.route(/\/api\/scheduler\/admin-settings$/, async route => {
    if (route.request().method() === 'GET') await new Promise(r => setTimeout(r, 4000))
    await route.continue()
  })

  await page.goto(`${baseURL}/settings/scheduler`)

  // While the GET is held: a loading state, and NO form/inputs/Save. (The
  // loading branch renders the page shell WITHOUT `scheduler-admin-page` — that
  // testid marks the loaded page — so assert on the Spin's accessible name.)
  await expect(page.getByRole('status', { name: 'Loading scheduler settings' })).toBeVisible({
    timeout: 20000,
  })
  await expect(byTestId(page, 'scheduler-max-active')).toHaveCount(0)
  await expect(byTestId(page, 'scheduler-admin-save')).toHaveCount(0)

  // …and once it lands, the real row renders.
  await expect(byTestId(page, 'scheduler-max-active')).toBeVisible({ timeout: 20000 })
  await expect(byTestId(page, 'scheduler-max-active')).not.toHaveValue('')
})

test('TEST-5d: editing a limit saves and survives a reload', async ({ page, testInfra }) => {
  const { baseURL } = testInfra
  await page.setViewportSize({ width: 1280, height: 900 })
  await loginAsAdmin(page, baseURL)
  await openSettings(page, baseURL)

  // A value that is NOT the server/form default (20), so a green result cannot
  // come from the defaultValues seed.
  await byTestId(page, 'scheduler-max-active').fill('37')
  await byTestId(page, 'scheduler-retention').fill('11')
  await byTestId(page, 'scheduler-admin-save').click()

  await page.reload()
  await openSettings(page, baseURL)
  await expect(byTestId(page, 'scheduler-max-active')).toHaveValue('37')
  await expect(byTestId(page, 'scheduler-retention')).toHaveValue('11')

  // restore the deployment default so the shared backend isn't left mutated
  await byTestId(page, 'scheduler-max-active').fill('20')
  await byTestId(page, 'scheduler-retention').fill('30')
  await byTestId(page, 'scheduler-admin-save').click()
  await expect(byTestId(page, 'scheduler-admin-save')).toBeDisabled()
})
