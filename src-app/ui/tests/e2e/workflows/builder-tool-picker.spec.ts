import type { APIRequestContext, Page } from '@playwright/test'
import { test, expect } from '../../fixtures/test-context'
import { loginAsAdmin, getAdminToken } from '../../common/auth-helpers'
import { byTestId } from '../testid'
import {
  addStep,
  openNewBuilder,
  saveBuilder,
  waitBuilderValid,
} from './helpers/builder-helpers'
import {
  MockBuilderToolsServer,
  MOCK_TOOL_NAMES,
  SEARCH_PROPERTY_NAMES,
} from './helpers/builder-tools-mock-server'

/**
 * TEST-4 / TEST-5 / TEST-6 / TEST-7 — the acceptance proofs for the tool step's
 * authoring surface (DESIGN §2.3 / §2.4 / §2.6 / §2.5 ⇒ INV-3..INV-6).
 *
 * These assert the DESIGN's promise, not the implementation's behavior:
 *
 *   TEST-4 (INV-3) the Tool control offers EXACTLY the tools the server serves,
 *          and an arbitrary typed name is NOT a valid selection.
 *   TEST-5 (INV-4) the Arguments section is GENERATED from the chosen tool's
 *          declared schema — one labelled, typed control per declared property
 *          carrying its requiredness / description / default — and no free
 *          "argument name" key box for those properties. Switching tools
 *          regenerates from the OTHER tool's schema.
 *   TEST-6 (INV-5) a `{{ inputs.query }}` reference is accepted by a NON-string
 *          typed field (the integer `limit`) and survives save → reload.
 *   TEST-7 (INV-6) an UNREACHABLE server degrades VISIBLY: a stated reason that
 *          names the server plus a free-text tool field that really commits what
 *          is typed — and a schema-undeclared argument key survives an
 *          edit → save → reload round-trip (lossless fallback).
 *
 * No mocking of ziee's own endpoints. `MockBuilderToolsServer` is an EXTERNAL
 * MCP server registered through the real `POST /api/mcp/servers` — the same
 * pattern as `tests/e2e/mcp/helpers/resource-link-mock-server.ts`.
 */

// ---------------------------------------------------------------------------
// Shared drivers
// ---------------------------------------------------------------------------

/** Register a user-owned, enabled http MCP server pointing at `url`. */
async function seedMcpServer(
  request: APIRequestContext,
  apiURL: string,
  token: string,
  name: string,
  url: string,
): Promise<void> {
  const resp = await request.post(`${apiURL}/api/mcp/servers`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name,
      display_name: name,
      enabled: true,
      transport_type: 'http',
      url,
      timeout_seconds: 30,
    },
  })
  expect(resp.status(), `seed mcp server: ${await resp.text()}`).toBe(201)
}

/** Add a tool step to a fresh builder and choose `srvName` in the Server picker. */
async function addToolStepOnServer(page: Page, srvName: string): Promise<string> {
  const stepId = await addStep(page, 'tool', 1)
  await byTestId(page, 'wf-builder-tool-server').click()
  await byTestId(page, `wf-builder-tool-server-opt-${srvName}`).click()
  return stepId
}

/** The Tool control is in PICKER mode ⇔ the form says so on the field itself.
 *  (Waiting on this rather than on a popup means we never click the control
 *  while it is still the loading/fallback Input.) */
async function waitForToolPicker(page: Page) {
  await expect(byTestId(page, 'wf-builder-step-config')).toContainText(
    'Pick the tool this step should call.',
    { timeout: 30000 },
  )
}

/** Open the tool Combobox's list. */
async function openToolList(page: Page) {
  await byTestId(page, 'wf-builder-tool-name').click()
  await expect(
    page.locator('[data-testid^="wf-builder-tool-name-opt-"]').first(),
  ).toBeVisible({ timeout: 10000 })
}

/** Choose a tool by name through the real Combobox (filter, then click). */
async function pickTool(page: Page, toolName: string) {
  const field = byTestId(page, 'wf-builder-tool-name')
  await field.click()
  await field.fill(toolName)
  const option = byTestId(page, `wf-builder-tool-name-opt-${toolName}`)
  await expect(option).toBeVisible({ timeout: 10000 })
  await option.click()
}

/**
 * The `LabeledControl` block a generated field lives in: the control itself, its
 * visible `<label>` (which carries the label text + the required `*`), and the
 * block that also holds the description. The control must additionally expose an
 * accessible NAME derived from the declared property — asserted by the caller —
 * so "one labelled control per declared property" is proven for every control
 * type (input / number / switch / select), whichever naming mechanism it uses.
 */
