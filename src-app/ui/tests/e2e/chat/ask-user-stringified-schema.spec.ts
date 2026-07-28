import { test, expect } from '../../fixtures/test-context'
import { loginAsAdmin, getAdminToken } from '../../common/auth-helpers'
import { assignProviderToAdministratorsGroup } from '../../common/provider-helpers'
import { goToNewChatPage, selectModelInDropdown, sendChatMessage } from './helpers/chat-helpers'
import { createToolCapableModel } from '../control/helpers/control-llm-helpers'
import { OaiStubServer } from '../helpers/oai-stub-server'

/**
 * THE acceptance test for the stringified-argument round, at the layer the user
 * actually experiences.
 *
 * Observed live: the model called the built-in `ask_user` with its object
 * `schema` argument JSON-ENCODED AS A STRING —
 *
 *   "schema": "{\"properties\": {\"name\": {...}}, \"required\": [\"name\"], ...}"
 *
 * Nothing decoded it, so `cap_requested_schema` and `stamp_ask_user_marker` both
 * fell through their non-object arms, the frontend did `schema?.properties || {}`
 * on a string primitive, and the user got a card with the question, ZERO fields,
 * and a Submit that POSTs `content: {}`. The turn then blocked for the full 300s
 * timeout.
 *
 * This drives the REAL backend end to end — real chat loop, real built-in, real
 * SSE, real renderer — and asserts the user sees a form with REAL FIELDS.
 *
 * Deterministic and UNSKIPPABLE by design: a real model cannot be asked to
 * stringify its arguments on demand, so a real-LLM version of this would be a
 * coin flip that rots into a flaky skip. The scripted OpenAI-compatible fixture
 * (`helpers/oai-stub-server.ts`) emits the exact malformed call every time. It
 * stands in for the EXTERNAL LLM boundary only — no ziee API is mocked.
 */
test.describe('ask_user — a JSON-encoded schema still renders a real form', () => {
  test.slow()

  test('the reported stringified schema renders its fields through the real backend', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra

    // The EXACT payload from the live session, verbatim.
    const stringifiedSchema =
      '{"properties": {"name": {"title": "Project name", "type": "string"}, "description": {"title": "Brief description (optional)", "type": "string"}, "instructions": {"title": "System instructions for conversations in this project (optional)", "type": "string"}}, "required": ["name"], "type": "object"}'

    const stub = await OaiStubServer.start({
      toolName: 'ask_user',
      argumentsJson: JSON.stringify({
        message: 'What would you like to name this new project?',
        // NOTE: a STRING, not an object. This is the defect.
        schema: stringifiedSchema,
      }),
      followUpText: 'Thanks — creating the project now.',
    })

    try {
      await loginAsAdmin(page, baseURL)
      const token = await getAdminToken(apiURL)

      // An `openai` provider whose base_url points at the loopback stub — the
      // established BRIDGE pattern (`agent-llm-helpers.ts::createBridgeToolModel`,
      // and how every local-bridge spec wires a self-hosted endpoint).
      //
      // NOT `provider_type: 'custom'`: the row is created and the API accepts
      // it, but no model under it reaches the chat model dropdown, so the spec
      // fails at model selection before it can prove anything. Observed, not
      // assumed. `openai` + an explicit `base_url` routes to the same
      // OpenAI-compatible client, and `validate_base_url` uses the DEV_LOCAL
      // policy, which allows 127.0.0.1.
      const providerRes = await page.request.post(`${apiURL}/api/llm-providers`, {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          name: `stub-oai-${Date.now()}`,
          provider_type: 'openai',
          enabled: true,
          api_key: 'stub-key',
          base_url: stub.baseUrl(),
        },
      })
      expect(
        providerRes.ok(),
        `create stub provider: ${providerRes.status()} ${await providerRes.text()}`,
      ).toBeTruthy()
      const providerId = (await providerRes.json()).id as string
      await assignProviderToAdministratorsGroup(apiURL, token, providerId)

      // Must be TOOL-CAPABLE or `ask_user` is never attached and the stub's
      // tool call has nothing to name (`createModelViaAPI` hardcodes
      // `function_calling: false`, which is why it cannot be used here).
      await createToolCapableModel(
        page,
        apiURL,
        token,
        providerId,
        'Stub Tool Model',
        'stub-model',
      )

      await goToNewChatPage(page, baseURL)
      await selectModelInDropdown(page, 'Stub Tool Model')
      // `false` — do NOT wait for completion: the turn deliberately pauses on
      // the form.
      await sendChatMessage(page, 'I want to create a new project.', false)

      const pending = page.locator('[data-testid^="elicitation-pending-"]').first()
      await expect(
        pending,
        'a JSON-encoded schema must still surface a form',
      ).toBeVisible({ timeout: 60000 })

      // THE assertion. On the pre-fix backend this card renders with zero
      // fields, so this is what turns red on a regression.
      const fields = pending.locator('[data-testid^="elicitation-field-"]')
      await expect(
        fields.first(),
        'the form must have REAL fields — a form with none is the defect',
      ).toBeVisible({ timeout: 30000 })

      // …and it must be asking THIS schema's questions, so an unrelated
      // elicitation cannot satisfy the spec.
      //
      // The decisive signal is the wizard's step COUNT: the rich ask_user UX
      // renders one step per `properties` entry, so "step 1 of 3" can only
      // happen if all three properties were decoded out of the string. On the
      // pre-fix backend `properties` is `{}`, so there are no steps at all.
      //
      // NOTE we do NOT assert the literal "Project name" here: on step 1 the
      // wizard renders the elicitation MESSAGE as the question text, so the
      // first field's `title` is not on screen yet. Asserting it failed against
      // a CORRECT render — the assertion was wrong, not the product.
      const cardText = ((await pending.textContent()) ?? '').toLowerCase()
      expect(
        cardText,
        'the wizard must show one step per decoded property (3), which is only possible if the string was decoded',
      ).toContain('step 1 of 3')
      expect(
        cardText,
        "a title from the decoded schema must be rendered, so an unrelated elicitation cannot satisfy this spec",
      ).toContain('brief description')

      // The degraded "no fields" card must NOT be what rendered.
      await expect(
        page.locator('[data-testid="mcp-elicitation-no-fields-card"]'),
        'a decodable schema is not a degraded one',
      ).toHaveCount(0)

      // Close the loop rather than leaving a generation task blocked on a form
      // nobody answers (every sibling elicitation spec does this).
      const decline = pending.locator('[data-testid^="elicitation-decline"]').first()
      if (await decline.count()) {
        await decline.click()
      }
    } finally {
      await stub.dispose()
    }
  })
})
