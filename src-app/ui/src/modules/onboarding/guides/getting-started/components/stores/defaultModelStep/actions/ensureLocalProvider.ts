import { ApiClient } from '@/api-client'
import { Permissions } from '@/api-client/permissions'
import { hasPermissionNow } from '@/core/permissions'
import { LlmProvider as LlmProviderStore } from '@/modules/llm-provider/stores/llmProvider'
import type { DefaultModelStepGet, DefaultModelStepSet } from '../state'

/**
 * The group an installed default model is made available through.
 *
 * Every user belongs to `Users` — it is the group the migrations grant baseline
 * permissions to, and the group the shipped seed hands the built-in `fetch` MCP
 * server to (`resources/seed/default.yaml`). "Available to everyone" means this
 * group.
 */
const DEFAULT_GROUP_NAME = 'Users'

export interface LocalProviderReadiness {
  providerId: string | null
  /** Why it is not ready, in words a user can act on. */
  problem: string | null
}

/**
 * Make a local provider ready to install into, and reachable once installed.
 *
 * TWO things are required, and only the first is obvious:
 *
 * 1. **The provider must be enabled.** A fresh install ships the built-in
 *    `Local` provider DISABLED, and `list_local_providers` filters
 *    `WHERE provider_type = 'local' AND enabled = true`, so there is otherwise
 *    nothing to download into.
 * 2. **The provider must be assigned to a group the user is in.** This is the
 *    one that looks unnecessary and is not: the model picker reads
 *    `get_for_user`, which INNER JOINs `user_group_llm_providers`, and every
 *    chat send re-checks `user_has_access_to_provider` and answers 403
 *    ACCESS_DENIED without it — with no admin bypass. Nothing seeds such a row.
 *    So an enabled provider holding a downloaded model is still INVISIBLE in the
 *    picker and unusable in chat, and the user would have to go to
 *    Settings → LLM Providers → Groups to fix it. That is precisely what INV-2
 *    forbids ("without visiting a settings page"), which is why the step does it.
 *
 * Enabling happens at install time rather than in the seed migration so an
 * upgrading deployment that never touches this step is unaffected (DEC-5); the
 * group assignment is scoped the same way, and both are reversible from the
 * existing providers page.
 *
 * Returns the provider id, or a `problem` naming what a human must do instead.
 */
export default (_set: DefaultModelStepSet, _get: DefaultModelStepGet) =>
  async (): Promise<LocalProviderReadiness> => {
    // Read through `.$` — this runs from an install handler, not a render, and
    // the reactive proxy calls React hooks.
    await LlmProviderStore.loadLlmProviders()
    const locals = () =>
      LlmProviderStore.$.providers.filter(p => p.provider_type === 'local')

    let provider = locals().find(p => p.enabled) ?? locals()[0]
    if (!provider) {
      return {
        providerId: null,
        problem:
          'No local provider exists to install into. An administrator can add one in Settings → LLM Providers.',
      }
    }

    // ── 1. Enabled ──────────────────────────────────────────────────────────
    if (!provider.enabled) {
      if (!hasPermissionNow(Permissions.LlmProvidersEdit)) {
        return {
          providerId: null,
          problem:
            'The local provider is turned off, and your account cannot turn it on. An administrator can enable it in Settings → LLM Providers.',
        }
      }
      await LlmProviderStore.updateLlmProvider(provider.id, { enabled: true })

      // Deliberately NOT trusting `updateLlmProvider`'s return value: it
      // resolves to `null` when a concurrent update is already in flight (it
      // early-returns on its own `updating` flag). Re-read so the result
      // reflects what the server actually holds.
      await LlmProviderStore.loadLlmProviders(true)
      const enabled = locals().find(p => p.enabled)
      if (!enabled) {
        return {
          providerId: null,
          problem: 'The local provider could not be turned on.',
        }
      }
      provider = enabled
    }

    // ── 2. Reachable by this user ───────────────────────────────────────────
    const problem = await ensureGroupAssignment(provider.id)
    if (problem) return { providerId: null, problem }

    return { providerId: provider.id, problem: null }
  }

/**
 * Ensure the provider is assigned to at least one group, so an installed model
 * is actually reachable. Returns a human-readable problem, or `null` on success.
 */
async function ensureGroupAssignment(providerId: string): Promise<string | null> {
  let assigned: { id: string; name: string }[] = []
  try {
    assigned = await ApiClient.LlmProvider.getGroups({ provider_id: providerId })
  } catch {
    // Reading the assignment needs `llm_providers::read`, which the install
    // flow already requires; if it fails, fall through to attempting the
    // assignment rather than blocking on a read.
    assigned = []
  }
  // Already reachable through some group — leave an operator's existing
  // arrangement exactly as it is.
  if (assigned.length > 0) return null

  if (!hasPermissionNow(Permissions.LlmProvidersAssignGroups)) {
    return 'The local provider is not shared with any user group, and your account cannot change that. An administrator can assign it in Settings → LLM Providers → Groups.'
  }

  const groups = await ApiClient.UserGroup.list({ page: 1, per_page: 100 })
  const active = groups.groups.filter(g => g.is_active)
  // `is_default` is the schema's own answer to "the group ordinary users land
  // in"; the name is the fallback for a deployment that renamed or unset it.
  const target =
    active.find(g => g.is_default) ??
    active.find(g => g.name === DEFAULT_GROUP_NAME) ??
    active[0]
  if (!target) {
    return 'No active user group exists to share the local provider with.'
  }

  await LlmProviderStore.assignGroupToProvider(providerId, target.id)
  return null
}
