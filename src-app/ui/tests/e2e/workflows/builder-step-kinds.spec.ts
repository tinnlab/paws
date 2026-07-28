import { test, expect } from '../../fixtures/test-context'
import { loginAsAdmin, getAdminToken } from '../../common/auth-helpers'
import { byTestId } from '../testid'
import {
  ALL_STEP_KINDS,
  addStep,
  openNewBuilder,
  saveBuilder,
  waitBuilderValid,
} from './helpers/builder-helpers'
import { MockBuilderToolsServer } from './helpers/builder-tools-mock-server'

/**
 * TEST-19 (was TEST-12) — the add-step kind picker + the schema-driven per-kind
 * config forms.
 *
 *   the picker offers all 6 kinds → add a Tool step + an Llm step → each renders
 *   TYPED fields (a server Select / a tool PICKER / arguments; a prompt + an
 *   Output segmented) — NOT a single raw-JSON textarea → an invalid tool step
 *   surfaces inline field validation → a valid config Saves. The llm form has NO
 *   tools/capability picker (the backend rejects `tools:` on an llm step).
 *
 * NOTE on the Tool field: this spec previously typed a tool name into a free-text
 * Input and called that "typed fields". It is not — a tool name is an entity the
 * system can ENUMERATE from the chosen server (`GET /api/mcp/servers/{id}/tools`),
 * so asking the author to recall it is the defect, and asserting it here PINNED
 * that defect in place (DESIGN §2.3). The Tool control is now a PICKER, and this
 * spec seeds a REACHABLE server so the picker — not the documented hand-entry
 * fallback — is what the tool step offers.
 *
 * Division of labour with `builder-tool-picker.spec.ts` (TEST-4 / TEST-5): that
 * spec proves the picker's OPTIONS equal the server's real tools and that the
 * Arguments form is generated from the chosen tool's declared schema. This spec's
 * distinct job is that the picker is what the step OFFERS (no free-text tool
 * name), that the inline required-field validation still behaves on a fresh step
 * and clears once server + tool are chosen, and that a valid config still SAVES.
 *
 * No API mocking of ziee: a real personal MCP server is seeded via the REST API,
 * pointing at an in-process mock MCP server on loopback, so both the server
 * Select and the tool picker are backed by real data.
 */

