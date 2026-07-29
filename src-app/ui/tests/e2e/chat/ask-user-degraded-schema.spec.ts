import { test, expect } from '../../fixtures/test-context'
import { byTestId } from '../testid'
import { loginAsAdmin, getAdminToken } from '../../common/auth-helpers'
import {
  createProviderViaAPI,
  createModelViaAPI,
  assignProviderToAdministratorsGroup,
} from '../../common/provider-helpers'
import { goToNewChatPage, selectModelInDropdown, sendChatMessage } from './helpers/chat-helpers'
import {
  mockChatTokenStream,
  startedEvent,
  mcpElicitationRequiredEvent,
  completeEvent,
  mockGetMessages,
  mockUserMessage,
  mockAssistantElicitationMessage,
} from '../helpers/sse-mock-helpers'

/**
 * The elicitation card must never LIE.
 *
 * Before this round, every schema that yielded no renderable field —
 * a JSON-encoded string, `null`, a missing or empty `properties` — fell through
 * `schema?.properties || {}` to `{}` and rendered a card that LOOKS answerable:
 * the assistant's question, an empty `<form>`, and a working **Submit** whose
 * zod schema (`z.object({})`) validates anything, POSTing `content: {}` back to
 * the model as if the user had answered. The user had no way to tell.
 *
 * The backend now decodes what it can (see the Rust tests) — but it cannot fix
 * every case: an external MCP server may legitimately send a zero-property
 * CONFIRMATION, and the backend mints an `x-ziee-error` reason when it drops an
 * unusable schema. Those still reach the client, so the client must be honest
 * about them. That is what this spec pins.
 *
 * Mirrors the setup of the sibling `mcp-elicitation-form-rendering.spec.ts`
 * (the established pattern for driving the elicitation renderer).
 */
test.describe('Elicitation — a schema with no renderable fields', () => {
  test.beforeEach(async ({ page, testInfra }) => {
    const { baseURL, apiURL } = testInfra
    await loginAsAdmin(page, baseURL)
    const token = await getAdminToken(apiURL)
    const providerId = await createProviderViaAPI(apiURL, token, 'OpenAI', 'openai')
    await assignProviderToAdministratorsGroup(apiURL, token, providerId)
    await createModelViaAPI(apiURL, token, providerId, undefined, undefined, 'openai')
  })

  test('a zero-field schema explains itself instead of showing an empty form', async ({
    page,
    testInfra,
  }) => {
    const { card } = await seedDegraded(page, testInfra.baseURL, {
      type: 'object',
      properties: {},
    })

    // The honest state renders…
    await expect(
      byTestId(page, 'mcp-elicitation-no-fields-card').first(),
      'a schema with no fields must render the explanatory card, not a form',
    ).toBeVisible()
    const notice = byTestId(page, 'mcp-elicitation-no-fields-notice').first()
    await expect(notice).toBeVisible()
    await expect(
      notice,
      'the user must be told WHY there is nothing to fill in',
    ).toContainText(/no fields to fill in/i)

    // …and the misleading one does NOT. This is the assertion that fails on the
    // pre-fix code, where an empty <form> with a bare Submit was rendered.
    await expect(
      byTestId(page, 'mcp-elicitation-form').first(),
      'an empty form must not be rendered at all',
    ).toHaveCount(0)
    await expect(
      card.locator('[data-testid^="elicitation-field-"]'),
      'there are no fields, so none may be claimed',
    ).toHaveCount(0)

    // The user still gets two REAL choices, and the accept action says exactly
    // what it will do rather than pretending an answer was given.
    await expect(byTestId(page, 'elicitation-decline').first()).toBeVisible()
    const accept = byTestId(page, 'elicitation-accept-no-values').first()
    await expect(accept).toBeVisible()
    await expect(
      accept,
      'accepting must be labelled honestly — it sends no values',
    ).toContainText(/without values/i)
  })

  test("the server's x-ziee-error reason is shown to the user, not swallowed", async ({
    page,
    testInfra,
  }) => {
    // This is the shape `cap_requested_schema` produces when it drops an
    // unusable schema. The UI previously never read `x-ziee-error` at all
    // (zero references across src), so the reason was minted and thrown away.
    await seedDegraded(page, testInfra.baseURL, {
      type: 'object',
      properties: {},
      'x-ziee-error':
        'the MCP server sent `requestedSchema` as a string that is not a valid JSON object, so no form could be built',
    })

    await expect(
      byTestId(page, 'mcp-elicitation-no-fields-notice').first(),
      "the backend's own reason must reach the user",
    ).toContainText(/not a valid JSON object/i)
  })

  test('a JSON-encoded schema persisted before the fix still renders its fields', async ({
    page,
    testInfra,
  }) => {
    // The backend now decodes at ingress, so NEW elicitations are objects. But
    // message-content blocks written BEFORE the fix still hold a string — so
    // reopening an old conversation must not stay permanently broken.
    const { card } = await seedDegraded(
      page,
      testInfra.baseURL,
      JSON.stringify({
        type: 'object',
        'x-ziee-askuser': true,
        properties: { name: { type: 'string', title: 'Project name' } },
        required: ['name'],
      }) as unknown as Record<string, unknown>,
    )

    await expect(
      card.locator('[data-testid^="elicitation-field-"]').first(),
      'a schema persisted as a string must be parsed so its fields still render',
    ).toBeVisible()
    await expect(
      byTestId(page, 'mcp-elicitation-no-fields-card'),
      'a decodable schema is not a degraded one',
    ).toHaveCount(0)
  })
})

let counter = 0

/** Drive the renderer with an arbitrary `requested_schema` and return the card. */
async function seedDegraded(
  page: import('@playwright/test').Page,
  baseURL: string,
  requestedSchema: unknown,
): Promise<{ elicitationId: string; card: import('@playwright/test').Locator }> {
  counter++
  const elicitationId = `eid_degraded_${counter}_${Date.now()}`
  const userMessageId = `umsg_degraded_${counter}_${Date.now()}`
  const assistantMessageId = `amsg_degraded_${counter}_${Date.now()}`
  const promptText = `Degraded elicitation #${counter}`

  await mockChatTokenStream(page, [
    [
      startedEvent({ userMessageId }),
      mcpElicitationRequiredEvent({
        elicitationId,
        messageId: assistantMessageId,
        message: promptText,
        requestedSchema,
      }),
      completeEvent({ finishReason: 'tool_use' }),
    ],
  ])

  // After SSE complete the chat store calls loadMessages; without this the
  // optimistic streaming message is wiped and the card unmounts.
  await mockGetMessages(page, [
    mockUserMessage({ id: userMessageId, text: promptText }),
    mockAssistantElicitationMessage({
      id: assistantMessageId,
      elicitationId,
      message: promptText,
      requestedSchema,
      status: 'pending',
    }),
  ])

  await goToNewChatPage(page, baseURL)
  await selectModelInDropdown(page, 'GPT-4o Mini')
  await sendChatMessage(page, promptText)

  const card = byTestId(page, `elicitation-pending-${elicitationId}`).first()
  await expect(card).toBeVisible({ timeout: 30000 })
  return { elicitationId, card }
}
