import type { Locator, Page } from '@playwright/test'
import { test, expect } from '../../fixtures/test-context'
import type { TestInfrastructure } from '../../fixtures/test-context'
import {
  loginAsAdmin,
  getAdminToken,
  getCurrentUserToken,
  createTestUser,
  login,
} from '../../common/auth-helpers'
import {
  currentUserId,
  openSeededConversation,
  openStepRecord,
  railIn,
  seedRailConversation,
  seedToolCallRecord,
  textBlock,
  toolPair,
} from './helpers/rail-helpers'

/**
 * TEST-41 [negative-perm] — THE ADMIN-GATED RAW REVEAL.
 *
 * The step-detail panel renders a tool call's arguments REDACTED by default
 * (DEC-1), and offers a permission-gated "Reveal raw" affordance so no
 * user-meaningful detail becomes permanently unreachable (INV-2). The gate is
 * `mcp_servers_admin::edit` — whose holder can already read and set a system
 * server's configured secret headers, so revealing arguments grants them nothing
 * they lack.
 *
 * The point of a negative-permission spec is that a 403 on use is NOT the
 * contract: a user without the permission must see NO AFFORDANCE AT ALL — no
 * button, no menu item, no focusable control, nothing a keyboard user can reach.
 * A surface that renders a disabled-looking control and relies on the endpoint
 * to refuse has already told the user a secret exists and is one bug away from
 * leaking it. So this walks the DOM for absence.
 *
 * Both halves are owner-scoped: each user seeds and reads THEIR OWN
 * conversation, because the reveal endpoint 404s on another user's row even for
 * an administrator.
 */

const SECRET = 'sk-live-RAILREVEAL-0xdeadbeef'
const REDACTED = '[redacted]'

/** Every control a user could actuate inside `scope`, with its visible + a11y name. */
async function actionableNames(scope: Locator): Promise<string[]> {
  return scope.evaluate(root => {
    const nodes = root.querySelectorAll<HTMLElement>(
      'button, a[href], [role="button"], [role="menuitem"], [role="option"], [tabindex]:not([tabindex="-1"]), input, summary',
    )
    return Array.from(nodes).map(el =>
      [
        el.getAttribute('aria-label') ?? '',
        el.getAttribute('title') ?? '',
        el.getAttribute('data-testid') ?? '',
        (el.textContent ?? '').trim(),
      ]
        .filter(Boolean)
        .join(' | '),
    )
  })
}

/**
 * Seed a conversation whose single tool call carries a SECRET argument, plus the
 * recorded (already-redacted) history row the detail panel joins to.
 */
async function seedSecretCall(
  page: Page,
  testInfra: Pick<TestInfrastructure, 'apiURL' | 'sql'>,
  token: string,
  label: string,
): Promise<{ conversationId: string; assistantId: string; toolUseId: string }> {
  const { apiURL } = testInfra
  const userId = await currentUserId(page, apiURL, token)
  const toolUseId = `toolu_reveal_${label}`

  const seeded = await seedRailConversation(
    page,
    testInfra,
    token,
    `rail-reveal-${label}`,
    [
      { role: 'user', blocks: [textBlock('Call the billing API for me.')] },
      {
        role: 'assistant',
        blocks: [
          ...toolPair({
            id: toolUseId,
            name: 'call_billing_api',
            // The raw secret lives on the transcript block — which is exactly
            // where the reveal endpoint reads it from.
            serverId: '00000000-0000-0000-0000-0000000000aa',
            input: { endpoint: 'https://billing.example.com/v1', api_key: SECRET },
            result: 'Billing API returned 12 open invoices.',
            structuredContent: { invoices: 12 },
          }),
          textBlock('You have 12 open invoices.'),
        ],
      },
    ],
  )
  const assistantId = seeded.messageIds[1]

  // The RECORDED row is already redacted at write time (`cap_arguments`), so the
  // seed mirrors that: the history column has never held the raw value.
  await seedToolCallRecord(testInfra, {
    userId,
    conversationId: seeded.conversationId,
    messageId: assistantId,
    toolUseId,
    toolName: 'call_billing_api',
    serverName: 'Billing (external)',
    argumentsJson: {
      endpoint: 'https://billing.example.com/v1',
      api_key: REDACTED,
    },
    resultJson: { invoices: 12 },
    durationMs: 2100,
  })

  return { conversationId: seeded.conversationId, assistantId, toolUseId }
}

