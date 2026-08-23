import { ApiClient } from '@/api-client'
import { Permissions } from '@/api-client/permissions'
import { hasPermissionNow } from '@/core/permissions'
import { LlmProvider as LlmProviderStore } from '@/modules/llm-provider/stores/llmProvider'
import type { DefaultModelStepGet, DefaultModelStepSet } from '../state'

/**
 * The group an installed default model is made available through, when the seed
 * default is unavailable.
 *
 * Every user belongs to `Users` — it is the group the migrations grant baseline
 * permissions to, and the group the shipped seed hands the built-in `fetch` MCP
 * server to (`resources/seed/default.yaml`).
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
 * 2. **The provider must be assigned to a group the user is in.** The model
 *    picker reads `get_for_user`, which INNER JOINs `user_group_llm_providers`,
 *    and every chat send re-checks `user_has_access_to_provider` and answers 403
 *    ACCESS_DENIED without it — with no admin bypass. Nothing seeds such a row,
 *    so an enabled provider holding a downloaded model is still INVISIBLE, and
 *    the user would have to go to Settings → LLM Providers → Groups. INV-2
 *    forbids exactly that, which is why the step does it.
 *
 * ## Granting access is an ACCESS-CONTROL WRITE, and is bounded accordingly
 *
 * The second half widens who can reach a provider, so it is deliberately narrow:
 *
 * - **It only grants as part of provisioning THIS step performed.** If the
 *   provider was already enabled, someone has been here before and its group
 *   arrangement is theirs — including the arrangement of having none, which is
 *   the supported way to hide a provider from users while leaving it enabled
 *   (`remove_provider_from_group` / `update_group_providers` are first-class
 *   admin actions). The step reports what a human should do instead of quietly
 *   reversing that decision.
 * - **It fails CLOSED.** If the current assignment cannot be read, the step does
 *   NOT grant. Guessing "probably none" and writing would widen access on a
 *   transient 5xx.
 * - **It never guesses a group.** Only the seeded default group, or one named
 *   `Users`. If neither is present it reports the problem rather than granting
 *   to whichever group happens to sort first.
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

    // Prefer the BUILT-IN local provider explicitly rather than whatever sorts
    // first: it is the row the product seeds and the one this step exists to
    // provision. Enabling and then sharing an operator's own custom provider
    // would be a bigger action than the user asked for.
    const pick = (candidates: typeof LlmProviderStore.$.providers) =>
      candidates.find(p => p.built_in) ?? candidates[0]

    const enabledLocal = pick(locals().filter(p => p.enabled))
    const anyLocal = enabledLocal ?? pick(locals())
    if (!anyLocal) {
      return {
        providerId: null,
        problem:
          'No local provider exists to install into. An administrator can add one in Settings → LLM Providers.',
      }
    }

    // Was it already usable before this step touched anything? That answer
    // decides whether the group grant below is provisioning or interference.
    const wasAlreadyEnabled = Boolean(enabledLocal)

    let providerId = anyLocal.id
    if (!wasAlreadyEnabled) {
      if (!hasPermissionNow(Permissions.LlmProvidersEdit)) {
        return {
          providerId: null,
          problem:
            'The local provider is turned off, and your account cannot turn it on. An administrator can enable it in Settings → LLM Providers.',
        }
      }
      await LlmProviderStore.updateLlmProvider(providerId, { enabled: true })

      // Deliberately NOT trusting `updateLlmProvider`'s return value: it
      // resolves to `null` when a concurrent update is already in flight (it
      // early-returns on its own `updating` flag). Re-read so the result
      // reflects what the server actually holds.
      await LlmProviderStore.loadLlmProviders(true)
      const nowEnabled = pick(locals().filter(p => p.enabled))
      if (!nowEnabled) {
        return {
          providerId: null,
          problem: 'The local provider could not be turned on.',
        }
      }
      providerId = nowEnabled.id
    }

    const problem = await ensureGroupAssignment(providerId, wasAlreadyEnabled)
    if (problem) return { providerId: null, problem }

    return { providerId, problem: null }
  }

/**
 * Ensure the provider is reachable, granting access ONLY when this step is the
 * one that provisioned it. Returns a human-readable problem, or `null`.
 */
async function ensureGroupAssignment(
  providerId: string,
  wasAlreadyEnabled: boolean,
): Promise<string | null> {
  // FAIL CLOSED. A read failure is not evidence of "no groups"; treating it as
  // such would grant access on a transient error.
  let assigned: { id: string; name: string }[]
  try {
    assigned = await ApiClient.LlmProvider.getGroups({ provider_id: providerId })
  } catch {
    return 'Could not check which user groups the local provider is shared with, so it was left unchanged. Try again, or assign it in Settings → LLM Providers → Groups.'
  }

  // Already reachable — leave an operator's arrangement exactly as it is.
  if (assigned.length > 0) return null

  // No groups, and the provider was ALREADY enabled: someone configured this
  // provider before we got here, and an empty group set is a supported way to
  // keep a provider out of users' pickers. Say so; do not reverse it.
  if (wasAlreadyEnabled) {
    return 'The local provider is enabled but not shared with any user group, so an installed model would not appear in the model picker. An administrator can share it in Settings → LLM Providers → Groups.'
  }

  if (!hasPermissionNow(Permissions.LlmProvidersAssignGroups)) {
    return 'The local provider is not shared with any user group, and your account cannot change that. An administrator can assign it in Settings → LLM Providers → Groups.'
  }

  const groups = await ApiClient.UserGroup.list({ page: 1, per_page: 100 })
  const active = groups.groups.filter(g => g.is_active)
  // `is_default` is the schema's own answer to "the group ordinary users land
  // in"; the name is the fallback for a deployment that unset it. There is NO
  // third fallback on purpose — granting to whichever group sorts first is a
  // silent access-control decision nobody asked for.
  const target =
    active.find(g => g.is_default) ?? active.find(g => g.name === DEFAULT_GROUP_NAME)
  if (!target) {
    return `No default user group was found to share the local provider with. An administrator can share it with the right group in Settings → LLM Providers → Groups.`
  }

  await LlmProviderStore.assignGroupToProvider(providerId, target.id)
  return null
}
