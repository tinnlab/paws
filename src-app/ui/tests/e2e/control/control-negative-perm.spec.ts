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
  setAutoApproveDefault,
  recordedToolNames,
  currentConversationId,
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
  // Read-only visibility so the assertions below can observe "nothing created"
  // and can read the MCP tool-call history that proves the invoke was ATTEMPTED.
  'projects::read',
  'mcp_servers::read',
]

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

/** Create the restricted user (no model, no provider) and return their token. */
async function seedRestrictedUser(
  page: import('@playwright/test').Page,
  apiURL: string,
  adminToken: string,
): Promise<{ username: string; groupId: string; token: string }> {
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
  const loginRes = await page.request.post(`${apiURL}/api/auth/login`, {
    data: { username, password: RESTRICTED_PASSWORD },
  })
  expect(loginRes.ok(), 'the restricted user must be able to log in').toBeTruthy()
  return { username, groupId, token: (await loginRes.json()).access_token as string }
}

/**
 * TEST-17(a) — NOT OFFERED. Deliberately OUTSIDE the LLM gate: it drives only
 * JSON-RPC + REST, so an authorization proof must not go dark on a box with no
 * model configured (that is the very failure this feature exists to end).
 */
test.describe('control_mcp — an unpermitted operation is not offered', () => {
  test('an operation the user lacks permission for is NOT OFFERED by the control tools', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    await loginAsAdmin(page, baseURL)
    const adminToken = await getAdminToken(apiURL)
    const { token: restrictedToken } = await seedRestrictedUser(page, apiURL, adminToken)

    // Positive control: the query DOES find the operation for someone permitted.
    const asAdmin = await controlTool(page, apiURL, adminToken, 'list_capabilities', {
      query: 'delete user',
    })
    expect(
      operationIds(asAdmin.body),
      'positive control: an admin must see User.delete for this query',
    ).toContain('User.delete')

    const asRestricted = await controlTool(page, apiURL, restrictedToken, 'list_capabilities', {
      query: 'delete user',
    })
    // The restricted user must genuinely REACH the control surface — otherwise
    // "User.delete is absent" would be satisfied by a 401/403/empty response and
    // would prove nothing about the per-user filter. Probed with an operation the
    // user demonstrably HOLDS (`projects::read` -> Project.list), so this liveness
    // check stays valid no matter how the catalog's permission coverage changes.
    const liveness = await controlTool(page, apiURL, restrictedToken, 'list_capabilities', {
      query: 'list projects',
    })
    expect(
      operationIds(liveness.body),
      `the restricted user must reach the control surface: ${JSON.stringify(liveness.body).slice(0, 400)}`,
    ).toContain('Project.list')
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
    // A permitted operation's schema still resolves for the same user — proving
    // the refusal above is the PERMISSION filter, not a broken tool.
    const permitted = await controlTool(page, apiURL, restrictedToken, 'describe_capability', {
      operation_id: 'Project.list',
    })
    expect(
      permitted.body?.error === undefined,
      `describe_capability must still work for a permitted op: ${JSON.stringify(permitted.body).slice(0, 400)}`,
    ).toBeTruthy()
  })

  /**
   * TEST-17(b1) — DENIED, deterministically.
   *
   * `Project.create` reaches the catalog with `required_permission: null` (the
   * KNOWN GAP above), so it IS offered to any `control::use` holder even though
   * its route requires `projects::create`. The real gate is the forwarded-JWT
   * loopback dispatch: the route re-authorizes and refuses. Driven straight at
   * the JSON-RPC surface so the authorization proof does not depend on a model
   * choosing to call the tool (and so it runs on a box with no LLM at all).
   */
  test('an offered-but-unpermitted write is REFUSED by the real route and creates nothing', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    await loginAsAdmin(page, baseURL)
    const adminToken = await getAdminToken(apiURL)
    const { token: restrictedToken } = await seedRestrictedUser(page, apiURL, adminToken)

    // It really is OFFERED — otherwise this would be a not-offered test wearing
    // the wrong name, and the loopback gate would go unexercised.
    const offered = await controlTool(page, apiURL, restrictedToken, 'list_capabilities', {
      query: 'create project',
    })
    expect(
      operationIds(offered.body),
      'Project.create declares no permission, so it must still be OFFERED',
    ).toContain('Project.create')

    const name = `ControlNoPerm_${Date.now()}`
    const invoke = await controlTool(page, apiURL, restrictedToken, 'invoke_capability', {
      operation_id: 'Project.create',
      body: { name },
    })
    const payload = JSON.stringify(invoke.body)
    expect(
      invoke.body?.error !== undefined || invoke.body?.result?.structuredContent?.ok === false,
      `the loopback dispatch must be refused for a user without projects::create: ${payload.slice(0, 500)}`,
    ).toBeTruthy()
    expect(payload, 'the refusal must be an authorization refusal').toMatch(/403|forbidden|permission/i)

    const after = await listJson(
      page,
      apiURL,
      restrictedToken,
      '/api/projects?per_page=100',
      'projects',
    )
    expect(after.length, 'a refused control write must create nothing').toBe(0)
  })
})

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

    const restricted = await seedRestrictedUser(page, apiURL, adminToken)
    // The restricted user must be able to REACH the model, or every assertion
    // below would pass vacuously (no chat, therefore no write).
    await assignProviderToGroupViaAPI(apiURL, adminToken, restricted.groupId, [providerId])
    // Auto-approve so a card appearing is meaningful, and so the invoke is not
    // parked behind a prompt this test would have to babysit.
    await setAutoApproveDefault(page, apiURL, restricted.token)

    return { adminToken, ...restricted }
  }

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

    const before = await listJson(
      page,
      apiURL,
      restrictedToken,
      '/api/projects?per_page=100',
      'projects',
    )
    expect(before.length, 'the restricted user starts with no projects').toBe(0)

    const name = `ControlNoPerm_${Date.now()}`
    // Nudged like the table rows: names the tool FAMILY, never an operation id,
    // so discovery is still required. This leg is about AUTHORIZATION, and a
    // chatty local model stalling on a clarifying question would make it a test
    // of model manners instead.
    await sendChatMessage(
      page,
      `Create a new project called "${name}" for me. Use the app-control tools; do not ask me first.`,
      false,
    )

    // If the model reaches the mutating invoke the approval card appears —
    // approve it, so what is under test is the BACKEND refusing, not the model
    // failing to get that far.
    const approve = page.locator('[data-testid="tool-approval-approve-once"]').first()
    if (await approve.isVisible({ timeout: 120000 }).catch(() => false)) {
      await approve.click()
    }

    // The control surface must genuinely have been EXERCISED in this chat.
    // Without this the test passes on a turn where the model said nothing at all
    // — a green run that never touched the feature.
    //
    // The assertion is on discovery rather than on `invoke_capability`
    // deliberately: whether a 35B local model chooses to attempt the write is its
    // decision, not the product's. The REFUSAL itself is proven deterministically
    // by the sibling test above ("an offered-but-unpermitted write is REFUSED by
    // the real route"), which drives the invoke directly; this test's job is the
    // end-to-end UI journey ending with nothing created.
    const conversationId = currentConversationId(page)
    expect(conversationId, 'the restricted user must have started a conversation').toBeTruthy()
    await expect
      .poll(
        async () => recordedToolNames(page, apiURL, restrictedToken, conversationId as string),
        { timeout: 120000 },
      )
      .toContain('list_capabilities')

    // …and nothing was created. `listJson` throws on a non-OK read, so this
    // cannot pass on a broken/forbidden list endpoint either.
    await page.waitForTimeout(5000)
    const after = await listJson(
      page,
      apiURL,
      restrictedToken,
      '/api/projects?per_page=100',
      'projects',
    )
    expect(
      after.length,
      'a user without projects::create must never end up with a project',
    ).toBe(0)
  })
})
