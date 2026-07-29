import { test, expect } from '../../fixtures/test-context'
import {
  loginAsAdmin,
  getAdminToken,
  createTestUser,
  login,
  clearAuthState,
  getCurrentUserToken,
  completeOnboarding,
} from '../../common/auth-helpers'
import { byTestId } from '../testid'
import { MockResourceLinkServer } from '../mcp/helpers/resource-link-mock-server'

/**
 * TEST-21 (A10 [negative-perm]) [covers: ITEM-16] — a NON-ADMIN must be able to
 * reach a BUILT-IN / system server's tool-call history.
 *
 * The bug this locks down: `McpServersSettings.tsx` passed the single flag
 * `isEditable={!server.is_system}` down to `McpServerCard`, and that one flag
 * gated the WHOLE action row. Since the "Calls" tab lived inside the drawer and
 * the drawer's only entry point was the Edit button, the call history of every
 * built-in server (memory, web_search, knowledge_base, code_sandbox, citations,
 * bio, …) was unreachable — a user could not audit the calls they themselves
 * made.
 *
 * The fix splits that flag in two:
 *   - `isEditable`     — still gates enable/test/edit/delete (UNCHANGED).
 *   - `canViewHistory` — the read-only "Calls" affordance, gated on
 *                        `mcp_servers::read`, which is exactly the permission
 *                        the `GET /api/mcp/tool-calls` endpoint enforces.
 * It opens the drawer in the new read-only `history` mode: the tool-call body
 * ONLY — no form, no Details tab, no save/test/delete.
 *
 * No data boundary moves: `mcp/tool_calls/repository.rs` scopes every query with
 * `user_id = $1`, so a user sees only their OWN calls. Both halves are asserted
 * below (user B's call against the SAME server never appears for user A).
 *
 * Why a MOCK registered as a `is_system` server rather than a real built-in
 * (memory / knowledge_base / …): the surface under test is precisely
 * `is_system === true ⇒ isEditable === false`, which is what makes the Calls tab
 * unreachable, and this shape lets the test drive a REAL, deterministic tool
 * call through the REST `/tools/{name}/call` chokepoint (the same
 * `McpSession::call_tool` recorder the chat path uses) with no LLM and nothing
 * mocked on the ziee side. Driving a genuine loopback built-in would require an
 * LLM or per-built-in argument knowledge and would test the same gate.
 *
 * Never `waitForLoadState('networkidle')` — the realtime-sync SSE keeps the
 * network busy forever; wait on stable selectors instead.
 */
