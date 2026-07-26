import type { McpComposerSet, McpComposerGet } from '../state'
import { blankMcpConfig, type ApprovalModeValue } from '../../approvalDefaults'

interface ConversationMcpConfig {
  selectedServers: Map<string, { server_id: string; tools: string[] }>
  disabledServers?: import('@/api-client/types').DisabledServer[]
  approvalMode?: ApprovalModeValue
  autoApprovedTools?: import('@/api-client/types').AutoApprovedServer[]
  loopSettings?: import('@/api-client/types').LoopSettings
}

/**
 * Load conversation config (from backend or create default).
 */
export default (set: McpComposerSet, _get: McpComposerGet) => (
  conversationId: string,
  config?: ConversationMcpConfig,
) => {
  set(state => {
    if (config) {
      state.conversationConfigs.set(conversationId, config)
    } else {
      // Create default config
      state.conversationConfigs.set(
        conversationId,
        blankMcpConfig(state.serverDefaultApprovalMode),
      )
    }

    // If this is current conversation, update selectedServers
    if (state.currentConversationId === conversationId) {
      const loadedConfig = state.conversationConfigs.get(conversationId)!
      state.selectedServers = new Map(loadedConfig.selectedServers)
    }
  })
  console.log('[MCP Store] Loaded conversation config:', conversationId)
}
