import { pendingConversationKey } from '../../approvalRouting'
import { resolveConfigKey } from '../state'
import type { McpComposerSet, McpComposerGet } from '../state'
import { blankMcpConfig, type ApprovalModeValue } from '../../approvalDefaults'

/**
 * Set current conversation ID and load its config.
 */
export default (set: McpComposerSet, _get: McpComposerGet) => (
  conversationId: string | null,
  paneId?: string | null,
) => {
  set(state => {
    state.currentConversationId = conversationId
    // Bind the active selection / modal to the opening pane (ITEM-51) so a
    // new-chat toggle edits THAT pane's pending config, not a shared one.
    state.currentPaneId = paneId ?? null

    // Determine which config key to use (now paneId-aware for the pending case).
    const configKey = resolveConfigKey(state, conversationId)

    // Load selected servers from conversation config (or pending)
    if (state.conversationConfigs.has(configKey)) {
      const config = state.conversationConfigs.get(configKey)!
      state.selectedServers = new Map(config.selectedServers)
    } else if (!conversationId) {
      // New conversation without pending config - create one with user defaults if available.
      // With no saved defaults the approval mode comes from the SERVER's default,
      // never a client-side literal (that hardcode is what used to get persisted
      // on the first send and downgrade an auto-approving deployment).
      const defaults = state.userDefaults
      const pendingConfig: {
        selectedServers: Map<string, { server_id: string; tools: string[] }>
        disabledServers?: import('@/api-client/types').DisabledServer[]
        approvalMode?: ApprovalModeValue
        autoApprovedTools?: import('@/api-client/types').AutoApprovedServer[]
        loopSettings?: import('@/api-client/types').LoopSettings
      } = {
        ...blankMcpConfig(
          (defaults?.approval_mode as ApprovalModeValue) ??
            state.serverDefaultApprovalMode,
          defaults?.loop_settings,
        ),
        disabledServers: defaults?.disabled_servers || [],
        autoApprovedTools: defaults?.auto_approved_tools || [],
      }
      // THIS pane's pending config key (ITEM-51), not the single shared one.
      state.conversationConfigs.set(pendingConversationKey(paneId), pendingConfig)
      state.selectedServers = new Map()
    } else {
      // No config yet, reset to empty
      state.selectedServers = new Map()
    }
  })
  console.log('[MCP Store] Set current conversation:', conversationId)
}
