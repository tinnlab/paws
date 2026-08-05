
import type { McpComposerSet, McpComposerGet } from '../state'
import type { DisabledServer } from '@/api-client/types'
import { approvalModePayload } from '../../approvalDefaults'

/**
 * Save conversation config changes.
 */
export default (set: McpComposerSet, get: McpComposerGet) => async (
  conversationId: string,
  availableServerIds?: string[],
  serverToolsMap?: Map<string, string[]>,
  updateAutoApproved?: boolean,
) => {
  const state = get()
  const config = state.conversationConfigs.get(conversationId)

  if (!config) {
    console.warn('[MCP Store] No config to save for:', conversationId)
    return
  }

  // Compute disabled_servers from selectedServers (inverted logic)
  let disabledServers: DisabledServer[] = []
  if (availableServerIds && availableServerIds.length > 0) {
    const selectedServerIds = new Set(config.selectedServers.keys())
    disabledServers = availableServerIds
      .filter(id => !selectedServerIds.has(id))
      .map(id => ({ server_id: id, tools: [] }))
  }

  const existingDisabled = config.disabledServers || []

  // For partially selected servers (specific tools chosen), compute disabled tools
  if (serverToolsMap) {
    for (const [serverId, selection] of config.selectedServers.entries()) {
      if (selection.tools.length > 0) {
        const allTools = serverToolsMap.get(serverId)
        if (allTools === undefined) {
          // We never learned this server's tool list — its `tools/list` failed
          // (an unreachable MCP server answers 502, which is a COMMON and
          // transient condition). The disabled set is derived by subtracting
          // the selection from the full list, so with no list there is nothing
          // to subtract from: treating that as `[]` silently produced an empty
          // disabled set and RE-ENABLED every tool the user had turned off, on
          // a save the user never asked for (close auto-saves). Carry the
          // previously-persisted entry forward untouched instead.
          const prior = existingDisabled.find((d: DisabledServer) => d.server_id === serverId)
          if (prior) disabledServers.push(prior)
          continue
        }
        const disabledTools = allTools.filter(t => !selection.tools.includes(t))
        if (disabledTools.length > 0) {
          disabledServers.push({ server_id: serverId, tools: disabledTools })
        }
      }
    }
  }

  // Also include any previously saved disabled servers for unavailable servers
  const availableSet = new Set(availableServerIds || [])
  const unavailableDisabled = existingDisabled.filter((d: DisabledServer) => !availableSet.has(d.server_id))
  disabledServers = [...disabledServers, ...unavailableDisabled]

  // Call backend API to persist settings
  const { ApiClient } = await import('@/api-client')
  await ApiClient.Conversation.updateMcpSettings({
    id: conversationId,
    // Only send approval_mode when this config actually HAS one — backend
    // COALESCE applies the server default on insert and preserves the stored
    // value on update. The unconditional `|| 'manual_approve'` this replaces
    // is what made a brand-new conversation's first save pin manual approval
    // on a deployment whose default is auto-approve (auto-approved on turn 1,
    // prompted from turn 2). This save exists to snapshot the SERVER LIST.
    ...approvalModePayload(config.approvalMode),
    // Only send auto_approved_tools when explicitly changing approvals — backend COALESCE preserves DB value otherwise
    ...(updateAutoApproved ? { auto_approved_tools: config.autoApprovedTools } : {}),
    disabled_servers: disabledServers,
    loop_settings: config.loopSettings,
  })

  // Update local state with the computed disabled servers
  set(state => {
    const existingConfig = state.conversationConfigs.get(conversationId)
    if (existingConfig) {
      state.conversationConfigs.set(conversationId, {
        ...existingConfig,
        disabledServers,
      })
    }
  })

  console.log('[MCP Store] Saved conversation config:', conversationId, {
    approvalMode: config.approvalMode,
    autoApprovedTools: config.autoApprovedTools?.length || 0,
    disabledServers: disabledServers.length,
  })
}
