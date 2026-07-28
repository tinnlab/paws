import type { McpServer } from '@/api-client/types'
import type { StoreSet } from '@ziee/framework/store-kit'

export interface McpServerDrawerPrefill {
  fields: Partial<McpServer>
  hub_id?: string
}

// `history` is a READ-ONLY mode: it renders ONLY the per-server tool-call
// history (McpToolCallsTab) — no form, no save/test/delete affordance. It
// exists so a non-admin holding `mcp_servers::read` can audit the calls THEY
// made against a built-in / system server, whose edit surface stays closed to
// them. The backend already owner-scopes every tool-call query, so this mode
// widens no data boundary.
export type McpServerDrawerMode =
  | 'create'
  | 'edit'
  | 'clone'
  | 'create-system'
  | 'edit-system'
  | 'history'

export const mcpServerDrawerState = {
  open: false,
  loading: false,
  editingServer: null as McpServer | null,
  prefillData: null as McpServerDrawerPrefill | null,
  isCloning: false,
  mode: 'create' as McpServerDrawerMode,
}

export type McpServerDrawerState = typeof mcpServerDrawerState
export type McpServerDrawerSet = StoreSet<McpServerDrawerState>
export type McpServerDrawerGet = () => McpServerDrawerState
