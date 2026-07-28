import { test, expect } from '../../fixtures/test-context'
import { loginAsAdmin } from '../../common/auth-helpers'
import {
  createProviderViaAPI,
  createModelViaAPI,
  assignProviderToAdministratorsGroup,
} from '../../common/provider-helpers'
import { goToNewChatPage, selectModelInDropdown } from './helpers/chat-helpers'
import {
  mockChatTokenStream,
  startedEvent,
  mockGetMessages,
  mockUserMessage,
} from '../helpers/sse-mock-helpers'

/**
 * run_js inner-tool approval (TEST-11/12/30/31).
 *
 * When a run_js script calls a GATED sub-tool it suspends IN-PROCESS and the
 * stream emits `runJsApprovalRequired`. Unlike the turn-boundary MCP approval,
 * this resolves via the SIDE-CHANNEL `POST /api/mcp/elicitation/{id}/respond`
 * (the same in-process oneshot ask_user uses) — so the stream stays open (no
 * `complete`) until the user answers. These specs drive the approve/deny path
 * through the real `JsToolApprovalContent` component and assert the resolve POST.
 */
test.describe('run_js inner-tool approval', () => {
  test.beforeEach(async ({ page, testInfra }) => {
    const { baseURL, apiURL } = testInfra
    await loginAsAdmin(page, baseURL)
    const token = await getAdminToken(page)
    const providerId = await createProviderViaAPI(apiURL, token, 'OpenAI', 'openai')
    await assignProviderToAdministratorsGroup(apiURL, token, providerId)
    await createModelViaAPI(apiURL, token, providerId, undefined, undefined, 'openai')
  })

  test('approve: prompt resolves via side-channel /respond with accept', async ({
    page,
    testInfra,
  }) => {
    const eid = 'elic-runjs-approve'
    let respondAction: string | undefined
    await page.route('**/api/mcp/elicitation/*/respond', async (route) => {
      respondAction = route.request().postDataJSON()?.action
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
    })

    // Suspended stream: started + the approval frame, NO complete.
    await mockChatTokenStream(page, [
      [
        startedEvent({ userMessageId: 'umsg-rj-approve' }),
        {
          event: 'runJsApprovalRequired',
          data: { elicitation_id: eid, tool_name: 'web_search', server: 'web_search', input: { query: 'x' } },
        },
      ],
    ])
    await mockGetMessages(page, [mockUserMessage({ id: 'umsg-rj-approve', text: 'run a script' })])

    await goToNewChatPage(page, testInfra.baseURL)
    await sendChatMessage(page, 'run a script')

    const prompt = page.locator(`[data-testid="run-js-approval-${eid}"]`).first()
    await expect(prompt).toBeVisible({ timeout: 30000 })

    const approve = page.locator(`[data-testid="run-js-approval-approve-${eid}"]`)
    const deny = page.locator(`[data-testid="run-js-approval-deny-${eid}"]`)

    // FIX_ROUND-7: pin the ACCESSIBLE NAMES. This property flip-flopped across two
    // fix rounds with nothing guarding it: FIX_ROUND-5 added a `tooltip` to the
    // disabled state, and kit Button derives `aria-label` from a string tooltip
    // when no explicit `aria-label` is given — and these controls give none — so
    // both controls announced identically and became indistinguishable to a
    // screen reader (WCAG 2.5.3 / 4.1.2). Re-adding it turns this red.
    await expect(approve).toHaveAccessibleName(/approve/i)
    await expect(deny).toHaveAccessibleName(/deny/i)
    // Healthy transport -> both actionable, and no description pointing at an
    // empty status region.
    await expect(approve).toBeEnabled()
    await expect(deny).toBeEnabled()
    await expect(approve).not.toHaveAttribute('aria-describedby', /./)

    await approve.click()

    await expect.poll(() => respondAction, { timeout: 5000 }).toBe('accept')
    await expect(page.locator(`[data-testid="run-js-approval-status-${eid}"]`)).toHaveAttribute(
      'data-status',
      'approved',
      { timeout: 5000 },
    )
  })

  test('deny: prompt resolves via /respond with decline', async ({ page, testInfra }) => {
    const eid = 'elic-runjs-deny'
    let respondAction: string | undefined
    await page.route('**/api/mcp/elicitation/*/respond', async (route) => {
      respondAction = route.request().postDataJSON()?.action
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
    })

    await mockChatTokenStream(page, [
      [
        startedEvent({ userMessageId: 'umsg-rj-deny' }),
        {
          event: 'runJsApprovalRequired',
          data: { elicitation_id: eid, tool_name: 'web_search', server: 'web_search', input: {} },
        },
      ],
    ])
    await mockGetMessages(page, [mockUserMessage({ id: 'umsg-rj-deny', text: 'run a script' })])

    await goToNewChatPage(page, testInfra.baseURL)
    await sendChatMessage(page, 'run a script')

    await expect(page.locator(`[data-testid="run-js-approval-${eid}"]`).first()).toBeVisible({
      timeout: 30000,
    })
    await page.locator(`[data-testid="run-js-approval-deny-${eid}"]`).click()

    await expect.poll(() => respondAction, { timeout: 5000 }).toBe('decline')
    await expect(page.locator(`[data-testid="run-js-approval-status-${eid}"]`)).toHaveAttribute(
      'data-status',
      'denied',
      { timeout: 5000 },
    )
  })
})

async function getAdminToken(page: import('@playwright/test').Page): Promise<string> {
  const authData = await page.evaluate(() => localStorage.getItem('auth-storage'))
  return JSON.parse(authData!).state.token
}

async function sendChatMessage(page: import('@playwright/test').Page, text: string) {
  await selectModelInDropdown(page, 'GPT-4o Mini')
  const textarea = page.locator('textarea[placeholder*="Type your message"]').first()
  await textarea.fill(text)
  await page.getByRole('button', { name: 'Send message' }).click()
}
