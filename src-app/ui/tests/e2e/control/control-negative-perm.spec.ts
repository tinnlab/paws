import { test, expect } from '../../fixtures/test-context'
import { loginAsAdmin, getAdminToken, createTestUser, login } from '../../common/auth-helpers'
import {
  createProviderViaAPI,
  assignProviderToAdministratorsGroup,
  createGroupViaAPI,
  assignUserToGroupViaAPI,
  assignProviderToGroupViaAPI,
} from '../../common/provider-helpers'
import { goToNewChatPage, selectModelInDropdown, sendChatMessage } from '../chat/helpers/chat-helpers'
import {
  TEST_LLM,
  NO_LLM_SKIP,
  createToolCapableModel,
  listJson,
} from './helpers/control-llm-helpers'

/**
 * control_mcp — the RESTRICTED-USER half of the authorization proof.
 *
 * The happy-path matrix runs as an admin and therefore can never catch an
 * ungated control operation. This spec drives the SAME surface as a user who
 * holds `control::use` but LACKS the permission each operation needs, and
 * asserts both halves of the contract:
 *
 *   (a) NOT OFFERED — an operation whose route declares a required permission is
 *       filtered out of `list_capabilities` / refused by `describe_capability`,
 *       so the model never even sees it.
 *   (b) DENIED — an operation whose route declares no permission in its docs is
 *       still offered, but the invoke is dispatched over loopback carrying the
 *       CALLER's JWT, so the real route refuses it and nothing is created.
 *
 * Both halves are needed: asserting only (a) would silently pass for every
 * operation the catalog cannot filter, and asserting only (b) would skip the
 * layer the control surface itself implements.
 */

const MODEL_DISPLAY_NAME = 'Control Negative Perm Model'
const RESTRICTED_PASSWORD = 'Restricted!123'

/** Everything needed to CHAT, plus `control::use` — but no write permissions. */
const RESTRICTED_PERMISSIONS = [
  'conversations::create',
  'conversations::read',
  'conversations::edit',
  'messages::create',
  'messages::read',
  'llm_models::read',
  'control::use',
  // Read-only visibility so the assertions below can observe "nothing created".
  'projects::read',
]

