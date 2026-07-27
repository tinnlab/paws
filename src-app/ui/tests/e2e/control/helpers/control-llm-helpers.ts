import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'
import { loginAsAdmin, getAdminToken } from '../../../common/auth-helpers'
import {
  createProviderViaAPI,
  assignProviderToAdministratorsGroup,
} from '../../../common/provider-helpers'
import { goToNewChatPage, selectModelInDropdown } from '../../chat/helpers/chat-helpers'

/**
 * Shared setup for the control-MCP real-LLM E2E specs.
 *
 * These specs used to gate on `ANTHROPIC_API_KEY`, which is unset on a box wired
 * to a local OpenAI-compatible bridge — so in a full-suite run they reported
 * SKIPPED and the whole "the LLM mutates the app's own state" surface went
 * unverified. The rule now: run against WHATEVER LLM the environment configures,
 * and skip only when NOTHING is configured.
 *
 * Mirrors the resolution order of the Rust seam
 * (`server/tests/chat/helpers.rs::resolve_test_llm`) and the existing
 * `tests/e2e/chat/helpers/agent-llm-helpers.ts` bridge pattern.
 */

export type ConfiguredTestLlm = {
  /** Display name for the provider row this spec creates. */
  providerName: string
  /** ziee `provider_type` discriminant. */
  providerType: 'openai' | 'anthropic'
  /** Model id sent upstream. */
  model: string
}

/**
 * The configured test LLM, or `null` when nothing at all is configured.
 *
 * NOTE the base_url + api_key are applied by `createProviderViaAPI`, which
 * already reads `<PROVIDER>_BASE_URL` / `ZIEE_TEST_LLM_BASE_URL` and
 * `<PROVIDER>_API_KEY`; this function only decides WHICH vendor seam is live and
 * which model name to use.
 */
export function configuredTestLlm(): ConfiguredTestLlm | null {
  const val = (name: string): string | undefined => {
    const v = process.env[name]
    return v && v.trim() !== '' ? v : undefined
  }
  const globalModel = val('ZIEE_TEST_LLM_MODEL')
  const candidates = [
    { providerName: 'OpenAI', providerType: 'openai', keyEnv: 'OPENAI_API_KEY', modelEnv: 'OPENAI_MODEL', fallback: 'gpt-4o-mini' },
    { providerName: 'Anthropic', providerType: 'anthropic', keyEnv: 'ANTHROPIC_API_KEY', modelEnv: 'ANTHROPIC_MODEL', fallback: 'claude-opus-4-1-20250805' },
  ] as const

  for (const c of candidates) {
    if (!val(c.keyEnv)) continue
    return {
      providerName: c.providerName,
      providerType: c.providerType,
      model: val(c.modelEnv) ?? globalModel ?? c.fallback,
    }
  }
  return null
}

export const TEST_LLM = configuredTestLlm()
/** The ONLY legitimate skip reason: no LLM configured at all. */
export const NO_LLM_SKIP =
  'no LLM configured at all (set OPENAI_API_KEY [+OPENAI_BASE_URL +ZIEE_TEST_LLM_MODEL], or the Anthropic seam) — NOT a vendor-specific skip'

/**
 * Create a TOOL-CAPABLE model row for the configured LLM.
 *
 * `createModelViaAPI` hardcodes `capabilities.function_calling:false` and never
 * sets `tools`, so a model created through it is NOT tool-capable — the control
 * chat extension's `ensure_model_tools_capable` gate bails and the control tools
 * are never attached. That is why the previous spec could not have passed even
 * with a key set. POST the row directly instead (mirrors
 * `agent-llm-helpers.ts::createBridgeToolModel`).
 */
export async function createToolCapableModel(
  page: Page,
  apiURL: string,
  token: string,
  providerId: string,
  displayName: string,
  model: string,
  // A REASONING bridge model spends its budget on hidden reasoning before
  // emitting the tool call / final text; too small a cap cuts it off mid-thought.
  maxTokens = 4096,
): Promise<string> {
  const res = await page.request.post(`${apiURL}/api/llm-models`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      provider_id: providerId,
      name: model,
      display_name: displayName,
      enabled: true,
      engine_type: 'none',
      file_format: 'gguf',
      capabilities: { tools: true, chat: true, streaming: true },
      parameters: { context_length: 32768, temperature: 0, top_p: 0.9, max_tokens: maxTokens },
    },
  })
  expect(res.ok(), `create tool-capable model: ${res.status()} ${await res.text()}`).toBeTruthy()
  return (await res.json()).id as string
}

/**
 * Log in as admin, wire the configured LLM as a tool-capable model, and open a
 * FRESH chat on it. A fresh chat is auto-approve for ordinary tools, which is
 * precisely the condition under which a mutating control invoke must STILL be
 * forced through the approval card.
 */
export async function setupControlChat(
  page: Page,
  baseURL: string,
  apiURL: string,
  displayName = 'Control Tools Model',
): Promise<{ token: string; modelId: string }> {
  const llm = TEST_LLM
  if (!llm) throw new Error(NO_LLM_SKIP)

  await loginAsAdmin(page, baseURL)
  const token = await getAdminToken(apiURL)
  const providerId = await createProviderViaAPI(apiURL, token, llm.providerName, llm.providerType)
  await assignProviderToAdministratorsGroup(apiURL, token, providerId)
  const modelId = await createToolCapableModel(
    page,
    apiURL,
    token,
    providerId,
    displayName,
    llm.model,
  )
  await goToNewChatPage(page, baseURL)
  await selectModelInDropdown(page, displayName)
  return { token, modelId }
}

/** Tool names the model invoked in `conversationId`, from the durable MCP tool-call history. */
export async function recordedToolNames(
  page: Page,
  apiURL: string,
  token: string,
  conversationId: string,
): Promise<string[]> {
  const res = await page.request.get(
    `${apiURL}/api/mcp/tool-calls?per_page=100&conversation_id=${conversationId}`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!res.ok()) return []
  const body = await res.json()
  const rows = body.calls ?? []
  return rows.map((r: { tool_name?: string }) => r.tool_name ?? '')
}

/** The conversation id of the chat currently open in `page` (from the URL). */
export function currentConversationId(page: Page): string | null {
  const m = page.url().match(/\/chat\/([0-9a-f-]{36})/i)
  return m ? m[1] : null
}

/** GET a JSON list endpoint and return its array payload. */
export async function listJson(
  page: Page,
  apiURL: string,
  token: string,
  path: string,
  key: string,
): Promise<Array<Record<string, unknown>>> {
  const res = await page.request.get(`${apiURL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok()) return []
  const body = await res.json()
  return (body[key] ?? body.data ?? []) as Array<Record<string, unknown>>
}