test.describe('Built-in MCP server call history — non-admin access (negative-perm)', () => {
  let mock: MockResourceLinkServer

  test.afterEach(async () => {
    await mock?.dispose()
  })

  /** Log in over REST and return the access token (no browser context needed). */
  async function apiLogin(
    apiURL: string,
    username: string,
    password: string,
  ): Promise<string> {
    const res = await fetch(`${apiURL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    if (!res.ok) {
      throw new Error(`apiLogin(${username}) failed: ${res.status} - ${await res.text()}`)
    }
    return (await res.json()).access_token
  }

  /** The default ("Users") group — every new user is auto-assigned to it. */
  async function defaultGroup(
    apiURL: string,
    adminToken: string,
  ): Promise<{ id: string }> {
    const res = await fetch(`${apiURL}/api/groups`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    const body = await res.json()
    const groups: Array<{ id: string; name: string; is_default: boolean }> =
      body.groups ?? body.data ?? body
    const g =
      groups.find(x => x.is_default) ?? groups.find(x => x.name === 'Users')
    if (!g) throw new Error('default Users group not found')
    return g
  }

  test('a non-admin with mcp_servers::read opens a system server Calls history, sees only their own calls, and gets no edit affordance', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    await loginAsAdmin(page, baseURL)
    const adminToken = await getAdminToken(apiURL)
    const adminAuth = { Authorization: `Bearer ${adminToken}` }

    // ── Fixture: a mock MCP server registered as a SYSTEM server and shared
    //    with the default group, so every non-admin sees it on their own
    //    /settings/mcp-servers page as a read-only (System-tagged) card.
    mock = await MockResourceLinkServer.start({ baseUrl: baseURL })
    const stamp = Date.now().toString(36)
    const displayName = `Builtin History Fixture ${stamp}`
    const created = await page.request.post(`${apiURL}/api/mcp/system-servers`, {
      headers: adminAuth,
      data: {
        name: `builtin_hist_${stamp}`,
        display_name: displayName,
        description: 'Fixture system server for the built-in call-history spec',
        enabled: true,
        transport_type: 'http',
        url: mock.url(),
        timeout_seconds: 60,
        usage_mode: 'auto',
      },
    })
    expect(created.ok()).toBeTruthy()
    const serverId = (await created.json()).id as string

    const group = await defaultGroup(apiURL, adminToken)
    const assigned = await page.request.post(
      `${apiURL}/api/mcp/system-servers/${serverId}/groups`,
      { headers: adminAuth, data: { group_ids: [group.id] } },
    )
    expect(assigned.ok()).toBeTruthy()

    // ── Two ordinary non-admin users. `createTestUser` auto-assigns both to
    //    the default group, which grants `mcp_servers::read` (but never
    //    `mcp_servers::admin::*`) — a realistic non-admin subject.
    const userA = `histuser_a_${stamp}`
    const userB = `histuser_b_${stamp}`
    for (const uname of [userA, userB]) {
      await createTestUser(
        apiURL,
        adminToken,
        uname,
        `${uname}@example.com`,
        'password123',
        ['profile::read', 'profile::edit'],
      )
    }

    // ── Drive one REAL tool call per user through the REST chokepoint. Both
    //    hit the SAME system server, so the only thing separating them in the
    //    history is the backend's owner scoping.
    const tokenA = await apiLogin(apiURL, userA, 'password123')
    const tokenB = await apiLogin(apiURL, userB, 'password123')
    for (const [token, fileName] of [
      [tokenA, `a-only-${stamp}.pdf`],
      [tokenB, `b-only-${stamp}.pdf`],
    ] as const) {
      const res = await fetch(
        `${apiURL}/api/mcp/servers/${serverId}/tools/get_file_link/call`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            arguments: { name: fileName, mime_type: 'application/pdf' },
          }),
        },
      )
      expect(res.ok, `tool call for ${fileName} should succeed`).toBeTruthy()
    }

    // ── Act as user A in the browser. ───────────────────────────────────────
    await clearAuthState(page)
    await login(page, baseURL, userA, 'password123')
    await completeOnboarding(baseURL, await getCurrentUserToken(page))

    await page.goto(`${baseURL}/settings/mcp-servers`)
    await page.waitForLoadState('load')
    await expect(byTestId(page, 'settings-page-title')).toBeVisible({
      timeout: 30000,
    })

    // The fixture card is present, tagged System, and carries NO edit
    // affordance whatsoever — the `isEditable=false` half of the split is
    // untouched by the fix.
    const card = page
      .getByTestId(/^mcp-server-card-/)
      .filter({ hasText: displayName })
      .first()
    await expect(card).toBeVisible({ timeout: 30000 })
    await expect(card.getByTestId('mcp-server-system-tag')).toBeVisible()
    await expect(card.getByTestId('mcp-server-edit-btn')).toHaveCount(0)
    await expect(card.getByTestId('mcp-server-delete-btn')).toHaveCount(0)
    await expect(card.getByTestId('mcp-server-test-btn')).toHaveCount(0)
    await expect(card.getByTestId('mcp-server-enable-switch')).toHaveCount(0)

    // … but the read-only Calls affordance IS offered (semantic selector: the
    // button's accessible name).
    const callsBtn = card.getByRole('button', {
      name: `View tool call history for ${displayName}`,
    })
    await expect(callsBtn).toBeVisible()
    await callsBtn.click()

    // The drawer opens in read-only `history` mode: the history body only —
    // no form, no Details/Tool-approvals tabs, no save affordance.
    const tab = byTestId(page, 'mcp-tool-calls-tab')
    await expect(tab).toBeVisible({ timeout: 15000 })
    await expect(byTestId(page, 'mcp-drawer-form')).toHaveCount(0)
    await expect(byTestId(page, 'mcp-drawer-submit-btn')).toHaveCount(0)
    await expect(byTestId(page, 'mcp-drawer-save-test-btn')).toHaveCount(0)
    await expect(byTestId(page, 'mcp-drawer-tabs')).toHaveCount(0)
    await expect(byTestId(page, 'mcp-drawer-enabled-switch')).toHaveCount(0)

    // Exactly ONE row: A's own call. B's call against the same server is
    // filtered out server-side (`user_id = $1`), which is why no new endpoint
    // or permission was needed. The insert is fire-and-forget — allow a beat.
    const rows = tab.getByTestId(/^mcp-tool-calls-table-row-/)
    await expect(rows).toHaveCount(1, { timeout: 15000 })
    await expect(rows.first()).toContainText('get_file_link')

    // Expanding proves it is A's invocation, not B's.
    await rows.first().click()
    const detail = byTestId(page, 'mcp-tool-call-detail')
    await expect(detail).toBeVisible()
    await expect(detail).toContainText(`a-only-${stamp}.pdf`)
    await expect(tab).not.toContainText(`b-only-${stamp}.pdf`)
  })

  test('a user lacking mcp_servers::read sees no call-history surface at all', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    await loginAsAdmin(page, baseURL)
    const adminToken = await getAdminToken(apiURL)

    // `create_user` unconditionally assigns every new user to the default
    // "Users" group, which grants `mcp_servers::read`. Strip that membership so
    // the user genuinely LACKS it, keeping only direct profile perms — exactly
    // the state the read gate must handle.
    const stamp = Date.now().toString(36)
    const uname = `nomcpread_${stamp}`
    const userId = await createTestUser(
      apiURL,
      adminToken,
      uname,
      `${uname}@example.com`,
      'password123',
      ['profile::read', 'profile::edit'],
    )
    const group = await defaultGroup(apiURL, adminToken)
    const removed = await fetch(
      `${apiURL}/api/groups/${userId}/${group.id}/remove`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${adminToken}` } },
    )
    if (!removed.ok) {
      throw new Error(
        `failed to remove user from default group: ${removed.status}`,
      )
    }

    await clearAuthState(page)
    await login(page, baseURL, uname, 'password123')
    await completeOnboarding(baseURL, await getCurrentUserToken(page))

    // Layer 1 (slot): the "MCP Servers" settings nav item is filtered out.
    await page.goto(`${baseURL}/settings/profile`)
    await expect(byTestId(page, 'settings-page-title')).toBeVisible({
      timeout: 30000,
    })
    await expect(
      byTestId(page, 'settings-nav-menu-item-mcp-servers'),
    ).toHaveCount(0)

    // Layer 2 (route): a direct hit renders the 403 gate, never the page — so
    // no card, no Calls button, no history body.
    await page.goto(`${baseURL}/settings/mcp-servers`)
    await expect(
      page.locator(
        '[data-testid="router-route-forbidden-result"], [data-testid="settings-forbidden-result"]',
      ),
    ).toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId(/^mcp-server-card-/)).toHaveCount(0)
    await expect(byTestId(page, 'mcp-server-calls-btn')).toHaveCount(0)
    await expect(byTestId(page, 'mcp-tool-calls-tab')).toHaveCount(0)

    // Layer 3 (data): the endpoint the surface reads is gated the same way, so
    // there is no back door for this user.
    const token = await getCurrentUserToken(page)
    const listRes = await fetch(`${apiURL}/api/mcp/tool-calls`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(listRes.status).toBe(403)
  })
})