test.describe('Activity rail — raw-argument reveal is permission-gated (TEST-41)', () => {
  test('a user WITHOUT mcp_servers_admin::edit sees no reveal affordance anywhere, and only the redacted value', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    // Bootstrap the admin (so the instance is set up), then act as a restricted
    // user with only the permissions the chat + history surfaces need.
    await loginAsAdmin(page, baseURL)
    const adminToken = await getAdminToken(apiURL)
    const username = `railreveal_${Date.now().toString(36)}`
    await createTestUser(apiURL, adminToken, username, `${username}@ex.com`, 'password123', [
      'profile::read',
      'profile::edit',
      'conversations::read',
      'conversations::edit',
      // Enough to READ the tool-call history — and deliberately NOT
      // `mcp_servers_admin::edit`, the reveal gate.
      'mcp_servers::read',
    ])
    await login(page, baseURL, username, 'password123')
    const userToken = await getCurrentUserToken(page)

    const { conversationId, assistantId, toolUseId } = await seedSecretCall(
      page,
      testInfra,
      userToken,
      'restricted',
    )
    await openSeededConversation(page, baseURL, conversationId)

    const rail = railIn(page, assistantId)
    const panel = await openStepRecord(page, rail, toolUseId)
    const record = panel.getByTestId('tool-call-panel')
    await expect(record).toBeVisible({ timeout: 20000 })

    // The redacted value is all they can obtain.
    const args = record.getByTestId('tool-call-panel-args')
    await expect(args).toContainText(REDACTED)
    await expect(args).not.toContainText(SECRET)
    await expect(record.getByTestId('tool-call-panel-raw-args')).toHaveCount(0)

    // NO AFFORDANCE — button, menu item, or any focusable control.
    await expect(panel.getByTestId('tool-call-reveal-btn')).toHaveCount(0)
    await expect(panel.getByRole('button', { name: /reveal/i })).toHaveCount(0)
    await expect(panel.getByRole('menuitem', { name: /reveal|raw/i })).toHaveCount(0)
    // …and not merely hidden elsewhere on the page either.
    await expect(page.getByTestId('tool-call-reveal-btn')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /reveal/i })).toHaveCount(0)

    // No KEYBOARD path: enumerate every actuatable node in the panel and assert
    // none of them is a reveal control.
    const names = await actionableNames(panel)
    expect(names.length, 'the panel must expose some controls (copy…)').toBeGreaterThan(0)
    for (const n of names) {
      expect(n, `a focusable control offers a reveal path: "${n}"`).not.toMatch(
        /reveal|unredact|show raw/i,
      )
    }

    // Nothing anywhere in the rendered panel leaks the secret.
    const panelText = await panel.innerText()
    expect(panelText).not.toContain(SECRET)

    // Independently, the endpoint itself refuses — the DOM absence is the
    // contract, this is the second lock.
    const rowId = (
      await (
        await page.request.get(
          `${apiURL}/api/mcp/tool-calls?tool_use_id=${toolUseId}&per_page=1`,
          { headers: { Authorization: `Bearer ${userToken}` } },
        )
      ).json()
    ).calls[0].id as string
    const refused = await page.request.get(
      `${apiURL}/api/mcp/tool-calls/${rowId}/reveal`,
      { headers: { Authorization: `Bearer ${userToken}` } },
    )
    expect(
      refused.status(),
      'the reveal endpoint must refuse a user without mcp_servers_admin::edit',
    ).toBe(403)
  })

  test('an ADMIN sees the reveal affordance and can obtain the raw arguments', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    await loginAsAdmin(page, baseURL)
    const adminToken = await getAdminToken(apiURL)

    const { conversationId, assistantId, toolUseId } = await seedSecretCall(
      page,
      testInfra,
      adminToken,
      'admin',
    )
    await openSeededConversation(page, baseURL, conversationId)

    const rail = railIn(page, assistantId)
    const panel = await openStepRecord(page, rail, toolUseId)
    const record = panel.getByTestId('tool-call-panel')
    await expect(record).toBeVisible({ timeout: 20000 })

    // Default is STILL redacted — the reveal is opt-in, not automatic.
    await expect(record.getByTestId('tool-call-panel-args')).toContainText(REDACTED)
    await expect(record.getByTestId('tool-call-panel-raw-args')).toHaveCount(0)

    const revealBtn = panel.getByTestId('tool-call-reveal-btn')
    await expect(revealBtn).toBeVisible()
    await revealBtn.click()

    // The raw value arrives in its own block, and no error is surfaced.
    await expect(panel.getByTestId('tool-call-reveal-error')).toHaveCount(0)
    await expect(panel.getByTestId('tool-call-panel-raw-args')).toContainText(
      SECRET,
      { timeout: 15000 },
    )
  })
})