test.describe('Workflows — builder step kinds + typed forms', () => {
  let mock: MockBuilderToolsServer

  test.beforeEach(async () => {
    mock = await MockBuilderToolsServer.start()
  })

  test.afterEach(async () => {
    await mock?.dispose()
  })

  test('TEST-19: all 6 kinds; tool step offers a server + tool PICKER (no free text), inline validation clears, llm typed form, valid saves', async ({
    page,
    request,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    const wfName = `e2e-builder-kinds-${Date.now()}`
    const srvName = `e2e_tool_srv_${Date.now()}`
    const srvDisplay = 'E2E Tool Server'

    await loginAsAdmin(page, baseURL)
    const token = await getAdminToken(apiURL)

    // Seed a real, enabled, user-owned MCP server so the tool step's server
    // picker has an option (health check is disabled in E2E, so it stays on).
    // Its URL is the in-process mock MCP server, so the tool catalog genuinely
    // loads and the Tool control resolves to the picker rather than the
    // documented unreachable-server fallback.
    const srvResp = await request.post(`${apiURL}/api/mcp/servers`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        name: srvName,
        display_name: srvDisplay,
        enabled: true,
        transport_type: 'http',
        url: mock.url(),
        timeout_seconds: 30,
      },
    })
    expect(srvResp.status(), `seed mcp server: ${await srvResp.text()}`).toBe(201)

    await openNewBuilder(page, baseURL)

    // The kind picker offers all 6 kinds.
    await byTestId(page, 'wf-builder-add-step-btn').click()
    for (const kind of ALL_STEP_KINDS) {
      await expect(
        byTestId(page, `wf-builder-add-step-menu-item-${kind}`),
      ).toBeVisible()
    }
    // Close the menu (Escape) before adding via the helper.
    await page.keyboard.press('Escape')

    // ── Tool step: typed form + inline validation ────────────────────────────
    const toolId = await addStep(page, 'tool', 1) // tool_1
    const cfg = byTestId(page, 'wf-builder-step-config')
    // Typed fields, NOT a raw JSON box: a server Select, a Tool control, and an
    // argument editor.
    await expect(byTestId(page, 'wf-builder-tool-server')).toBeVisible()
    await expect(byTestId(page, 'wf-builder-tool-name')).toBeVisible()
    await expect(byTestId(page, 'wf-builder-tool-arg-add')).toBeVisible()
    // A fresh tool step (empty server + tool) surfaces inline required-field
    // validation right in the form.
    await expect(cfg).toContainText('A server is required')
    await expect(cfg).toContainText('A tool name is required')

    // The Server field is a PICKER over the user's real MCP servers — choosing
    // the seeded one clears its inline required-field error.
    await byTestId(page, 'wf-builder-tool-server').click()
    await byTestId(page, `wf-builder-tool-server-opt-${srvName}`).click()
    await expect(cfg).not.toContainText('A server is required')

    // The server is reachable, so the catalog loads and the Tool field is the
    // PICKER, not the hand-entry escape hatch: no failure alert, and the field's
    // own copy invites a pick instead of an exact name from memory.
    await expect(byTestId(page, 'wf-builder-tool-catalog-error')).toHaveCount(0, {
      timeout: 20000,
    })
    await expect(cfg).toContainText('Pick the tool this step should call.', {
      timeout: 20000,
    })
    await expect(cfg).not.toContainText(
      'The exact name of the tool to call on that server.',
    )

    // Opening it lists the server's tools — the author CHOOSES one; they do not
    // type it. (That the options ARE the server's real tool set is TEST-4's job.)
    await byTestId(page, 'wf-builder-tool-name').click()
    const searchOption = byTestId(page, 'wf-builder-tool-name-opt-search')
    await expect(searchOption).toBeVisible({ timeout: 20000 })
    await searchOption.click()

    // Choosing the tool clears its inline required-field error, and its declared
    // arguments are collected through a generated form (shape asserted by TEST-5).
    await expect(cfg).not.toContainText('A tool name is required')
    await expect(byTestId(page, 'wf-builder-tool-args-generated')).toBeVisible({
      timeout: 15000,
    })
    await byTestId(page, 'wf-builder-tool-arg-field-query').fill('ziee')

    // ── Llm step: typed form, NO tools picker ────────────────────────────────
    const llmId = await addStep(page, 'llm', 1) // llm_1
    // Typed fields: a prompt textarea + an Output segmented control.
    await expect(byTestId(page, 'wf-builder-llm-prompt')).toBeVisible()
    await expect(byTestId(page, 'wf-builder-llm-output')).toBeVisible()
    // The llm form has NO capability/tools picker (that is agent-only; the
    // backend rejects `tools:` on an llm step).
    await expect(byTestId(page, 'wf-builder-agent-servers')).toHaveCount(0)
    await byTestId(page, 'wf-builder-llm-prompt').fill('Summarize the result.')

    // Sanity: the two steps exist and carry their kind tags.
    await expect(byTestId(page, `wf-builder-step-kind-${toolId}`)).toContainText(
      'Call a tool',
    )
    await expect(byTestId(page, `wf-builder-step-kind-${llmId}`)).toContainText(
      'LLM prompt',
    )

    // A valid config Saves.
    await byTestId(page, 'wf-builder-name').fill(wfName)
    await waitBuilderValid(page)
    await saveBuilder(page)
    await expect(page).toHaveURL(/\/settings\/workflows\/[0-9a-f-]+\/edit$/, {
      timeout: 15000,
    })
  })
})
