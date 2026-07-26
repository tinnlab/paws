import { hasPermissionNow } from '@/core/permissions'
import { Permissions } from '@/api-client/permissions'
import type { McpComposerSet, McpComposerGet } from '../state'
import { FALLBACK_APPROVAL_MODE, type ApprovalModeValue } from '../../approvalDefaults'

/**
 * Load user defaults from backend.
 */
export default (set: McpComposerSet, _get: McpComposerGet) => async () => {
  // Permission-gate the shell-eager-load fetch:
  if (!hasPermissionNow(Permissions.ConversationsRead)) return

  try {
    const { ApiClient } = await import('@/api-client')
    const response = await ApiClient.Mcp.getDefaults()
    set(state => {
      state.userDefaults = response.defaults || null
      // The server's default for any scope with no stored row. `defaults` is
      // null for a user who never saved any, which used to leave the client
      // with nothing but a hardcoded guess.
      state.serverDefaultApprovalMode =
        (response.default_approval_mode as ApprovalModeValue) ??
        FALLBACK_APPROVAL_MODE
      state.userDefaultsLoaded = true
    })
    console.log(
      '[MCP Store] Loaded user defaults:',
      response.defaults,
      'server default approval mode:',
      response.default_approval_mode,
    )
  } catch (error) {
    console.error('[MCP Store] Failed to load user defaults:', error)
    set(state => {
      state.userDefaultsLoaded = true
    })
  }
}
