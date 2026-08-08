import { test, expect } from '../../fixtures/test-context'
import { loginAsAdmin, getAdminToken } from '../../common/auth-helpers'
import { assignProviderToAdministratorsGroup } from '../../common/provider-helpers'
import { goToNewChatPage, selectModelInDropdown, sendChatMessage } from './helpers/chat-helpers'
import { createToolCapableModel } from '../control/helpers/control-llm-helpers'
import { ReasoningStubServer, type ReasoningStubMode } from '../helpers/reasoning-stub-server'

/**
 * TEST-4 [acceptance, INV-3] + TEST-11 — the answerless-turn notice, at the
 * layer the user actually experiences.
 *
 * The reported symptom: "The model returned an empty response and made no tool
 * call. Please try again." appearing constantly. Measured on the live rig, that
 * one string covered 680 of 5792 assistant turns (11.7%) and collapsed THREE
 * different causes into one message — and for the majority cause the advice it
 * gave was deterministically wrong.
 *
 * The dominant cause is a reasoning model whose chain of thought is billed
 * against the same `max_tokens` as the answer: reasoning eats the budget, the
 * provider terminates `finish_reason: "length"`, and ZERO content deltas are
 * ever emitted. Retrying re-runs into the same cap, so "Please try again" sends
 * the user in a loop. (The pre-existing comment on `createToolCapableModel`'s
 * `maxTokens` param — "too small a cap cuts it off mid-thought" — is the same
 * phenomenon, previously worked around rather than surfaced.)
 *
 * This drives the REAL stack: real chat loop, real provider client, real SSE,
 * real persistence, real renderer. Only the EXTERNAL LLM boundary is a fixture
 * (`helpers/reasoning-stub-server.ts`), whose wire shape is taken from bytes
 * captured off the live Qwen3.6-35B bridge. No ziee API is mocked.
 *
 * Deterministic and unskippable by design: a real model cannot be asked to
 * exhaust its budget on demand, so a real-LLM version would be a coin flip.
 */

async function chatWithStub(
  page: Parameters<typeof loginAsAdmin>[0],
  testInfra: { baseURL: string; apiURL: string },
  mode: ReasoningStubMode,
  prompt: string,
) {
  const { baseURL, apiURL } = testInfra
  const stub = await ReasoningStubServer.start({ mode })

  await loginAsAdmin(page, baseURL)
  const token = await getAdminToken(apiURL)

  // The established bridge pattern: an `openai` provider pointed at a loopback
  // stub (`validate_base_url` uses the DEV_LOCAL policy, which allows 127.0.0.1).
  const providerRes = await page.request.post(`${apiURL}/api/llm-providers`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name: `reasoning-stub-${mode}-${Date.now()}`,
      provider_type: 'openai',
      enabled: true,
      api_key: 'stub-key',
      base_url: stub.baseUrl(),
    },
  })
  expect(
    providerRes.ok(),
    `create stub provider: ${providerRes.status()} ${await providerRes.text()}`,
  ).toBeTruthy()
  const providerId = (await providerRes.json()).id as string
  await assignProviderToAdministratorsGroup(apiURL, token, providerId)

  await createToolCapableModel(
    page,
    apiURL,
    token,
    providerId,
    `Reasoning Stub ${mode}`,
    'stub-model',
  )

  await goToNewChatPage(page, baseURL)
  await selectModelInDropdown(page, `Reasoning Stub ${mode}`)
  await sendChatMessage(page, prompt, true)

  return stub
}

test.describe('answerless turns name their cause', () => {
  test.slow()

  test('TEST-4: a budget-truncated turn names the budget and does NOT advise a bare retry', async ({
    page,
    testInfra,
  }) => {
    const stub = await chatWithStub(page, testInfra, 'budget', 'Think this through carefully.')
    try {
      const notice = page.locator('[data-testid="chat-empty-completion-notice"]')
      await expect(notice, 'an answerless turn must explain itself').toBeVisible({
        timeout: 60000,
      })

      // The cause reached the client and survived persistence.
      await expect(notice).toHaveAttribute('data-empty-completion-cause', 'budget_truncated')

      // INV-3: it names the real cause and the corrective action…
      await expect(notice).toContainText(/token budget/i)
      await expect(notice).toContainText(/max tokens|reasoning effort/i)

      // …and it must NOT tell the user to just retry. THIS is the assertion that
      // turns red on the pre-fix build, where every answerless turn — including
      // this deterministic one — carried exactly that advice.
      await expect(notice).not.toContainText(/please try again/i)
    } finally {
      await stub.dispose()
    }
  })

  test('TEST-4: a genuinely-empty turn keeps the empty-response wording', async ({
    page,
    testInfra,
  }) => {
    // The negative control. Without it, "the truncated case doesn't say retry"
    // would also pass if the phrase had simply been deleted everywhere — this
    // proves the copy is chosen by CAUSE, and that a retry is still advised
    // where a retry is actually reasonable.
    const stub = await chatWithStub(page, testInfra, 'empty', 'Say nothing at all.')
    try {
      const notice = page.locator('[data-testid="chat-empty-completion-notice"]')
      await expect(notice).toBeVisible({ timeout: 60000 })
      await expect(notice).toHaveAttribute('data-empty-completion-cause', 'empty')
      await expect(notice).toContainText(/empty response/i)
      await expect(notice).toContainText(/please try again/i)
    } finally {
      await stub.dispose()
    }
  })

  test('TEST-11: the cause survives a full page reload', async ({ page, testInfra }) => {
    // The notice is derived at RENDER time, and the live stream flags all reset
    // on load — so if the cause were not persisted server-side, the reloaded
    // turn would fall back to the generic copy. That regression is invisible to
    // the two tests above, which never leave the streaming session.
    const stub = await chatWithStub(page, testInfra, 'budget', 'Think this through carefully.')
    try {
      const notice = page.locator('[data-testid="chat-empty-completion-notice"]')
      await expect(notice).toBeVisible({ timeout: 60000 })

      await page.reload()

      const afterReload = page.locator('[data-testid="chat-empty-completion-notice"]')
      await expect(afterReload, 'the notice must survive a reload').toBeVisible({
        timeout: 60000,
      })
      await expect(afterReload).toHaveAttribute('data-empty-completion-cause', 'budget_truncated')
      await expect(afterReload).toContainText(/token budget/i)
      await expect(afterReload).not.toContainText(/please try again/i)
    } finally {
      await stub.dispose()
    }
  })
})
