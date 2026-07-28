import { useState } from 'react'
import { Alert, Button, Card, Progress, Text } from '@ziee/kit'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ToolStatusIcon } from '@/modules/chat/core/ToolStatusIcon'
import { serverParenLabel } from '@/modules/chat/core/utils/serverLabel'
import {
  createExtension,
  type ChatExtension,
  type ContentRendererProps,
} from '@/modules/chat/core/extensions'
import type { McpToolCall } from '@/modules/mcp/stores/mcpComposer'
import type { MessageContent, MessageContentDataToolUse, MessageContentDataToolResult, MessageWithContent, SSEChatStreamMcpElicitationRequiredData } from '@/api-client/types'
import { ToolCallPendingApprovalContent } from '@/modules/mcp/chat-extension/components/ToolCallPendingApprovalContent'
import { McpMenuItem } from '@/modules/mcp/chat-extension/components/McpMenuItem'
import { McpConfigModalMount } from '@/modules/mcp/chat-extension/components/McpConfigModalMount'
import { McpStatusRow } from '@/modules/mcp/chat-extension/components/McpStatusRow'
import { McpInitializer } from '@/modules/mcp/chat-extension/components/McpInitializer'
import { ElicitationFormContent } from '@/modules/mcp/chat-extension/components/ElicitationFormContent'
import { resolveArtifactToolUseId } from '@/modules/mcp/chat-extension/toolRun'
import { redactedJson } from '@/modules/chat/core/rail/redactToolArgs'
import { mcpRailContributions } from '@/modules/mcp/chat-extension/railContribution'
import { setRailLiveSource } from '@/modules/chat/core/rail/liveSteps'
import { setElicitationTransport } from '@/modules/chat/core/elicitation/transport'
import { McpComposer, useMcpComposerStore } from '@/modules/mcp/stores/mcpComposer'
import { McpServer as McpServerStore } from '@/modules/mcp/stores/mcpServer'
import { Chat } from '@/modules/chat/core/stores/chatBridge'

/**
 * MCP Tool Call UI Component
 * Shows approval UI when status is 'pending_approval'
 */
