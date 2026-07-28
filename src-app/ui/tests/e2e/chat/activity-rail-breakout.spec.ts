import { test, expect } from '../../fixtures/test-context'
import { loginAsAdmin } from '../../common/auth-helpers'
import {
  createProviderViaAPI,
  createModelViaAPI,
  assignProviderToAdministratorsGroup,
} from '../../common/provider-helpers'
import {
  goToNewChatPage,
  selectModelInDropdown,
  sendChatMessage,
} from './helpers/chat-helpers'
import {
  mockChatTokenStream,
  startedEvent,
  mcpToolStartEvent,
  mcpToolCompleteEvent,
  mcpApprovalRequiredEvent,
  completeEvent,
  mockGetMessages,
  mockUserMessage,
  type MockMessageContent,
} from '../helpers/sse-mock-helpers'
import {
  mockToolUseContent,
  mockToolResultContent,
} from './fixtures/mock-tool-result'

/**
 * TEST-3 [acceptance, INV-3] — THE BREAKOUT.
 *
 * INV-3: "Anything that needs the user breaks out of the rail: a request for
 * input is never collapsed into a rail row."
 *
 * A pending tool approval is the canonical case. Collapsing it into a rail row
 * would strand the user behind a disclosure triangle: the turn cannot proceed
 * until they answer, and they would have no visible prompt telling them so.
 *
 * A live `pending_approval` status exists ONLY in the MCP extension's SSE-fed
 * store — a persisted `tool_use`/`tool_result` pair cannot express it — so this
 * spec drives the existing in-repo chat-stream mock (`mockChatTokenStream` +
 * `mcpApprovalRequiredEvent`), exactly as `07-mcp/tool-group-auto-open.spec.ts`
 * does for the retired group card. Every route it mocks
 * (`PUT /api/chat/stream/subscription`, `POST /api/conversations/{id}/messages`,
 * `GET /api/chat/stream`, `GET /api/conversations/{id}/messages`) is a live
 * route in `openapi/openapi.json`.
 */

const SERVER_ID = 'srv-rail-breakout'
const USE_DONE = 'tu_rail_bo_done'
const USE_PENDING = 'tu_rail_bo_pending'
const USE_SECOND = 'tu_rail_bo_second'
const USER_MSG = 'umsg_rail_bo'
const ASSISTANT_MSG = 'amsg_rail_bo'

