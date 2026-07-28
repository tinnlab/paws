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

    // The form must actually ask for something. Select on the per-field testid
    // every renderer stamps (`elicitation-field-<name>`) rather than on a
    // hand-picked set of control tags: the wizard also renders Switch
    // (role=switch), Select (role=combobox) and DatePicker, so an
    // input/radio/checkbox locator false-FAILS on a boolean- or enum-only form.
    const fields = pending.locator('[data-testid^="elicitation-field-"]')
    await expect(
      fields.first(),
      'a form with no fields is a form in name only',
    ).toBeVisible({ timeout: 30000 })

    // …and it must be asking for THIS operation's inputs. The whole point of the
    // guidance is "one property per schema field", so a generic elicitation from
    // some unrelated tool must not satisfy this spec: the project name is the
    // one field `Project.create` cannot proceed without.
    const cardText = ((await pending.textContent()) ?? '').toLowerCase()
    expect(
      cardText,
      'the form must ask for the project name — the required field the request omitted',
    ).toContain('name')

    // The model reached the form through the CONTROL flow (`list_capabilities` /
    // `describe_capability` ARE recorded; `ask_user` deliberately is not), so
    // this is not an unrelated elicitation. Polled WITHOUT ordering constraints:
    // discovering before or after asking are both legitimate trajectories, and
    // an `ask_user` call blocks the turn, so requiring "discovery first" would
    // fail on model ordering rather than on the product.
    const conversationId = currentConversationId(page)
    expect(conversationId, 'the chat must have created a conversation').toBeTruthy()
    await expect
      .poll(async () => recordedToolNames(page, apiURL, token, conversationId as string), {
        timeout: 60000,
      })
      .toEqual(
        expect.arrayContaining([
          expect.stringMatching(/list_capabilities|describe_capability/),
        ]),
      )

    // Close the loop rather than leaving a generation task blocked on a form
    // nobody answers (every sibling control spec clicks approve or deny).
    const decline = pending.locator('[data-testid^="elicitation-decline"]').first()
    if (await decline.count()) {
      await decline.click()
    }
  })
})
