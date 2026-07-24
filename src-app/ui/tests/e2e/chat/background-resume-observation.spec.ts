import type { Page } from '@playwright/test'
import { byTestId } from '../testid'
import { test, expect } from '../../fixtures/test-context'
import { loginAsAdmin } from '../../common/auth-helpers'
import {
  createProviderViaAPI,
  createModelViaAPI,
  assignProviderToAdministratorsGroup,
} from '../../common/provider-helpers'
import { goToNewChatPage, selectModelInDropdown } from './helpers/chat-helpers'
import {
  mockChatStream,
  startedEvent,
  completeEvent,
  mockGetMessages,
  mockUserMessage,
  type MockMessageWithContent,
} from '../helpers/sse-mock-helpers'

/**
 * Background push-to-resume — observation-card rendering (TEST-10 / ITEM-8).
 *
 * When a detached background sub-agent completes, its result is injected into the
 * conversation as an `observation`-typed content block (DEC-1). It rides a
 * user-ROLE message on the wire (so the model sees it as context), but it must
 * render as a DISTINCT system/observation card — NOT a right-aligned user bubble,
 * and NOT offering an "Edit" affordance (it's system-authored). This spec drives
 * the render exactly as the sibling `empty-completion.spec.ts` drives a
 * thinking-card render: it mocks the persisted history to contain an observation
 * message + a following assistant continuation, then asserts the distinct card.
 */

const OBSERVATION_TEXT =
  '[Background task complete] A background sub-agent you started has finished.\n\n' +
  'Task: Say a one-line hello.\n\nResult:\nHello from the background sub-agent.\n\n' +
  'Use this result to continue the conversation.'

// The injected background result: a user-role message whose sole content is an
// `observation` block (this is what push-to-resume persists).
const observationMessage = (id: string): MockMessageWithContent => ({
  id,
  role: 'user',
  contents: [
    {
      content_type: 'observation',
      content: { type: 'observation', text: OBSERVATION_TEXT },
    },
  ],
})

// The assistant's continuation, produced from the background result.
const assistantContinuation = (id: string): MockMessageWithContent => ({
  id,
  role: 'assistant',
  contents: [
    {
      content_type: 'text',
      content: {
        type: 'text',
        text: 'Based on the background result, here is the continuation.',
      },
    },
  ],
})

// The chat-message row that contains the observation card.
const observationRow = (page: Page) =>
  page.locator('[data-testid="chat-message"]', {
    has: page.locator('[data-testid="observation-card"]'),
  })

test.describe('Background push-to-resume observation card', () => {
  test.beforeEach(async ({ page, testInfra }) => {
    const { baseURL, apiURL } = testInfra
    await loginAsAdmin(page, baseURL)
    const token = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('auth-storage')!).state.token,
    )
    const providerId = await createProviderViaAPI(apiURL, token, 'OpenAI', 'openai')
    await assignProviderToAdministratorsGroup(apiURL, token, providerId)
    await createModelViaAPI(apiURL, token, providerId, undefined, undefined, 'openai')
  })

  test('injected background result renders as a distinct observation card (not a user bubble) and the assistant continues', async ({
    page,
    testInfra,
  }) => {
    await mockChatStream(page, [
      [
        startedEvent({ userMessageId: 'umsg_obs_1' }),
        completeEvent({ finishReason: 'stop' }),
      ],
    ])
    // The persisted history the chat refetches after `complete`: the user's send,
    // then the injected observation turn, then the assistant continuation.
    await mockGetMessages(page, [
      mockUserMessage({ id: 'umsg_obs_1', text: 'research something in the background' }),
      observationMessage('obs_msg_1'),
      assistantContinuation('amsg_obs_1'),
    ])

    await goToNewChatPage(page, testInfra.baseURL)
    await selectModelInDropdown(page, 'GPT-4o Mini')

    const textarea = byTestId(page, 'chat-message-textarea').first()
    await textarea.fill('research something in the background')
    await byTestId(page, 'chat-input-send-btn').click()

    // The distinct observation card renders, showing the framed result payload.
    await expect(byTestId(page, 'observation-card')).toBeVisible({ timeout: 15000 })
    await expect(
      page.getByText('Hello from the background sub-agent.'),
    ).toBeVisible()

    // It is NOT treated as a user-authored message: the observation row offers NO
    // "Edit" affordance (a real user bubble does). This is the "not a user bubble"
    // signal — a user message renders `edit-message-button`, an observation does not.
    await expect(
      observationRow(page).locator('[data-testid="edit-message-button"]'),
    ).toHaveCount(0)

    // And the model CONTINUED from it — the assistant reply is present.
    await expect(
      page.getByText('Based on the background result, here is the continuation.'),
    ).toBeVisible()

    // Render is derived from the persisted content, so it survives a reload.
    await page.reload()
    await expect(byTestId(page, 'observation-card')).toBeVisible({ timeout: 15000 })
    await expect(
      observationRow(page).locator('[data-testid="edit-message-button"]'),
    ).toHaveCount(0)
  })
})
