import { test, expect } from '../../fixtures/test-context'
import { sendChatMessage } from '../chat/helpers/chat-helpers'
import {
  TEST_LLM,
  NO_LLM_SKIP,
  setupControlChat,
  currentConversationId,
  recordedToolNames,
} from './helpers/control-llm-helpers'

/**
 * control_mcp — asked for a mutating operation WITHOUT the inputs, the model
 * must collect them with the built-in `ask_user` FORM, not with chat prose.
 *
 * The defect this covers, observed live: told "create a new project" with no
 * name, the model wrote a numbered questionnaire into the chat —
 * "To get started: 1. What's the project name? 2. ..." — leaving the user to
 * free-type answers into a message. ziee already ships the right affordance
 * (`ask_user` renders a real form / Next-Back wizard from a JSON Schema and
 * returns the answers as the tool result); nothing in the control surface told
 * the model to use it.
 *
 * The assertion is the RENDERED CARD, deliberately, for two reasons:
 *   - `ask_user` is intercepted before `McpSession::call_tool`, so it is never
 *     written to `mcp_tool_calls` — the tool-call history cannot see it.
 *   - the card IS the defect. "A form appeared" is the user-visible difference
 *     between the broken and fixed behaviour.
 *
 * Gating mirrors the sibling control specs: run against WHATEVER LLM the
 * environment configures, skip ONLY when nothing at all is configured.
 */
test.describe('control_mcp — missing input is collected with a form, not prose', () => {
  test.skip(!TEST_LLM, NO_LLM_SKIP)
  // Real-LLM + live SSE: multi-round tool calling is non-deterministic, so
  // retry like the other real-backend control specs.
  test.describe.configure({ retries: 2 })
  test.slow()

  test('a vague "create a project" request renders the ask_user form instead of a prose questionnaire', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    const { token } = await setupControlChat(page, baseURL, apiURL)

    // Deliberately UNDER-SPECIFIED: no name, no description, no operation id.
    // This is the exact shape of request that produced the prose questionnaire.
    await sendChatMessage(page, 'I want to create a new project.', false)

    // The proof: a pending elicitation card is rendered in the transcript.
    const pending = page.locator('[data-testid^="elicitation-pending-"]').first()
    await expect(
      pending,
      'the model must collect the missing project fields with the ask_user form, ' +
        'not by asking for them in chat text',
    ).toBeVisible({ timeout: 120000 })

    // The form must actually ask for something — a card with no field would be
    // a form in name only.
    await expect(pending.locator('input, textarea, [role="radio"], [role="checkbox"]').first())
      .toBeVisible({ timeout: 30000 })

    // And it must be the CONTROL flow that got there: the model discovered the
    // operation first (`list_capabilities` / `describe_capability` ARE recorded,
    // unlike `ask_user`), so this is not some unrelated elicitation.
    const conversationId = currentConversationId(page)
    expect(conversationId, 'the chat must have created a conversation').toBeTruthy()
    await expect
      .poll(async () => recordedToolNames(page, apiURL, token, conversationId as string), {
        timeout: 60000,
      })
      .toEqual(expect.arrayContaining([expect.stringMatching(/list_capabilities|describe_capability/)]))
  })
})
