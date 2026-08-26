import { test, expect } from '../../fixtures/test-context'
import { getAdminToken, loginAsAdmin } from '../../common/auth-helpers'
import { byTestId } from '../testid'
import { OaiStubServer } from '../helpers/oai-stub-server'

/**
 * TEST-14 [acceptance] [invariant: INV-5] — a model that arrives the way a
 * completed download delivers one becomes usable **with no page reload**: it
 * appears in the composer AND a message sent to it comes back answered.
 *
 * The owner's report was "after the model finishes downloading it appears
 * selected in the chat input, but sending a message does not work; reloading
 * the page makes it work". The brief's acceptance bar was explicit — the proof
 * has to be CONSUMER-observed, because a test asserting the server's state is
 * correct would have passed against the broken build and proved nothing.
 *
 * ## What this spec proves, and what it deliberately does NOT
 *
 * PROVES: the end-to-end consumer promise over the delivery mechanism the
 * download path actually uses. `create_model_with_files` publishes its sync pair
 * with `origin = None`, so the frame reaches EVERY connected tab including the
 * one that started the download. This spec reproduces those exact semantics by
 * driving the mutation from a raw admin `fetch` that sends **no
 * `X-Sync-Connection-Id` header** — the same technique
 * `tests/e2e/sync/llm-provider-sync.spec.ts` uses — so the browser observes an
 * un-suppressed frame, exactly as it would after a download. Then it sends and
 * asserts a real answer, without ever calling `page.reload()`.
 *
 * DOES NOT PROVE: the local-engine serving path. A local model needs a real
 * llama.cpp runtime, which the e2e environment only has behind
 * `ZIEE_E2E_ENGINE_MIRROR`; this spec therefore serves the model through a
 * stub OpenAI provider. The local-engine half — the teardown race that was the
 * ACTUAL cause of the reported symptom — is pinned by TEST-17 over
 * `resolve_engine_endpoint`, and was reproduced live against a real 296 MB
 * download (recorded in the feature's `INFRA_INTEGRATION.md`). Stated here
 * rather than left for a reader to assume this spec covers it.
 *
 * ## Not a race
 *
 * The mutation happens FIRST and the assertions wait for its effect, so there
 * is no moving window to hit. The page is loaded and its landmark awaited
 * BEFORE the mutation so the frame lands inside its live delivery window.
 * `waitForLoadState('networkidle')` is never used — it hangs forever once the
 * sync SSE is connected.
 */

const REPLY = 'HELLO_FROM_THE_FRESHLY_ADDED_MODEL'

/**
 * Create an enabled provider + model through the ADMIN API with no
 * `X-Sync-Connection-Id`, so the server publishes with `origin = None` and the
 * browser's own stream receives the frame — the download path's semantics.
 */
