import { resolveConfigKey } from '../state'
import type { McpComposerSet, McpComposerGet } from '../state'
import { blankMcpConfig, type ApprovalModeValue } from '../../approvalDefaults'

/**
 * Set approval mode for a conversation (or pending if conversationId is null).
 */
export default (set: McpComposerSet, _get: McpComposerGet) => (
  conversationId: string | null,
  mode: ApprovalModeValue,
) => {
  set(state => {
    const configKey = resolveConfigKey(state, conversationId)
    let config = state.conversationConfigs.get(configKey)

    // Create pending config if it doesn't exist (for new conversations)
    if (!config && !conversationId) {
      config = blankMcpConfig(state.serverDefaultApprovalMode)
      state.conversationConfigs.set(configKey, config)
    }

    if (config) {
      config.approvalMode = mode
    }
  })
}
