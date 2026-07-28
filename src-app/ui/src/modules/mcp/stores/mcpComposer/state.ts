import type { StoreSet } from '@ziee/framework/store-kit'
import type { ToolApprovalDecision, SSEChatStreamMcpElicitationRequiredData } from '@/api-client/types'
import {
  PENDING_CONVERSATION_KEY,
  pendingConversationKey,
  approvalKeyOf,
} from '../approvalRouting'
import { FALLBACK_APPROVAL_MODE, type ApprovalModeValue } from '../approvalDefaults'

// Re-export so consumers of this module don't need approvalRouting directly.
export {
  PENDING_CONVERSATION_KEY,
  pendingConversationKey,
  approvalKeyOf,
}

// Re-export the approval-mode vocabulary so action files get it from the
// state barrel they already import (mirrors the approvalRouting re-exports).
export { FALLBACK_APPROVAL_MODE, type ApprovalModeValue }

/**
 * Elicitation request state — a pending form the user needs to fill in.
 */
export interface ElicitationRequestState extends SSEChatStreamMcpElicitationRequiredData {
  status: 'pending' | 'accepted' | 'declined' | 'cancelled'
  /** Submitted field values — only set when status = 'accepted' */
  response_content?: Record<string, unknown>
}

/**
 * Live progress for a long-running tool call (from MCP
 * `notifications/progress` — e.g. a sandbox rootfs download).
 */
export interface McpToolProgressState {
  /** Current progress value (monotonically increasing). */
  progress: number
  /** Total expected units, if known (denominator for a progress bar). */
  total?: number | null
  /** Human-readable phase message ("Downloading…", "Verifying…"). */
  message?: string | null
}

/**
 * MCP tool call state
 */
export interface McpToolCall {
  tool_use_id: string
  /** Server display name */
  server: string
  /** Server UUID */
  server_id?: string
  /** The streaming message this call belongs to (ITEM-33) — correlates a
   *  `notifications/progress` (server + message_id, no tool_use_id) to the RIGHT
   *  pane's call, so two panes running a tool on the same server don't cross-bleed. */
  message_id?: string
  tool_name: string
  status: 'started' | 'pending_approval' | 'completed' | 'error'
  /** ISO start timestamp from the `mcpToolStart` / `mcpToolComplete` frame
   *  (ITEM-14). A LIVE step cannot get its timing from a DB join — the row is
   *  not written until the call finishes — so the frame carries it and the rail
   *  ticks an elapsed timer from here (DEC-9). */
  started_at?: string
  /** Final wall time in ms from the `mcpToolComplete` frame (ITEM-14). */
  duration_ms?: number
  /** The server ALWAYS re-prompts for this tool, ignoring any persisted
   *  per-conversation auto-approval — so the "Approve for this conversation"
   *  affordance would be a silent no-op and is hidden.
   *
   *  Carried on the `mcpApprovalRequired` frame (ITEM-25/AP-3). It replaces a
   *  hardcoded `control_mcp` server UUID + tool name that the mcp module used to
   *  keep in its approval card: the SERVER knows its own re-prompt policy, so it
   *  declares it, and mcp stops naming another module's built-in. */
  always_reprompt?: boolean
  input?: unknown
  result?: unknown
  error?: string
  /** ITEM-50 (full-disclosure): the EXTERNAL destination host this tool would
   *  send data to (e.g. `api.example.com`). Carried on the `mcpApprovalRequired`
   *  SSE frame so the approval card names the data-egress destination. Undefined
   *  for a built-in / loopback / stdio server (no external destination — a local
   *  call) or when restored from a persisted pending-approval row on reload. */
  dest_host?: string
  /** ITEM-50 (full-disclosure): the tool's FULL, EXACT advertised description
   *  (never truncated/summarized — poisoning hides in truncation). Carried on the
   *  `mcpApprovalRequired` SSE frame so the human reviews the real description the
   *  model was given. Undefined when the server advertised none / was unreachable. */
  description?: string
  /** Latest progress notification, while the call is running. */
  progress?: McpToolProgressState
}

/**
 * Server selection state
 * Maps server_id to selected tools (empty array = all tools)
 */
