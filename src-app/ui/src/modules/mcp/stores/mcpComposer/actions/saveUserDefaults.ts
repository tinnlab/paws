import { resolveConfigKey } from '../state'
import type { McpComposerSet, McpComposerGet } from '../state'
import type { DisabledServer } from '@/api-client/types'
import { approvalModePayload } from '../../approvalDefaults'

/**
 * Save current config as user defaults.
 */
export default (set: McpComposerSet, get: McpComposerGet) => async (
  conversationId: string | null,
  availableServerIds: string[],
  updateAutoApproved?: boolean,
) => {
  const state = get()
  const configKey = resolveConfigKey(state, conversationId)
  const config = state.conversationConfigs.get(configKey)

  // Use state.selectedServers directly (always available)
  const selectedServerIds = new Set(state.selectedServers.keys())

  // Compute disabled_servers from selectedServers (inverted logic)
  const disabledServers: DisabledServer[] = availableServerIds
    .filter(id => !selectedServerIds.has(id))
    .map(id => ({ server_id: id, tools: [] }))

  try {
    const { ApiClient } = await import('@/api-client')
    const response = await ApiClient.Mcp.updateDefaults({
      // Only send approval_mode when this config actually HAS one. This save is
      // often a SIDE EFFECT of an unrelated action — removing an MCP server chip
      // on a new chat persists the server list here — and a mode pinned by such a
      // write becomes the fallback for EVERY future conversation of this user,
      // not just the current one. Backend COALESCE applies the server default on
      // insert and preserves the stored value on update.
      ...approvalModePayload(config?.approvalMode),
      // Only send auto_approved_tools when explicitly changing approvals — backend COALESCE preserves DB value otherwise
      ...(updateAutoApproved ? { auto_approved_tools: config?.autoApprovedTools || [] } : {}),
      disabled_servers: disabledServers,
      loop_settings: config?.loopSettings,
    })
    set(state => {
      state.userDefaults = response
    })
    console.log('[MCP Store] Saved user defaults:', response, {
      selectedServers: selectedServerIds.size,
      disabledServers: disabledServers.length,
    })
  } catch (error) {
    console.error('[MCP Store] Failed to save user defaults:', error)
    throw error
  }
}