test.describe('Activity rail — a request for input breaks OUT of the rail (INV-3)', () => {
  test.beforeEach(async ({ page, testInfra }) => {
    const { baseURL, apiURL } = testInfra
    await loginAsAdmin(page, baseURL)
    const token = await page.evaluate(
      () => JSON.parse(localStorage.getItem('auth-storage')!).state.token,
    )
    const providerId = await createProviderViaAPI(apiURL, token, 'OpenAI', 'openai')
    await assignProviderToAdministratorsGroup(apiURL, token, providerId)
    await createModelViaAPI(apiURL, token, providerId, undefined, undefined, 'openai')
  })

  test('a pending approval renders outside the rail, full width, with no control that collapses or hides it', async ({
    page,
    testInfra,
  }) => {
    // Two completed tools + one awaiting approval. The two completed calls are
    // what make the rail a RAIL (a multi-step span with a collapse control), so
    // "the approval is not inside it" is a real assertion rather than a vacuous
    // one on a rail that has no container at all.
    await mockChatTokenStream(page, [
      [
        startedEvent({ userMessageId: USER_MSG }),
        mcpToolStartEvent({
          toolUseId: USE_DONE,
          toolName: 'search',
          server: SERVER_ID,
        }),
        mcpToolCompleteEvent({ toolUseId: USE_DONE, isError: false, result: { ok: true } }),
        mcpToolStartEvent({
          toolUseId: USE_SECOND,
          toolName: 'lookup',
          server: SERVER_ID,
        }),
        mcpToolCompleteEvent({ toolUseId: USE_SECOND, isError: false, result: { ok: true } }),
        mcpApprovalRequiredEvent({
          toolUseId: USE_PENDING,
          toolName: 'dangerous_op',
          server: SERVER_ID,
          input: { target: 'production' },
        }),
        completeEvent({ finishReason: 'tool_use' }),
      ],
    ])

    const contents: MockMessageContent[] = [
      mockToolUseContent({ toolUseId: USE_DONE, toolName: 'search', serverId: SERVER_ID }),
      mockToolResultContent({ toolUseId: USE_DONE, toolName: 'search', resourceLinks: [] }),
      mockToolUseContent({ toolUseId: USE_SECOND, toolName: 'lookup', serverId: SERVER_ID }),
      mockToolResultContent({ toolUseId: USE_SECOND, toolName: 'lookup', resourceLinks: [] }),
      mockToolUseContent({
        toolUseId: USE_PENDING,
        toolName: 'dangerous_op',
        serverId: SERVER_ID,
        input: { target: 'production' },
      }),
    ]
    await mockGetMessages(page, [
      mockUserMessage({ id: USER_MSG, text: 'run the ops' }),
      { id: ASSISTANT_MSG, role: 'assistant', contents },
    ])

    await goToNewChatPage(page, testInfra.baseURL)
    await selectModelInDropdown(page, 'GPT-4o Mini')
    await sendChatMessage(page, 'run the ops')

    const message = page.locator(
      `[data-testid="chat-message"][data-message-id="${ASSISTANT_MSG}"]`,
    )
    await expect(message).toBeVisible({ timeout: 20000 })

    const breakout = message.getByTestId('rail-breakout')
    const rail = message.getByTestId('activity-rail')

    // 1. The approval is ACTIONABLE without any disclosure step.
    await expect(breakout).toBeVisible({ timeout: 20000 })
    await expect(
      breakout.locator('[data-testid="tool-approval-approve-once"]'),
    ).toBeVisible()
    await expect(breakout.locator('[data-testid="tool-approval-deny"]')).toBeVisible()

    // 2. It is a SIBLING of the rail, never a row inside it.
    await expect(rail).toBeVisible()
    await expect(rail.getByTestId('rail-breakout')).toHaveCount(0)
    await expect(breakout.getByTestId('activity-rail')).toHaveCount(0)
    // Not a rail STEP either.
    await expect(
      breakout.locator(`[data-testid="rail-step"][data-step-key="${USE_PENDING}"]`),
    ).toHaveCount(0)
    await expect(
      page.locator(
        `[data-testid="activity-rail-steps"] [data-step-key="${USE_PENDING}"]`,
      ),
    ).toHaveCount(0)
    // Structural proof, not a coincidence of nesting order: the two nodes share
    // a parent.
    const isSibling = await message.evaluate(el => {
      const b = el.querySelector('[data-testid="rail-breakout"]')
      const r = el.querySelector('[data-testid="activity-rail"]')
      return !!b && !!r && b.parentElement === r.parentElement
    })
    expect(
      isSibling,
      'the breakout must be a sibling of the rail, not nested inside it',
    ).toBe(true)

    // 3. FULL WIDTH — it spans the bubble, unlike an indented rail row.
    const widths = await message.evaluate(el => {
      const b = el.querySelector('[data-testid="rail-breakout"]') as HTMLElement
      return {
        breakout: b.getBoundingClientRect().width,
        parent: (b.parentElement as HTMLElement).getBoundingClientRect().width,
      }
    })
    expect(widths.breakout).toBeGreaterThan(0)
    expect(widths.breakout).toBeGreaterThanOrEqual(widths.parent - 1)

    // 4. NO control inside it that collapses or hides IT. The card may contain
    //    an inner clamp (the tool-description "Show more/less"), so the
    //    assertion is behavioural rather than structural: actuate EVERY
    //    disclosure control in the breakout and prove none of them can take the
    //    approval decision away.
    const disclosures = breakout.locator('[aria-expanded]')
    const disclosureCount = await disclosures.count()
    for (let i = 0; i < disclosureCount; i++) {
      await disclosures.nth(i).click({ force: true })
      await expect(
        breakout.locator('[data-testid="tool-approval-approve-once"]'),
        'a control inside the breakout hid the approval decision',
      ).toBeVisible()
      await expect(breakout).toBeVisible()
    }
    // …and no control ADVERTISES collapsing the request itself.
    await expect(
      breakout.getByRole('button', { name: /^(collapse|hide)\b/i }),
    ).toHaveCount(0)

    // 5. …and it stays that way while the RAIL ITSELF is collapsed. Collapse
    //    the rail through its own summary control, then re-assert.
    const summary = rail.getByTestId('activity-rail-summary')
    if (await summary.isVisible()) {
      if ((await summary.getAttribute('aria-expanded')) === 'true') {
        await summary.click()
        await expect(summary).toHaveAttribute('aria-expanded', 'false')
      }
      await expect(rail.getByTestId('activity-rail-steps')).toHaveCount(0)
    }
    await expect(breakout).toBeVisible()
    await expect(
      breakout.locator('[data-testid="tool-approval-approve-once"]'),
    ).toBeVisible()

    // 6. The approval is genuinely usable — exercise it, don't just look at it.
    await breakout.locator('[data-testid="tool-approval-deny"]').click()
    await expect(
      breakout.locator('[data-testid="tool-approval-approve-once"]'),
    ).toHaveCount(0, { timeout: 15000 })
  })
})
