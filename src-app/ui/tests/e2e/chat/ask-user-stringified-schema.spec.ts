import { test, expect } from '../../fixtures/test-context'
import { loginAsAdmin, getAdminToken } from '../../common/auth-helpers'
import { assignProviderToAdministratorsGroup } from '../../common/provider-helpers'
import { goToNewChatPage, selectModelInDropdown, sendChatMessage } from './helpers/chat-helpers'
import {
  createToolCapableModel,
  setupControlChat,
  TEST_LLM,
  NO_LLM_SKIP,
} from '../control/helpers/control-llm-helpers'
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

/**
 * TEST-38 — the REAL-MODEL no-regression leg.
 *
 * TEST-37 above proves the FIX: a deliberately malformed, stringified schema
 * now renders a real form. That is a test of the new tolerance, and a test of a
 * new tolerance cannot tell you whether you broke the case that already worked.
 * A coercion layer that mangled a well-formed object schema — or that made
 * `ask_user` refuse a shape a real model actually emits — would leave TEST-37
 * perfectly green while breaking every real conversation.
 *
 * So this leg keeps a REAL model in the loop and asserts the ordinary path still
 * ends in a usable form: an under-specified request, the model's own choice of
 * schema, real fields on screen, and specifically NOT the degraded "no fields"
 * card that ITEM-17 introduced. The degraded card is the honest surface for a
 * schema that genuinely carries nothing; seeing it here would mean the decode
 * path had started rejecting good input, which is precisely the regression this
 * spec exists to catch and which no deterministic stub can observe.
 *
 * Gating mirrors the sibling real-LLM control specs: it runs against WHATEVER
 * LLM the environment configures and skips ONLY when nothing at all is
 * configured. Deliberately NOT an `ANTHROPIC_API_KEY` gate — on a box wired to a
 * local OpenAI-compatible bridge that key is unset, and a vendor-scoped gate
 * would report SKIPPED while claiming coverage. Never an unconditional skip.
 */
test.describe('ask_user — a real model still gets a real form (no regression)', () => {
  test.skip(!TEST_LLM, NO_LLM_SKIP)
  // A real model deciding to call a tool, over live SSE, is non-deterministic —
  // retried like every sibling real-LLM spec on this surface.
  test.describe.configure({ retries: 2 })
  test.slow()

  test('an under-specified request renders an ask_user form with real fields', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    // Logs in, wires the configured LLM as a TOOL-CAPABLE model (the plain
    // `createModelViaAPI` hardcodes `function_calling:false`, under which
    // `ask_user` is never attached and the spec could not pass), sets the MCP
    // default to auto_approve so an approval card cannot masquerade as the
    // elicitation form, and opens a fresh chat.
    await setupControlChat(page, baseURL, apiURL, 'Real LLM ask_user Model')

    // Under-specified on purpose — the same shape of request that must be
    // answered with a FORM rather than a prose questionnaire. The explicit
    // instruction keeps a mid-sized bridge model on the intended trajectory
    // without dictating the schema: the schema is the model's own, which is the
    // whole point of a no-regression check.
    await sendChatMessage(
      page,
      'I want to create a new project, but I have not decided the details. ' +
        'Use the ask_user tool to ask me for the project name and a short ' +
        'description. Do NOT guess the values and do NOT ask in chat text — you ' +
        'MUST call ask_user and wait for my answer.',
      false, // the turn deliberately pauses on the form
    )

    const pending = page.locator('[data-testid^="elicitation-pending-"]').first()
    await expect(
      pending,
      'a real model calling ask_user must still surface the elicitation card',
    ).toBeVisible({ timeout: 120000 })

    // The regression signal. A form with no fields is a form in name only, and
    // is exactly what a coercion layer that mangled a good schema would produce.
    const fields = pending.locator('[data-testid^="elicitation-field-"]')
    await expect(
      fields.first(),
      'the real-model form must still have REAL fields — the decode path must ' +
        'not degrade a schema that was already well-formed',
    ).toBeVisible({ timeout: 60000 })

    // The degraded card is correct ONLY for a schema that genuinely renders
    // nothing. Reaching it from a healthy real-model call would mean good input
    // is now being rejected.
    await expect(
      page.locator('[data-testid="mcp-elicitation-no-fields-card"]'),
      'a real model’s own schema must not land on the degraded no-fields card',
    ).toHaveCount(0)

    // Close the loop rather than leaving a generation task blocked on a form
    // nobody answers (every sibling elicitation spec does this).
    const decline = pending.locator('[data-testid^="elicitation-decline"]').first()
    if (await decline.count()) {
      await decline.click()
    }
  })
})
