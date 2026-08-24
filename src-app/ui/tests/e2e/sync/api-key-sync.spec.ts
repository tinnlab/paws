import { test, expect } from '../../fixtures/test-context'
import { byTestId } from '../testid'
import {
  loginAsAdmin,
  login,
  createTestUser,
  getAdminToken,
} from '../../common/auth-helpers'

// Realtime cross-device sync for the owner-scoped `api_key` entity: a user's
// saved provider key reaches the SAME user's other device live (the masked-key
// tag flips), and a DIFFERENT user never sees it.
//
// paws: this spec was SPLIT OUT of the former `template-apikey-sync.spec.ts`,
// which covered two unrelated entities. That file was deleted with the
// assistant-templates admin surface (design item 12) — but `api_key` is a
// SURVIVOR, unaffected by the feature-surface reduction, and deleting the file
// wholesale silently took its only cross-device coverage with it. Restored here
// verbatim, minus the template half.
//
// Run with --workers=1 (shared backend + DB).
//
// NAV NOTE: every authenticated page holds an open `GET /api/sync/subscribe`
// SSE stream, so `waitForLoadState('networkidle')` never settles and HANGS the
// test. The helper below navigates inline and waits for a stable selector
// instead.

async function gotoUserLlmProvidersAndSelect(
  page: import('@playwright/test').Page,
  baseURL: string,
  providerName: string,
) {
  await page.goto(`${baseURL}/settings/user-llm-providers`)
  // Stable "page rendered" signal: the provider sits in a role=menuitem
  // (desktop Menu or mobile Dropdown both expose this role).
  const provItem = page
    .getByTestId(/^ullm-provider-menu-item-/)
    .filter({ hasText: providerName })
    .first()
  await provItem.waitFor({ state: 'visible', timeout: 15000 })
  await provItem.click()
  // The detail panel for the selected provider renders its name as an h4.
  await expect(byTestId(page, 'ullm-provider-title')).toContainText(providerName, { timeout: 15000 })
}

// ── REST fixtures (driven via baseURL, which proxies /api to this test's
// backend) ──────────────────────────────────────────────────────────────────

/**
 * Create a `custom` provider with no system key (the only enabled-with-no-key
 * combination the backend accepts). This surfaces the orange "No admin key"
 * tag and the "Save Key" button — exactly the starting state the api_key test
 * mutates.
 */
async function createProviderViaApi(
  baseURL: string,
  adminToken: string,
  name: string,
): Promise<{ id: string; name: string }> {
  const res = await fetch(`${baseURL}/api/llm-providers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ name, provider_type: 'custom', enabled: true }),
  })
  if (!res.ok) {
    throw new Error(
      `createProviderViaApi(${name}) failed: ${res.status} ${await res.text()}`,
    )
  }
  const data = await res.json()
  return { id: data.id, name: data.name }
}

/** Assign a provider to the default Users group so every user can see it. */
async function assignProviderToDefaultGroup(
  baseURL: string,
  adminToken: string,
  providerId: string,
): Promise<void> {
  const groupsResp = await fetch(`${baseURL}/api/groups`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  })
  const groupsBody = await groupsResp.json()
  const defaultGroup = groupsBody.groups.find(
    (g: { is_default?: boolean }) => g.is_default,
  )
  if (!defaultGroup) throw new Error('No default group found')

  const assignResp = await fetch(
    `${baseURL}/api/llm-providers/${providerId}/groups`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ group_id: defaultGroup.id }),
    },
  )
  if (!assignResp.ok) {
    throw new Error(
      `assignProviderToDefaultGroup failed: ${assignResp.status} ${await assignResp.text()}`,
    )
  }
}

test.describe('Realtime sync — api key (owner-scoped)', () => {
  test("a saved API key reaches the owner's other device but NOT a different user", async ({
    page,
    browser,
    testInfra,
  }) => {
    const { baseURL } = testInfra

    // User A = admin, device 1. loginAsAdmin onboards the admin FIRST so
    // getAdminToken below can authenticate.
    await loginAsAdmin(page, baseURL)

    const adminToken = await getAdminToken(baseURL)
    const uniq = Date.now()

    // Provider both users can see (assigned to the default Users group).
    const providerName = `sync-apikey-${uniq}`
    const provider = await createProviderViaApi(baseURL, adminToken, providerName)
    await assignProviderToDefaultGroup(baseURL, adminToken, provider.id)

    // A second, distinct user (auto-joins the default Users group, so it can see
    // the provider + gets a live sync stream).
    const username = `apikey_other_${uniq}`
    const password = 'Password123!'
    await createTestUser(
      baseURL,
      adminToken,
      username,
      `${username}@example.com`,
      password,
      ['profile::read', 'profile::edit', 'user_llm_providers::read'],
    )

    // Device 1 (owner) lands on the providers page now that the provider exists.
    await gotoUserLlmProvidersAndSelect(page, baseURL, providerName)

    const ctxA2 = await browser.newContext() // owner, device 2 — positive control
    const pageA2 = await ctxA2.newPage()
    const ctxB = await browser.newContext() // different user — isolation
    const pageB = await ctxB.newPage()
    try {
      // Load A2 fully before B.
      await loginAsAdmin(pageA2, baseURL)
      await gotoUserLlmProvidersAndSelect(pageA2, baseURL, providerName)

      await login(pageB, baseURL, username, password)
      await gotoUserLlmProvidersAndSelect(pageB, baseURL, providerName)

      // Baseline: every device starts with no personal key → orange tag.
      await expect(page.getByTestId('ullm-key-status-tag')).toContainText('No admin key')
      await expect(pageA2.getByTestId('ullm-key-status-tag')).toContainText('No admin key')
      await expect(pageB.getByTestId('ullm-key-status-tag')).toContainText('No admin key')

      // Owner saves a personal key on device 1.
      await page
        .getByTestId('ullm-key-password-input')
        .fill('sk-owner-personal-key')
      const saveBtn = byTestId(page, 'ullm-save-key-button')
      await expect(saveBtn).toBeEnabled()
      await saveBtn.click()

      // Device 1's own panel flips to the green "Your key configured" state.
      await expect(page.getByTestId('ullm-key-status-tag')).toContainText('Your key configured')

      // Positive control: the owner's OTHER device reflects the masked-key
      // change live — the SSE `sync:api_key` event makes UserLlmProviders
      // refetch, so the tag flips WITHOUT a reload. Proves the event fired +
      // was delivered, making B's absence below meaningful.
      await expect(pageA2.getByTestId('ullm-key-status-tag')).toContainText('Your key configured', {
        timeout: 15_000,
      })
      await expect(
        byTestId(pageA2, 'ullm-save-key-button'),
      ).toBeVisible()

      // Isolation: a DIFFERENT user had the same delivery window (A2 already
      // received it) yet never sees the owner's key — their panel stays orange.
      await expect(pageB.getByTestId('ullm-key-status-tag')).not.toContainText('Your key configured')
      await expect(pageB.getByTestId('ullm-key-status-tag')).toContainText('No admin key')
    } finally {
      await ctxA2.close()
      await ctxB.close()
    }
  })
})