function McpToolCallUI({ toolCall }: { toolCall: McpToolCall }) {
  const [isExpanded, setIsExpanded] = useState(false)

  // Show approval UI for pending approval status
  if (toolCall.status === 'pending_approval') {
    return <ToolCallPendingApprovalContent toolCall={toolCall} />
  }

  const serverLabel = serverParenLabel(toolCall.server)

  return (
    <Card
      size="sm"
      className={cn('mb-2', !isExpanded && 'py-2.5')}
      data-testid={`mcp-toolcall-card-${toolCall.tool_use_id}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <ToolStatusIcon status={toolCall.status} />
          <Text strong className="truncate">{toolCall.tool_name}</Text>
          {serverLabel && (
            <Text type="secondary" className="text-xs whitespace-nowrap">
              {serverLabel}
            </Text>
          )}
          {/* Status is conveyed by the icon (check / x / wrench) — no text. A
              hidden marker keeps the completed/failed signal available to tests
              (mirrors the historical McpToolUseRenderer marker). */}
          {(toolCall.status === 'completed' || toolCall.status === 'error') && (
            <span
              className="sr-only"
              data-testid={`mcp-toolcall-status-${toolCall.tool_use_id}`}
              data-status={toolCall.status === 'error' ? 'failed' : 'completed'}
            />
          )}
        </div>
        <Button
          size="icon"
          variant="ghost"
          tooltip={isExpanded ? 'Hide details' : 'Show details'}
          icon={<ChevronDown className={cn('transition-transform', isExpanded && 'rotate-180')} />}
          onClick={() => setIsExpanded(!isExpanded)}
          data-testid={`mcp-toolcall-details-btn-${toolCall.tool_use_id}`}
        />
      </div>

      {toolCall.status === 'started' && toolCall.progress && (
        <div className="mt-2">
          {toolCall.progress.message && (
            <Text type="secondary" className="text-xs">
              {toolCall.progress.message}
            </Text>
          )}
          <Progress
            size="sm"
            aria-label="Tool call progress"
            data-testid={`mcp-toolcall-progress-${toolCall.tool_use_id}`}
            value={
              toolCall.progress.total && toolCall.progress.total > 0
                ? Math.min(
                    100,
                    Math.round(
                      (toolCall.progress.progress / toolCall.progress.total) * 100,
                    ),
                  )
                : 0
            }
          />
        </div>
      )}

      {isExpanded && (
        <div className="mt-2 text-xs">
          {toolCall.input !== undefined && (
            <div className="mb-2">
              <Text strong>Input:</Text>
              {/* REDACTED at source (ITEM-17 / DEC-1). This is the ONLY renderer
                  registered for `tool_use`, so it is also what the activity rail
                  delegates to for every contribution that supplies no
                  `renderDetail` of its own — i.e. most of them. Redacting the
                  contributions individually would leave the guarantee one
                  forgotten opt-in away from failing; redacting here makes it
                  hold for every tool family by construction. */}
              <pre className="p-2 rounded mt-1 overflow-auto max-h-40">
                {redactedJson(toolCall.input)}
              </pre>
            </div>
          )}

          {toolCall.result !== undefined && (
            <div className="mb-2">
              <Text strong>Result:</Text>
              <pre className="p-2 rounded mt-1 overflow-auto max-h-40">
                {redactedJson(toolCall.result)}
              </pre>
            </div>
          )}

          {toolCall.error && (
            <Alert
              tone="error"
              title="Error"
              description={toolCall.error}
              data-testid={`mcp-toolcall-error-alert-${toolCall.tool_use_id}`}
            />
          )}
        </div>
      )}
    </Card>
  )
}

/**
 * MCP tool use content renderer component
 * Renders tool calls from MCP servers (the call itself, before result)
 */
function McpToolUseRenderer({ content: data }: ContentRendererProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  // Access toolCalls Map directly to create a reactive subscription
  // Using getToolCall() method doesn't trigger re-renders when store updates
  const { toolCalls } = McpComposer
  const { servers } = McpServerStore
  // Hoisted above the early returns below: `Chat.messages` is a reactive
  // store-proxy access that calls a hook on every render, so it MUST run on every
  // render path — otherwise a re-render that early-returns (e.g. once `toolCall`
  // is tracked) calls fewer hooks → "Rendered fewer hooks than expected" crash.
  const { messages } = Chat
  const toolUseData = data.content as MessageContentDataToolUse

  if (!toolUseData.id) {
    return null
  }

  const toolCall = toolCalls.get(toolUseData.id)

  // If we have a tracked tool call, render it
  if (toolCall) {
    return <McpToolCallUI toolCall={toolCall} />
  }

  // Look up the server row so we can show its human display name (never the id).
  const server = servers.find(s => s.id === toolUseData.server_id)

  // Look up matching tool_result for historical display
  const message = messages.get(data.message_id)
  const toolResultData = message?.contents.find(
    c =>
      c.content_type === 'tool_result' &&
      ((c.content as unknown as { tool_use_id: string }).tool_use_id === toolUseData.id),
  )?.content as unknown as { content: string; is_error?: boolean } | undefined

  const hasDetails = toolUseData.input || toolResultData

  // Historical view for tool calls loaded from DB (store is empty after reload)
  return (
    <Card size="sm" className={cn('mb-2', !isExpanded && 'py-2.5')} data-testid={`mcp-tooluse-card-${toolUseData.id}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <ToolStatusIcon
            status={toolResultData ? (toolResultData.is_error ? 'failed' : 'success') : 'running'}
          />
          <Text strong className="truncate">{toolUseData.name || 'Tool Call'}</Text>
          {serverParenLabel(server?.display_name) && (
            <Text type="secondary" className="text-xs whitespace-nowrap">{serverParenLabel(server?.display_name)}</Text>
          )}
          {/* Status is conveyed by the icon (check / x / wrench) — no text. A
              hidden marker keeps the completed/failed signal available to tests. */}
          {toolResultData && (
            <span
              className="sr-only"
              data-testid={`mcp-tooluse-status-${toolUseData.id}`}
              data-status={toolResultData.is_error ? 'failed' : 'completed'}
            />
          )}
        </div>
        {hasDetails && (
          <Button
            size="icon"
            variant="ghost"
            tooltip={isExpanded ? 'Hide details' : 'Show details'}
            icon={<ChevronDown className={cn('transition-transform', isExpanded && 'rotate-180')} />}
            onClick={() => setIsExpanded(!isExpanded)}
            data-testid={`mcp-tooluse-details-btn-${toolUseData.id}`}
          />
        )}
      </div>
      {isExpanded && (
        <div className="mt-2 text-xs">
          {!!toolUseData.input && (
            <div className="mb-2">
              <Text strong>Input:</Text>
              {/* REDACTED at source — see the note in McpToolCallUI above. */}
              <pre className="p-2 rounded mt-1 overflow-auto max-h-40">
                {redactedJson(toolUseData.input)}
              </pre>
            </div>
          )}
          {toolResultData && (
            <div className="mb-2">
              <Text strong>Result:</Text>
              {toolResultData.is_error ? (
                <Alert tone="error" title="Error" description={toolResultData.content} className="mt-1" data-testid={`mcp-tooluse-error-alert-${toolUseData.id}`} />
              ) : (
                <pre className="p-2 rounded mt-1 overflow-auto max-h-40">{toolResultData.content}</pre>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

/**
 * MCP Extension
 * Handles MCP tool calls, approval workflows, and renders tool call UI
 */
// Per-pane subscription teardown (ITEM-34/5), keyed by ctx.chatStore.
const paneMcpSubs = new WeakMap<object, Array<() => void>>()

const mcpExtension: ChatExtension = createExtension({
  name: 'mcp',
  description: 'Handles MCP tool calls and approval workflows',
  priority: 50, // Higher priority to handle events early

  initialize: async (ctx) => {
    const { ApiClient } = await import('@/api-client')

    // Feed the CORE-owned rail live-step seam (ITEM-9 / DEC-9).
    //
    // Three things a persisted `tool_use`/`tool_result` pair cannot express —
    // `pending-approval`, a start timestamp to tick an elapsed timer from, and
    // "finished but the result block hasn't landed yet" — live in THIS module's
    // SSE-fed store. Core declares the shape and reads it; it never imports or
    // names this module (INV-1). Registration is idempotent, and re-registering
    // detaches the previous source, so a re-mounted pane cannot leak a
    // subscription.
    setRailLiveSource({
      get: toolUseId => {
        const call = McpComposer.$.toolCalls.get(toolUseId)
        if (!call) return null
        return {
          status: call.status,
          startedAt: call.started_at,
          durationMs: call.duration_ms,
        }
      },
      subscribe: onChange => useMcpComposerStore.subscribe(onChange),
    }, 'mcp')

    // Feed the CORE-owned ELICITATION seam (FIX_ROUND-2 #3 / AP-4).
    //
    // The side-channel elicitation transport — the `/respond` endpoint a
    // SUSPENDED in-process call resumes through — is genuinely owned by this
    // module: the route is `/api/mcp/elicitation/{id}/respond` and the state is
    // this store's `elicitationRequests`. But it is CONSUMED by any extension
    // whose tool can suspend mid-call (js-tool's `run_js` is the first). Before
    // this seam that consumer deep-imported `McpComposer`, which turned AP-4's
    // `mcp → js-tool` coupling into `js-tool → mcp` instead of removing it.
    // Now core declares the shape and this module pushes the implementation in;
    // neither extension names the other. Same inversion as the rail live source
    // above, same owner-scoped teardown in the registry's `unregister`.
    setElicitationTransport({
      has: id => McpComposer.$.elicitationRequests.has(id),
      status: id => McpComposer.$.elicitationRequests.get(id)?.status,
      register: init =>
        McpComposer.addElicitationRequest({
          elicitation_id: init.elicitation_id,
          message: init.message,
          requested_schema: {},
          server: init.server ?? '',
          message_id: init.message_id ?? null,
        } as unknown as SSEChatStreamMcpElicitationRequiredData),
      resolve: (id, action, content) =>
        McpComposer.resolveElicitation(id, action, content),
      // FIX_ROUND-3: notify only when the ELICITATION slice actually changes.
      //
      // Forwarding the whole store meant every addToolCall / updateToolCall /
      // setToolCallProgress / server-selection mutation bumped the core seam and
      // re-rendered every mounted approval card. That was a strict widening over
      // the code this replaced, which read `McpComposer.elicitationRequests`
      // through the store proxy's per-property `useShallow` selector and so woke
      // only on elicitation changes. The store replaces the Map on every
      // elicitation mutation (immutable update), so identity is a sound trigger.
      subscribe: onChange => {
        let last = McpComposer.$.elicitationRequests
        return useMcpComposerStore.subscribe(() => {
          const next = McpComposer.$.elicitationRequests
          if (next === last) return
          last = next
          onChange()
        })
      },
    }, 'mcp')

    // Bind the editing-message restore to the OWNING pane's chat store
    // (ctx.chatStore, ITEM-34/5) so editing in a non-focused pane restores that
    // pane's MCP server selection. Unsub stored per-pane for cleanup.
    const chatStore = ctx.chatStore
    const subs: Array<() => void> = []
    paneMcpSubs.set(chatStore, subs)
    subs.push(
      chatStore.subscribe(
        (state: any) => state.editingMessage,
        async (editingMessage: any) => {
        const mcpStore = McpComposer
        if (!mcpStore) return

        if (editingMessage) {
          // Per-message server snapshot moved off the Message row into
          // mcp's own `message_mcp_servers` join table (backend
          // migration 74). Fetch via the mcp-owned endpoint instead of
          // reading inline from `editingMessage.mcp_server_ids` (which
          // no longer exists on the Message type).
          try {
            const resp = await ApiClient.Message.getMcpServers({
              id: editingMessage.id,
            })
            if (resp.server_ids.length > 0) {
              mcpStore.setEnabledServers(resp.server_ids)
            }
          } catch {
            // Soft-fail: no snapshot recorded (pre-migration message
            // or write hook failed at send-time) → keep current
            // selection. Matches the pre-extraction behavior for
            // messages without the column populated.
          }
        } else {
          // Edit cancelled or sent — restore from stored conversation config,
          // binding the modal to THIS pane (ITEM-51).
          const st = chatStore.getState() as {
            conversation?: { id: string }
            paneId?: string | null
          }
          if (st.conversation) {
            mcpStore.setCurrentConversation(st.conversation.id, st.paneId ?? null)
          }
        }
        },
      ),
    )
  },

  // Type-safe SSE event handlers
  sseEventHandlers: {
    mcpToolStart: async (data, get, set) => {
      // data is automatically typed as SSEChatStreamMcpToolStartData
      // addToolCall is an action — callable directly on the store proxy
      // (actions are hook-free, safe outside a React component context).
      const mcpStore = McpComposer

      mcpStore.addToolCall({
        tool_use_id: data.tool_use_id,
        server: data.server,
        tool_name: data.tool_name,
        // The owning streaming message id (best-effort). It may be undefined (a
        // tool call leading the turn before any streamingMessage exists) or a
        // synthetic `streaming-<ts>` placeholder — neither equals the real backend
        // `message_id` a `notifications/progress` event carries, so `setToolCallProgress`
        // treats only a REAL (non-placeholder) id as a usable discriminator and
        // otherwise falls back to server-only matching (so the progress bar never
        // stalls — the fix for the LEDGER round-9 single-pane regression — while
        // still scoping per-pane when a real id IS present).
        message_id: get().streamingMessage?.id,
        status: 'started',
        input: data.input,
        // ITEM-14: the frame now carries the call's start instant, so a LIVE
        // step can show a ticking elapsed time. A DB join cannot serve this —
        // `mcp_tool_calls` is not written until the call finishes.
        started_at: data.started_at ?? undefined,
      })

      // Inject tool_use content block into streaming message so McpToolUseRenderer can mount
      // This ensures tool calls are visible during auto-approve execution
      const chatState = get()
      let streamingMessage = chatState.streamingMessage
      const now = new Date().toISOString()

      // Create tool_use content block
      const toolUseContent: MessageContent = {
        id: '',
        message_id: '',
        content_type: 'tool_use',
        content: {
          type: 'tool_use',
          id: data.tool_use_id,
          name: data.tool_name,
          server_id: data.server,
        } as MessageContentDataToolUse,
        sequence_order: 0,
        created_at: now,
        updated_at: now,
      }

      if (streamingMessage) {
        // Check if this tool_use content already exists (avoid duplicates)
        const exists = streamingMessage.contents.some(
          c => c.content_type === 'tool_use' &&
               (c.content as MessageContentDataToolUse).id === data.tool_use_id
        )
        if (!exists) {
          toolUseContent.id = `${streamingMessage.id}-tool-${data.tool_use_id}`
          toolUseContent.message_id = streamingMessage.id
          toolUseContent.sequence_order = streamingMessage.contents.length

          const updatedMessage = {
            ...streamingMessage,
            contents: [...streamingMessage.contents, toolUseContent],
          }

          const newMessages = new Map(chatState.messages)
          newMessages.set(updatedMessage.id, updatedMessage)
          set({
            streamingMessage: updatedMessage,
            messages: newMessages,
          })
        }
      } else {
        // No streaming message exists — check messages map for an existing block first (dedup)
        const existingInMap = [...chatState.messages.values()].some(m =>
          m.contents.some(
            c => c.content_type === 'tool_use' &&
                 (c.content as MessageContentDataToolUse).id === data.tool_use_id
          )
        )

        if (!existingInMap) {
          // CREATE a new streaming message with the tool_use block
          const messageId = `streaming-${Date.now()}`
          toolUseContent.id = `${messageId}-tool-${data.tool_use_id}`
          toolUseContent.message_id = messageId

          const newMessage: MessageWithContent = {
            id: messageId,
            role: 'assistant',
            contents: [toolUseContent],
            originated_from_id: '',
            edit_count: 0,
            created_at: now,
          }

          const newMessages = new Map(chatState.messages)
          newMessages.set(newMessage.id, newMessage)
          set({
            streamingMessage: newMessage,
            messages: newMessages,
          })
        }
      }
    },

    mcpToolProgress: async data => {
      // A long-running tool call reported progress (e.g. a sandbox rootfs
      // download). Attach it to the running tool call(s) for this server so
      // the tool card can render a live progress bar.
      const mcpStore = McpComposer
      mcpStore.setToolCallProgress(data.server, data.message_id, {
        progress: data.progress,
        total: data.total ?? undefined,
        message: data.message ?? undefined,
      })
    },

    mcpApprovalRequired: async (data, get, set) => {
      // data is automatically typed as SSEChatStreamMcpApprovalRequiredData
      const mcpStore = McpComposer

      // Use addToolCall instead of updateToolCall - the tool call doesn't exist yet
      // because mcpToolStart is NOT sent when approval is required
      mcpStore.addToolCall({
        tool_use_id: data.tool_use_id,
        server: data.server,
        server_id: data.server_id,
        tool_name: data.tool_name,
        // The owning streaming message id (best-effort). It may be undefined (a
        // tool call leading the turn before any streamingMessage exists) or a
        // synthetic `streaming-<ts>` placeholder — neither equals the real backend
        // `message_id` a `notifications/progress` event carries, so `setToolCallProgress`
        // treats only a REAL (non-placeholder) id as a usable discriminator and
        // otherwise falls back to server-only matching (so the progress bar never
        // stalls — the fix for the LEDGER round-9 single-pane regression — while
        // still scoping per-pane when a real id IS present).
        message_id: get().streamingMessage?.id,
        status: 'pending_approval',
        input: data.input,
        // ITEM-50 (full-disclosure): carry the data-egress destination host + the
        // tool's full exact description so the approval card can render them.
        dest_host: data.dest_host,
        description: data.description,
        // ITEM-25/AP-3 — the server declares its own re-prompt policy instead of
        // the client hardcoding a built-in server's UUID.
        always_reprompt: data.always_reprompt ?? undefined,
      })

      // Inject tool_use content block into streaming message so McpToolUseRenderer can mount
      // Without this, the approval UI won't show because there's no content block to render
      const chatState = get()
      let streamingMessage = chatState.streamingMessage
      const now = new Date().toISOString()

      // Create tool_use content block
      const toolUseContent: MessageContent = {
        id: '', // Will be set below based on message id
        message_id: '', // Will be set below
        content_type: 'tool_use',
        content: {
          type: 'tool_use',
          id: data.tool_use_id,
          name: data.tool_name,
          server_id: data.server_id,
          input: data.input,
        } as MessageContentDataToolUse,
        sequence_order: 0,
        created_at: now,
        updated_at: now,
      }

      if (streamingMessage) {
        // Streaming message exists - add tool_use content to it (dedup check)
        const existsInStreaming = streamingMessage.contents.some(
          c => c.content_type === 'tool_use' &&
               (c.content as MessageContentDataToolUse).id === data.tool_use_id
        )
        // Also check the full messages map: on approval-resend streams, asst_msg_1 may
        // already be loaded via loadMessages and contain this tool_use_id. Without this
        // check the handler would add a second tool_use block to the new streaming message,
        // producing two McpToolUseRenderer instances → two approval panels.
        const existsInMap = !existsInStreaming && [...chatState.messages.values()].some(m =>
          m.id !== streamingMessage.id &&
          m.contents.some(
            c => c.content_type === 'tool_use' &&
                 (c.content as MessageContentDataToolUse).id === data.tool_use_id
          )
        )
        if (!existsInStreaming && !existsInMap) {
          toolUseContent.id = `${streamingMessage.id}-tool-${data.tool_use_id}`
          toolUseContent.message_id = streamingMessage.id
          toolUseContent.sequence_order = streamingMessage.contents.length

          const updatedMessage = {
            ...streamingMessage,
            contents: [...streamingMessage.contents, toolUseContent],
          }

          const newMessages = new Map(chatState.messages)
          newMessages.set(updatedMessage.id, updatedMessage)
          set({
            streamingMessage: updatedMessage,
            messages: newMessages,
          })
        }
      } else {
        // No streaming message exists — check messages map for an existing one first (dedup)
        const existingStreaming = [...chatState.messages.values()].find(m =>
          m.contents.some(
            c => c.content_type === 'tool_use' &&
                 (c.content as MessageContentDataToolUse).id === data.tool_use_id
          )
        )

        if (!existingStreaming) {
          // CREATE a new streaming message with the tool_use block
          // This happens when LLM returns a tool call without any text first
          const messageId = `streaming-${Date.now()}`
          toolUseContent.id = `${messageId}-tool-${data.tool_use_id}`
          toolUseContent.message_id = messageId

          const newMessage: MessageWithContent = {
            id: messageId,
            role: 'assistant',
            contents: [toolUseContent],
            originated_from_id: '',
            edit_count: 0,
            created_at: now,
          }

          const newMessages = new Map(chatState.messages)
          newMessages.set(newMessage.id, newMessage)
          set({
            streamingMessage: newMessage,
            messages: newMessages,
          })
        }
      }
    },


    mcpElicitationRequired: async (data, get, set) => {
      // data is automatically typed as SSEChatStreamMcpElicitationRequiredData
      const mcpStore = McpComposer
      mcpStore.addElicitationRequest(data)

      // Inject elicitation_request content block into streaming message so
      // ElicitationFormContent can mount and render the form inline
      const chatState = get()
      const streamingMessage = chatState.streamingMessage
      const now = new Date().toISOString()

      const elicitContent = {
        id: '',
        message_id: '',
        content_type: 'elicitation_request',
        content: {
          type: 'elicitation_request',
          status: 'pending',
          elicitation_id: data.elicitation_id,
          message_id: data.message_id,
          message: data.message,
          requested_schema: data.requested_schema,
          server: data.server,
        },
        sequence_order: 0,
        created_at: now,
        updated_at: now,
      } as unknown as MessageContent

      if (streamingMessage) {
        // Dedup: don't inject the same elicitation block twice (keyed by unique elicitation_id)
        const exists = streamingMessage.contents.some(
          c =>
            c.content_type === 'elicitation_request' &&
            (c.content as unknown as { elicitation_id: string }).elicitation_id === data.elicitation_id,
        )
        if (!exists) {
          elicitContent.id = `${streamingMessage.id}-elicit-${data.elicitation_id}`
          elicitContent.message_id = streamingMessage.id
          elicitContent.sequence_order = streamingMessage.contents.length

          const updatedMessage = {
            ...streamingMessage,
            contents: [...streamingMessage.contents, elicitContent],
          }

          const newMessages = new Map(chatState.messages)
          newMessages.set(updatedMessage.id, updatedMessage)
          set({ streamingMessage: updatedMessage, messages: newMessages })
        }
      } else {
        // No streaming message — create one to host the form
        const messageId = `streaming-${Date.now()}`
        elicitContent.id = `${messageId}-elicit-${data.elicitation_id}`
        elicitContent.message_id = messageId

        const newMessage: MessageWithContent = {
          id: messageId,
          role: 'assistant',
          contents: [elicitContent],
          originated_from_id: '',
          edit_count: 0,
          created_at: now,
        }

        const newMessages = new Map(chatState.messages)
        newMessages.set(newMessage.id, newMessage)
        set({ streamingMessage: newMessage, messages: newMessages })
      }
    },

    mcpToolComplete: async (data, _get, _set) => {
      // data is automatically typed as SSEChatStreamMcpToolCompleteData
      const mcpStore = McpComposer

      mcpStore.updateToolCall(data.tool_use_id, {
        status: data.is_error ? 'error' : 'completed',
        error: data.is_error ? 'Tool execution failed' : undefined,
        result: data.result,
        // ITEM-14 — the authoritative wall time, so the rail row settles from a
        // ticking elapsed timer onto the real duration.
        started_at: data.started_at ?? undefined,
        duration_ms: data.duration_ms ?? undefined,
      })
    },

    artifactCreated: async (data, get, set) => {
      // data is automatically typed as SSEChatStreamArtifactCreatedData.
      // A tool returned a file artifact. Surface it during streaming the SAME
      // way it persists in the DB: as a `resource_link` on the tool_result
      // block for the producing tool call. The file extension's `tool_result`
      // content renderer then shows the inline preview at that block's
      // position — consistent during streaming and after the post-complete
      // reload (no FileCard flash, no jump to a footer).
      const chatState = get()
      const streamingMessage = chatState.streamingMessage
      if (!streamingMessage) return

      // Associate to the producing tool call. Prefer the explicit tool_use_id
      // from the event (robust under parallel tools). The legacy no-id fallback
      // attributes ONLY when unambiguous (a single tool_use in the message, or a
      // single in-flight store call) — it never guesses "the last tool_use",
      // which would mis-attach a parallel artifact.
      const toolUseId = resolveArtifactToolUseId(
        streamingMessage.contents,
        McpComposer.$.toolCalls,
        data.tool_use_id,
      )
      if (!toolUseId) return

      // Backend-owned artifact: render via the authenticated `/api/files/{id}`
      // path. InlineFilePreview resolves the File entity by `file_id`, so this
      // synthetic uri is only the React/dedup key until the real link arrives
      // on reload.
      const link = {
        uri: `/api/files/${data.file_id}`,
        file_id: data.file_id,
        name: data.filename,
        mime_type: data.mime_type ?? undefined,
        size: data.file_size,
        is_saved: true,
      }

      const now = new Date().toISOString()
      const contents = [...streamingMessage.contents]
      const existingIdx = contents.findIndex(
        c =>
          c.content_type === 'tool_result' &&
          (c.content as unknown as MessageContentDataToolResult).tool_use_id === toolUseId,
      )

      if (existingIdx >= 0) {
        // Merge: a tool that produced several artifacts collects them into one
        // tool_result block. Dedupe by file_id so repeated events don't stack.
        const existing = contents[existingIdx]
        const existingData = existing.content as unknown as MessageContentDataToolResult
        const links = [...(existingData.resource_links ?? [])]
        if (!links.some(l => l.file_id === link.file_id)) {
          links.push(link)
        }
        contents[existingIdx] = {
          ...existing,
          content: { ...existingData, resource_links: links } as unknown as MessageContentDataToolResult,
        }
      } else {
        // First artifact for this tool: create a tool_result block carrying the
        // file. Appended at the end (monotonic sequence_order); ChatMessage's
        // normalizeToolResultOrder relocates it adjacent to its tool_use at
        // render time (by tool_use_id), so it groups correctly even if a
        // non-tool block lands in between. `content` is empty — the result text
        // is shown by the tool_use card; this block only carries the files.
        // `tool_use_id` lets the card's historical lookup still match it after
        // reload.
        const toolResult: MessageContent = {
          id: `artifact-result-${toolUseId}`,
          message_id: streamingMessage.id,
          content_type: 'tool_result',
          content: {
            type: 'tool_result',
            tool_use_id: toolUseId,
            content: '',
            resource_links: [link],
          } as unknown as MessageContentDataToolResult,
          sequence_order: contents.length,
          created_at: now,
          updated_at: now,
        }
        contents.push(toolResult)
      }

      const updatedMessage = { ...streamingMessage, contents }
      const newMessages = new Map(chatState.messages)
      newMessages.set(updatedMessage.id, updatedMessage)
      set({ streamingMessage: updatedMessage, messages: newMessages })
    },
  },

  // Allow empty text when there are pending tool approvals
  beforeSendMessage: async () => {
    const { approvalKeyOf } = await import('@/modules/mcp/stores/mcpComposer')
    const mcpStore = McpComposer

    // Check if there are approval decisions queued to send for THIS (sending =
    // focused) conversation (ITEM-33) — not another pane's.
    const approvalDecisions = mcpStore.getApprovalDecisions(
      approvalKeyOf(Chat.$.conversation?.id),
    )
    const hasApprovalDecisions = approvalDecisions.length > 0

    if (hasApprovalDecisions) {
      // Discard text extension's cancel since we're sending tool approvals
      return { cancel: false, discardCancel: ['text'] }
    }

    return { cancel: false }
  },

  // Compose request fields to include MCP config and approval decisions
  composeRequestFields: async (ctx) => {
    const { approvalKeyOf } = await import('@/modules/mcp/stores/mcpComposer')
    const mcpStore = McpComposer
    // Resolve the SENDING pane's own MCP config + approvals (ITEM-33/51) — from the
    // per-conversation/per-pane keyed state, not the single-active pointer, so two
    // split panes send with their own selection and one pane's approval never leaks.
    // `ctx.paneId` scopes the PENDING (new-chat) read to THIS pane's own buffer.
    const selectedServers = mcpStore.getSelectedServersConfigFor(
      ctx.conversationId,
      ctx.paneId,
    )
    const approvalDecisions = mcpStore.getApprovalDecisions(
      approvalKeyOf(ctx.conversationId),
    )

    const fields: {
      enable_mcp?: boolean
      mcp_config?: { mcp_servers: typeof selectedServers }
      tool_approvals?: typeof approvalDecisions
    } = {}

    // Add MCP config if servers are selected
    if (selectedServers.length > 0) {
      fields.enable_mcp = true
      fields.mcp_config = { mcp_servers: selectedServers }
    }

    // Add approval decisions if present
    if (approvalDecisions.length > 0) {
      fields.tool_approvals = approvalDecisions
    }

    return fields
  },

  // Load conversation MCP settings when conversation is opened
  onConversationLoad: async (conversation) => {
    const mcpStore = McpComposer
    const mcpStoreProxy = McpComposer
    // STATE reads must go through the `$` snapshot — a non-function prop on the
    // store proxy resolves via `useStore` (a HOOK), which is invalid in this
    // async, non-component hook. Actions are hook-free and stay on `mcpStore`.
    const serverDefaultApprovalMode = McpComposer.$.serverDefaultApprovalMode

    // Set current conversation ID
    mcpStore.setCurrentConversation(conversation.id)

    try {
      // Load conversation MCP settings from backend (via store action).
      const response = await mcpStoreProxy.getConversationMcpSettings(
        conversation.id,
      )

      // Get available servers to compute selectedServers from disabledServers
      // Read via `$` snapshot on the McpServer store (outside React context)
      const mcpServerState = McpServerStore.$
      const availableServers = (mcpServerState?.servers || []).filter(s => s.enabled)
      const availableServerIds = new Set(availableServers.map(s => s.id))

      if (response.settings) {
        // Get disabled servers from backend
        const disabledServers = response.settings.disabled_servers || []

        // Compute selectedServers: all available servers that are NOT fully disabled.
        // Entries with non-empty tools = partially disabled (specific tools disabled, server still enabled).
        const selectedServers = new Map<string, { server_id: string; tools: string[] }>()
        for (const serverId of availableServerIds) {
          const disabledEntry = disabledServers.find(d => d.server_id === serverId)

          if (!disabledEntry) {
            // Not in disabled list → all tools selected
            selectedServers.set(serverId, { server_id: serverId, tools: [] })
          } else if (disabledEntry.tools.length > 0) {
            // Partially disabled: specific tools are disabled, compute selected = all - disabled
            try {
              const toolsResponse = await mcpStoreProxy.listServerTools(serverId)
              const allTools = toolsResponse.tools.map(t => t.name)
              const selectedTools = allTools.filter(t => !disabledEntry.tools.includes(t))
              if (selectedTools.length > 0) {
                selectedServers.set(serverId, { server_id: serverId, tools: selectedTools })
              }
              // If all tools are disabled (selectedTools empty), treat server as disabled → skip
            } catch {
              // On error fetching tools, fall back to all tools selected
              selectedServers.set(serverId, { server_id: serverId, tools: [] })
            }
          }
          // disabledEntry.tools.length === 0 → entire server disabled → skip
        }

        const config = {
          selectedServers,
          disabledServers,
          approvalMode: response.settings.approval_mode as 'disabled' | 'auto_approve' | 'manual_approve',
          autoApprovedTools: response.settings.auto_approved_tools || [],
          loopSettings: response.settings.loop_settings,
        }

        mcpStore.loadConversationConfig(conversation.id, config)
      } else {
        // If settings don't exist yet, select all available servers by default
        const selectedServers = new Map<string, { server_id: string; tools: string[] }>()
        for (const serverId of availableServerIds) {
          selectedServers.set(serverId, { server_id: serverId, tools: [] })
        }

        const config = {
          selectedServers,
          disabledServers: [],
          // No stored settings yet → the SERVER's default, not a client literal.
          // Hardcoding manual here misreported (and, via the first save, then
          // PERSISTED) the wrong mode on an auto-approving deployment.
          approvalMode: serverDefaultApprovalMode,
          autoApprovedTools: [],
          loopSettings: undefined,  // Use defaults
        }

        mcpStore.loadConversationConfig(conversation.id, config)
      }
    } catch {
      // If settings don't exist yet, create default config with all servers enabled
      const mcpServerState = McpServerStore.$
      const availableServers = (mcpServerState?.servers || []).filter(s => s.enabled)
      const selectedServers = new Map<string, { server_id: string; tools: string[] }>()
      for (const server of availableServers) {
        selectedServers.set(server.id, { server_id: server.id, tools: [] })
      }

      const config = {
        selectedServers,
        disabledServers: [],
        // Settings fetch failed → still use the SERVER's default rather than a
        // client literal (same reason as the no-settings branch above).
        approvalMode: serverDefaultApprovalMode,
        autoApprovedTools: [],
        loopSettings: undefined,  // Use defaults
      }

      mcpStore.loadConversationConfig(conversation.id, config)
    }

    // Load pending approvals for the current branch (to restore state after page refresh)
    if (conversation.active_branch_id) {
      try {
        const approvalsResponse = await mcpStoreProxy.getBranchPendingApprovals(
          conversation.active_branch_id,
        )

        if (approvalsResponse.approvals && approvalsResponse.approvals.length > 0) {
          for (const approval of approvalsResponse.approvals) {
            mcpStore.addToolCall({
              tool_use_id: approval.tool_use_id,
              server: approval.server_name,
              server_id: approval.server_id,
              tool_name: approval.tool_name,
              status: 'pending_approval',
              input: approval.input,
            })
          }
        }
      } catch (error) {
        console.error('[MCP Extension] Failed to load pending approvals:', error)
      }
    }
  },

  // Clear approval decisions after message is sent
  onMessageSent: async ownerPaneId => {
    const { paneRegistry } = await import('@/modules/chat/core/stores/chatBridge')
    // Read via `$` snapshot (state fields + actions both live on getState())
    const mcpStore = McpComposer.$

    // Resolve the SENDING pane's conversation from the threaded `ownerPaneId`, NOT
    // a `Chat.$` read (the FOCUSED pane) — in split view the sender may not
    // be focused by the time this async hook runs, so a `.$` read would transfer the
    // wrong pane's pending config (ITEM-51). Single-pane falls back to the bridge.
    const paneState = ownerPaneId
      ? (paneRegistry.get(ownerPaneId)?.api.getState() as
          | { conversation?: { id?: string } }
          | undefined)
      : undefined
    const conversation = paneState?.conversation ?? Chat.$.conversation

    // Handle new conversation creation: a freshly-minted conversation has no config
    // of its own yet → move THIS pane's own pending config (keyed by ownerPaneId)
    // under the new id, bind the modal to it, and persist.
    if (conversation?.id && !mcpStore.conversationConfigs.has(conversation.id)) {
      mcpStore.transferPendingConfig(conversation.id, ownerPaneId)
      mcpStore.setCurrentConversation(conversation.id, ownerPaneId)

      // Get available server IDs for proper disabled_servers computation
      const mcpServerState = McpServerStore.$
      const availableServerIds = (mcpServerState?.servers || [])
        .filter(s => s.enabled)
        .map(s => s.id)

      // Save settings to backend with available server IDs
      try {
        await mcpStore.saveConversationConfig(conversation.id, availableServerIds)
      } catch (error) {
        console.error('[MCP Extension] Failed to save config for new conversation:', error)
      }
    }

    // Clear only the SENDING conversation's approvals (ITEM-33).
    const { approvalKeyOf } = await import('@/modules/mcp/stores/mcpComposer')
    mcpStore.clearApprovalDecisions(approvalKeyOf(conversation?.id))

    return {}
  },

  // Register content type components.
  // NOTE: `tool_result` is intentionally NOT registered here. The tool-call
  // CARD (input + result text, including completed/error state) is rendered by
  // McpToolUseRenderer (the `tool_use` content type). The file extension owns
  // the `tool_result` content type so a tool's returned files (resource_links)
  // render INLINE at that block's position. The registry returns the first
  // renderer for a content type, so registering a null renderer here would
  // shadow the file extension's.
  // The tool-call CARD renders one block, never a group: grouping is the
  // ACTIVITY RAIL's job now (ITEM-2/ITEM-5), and the "N tools called" collapsible
  // group card it replaced is deleted — the two can never coexist, because both
  // claimed the same `tool_use` blocks and any overlap double-renders or drops
  // them (DEC-4, hard cutover).
  //
  // `run_js_approval` is NOT here: the js-tool module owns its own approval UI
  // now (ITEM-25/AP-4). mcp rendering another module's surface was an
  // anti-pattern, not a convenience.
  contentTypes: {
    tool_use: McpToolUseRenderer,
    elicitation_request: ElicitationFormContent,
  },

  // Each extension contributes its own step descriptor + detail body (INV-1).
  railContributions: mcpRailContributions,

  // Register slot components
  slots: {
    toolbar_actions: { component: McpInitializer, order: 1 },
    toolbar_plus_items: { component: McpMenuItem, order: 20 },
    toolbar_status: { component: McpStatusRow, order: 10 },
    // The config modal is hosted from an always-mounted composer slot (NOT the
    // "+" dropdown item) so it survives the dropdown closing on click.
    input_area_suffix: { component: McpConfigModalMount, order: 20 },
  },

  cleanup: async (ctx) => {
    const subs = paneMcpSubs.get(ctx.chatStore)
    if (subs) {
      for (const unsub of subs) unsub()
      paneMcpSubs.delete(ctx.chatStore)
    }
  },
})

export default mcpExtension
