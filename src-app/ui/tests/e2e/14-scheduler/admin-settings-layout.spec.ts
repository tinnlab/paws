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

  // …and specifically: every Limits label fits on ONE or TWO lines.
  const labels = (await measureLabels(page)).filter(m => m.words >= 2)
  expect(labels.length, 'the Limits form renders multi-word labels').toBeGreaterThanOrEqual(5)
  for (const m of labels) {
    expect(m.lines, `"${m.text}" wrapped to ${m.lines} lines`).toBeLessThanOrEqual(2)
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