interface ServerSelection {
  server_id: string
  tools: string[] // Empty = all tools from server
}

/**
 * Per-conversation MCP configuration
 * Persisted and loaded from backend
 */
interface ConversationMcpConfig {
  /** Selected servers with tool filtering */
  selectedServers: Map<string, ServerSelection>
  /** Disabled servers (persisted to backend) - allows all servers by default */
  disabledServers?: import('@/api-client/types').DisabledServer[]
  /** Approval mode from conversation_mcp_settings */
  approvalMode?: ApprovalModeValue
  /** Auto-approved tools grouped by server */
  autoApprovedTools?: import('@/api-client/types').AutoApprovedServer[]
  /** Loop settings for controlling iteration behavior */
  loopSettings?: import('@/api-client/types').LoopSettings
}

/** Special key for pending (new conversation) config */
/** Build a config-map key for a project (so the same conversationConfigs
 *  Map can hold both conversation- and project-scoped configs without a
 *  parallel collection). Conversation ids are raw UUIDs; project keys
 *  carry a `project:` prefix so they can't collide. */
export const projectConfigKey = (projectId: string) => `project:${projectId}`

/**
 * Resolve which config-map key an action should read/write based on
 * the currently-active scope (chat vs project). Centralizing this
 * keeps the precedence rule honest at every call site:
 *
 *   1. If `currentProjectId` is set AND `currentConversationId` is null,
 *      the modal was opened in project scope — route to the project key.
 *   2. Otherwise, route to the conversation id (or PENDING_CONVERSATION_KEY
 *      when null, i.e. the pending-buffer for new chats).
 *
 * Conversation always wins when present — even on a conversation that
 * belongs to a project. Editing from the chat surface edits conversation
 * overrides, never project defaults.
 */
function resolveConfigKey(
  state: {
    currentProjectId: string | null
    currentConversationId: string | null
    currentPaneId?: string | null
  },
  conversationId: string | null,
): string {
  if (state.currentProjectId !== null && state.currentConversationId === null) {
    return projectConfigKey(state.currentProjectId)
  }
  // No conversation → THIS pane's pending config (ITEM-51), so two new-chat split
  // panes edit their OWN pending config, not a single shared one.
  return conversationId || pendingConversationKey(state.currentPaneId)
}

// Re-export resolveConfigKey so action files can import it.
// It's a pure function that also needs the state shape, so we export it with the same signature.
export { resolveConfigKey }

/**
 * McpComposer store state.
 */
export const mcpComposerState = {
  toolCalls: new Map<string, McpToolCall>(),
  // Per-conversation approval decisions (ITEM-33): keyed by approvalKeyOf so a
  // pane's approval is sent only with ITS conversation's next message.
  approvalDecisions: new Map<string, ToolApprovalDecision[]>(),
  conversationConfigs: new Map<string, ConversationMcpConfig>(),
  currentConversationId: null as string | null,
  // The pane the config modal / active selection is currently bound to (ITEM-51).
  // Only meaningful while `currentConversationId` is null (a new chat): it selects
  // WHICH pane's per-pane pending config the modal edits. null = single-pane.
  currentPaneId: null as string | null,
  currentProjectId: null as string | null,
  selectedServers: new Map<string, ServerSelection>(),
  userDefaults: null as import('@/api-client/types').UserMcpDefaultsResponse | null,
  userDefaultsLoaded: false,
  /**
   * The SERVER's approval mode for any scope with no stored row — i.e. what a
   * brand-new conversation actually gets. Reported by `GET /api/mcp/defaults`
   * as `default_approval_mode`; the client must never assume it.
   *
   * Seeded with the safe restrictive fallback until that fetch resolves (see
   * `approvalDefaults.ts`). It is used for DISPLAY and for seeding blank configs
   * — never sent on a write (writes omit the field so the server stays
   * authoritative).
   */
  serverDefaultApprovalMode: FALLBACK_APPROVAL_MODE as ApprovalModeValue,
  configModalVisible: false,
  elicitationRequests: new Map<string, ElicitationRequestState>(),
}

export type McpComposerState = typeof mcpComposerState
export type McpComposerSet = StoreSet<McpComposerState>
export type McpComposerGet = () => McpComposerState
