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

/**
 * TEST-12 — the add-step kind picker + the schema-driven per-kind config forms.
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
 * that defect in place. The Tool control is now a picker. This spec asserts the
 * picker exists and the required-field validation still behaves; that the
 * picker's OPTIONS are the server's real tools is proven in
 * `builder-tool-picker.spec.ts`, which needs a server that actually serves a
 * tools/list (the server seeded here is an unreachable placeholder URL, so this
 * spec exercises the documented hand-entry FALLBACK).
 *
 * No API mocking: a real personal MCP server is seeded via the REST API so the
 * tool step's server Select has a real option to choose.
 */

test.describe('Workflows — builder step kinds + typed forms', () => {
  test('all 6 kinds; tool+llm typed forms, inline validation, valid saves', async ({
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
    const srvResp = await request.post(`${apiURL}/api/mcp/servers`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        name: srvName,
        display_name: srvDisplay,
        enabled: true,
        transport_type: 'http',
        url: 'https://tool-srv.example.invalid/mcp',
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

    // Pick the seeded server. Its URL is a deliberately unreachable placeholder,
    // so the tool catalog fails to load and the form must fall back to hand
    // entry WITH A STATED REASON — never a silently empty picker.
    await byTestId(page, 'wf-builder-tool-server').click()
    await byTestId(page, `wf-builder-tool-server-opt-${srvName}`).click()
    await expect(byTestId(page, 'wf-builder-tool-catalog-error')).toBeVisible({
      timeout: 20000,
    })
    await expect(byTestId(page, 'wf-builder-tool-catalog-error')).toContainText(
      srvName,
      { timeout: 5000 },
    )

    // The fallback still lets the author finish the step by hand.
    await byTestId(page, 'wf-builder-tool-name').fill('search')
    // The inline errors clear once the fields are filled.
    await expect(cfg).not.toContainText('A tool name is required')

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