async function addModelLikeADownloadDoes(
  baseURL: string,
  adminToken: string,
  stubUrl: string,
  uniq: number,
): Promise<{ providerId: string; displayName: string; modelName: string }> {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${adminToken}`,
  }

  const provRes = await fetch(`${baseURL}/api/llm-providers`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: `Stub Provider ${uniq}`,
      provider_type: 'custom',
      enabled: true,
      api_key: 'stub-key',
      base_url: stubUrl,
    }),
  })
  if (!provRes.ok) {
    throw new Error(`create provider failed: ${provRes.status} ${await provRes.text()}`)
  }
  const providerId = (await provRes.json()).id as string

  // Share it with the default group — without this the user-facing
  // `get_for_user` query excludes the provider and every model under it.
  const groups = await (
    await fetch(`${baseURL}/api/groups`, { headers })
  ).json()
  const defaultGroup = groups.groups.find((g: { is_default?: boolean }) => g.is_default)
  if (!defaultGroup) throw new Error('no default group')
  const assign = await fetch(`${baseURL}/api/llm-providers/${providerId}/groups`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ group_id: defaultGroup.id }),
  })
  if (!assign.ok) {
    throw new Error(`assign group failed: ${assign.status} ${await assign.text()}`)
  }

  const displayName = `Downloaded Model ${uniq}`
  const modelName = `downloaded-model-${uniq}`
  const modelRes = await fetch(`${baseURL}/api/llm-models`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      provider_id: providerId,
      name: modelName,
      display_name: displayName,
      enabled: true,
      engine_type: 'none',
      file_format: 'safetensors',
      capabilities: { chat: true },
    }),
  })
  if (!modelRes.ok) {
    throw new Error(`create model failed: ${modelRes.status} ${await modelRes.text()}`)
  }

  return { providerId, displayName, modelName }
}

test.describe('a freshly delivered model is chattable without a reload', () => {
  test('the model appears in the composer and answers a message, with no page reload', async ({
    page,
    testInfra,
  }) => {
    const { baseURL } = testInfra
    const uniq = Date.now()

    // A stub OpenAI server that answers with plain text. `toolName` names a tool
    // no request will advertise, so the stub takes its no-tool branch and
    // streams `followUpText` as the assistant's answer.
    const stub = await OaiStubServer.start({
      toolName: '__never_matches_any_tool__',
      argumentsJson: '{}',
      followUpText: REPLY,
    })

    try {
      await loginAsAdmin(page, baseURL)
      const adminToken = await getAdminToken(baseURL)

      // Load the chat page and wait for its landmark BEFORE the mutation, so the
      // sync frame lands inside this page's live delivery window. Navigate
      // inline — `networkidle` hangs once the sync SSE is connected.
      await page.goto(`${baseURL}/`)
      await page.waitForLoadState('load')
      const selector = byTestId(page, 'model-selector')
      await expect(selector).toBeVisible({ timeout: 30000 })

      // Plant a sentinel on `window`. A reload (or any full navigation) wipes
      // it, so its survival at the end of the test is real evidence that none
      // happened. See the assertion at the bottom for why the obvious
      // `page.url()` check does NOT work.
      await page.evaluate(() => {
        ;(window as unknown as Record<string, unknown>).__noReloadSentinel =
          'alive'
      })

      // Control: the model does not exist yet, so the later assertion cannot
      // pass vacuously against a picker that already contained it.
      const { displayName } = await (async () => {
        await expect(selector).not.toContainText(`Downloaded Model ${uniq}`)
        return addModelLikeADownloadDoes(baseURL, adminToken, stub.baseUrl(), uniq)
      })()

      // ── INV-5, first half: it becomes visible with NO reload ────────────
      // The picker auto-selects the first enabled model on refetch, so the new
      // model surfaces as the selector's value once `sync:user_llm_provider`
      // lands and `ModelPicker.loadProviders()` runs.
      await expect(selector).toContainText(displayName, { timeout: 30000 })

      // ── INV-5, second half: SENDING it works, still with no reload ──────
      const textarea = byTestId(page, 'chat-message-textarea').first()
      await textarea.fill('Say hello.')
      await byTestId(page, 'chat-input-send-btn').click()

      // The assistant's answer comes back IN THE TRANSCRIPT. This is the leg the
      // owner could not get: the message went nowhere until later.
      //
      // Scoped to `chat-messages` deliberately. An unscoped `getByText` matches
      // three places once the turn completes — the transcript, the
      // auto-generated conversation TITLE, and the sidebar's recent-conversation
      // entry — and two of those would be satisfied by a title derived from the
      // user's own text. Only the transcript proves the model ANSWERED.
      await expect(
        byTestId(page, 'chat-messages').getByText(REPLY, { exact: false }),
      ).toBeVisible({ timeout: 60000 })

      // The spec never reloaded — and this is the assertion that can actually
      // tell. An earlier version checked `page.url().startsWith(baseURL)`,
      // which is ALWAYS TRUE: `page.reload()` preserves the URL, so the guard
      // was satisfied by precisely the edit it claimed to block. The sentinel
      // lives on `window` and does not survive a reload, so if a future author
      // "stabilises" this spec with one, this fails and they have to say so.
      const sentinel = await page.evaluate(
        () => (window as unknown as Record<string, unknown>).__noReloadSentinel,
      )
      expect(
        sentinel,
        'the page was reloaded or renavigated — this spec proves the NO-RELOAD ' +
          'half of INV-5 and is worthless if it reloads',
      ).toBe('alive')
    } finally {
      await stub.dispose()
    }
  })
})