async function generatedField(page: Page, prop: string) {
  const control = byTestId(page, `wf-builder-tool-arg-field-${prop}`)
  await expect(control).toBeVisible({ timeout: 20000 })
  // The control's nearest `flex-col` ancestor is the LabeledControl root
  // (label row + control + description).
  const block = control.locator('xpath=ancestor::div[contains(@class,"flex-col")][1]')
  const label = block.locator('> div > label')
  await expect(label).toHaveCount(1)
  await expect(control).toHaveAccessibleName(new RegExp(prop))
  return { control, label, block }
}

/** Values of every free key/value argument row currently rendered. */
async function freeArgRows(page: Page): Promise<{ key: string; value: string }[]> {
  const keys = await page
    .locator('[data-testid^="wf-builder-tool-arg-key-"]')
    .evaluateAll(els => els.map(e => (e as HTMLInputElement).value))
  const values = await page
    .locator('[data-testid^="wf-builder-tool-arg-value-"]')
    .evaluateAll(els => els.map(e => (e as HTMLInputElement).value))
  return keys.map((key, i) => ({ key, value: values[i] ?? '' }))
}

// ---------------------------------------------------------------------------

test.describe('Workflows — builder tool picker + generated arguments', () => {
  let mock: MockBuilderToolsServer | null = null

  test.afterEach(async () => {
    await mock?.dispose()
    mock = null
  })

  // ── TEST-4 ────────────────────────────────────────────────────────────────
  test("TEST-4 — the Tool picker offers exactly the server's real tools", async ({
    page,
    request,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    const srvName = `e2e_wfb_tools_${Date.now()}`

    mock = await MockBuilderToolsServer.start()
    await loginAsAdmin(page, baseURL)
    const token = await getAdminToken(apiURL)
    await seedMcpServer(request, apiURL, token, srvName, mock.url())

    await openNewBuilder(page, baseURL)
    await addToolStepOnServer(page, srvName)
    const cfg = byTestId(page, 'wf-builder-step-config')

    // A reachable server ⇒ enumeration, so NO degradation notice.
    await waitForToolPicker(page)
    await expect(byTestId(page, 'wf-builder-tool-catalog-error')).toHaveCount(0)

    // INV-3: the offered options are EXACTLY the tools this server serves —
    // not a curated subset, not a superset, not a free-text box.
    await openToolList(page)
    const options = page.locator('[data-testid^="wf-builder-tool-name-opt-"]')
    await expect(options).toHaveCount(MOCK_TOOL_NAMES.length)
    const offered = (
      await options.evaluateAll(els =>
        els.map(e => e.getAttribute('data-testid') ?? ''),
      )
    )
      .map(t => t.replace('wf-builder-tool-name-opt-', ''))
      .sort()
    expect(offered).toEqual([...MOCK_TOOL_NAMES].sort())

    // …and an arbitrary name is NOT a selection: it matches nothing and the
    // step's tool stays unset (the required-field error persists).
    await byTestId(page, 'wf-builder-tool-name').fill('definitely_not_a_real_tool')
    await expect(page.getByText('No tool matches')).toBeVisible()
    await expect(options).toHaveCount(0)
    await expect(cfg).toContainText('A tool name is required')

    // Choosing a REAL tool is what commits the field.
    await pickTool(page, 'summarize')
    await expect(byTestId(page, 'wf-builder-tool-name')).toHaveValue(/^summarize/)
    await expect(cfg).not.toContainText('A tool name is required')
  })

  // ── TEST-5 ────────────────────────────────────────────────────────────────
  test("TEST-5 — Arguments are generated from the chosen tool's declared schema", async ({
    page,
    request,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    const srvName = `e2e_wfb_tools_${Date.now()}`

    mock = await MockBuilderToolsServer.start()
    await loginAsAdmin(page, baseURL)
    const token = await getAdminToken(apiURL)
    await seedMcpServer(request, apiURL, token, srvName, mock.url())

    await openNewBuilder(page, baseURL)
    await addToolStepOnServer(page, srvName)
    const cfg = byTestId(page, 'wf-builder-step-config')

    await waitForToolPicker(page)
    await pickTool(page, 'search')

    // INV-4: one control PER declared property, generated from the schema.
    await expect(byTestId(page, 'wf-builder-tool-args-generated')).toBeVisible({
      timeout: 20000,
    })
    for (const prop of SEARCH_PROPERTY_NAMES) {
      await expect(
        byTestId(page, `wf-builder-tool-arg-field-${prop}`),
        `declared property "${prop}" has a generated control`,
      ).toBeVisible()
    }

    // …carrying the DECLARED requiredness, description and default.
    const query = await generatedField(page, 'query')
    await expect(query.label).toHaveText(/^query\s*\*$/) // required string
    await expect(query.block).toContainText('What to search for.')

    const limit = await generatedField(page, 'limit')
    await expect(limit.label).toHaveText('limit') // optional ⇒ no `*`
    await expect(limit.block).toContainText('How many results to return.')
    await expect(limit.block).toContainText('Defaults to 10.') // declared default
    await expect(limit.control).toHaveAttribute('placeholder', '10')

    const archived = await generatedField(page, 'include_archived')
    await expect(archived.label).toHaveText('include_archived')
    await expect(archived.block).toContainText('Also search archived documents.')
    await expect(archived.control).toHaveAttribute('role', 'switch') // boolean

    // The enum is a closed picker over the DECLARED choices.
    const mode = await generatedField(page, 'mode')
    await expect(mode.block).toContainText('Ranking strategy.')
    await mode.control.click()
    for (const choice of ['semantic', 'keyword', 'hybrid']) {
      await expect(
        byTestId(page, `wf-builder-tool-arg-field-mode-opt-${choice}`),
      ).toBeVisible()
    }
    await byTestId(page, 'wf-builder-tool-arg-field-mode-opt-hybrid').click()

    // …and NO free "argument name" key box is rendered for those properties:
    // the author never invents a key. (The escape hatch below is explicitly
    // labelled as the EXTRA — schema-undeclared — arguments section.)
    await expect(page.locator('[data-testid^="wf-builder-tool-arg-key-"]')).toHaveCount(0)
    await expect(cfg).toContainText('Additional arguments')

    // Switching tools regenerates from the OTHER tool's schema — proving the
    // form is driven by the chosen tool's declaration, not by a fixed layout.
    await pickTool(page, 'translate')
    await expect(byTestId(page, 'wf-builder-tool-arg-field-text')).toBeVisible({
      timeout: 20000,
    })
    await expect(byTestId(page, 'wf-builder-tool-arg-field-target')).toBeVisible()
    await expect(byTestId(page, 'wf-builder-tool-arg-field-query')).toHaveCount(0)
    await expect(byTestId(page, 'wf-builder-tool-arg-field-limit')).toHaveCount(0)
  })

  // ── TEST-6 ────────────────────────────────────────────────────────────────
  test('TEST-6 — a reference is accepted by a NON-string typed field and survives a reload', async ({
    page,
    request,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    const srvName = `e2e_wfb_tools_${Date.now()}`
    const wfName = `e2e-wfb-tool-ref-${Date.now()}`

    mock = await MockBuilderToolsServer.start()
    await loginAsAdmin(page, baseURL)
    const token = await getAdminToken(apiURL)
    await seedMcpServer(request, apiURL, token, srvName, mock.url())

    await openNewBuilder(page, baseURL)

    // Declare the input the reference resolves against.
    await byTestId(page, 'wf-builder-input-add').click()
    await byTestId(page, 'wf-builder-input-name-0').fill('query')

    const stepId = await addToolStepOnServer(page, srvName)
    await waitForToolPicker(page)
    await pickTool(page, 'search')

    // `limit` is declared `integer` — as a typed control it holds a NUMBER.
    const limit = byTestId(page, 'wf-builder-tool-arg-field-limit')
    await expect(limit).toBeVisible({ timeout: 20000 })
    await limit.fill('25')
    await expect(limit).toHaveValue('25')

    // INV-5: that same non-string field must take a reference where it takes a
    // literal. Insert `{{ inputs.query }}` through the field's own affordance.
    await byTestId(page, 'wf-builder-tool-arg-field-limit-ref-trigger').click()
    await page.getByRole('menuitem', { name: /query/ }).click()
    await expect(byTestId(page, 'wf-builder-tool-arg-field-limit')).toHaveValue(
      '{{ inputs.query }}',
    )
    // …and the switch to reference mode is visibly reversible (never a trap).
    await expect(
      byTestId(page, 'wf-builder-tool-arg-field-limit-clear-ref'),
    ).toBeVisible()

    // Save → the reference is accepted by the real validator + persisted.
    await byTestId(page, 'wf-builder-name').fill(wfName)
    await waitBuilderValid(page)
    await saveBuilder(page)
    await expect(page).toHaveURL(/\/settings\/workflows\/[0-9a-f-]+\/edit$/, {
      timeout: 15000,
    })

    // Reload → the reference is STILL in the typed field (not coerced away,
    // not silently dropped by the number control).
    await page.reload({ waitUntil: 'domcontentloaded' })
    await byTestId(page, `wf-builder-step-row-${stepId}`).click()
    await expect(byTestId(page, 'wf-builder-tool-arg-field-limit')).toHaveValue(
      '{{ inputs.query }}',
      { timeout: 30000 },
    )
    await expect(
      byTestId(page, 'wf-builder-tool-arg-field-limit-clear-ref'),
    ).toBeVisible()
  })

  // ── TEST-7 ────────────────────────────────────────────────────────────────
  test('TEST-7 — an unreachable server degrades to free text with a stated reason, losslessly', async ({
    page,
    request,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    const srvName = `e2e_wfb_tools_${Date.now()}`
    const wfName = `e2e-wfb-tool-fallback-${Date.now()}`

    await loginAsAdmin(page, baseURL)
    const token = await getAdminToken(apiURL)
    // Deliberately unreachable: the tools endpoint CANNOT answer for this server.
    await seedMcpServer(
      request,
      apiURL,
      token,
      srvName,
      'https://tool-srv.example.invalid/mcp',
    )

    await openNewBuilder(page, baseURL)
    const stepId = await addToolStepOnServer(page, srvName)

    // INV-6: a stated reason NAMING the server — never an empty picker.
    const alert = byTestId(page, 'wf-builder-tool-catalog-error')
    await expect(alert).toBeVisible({ timeout: 30000 })
    await expect(alert).toContainText(srvName)

    // …and the tool field really is free text: no enumerated options exist, and
    // an arbitrary name COMMITS (the opposite of TEST-4's picker behaviour).
    await expect(
      page.locator('[data-testid^="wf-builder-tool-name-opt-"]'),
    ).toHaveCount(0)
    await byTestId(page, 'wf-builder-tool-name').fill('an_unlisted_tool')
    await expect(byTestId(page, 'wf-builder-step-config')).not.toContainText(
      'A tool name is required',
    )

    // A schema-undeclared argument, entered by hand through the escape hatch.
    await byTestId(page, 'wf-builder-tool-arg-add').click()
    await byTestId(page, 'wf-builder-tool-arg-key-0').fill('legacy_only')
    await byTestId(page, 'wf-builder-tool-arg-value-0').fill('keep-me')

    await byTestId(page, 'wf-builder-name').fill(wfName)
    await waitBuilderValid(page)
    await saveBuilder(page)
    await expect(page).toHaveURL(/\/settings\/workflows\/[0-9a-f-]+\/edit$/, {
      timeout: 15000,
    })

    // Reload: the hand-entered tool + argument came back.
    await page.reload({ waitUntil: 'domcontentloaded' })
    await byTestId(page, `wf-builder-step-row-${stepId}`).click()
    await expect(byTestId(page, 'wf-builder-tool-name')).toHaveValue(
      'an_unlisted_tool',
      { timeout: 30000 },
    )
    expect(await freeArgRows(page)).toEqual([
      { key: 'legacy_only', value: 'keep-me' },
    ])

    // EDIT something else, save, reload — the pre-existing, schema-undeclared
    // key must survive the round-trip untouched (lossless fallback).
    await byTestId(page, 'wf-builder-tool-name').fill('another_tool')
    await byTestId(page, 'wf-builder-tool-arg-add').click()
    await byTestId(page, 'wf-builder-tool-arg-key-1').fill('note')
    await byTestId(page, 'wf-builder-tool-arg-value-1').fill('added-later')
    await waitBuilderValid(page)
    await saveBuilder(page)

    await page.reload({ waitUntil: 'domcontentloaded' })
    await byTestId(page, `wf-builder-step-row-${stepId}`).click()
    await expect(byTestId(page, 'wf-builder-tool-name')).toHaveValue(
      'another_tool',
      { timeout: 30000 },
    )
    const rows = await freeArgRows(page)
    expect([...rows].sort((a, b) => a.key.localeCompare(b.key))).toEqual([
      { key: 'legacy_only', value: 'keep-me' },
      { key: 'note', value: 'added-later' },
    ])
  })
})