test.describe('control_mcp — a user lacking the permission cannot drive the operation', () => {
  test.skip(!TEST_LLM, NO_LLM_SKIP)
  test.describe.configure({ retries: 2 })
  test.slow()

  /**
   * Seed: a tool-capable model on the configured LLM, plus a restricted user in
   * a group that can reach that model but holds no write permissions.
   */
  async function seed(page: import('@playwright/test').Page, baseURL: string, apiURL: string) {
    const llm = TEST_LLM as NonNullable<typeof TEST_LLM>
    await loginAsAdmin(page, baseURL)
    const adminToken = await getAdminToken(apiURL)

    const providerId = await createProviderViaAPI(
      apiURL,
      adminToken,
      llm.providerName,
      llm.providerType,
    )
    await assignProviderToAdministratorsGroup(apiURL, adminToken, providerId)
    await createToolCapableModel(
      page,
      apiURL,
      adminToken,
      providerId,
      MODEL_DISPLAY_NAME,
      llm.model,
    )

    const stamp = Date.now()
    const username = `ctl_restricted_${stamp}`
    const groupId = await createGroupViaAPI(
      apiURL,
      adminToken,
      `ctl_restricted_group_${stamp}`,
      'control_mcp negative-permission group',
      RESTRICTED_PERMISSIONS,
    )
    const userId = await createTestUser(
      apiURL,
      adminToken,
      username,
      `${username}@example.com`,
      RESTRICTED_PASSWORD,
      RESTRICTED_PERMISSIONS,
    )
    await assignUserToGroupViaAPI(apiURL, adminToken, userId, groupId)
    // The restricted user must be able to REACH the model, or every assertion
    // below would pass vacuously (no chat, therefore no write).
    await assignProviderToGroupViaAPI(apiURL, adminToken, groupId, [providerId])

    return { adminToken, username }
  }

  /** Call the control MCP JSON-RPC as `token`. */
  async function controlTool(
    page: import('@playwright/test').Page,
    apiURL: string,
    token: string,
    name: string,
    args: Record<string, unknown>,
  ) {
    const res = await page.request.post(`${apiURL}/api/control/mcp`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
    })
    return { status: res.status(), body: await res.json().catch(() => ({})) }
  }

  function operationIds(body: Record<string, any>): string[] {
    const ops = body?.result?.structuredContent?.operations ?? []
    return ops.map((o: { operation_id?: string }) => o.operation_id ?? '')
  }

  /**
   * TEST-17(a) — NOT OFFERED.
   *
   * `User.delete` declares `**Required Permission:** users::delete`, which the
   * default Users group does NOT grant — so the control surface's per-user
   * filter must hide it from an ordinary user, while an admin (the positive
   * control, which is what keeps this test from being vacuous) still sees it for
   * the SAME query.
   *
   * The subject must be an operation the restricted user genuinely lacks: every
   * new account joins the default Users group, so an op that group grants (e.g.
   * `MemorySettings.update` / `memory::write`) is legitimately still offered and
   * would make this assertion a false alarm.
   */
  test('an operation the user lacks permission for is NOT OFFERED by the control tools', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    const { adminToken, username } = await seed(page, baseURL, apiURL)

    // Positive control: the query DOES find the operation for someone permitted.
    const asAdmin = await controlTool(page, apiURL, adminToken, 'list_capabilities', {
      query: 'delete user',
    })
    expect(
      operationIds(asAdmin.body),
      'positive control: an admin must see User.delete for this query',
    ).toContain('User.delete')

    // The restricted user's own token.
    const loginRes = await page.request.post(`${apiURL}/api/auth/login`, {
      data: { username, password: RESTRICTED_PASSWORD },
    })
    expect(loginRes.ok(), 'the restricted user must be able to log in').toBeTruthy()
    const restrictedToken = (await loginRes.json()).access_token as string

    const asRestricted = await controlTool(page, apiURL, restrictedToken, 'list_capabilities', {
      query: 'delete user',
    })
    expect(
      operationIds(asRestricted.body),
      'a user without users::delete must NOT be offered User.delete',
    ).not.toContain('User.delete')

    // …and cannot even read its schema.
    const describe = await controlTool(page, apiURL, restrictedToken, 'describe_capability', {
      operation_id: 'User.delete',
    })
    const text = JSON.stringify(describe.body)
    expect(
      describe.body?.error !== undefined || describe.body?.result?.isError === true,
      `describe_capability must refuse an unpermitted operation, got: ${text}`,
    ).toBeTruthy()
  })

  /**
   * TEST-17(b) — DENIED, through the real chat UI.
   *
   * `Project.create` declares no permission in its handler docs, so the catalog
   * cannot filter it — it IS offered. The real gate is the forwarded-JWT
   * loopback dispatch: the route's own `projects::create` check refuses, and no
   * project is created even if the human approves.
   */
  test('an offered-but-unpermitted write creates NOTHING even after the user approves', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    const { username } = await seed(page, baseURL, apiURL)

    await login(page, baseURL, username, RESTRICTED_PASSWORD)
    await goToNewChatPage(page, baseURL)
    await selectModelInDropdown(page, MODEL_DISPLAY_NAME)

    const restrictedToken = (
      await (
        await page.request.post(`${apiURL}/api/auth/login`, {
          data: { username, password: RESTRICTED_PASSWORD },
        })
      ).json()
    ).access_token as string

    const before = await listJson(page, apiURL, restrictedToken, '/api/projects?per_page=100', 'projects')
    expect(before.length, 'the restricted user starts with no projects').toBe(0)

    const name = `ControlNoPerm_${Date.now()}`
    await sendChatMessage(page, `Create a new project called "${name}" for me.`, false)

    // If the model reaches the mutating invoke, the approval card appears —
    // approve it, so the test proves the BACKEND refuses rather than relying on
    // the model failing to get that far.
    const approve = page.locator('[data-testid="tool-approval-approve-once"]').first()
    if (await approve.isVisible({ timeout: 120000 }).catch(() => false)) {
      await approve.click()
    }

    // Settle, then assert nothing was created no matter what the model did.
    await page.waitForTimeout(8000)
    const after = await listJson(page, apiURL, restrictedToken, '/api/projects?per_page=100', 'projects')
    expect(
      after.length,
      'a user without projects::create must never end up with a project',
    ).toBe(0)
  })
})
