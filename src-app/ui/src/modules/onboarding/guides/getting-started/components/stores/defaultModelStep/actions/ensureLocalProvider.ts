import { Permissions } from '@/api-client/permissions'
import { hasPermissionNow } from '@/core/permissions'
import { LlmProvider as LlmProviderStore } from '@/modules/llm-provider/stores/llmProvider'
import type { DefaultModelStepGet, DefaultModelStepSet } from '../state'

/**
 * Resolve the local provider the model is installed into, enabling it if needed.
 *
 * A fresh install ships the built-in `Local` provider DISABLED, and
 * `list_local_providers` filters `WHERE provider_type = 'local' AND enabled = true`
 * — so without this there is literally nothing to download into and INV-2's
 * "working model" is unreachable. Enabling happens HERE, at install time,
 * rather than in the seed migration, so an upgrading deployment that never
 * touches this step is unaffected (DEC-5).
 *
 * Returns the provider id, or `null` when none exists / the caller may not
 * enable one.
 */
export default (_set: DefaultModelStepSet, _get: DefaultModelStepGet) =>
  async (): Promise<string | null> => {
    // Read through `.$` — this runs from an install handler, not a render, and
    // the reactive proxy calls React hooks.
    await LlmProviderStore.loadLlmProviders()
    let locals = LlmProviderStore.$.providers.filter(p => p.provider_type === 'local')

    const alreadyEnabled = locals.find(p => p.enabled)
    if (alreadyEnabled) return alreadyEnabled.id

    const disabled = locals[0]
    if (!disabled) return null

    // Enabling a provider is a distinct permission from creating a model; a
    // caller holding only the latter must fail loudly here rather than start a
    // multi-GB download into a provider that will never serve it.
    if (!hasPermissionNow(Permissions.LlmProvidersEdit)) return null

    await LlmProviderStore.updateLlmProvider(disabled.id, { enabled: true })

    // Deliberately NOT trusting `updateLlmProvider`'s return value: it resolves
    // to `null` when a concurrent update is already in flight (it early-returns
    // on its own `updating` flag). Re-read the list so the result reflects what
    // the server actually holds.
    await LlmProviderStore.loadLlmProviders(true)
    locals = LlmProviderStore.$.providers.filter(p => p.provider_type === 'local')
    return locals.find(p => p.enabled)?.id ?? null
  }
