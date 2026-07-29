import { useState } from 'react'
import { Button, Card, CardActions, Text } from '@ziee/kit'
import {
  APPROVAL_DESCRIPTION_COLLAPSED_MAX_PX,
  approvalDescriptionViewKey,
} from '@/modules/mcp/chat-extension/components/approvalDescriptionClamp'
import { CollapsibleBlock } from '@/modules/chat/components/CollapsibleBlock'
import { Clock, Check, X, Send } from 'lucide-react'
import {
  approvalKeyOf,
  type McpToolCall,
} from '@/modules/mcp/stores/mcpComposer'
import { useChatPaneOrNull } from '@/modules/chat/core/pane/ChatPaneContext'
import { mcpServerParenLabel } from '@/modules/mcp/chat-extension/serverLabel'
import { McpComposer } from '@/modules/mcp/stores/mcpComposer'
import { McpServer } from '@/modules/mcp/stores/mcpServer'
import { Chat as ChatStore } from '@/modules/chat/core/stores/chatBridge'

interface ToolCallPendingApprovalContentProps {
  toolCall: McpToolCall
}

/**
 * Deterministic id of the built-in App Control MCP server
 * (`Uuid::new_v5(NAMESPACE_URL, "control.ziee.internal")`). Stable across
 * deployments; mirrors the backend `control_mcp_server_id()`.
 */
const CONTROL_MCP_SERVER_ID = 'd878787e-aa48-5f16-a31f-673052083f34'

/** Collapse whitespace + cap a string for the one-line egress sentence. The FULL
 *  args are always shown verbatim in the Arguments block below, so a truncated
 *  preview here never hides anything from the reviewer. */
function truncatePreview(s: string, max = 80): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

/** Short, human-readable preview of the concrete args the model chose, for the
 *  "sends «preview» to «host»" data-egress line. Prefers the first primitive
 *  argument value; falls back to compact JSON. */
function argPreview(input: unknown): string {
  if (input === undefined || input === null) return 'a request'
  if (typeof input === 'string') return truncatePreview(input) || 'a request'
  if (typeof input !== 'object') return truncatePreview(String(input))
  const entries = Object.entries(input as Record<string, unknown>)
  if (entries.length === 0) return 'a request'
  const firstPrimitive = entries.find(
    ([, v]) => v !== null && typeof v !== 'object',
  )
  if (firstPrimitive) {
    const [k, v] = firstPrimitive
    return truncatePreview(`${k}: ${String(v)}`)
  }
  return truncatePreview(JSON.stringify(input))
}

/**
 * The advertised tool description, bounded so the card's decision controls stay
 * on screen.
 *
 * REUSES the chat module's `CollapsibleBlock` rather than re-deriving a clamp.
 * That component already encodes the non-obvious parts this surface needs and a
 * hand-rolled version silently dropped: a bottom FADE MASK so the reader can SEE
 * the text is cut (on a consent surface, "looks like the description just ended"
 * is the failure mode that matters), `aria-controls` binding the toggle to the
 * region, auto-expand when a descendant takes focus (WCAG 2.4.7/2.4.11), and
 * `useInPlaceAnchor` so toggling inside the VIRTUALIZED message list grows the
 * row downward without the viewport jumping.
 *
 * The clamp is CSS-only: the COMPLETE string is always rendered into the DOM, in
 * both states, so it stays copyable, findable by in-page search, and readable by
 * assistive tech — honoring the card's "FULL, EXACT … never truncated/
 * summarized" contract while refusing to let an unbounded description bury
 * Deny/Approve.
 *
 * `break-words` is load-bearing, not cosmetic: without it a description made of
 * ONE unbroken token renders as a single line that never overflows VERTICALLY,
 * so a height clamp alone would hide the remainder horizontally with no toggle
 * and no cue — precisely the "poisoning hides in truncation" hole the contract
 * exists to close.
 *
 * The collapsed flag is keyed by the tool-use id (namespaced so it cannot
 * collide with a message id) so expanding survives the virtualizer unmounting
 * and remounting this row mid-read.
 */
function ApprovalToolDescription({
  description,
  toolUseId,
}: {
  description: string
  toolUseId: string
}) {
  return (
    <div>
      <Text strong className="text-xs">
        Tool description:
      </Text>
      <CollapsibleBlock
        maxHeightPx={APPROVAL_DESCRIPTION_COLLAPSED_MAX_PX}
        messageId={approvalDescriptionViewKey(toolUseId)}
        className="mt-0.5"
        data-testid="approval-tool-description-collapsible"
      >
        <Text
          className="text-sm whitespace-pre-wrap break-words block"
          data-testid="approval-tool-description"
        >
          {description}
        </Text>
      </CollapsibleBlock>
    </div>
  )
}

/**
 * ToolCallPendingApprovalContent
 *
 * Renders inline approval UI for MCP tool calls requiring approval.
 * Following the reference pattern: inline content block with approve/deny buttons.
 *
 * User actions:
 * - Approve Once: Creates immediate approval, resumes chat
 * - Deny: Denies tool execution, cancels the tool call
 */
export function ToolCallPendingApprovalContent({
  toolCall,
}: ToolCallPendingApprovalContentProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  // Bind to THIS pane's chat store (ITEM-33) so approving in pane B files the
  // decision under pane B's conversation and resumes pane B — never pane A (the
  // wrong-pane approval bug). Single-pane falls back to the primary.
  const chat = (useChatPaneOrNull()?.store ?? ChatStore) as typeof ChatStore

  // The built-in App Control server (`invoke_capability`) ALWAYS re-prompts on a
  // state-changing action — the backend deliberately ignores any persisted
  // per-conversation auto-approval for it (mutations to the app are always
  // confirmed). So the "Approve for this conversation" affordance would be a
  // silent no-op here; hide it to avoid misleading the user. Gate on the control
  // server's deterministic id (Uuid v5 of "control.ziee.internal") — NOT the tool
  // name alone, which a third-party server could also expose.
  const isControlWrite =
    toolCall.server_id === CONTROL_MCP_SERVER_ID &&
    toolCall.tool_name === 'invoke_capability'

  const handleApproveOnce = async () => {
    setIsSubmitting(true)
    const mcpStore = McpComposer
    // Optimistic status update: immediately switch out of 'pending_approval' so the
    // approval panel disappears and shows the 'Running…' card instead. This update
    // lives in McpStore (not local React state) and therefore survives the component
    // remount that happens when loadMessages replaces the messages Map after streaming.
    mcpStore.updateToolCall(toolCall.tool_use_id, { status: 'started' })
    try {
      mcpStore.addApprovalDecision(approvalKeyOf(chat.$.conversation?.id), {
        tool_use_id: toolCall.tool_use_id,
        decision: 'approve',
        note: 'User approved tool execution (once)',
      })
      await chat.sendMessage()
      // A failed POST sets Chat.store.error synchronously before sendMessage
      // resolves, so poll once to revert the optimistic update on that failure.
      // (A generation error after a successful POST arrives later on the chat
      // stream and surfaces in the conversation, not by reverting this panel.)
      const chatError = chat.$.error
      if (chatError) {
        throw new Error(chatError)
      }
      console.log('[MCP Approval] Tool approved once:', toolCall.tool_name)
    } catch (error) {
      console.error('[MCP Approval] Failed to approve tool:', error)
      // Revert optimistic update so the approval panel reappears on failure
      mcpStore.updateToolCall(toolCall.tool_use_id, {
        status: 'pending_approval',
      })
      setIsSubmitting(false)
    }
  }

  const handleApproveForConversation = async () => {
    setIsSubmitting(true)
    const mcpStore = McpComposer
    // Optimistic status update (same rationale as handleApproveOnce)
    mcpStore.updateToolCall(toolCall.tool_use_id, { status: 'started' })
    try {
      const chatState = chat.$
      const conversationId = chatState.conversation?.id || null

      // 1. Add tool to auto_approved_tools for this conversation
      if (toolCall.server_id) {
        mcpStore.toggleAutoApprovedTool(
          conversationId,
          toolCall.server_id,
          toolCall.tool_name,
        )

        // 2. Persist to backend if conversation exists
        if (conversationId) {
          const mcpServerState = McpServer.$
          const availableServerIds = (mcpServerState?.servers || [])
            .filter((s: { enabled: boolean }) => s.enabled)
            .map((s: { id: string }) => s.id)
          await mcpStore.saveConversationConfig(
            conversationId,
            availableServerIds,
            undefined,
            true,
          )
        }
      }

      // 3. Approve current tool call
      mcpStore.addApprovalDecision(approvalKeyOf(chat.$.conversation?.id), {
        tool_use_id: toolCall.tool_use_id,
        decision: 'approve',
        note: 'User approved tool for this conversation',
      })

      await chat.sendMessage()
      const chatError = chat.$.error
      if (chatError) {
        throw new Error(chatError)
      }
      console.log(
        '[MCP Approval] Tool approved for conversation:',
        toolCall.tool_name,
      )
    } catch (error) {
      console.error('[MCP Approval] Failed to approve tool:', error)
      mcpStore.updateToolCall(toolCall.tool_use_id, {
        status: 'pending_approval',
      })
      setIsSubmitting(false)
    }
  }

  const handleDeny = async () => {
    setIsSubmitting(true)
    const mcpStore = McpComposer
    // Optimistic status update to 'error' so the panel immediately shows denied state
    mcpStore.updateToolCall(toolCall.tool_use_id, {
      status: 'error',
      error: 'Tool execution denied by user',
    })
    try {
      mcpStore.addApprovalDecision(approvalKeyOf(chat.$.conversation?.id), {
        tool_use_id: toolCall.tool_use_id,
        decision: 'deny',
        note: 'User denied tool execution',
      })
      await chat.sendMessage()
      console.log('[MCP Approval] Tool denied:', toolCall.tool_name)
    } catch (error) {
      console.error('[MCP Approval] Failed to deny tool:', error)
      mcpStore.updateToolCall(toolCall.tool_use_id, {
        status: 'pending_approval',
      })
      setIsSubmitting(false)
    }
  }

  return (
    <div className="my-2" data-testid={`tool-approval-${toolCall.tool_use_id}`}>
      <Card
        size="sm"
        className="mb-2"
        data-testid="mcp-tool-approval-card"
        footer={
          // Right-aligned, negative-first like the elicitation form's
          // Decline/Submit. `CardActions` (not a hand-rolled `flex justify-end`
          // row) is load-bearing HERE above all: three decision controls do not
          // fit one line in a narrow card, and a non-wrapping `justify-end` row
          // pushes the overflow out the inline-START edge, where the Card's
          // `overflow-hidden` clips it away and no scroll can reach it. Measured
          // at a 390px viewport, that left Deny AND "Approve once" unreachable
          // with "Approve for this conversation" — the broadest approval — as the
          // only pressable control.
          <CardActions>
            <Button
              variant="outline"
              icon={<X />}
              onClick={handleDeny}
              loading={isSubmitting}
              size="default"
              data-testid="tool-approval-deny"
            >
              Deny
            </Button>
            <Button
              icon={<Check />}
              onClick={handleApproveOnce}
              loading={isSubmitting}
              size="default"
              data-testid="tool-approval-approve-once"
            >
              Approve once
            </Button>
            {!isControlWrite && (
              <Button
                icon={<Check />}
                onClick={handleApproveForConversation}
                loading={isSubmitting}
                size="default"
                data-testid="tool-approval-approve-conv"
              >
                Approve for this conversation
              </Button>
            )}
          </CardActions>
        }
      >
        {/* Header row — status icon + tool name + server label, mirroring the
            elicitation Card's header. */}
        {/* `flex-wrap` is load-bearing, same failure mode as the footer row:
            the two secondary labels are `whitespace-nowrap` and together need
            205px of a 238px row at a 390px viewport, so on ONE line they starved
            the TOOL NAME — the single thing the user is being asked to consent
            to — down to a rendered width of 0 (measured: name w=0,
            scrollWidth=98). A `truncate` element sets `overflow:hidden`, which
            already gives a flex item an automatic minimum size of ZERO, so it is
            always the sibling that loses; only wrapping saves it. */}
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <Clock className="size-4 shrink-0 text-warning" />
          <Text strong className="truncate" title={toolCall.tool_name}>
            {toolCall.tool_name}
          </Text>
          {mcpServerParenLabel(toolCall.server) && (
            <Text type="secondary" className="text-xs whitespace-nowrap">
              {mcpServerParenLabel(toolCall.server)}
            </Text>
          )}
          <Text type="secondary" className="text-xs whitespace-nowrap">
            — needs approval
          </Text>
        </div>

        <div className="mt-2 flex flex-col gap-2">
          {/* Data-egress disclosure (ITEM-50): name the CONCRETE destination host
              so the human reviews WHERE their data goes, not just a verb. Shown
              only for an EXTERNAL server (dest_host present); a built-in/loopback
              call has no external destination and falls back to the generic line. */}
          {toolCall.dest_host ? (
            <div
              className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-2"
              data-testid="approval-dest-host"
            >
              <Send className="size-4 shrink-0 mt-0.5 text-warning" />
              <Text className="text-sm">
                Sends{' '}
                <Text strong className="text-sm">
                  {argPreview(toolCall.input)}
                </Text>{' '}
                to{' '}
                <Text strong className="text-sm break-all">
                  {toolCall.dest_host}
                </Text>
              </Text>
            </div>
          ) : (
            <Text className="text-sm">
              This tool requires your approval before execution.
            </Text>
          )}

          {/* Full, EXACT tool description (never truncated): the description the
              model was actually given, so a poisoned/misleading one is visible.
              Visually CLAMPED (CSS max-height + "Show more"), never shortened —
              an unbounded description pushed Deny/Approve below the fold, which
              is both a usability defect and the cheapest way for a hostile
              server to leave Approve as the only action in view. */}
          {toolCall.description && (
            <ApprovalToolDescription
              description={toolCall.description}
              toolUseId={toolCall.tool_use_id}
            />
          )}

          {/* Concrete args the model chose — shown verbatim (no summarization). */}
          {toolCall.input !== undefined && (
            <div>
              <Text strong className="text-xs">
                Arguments:
              </Text>
              <pre
                className="p-2 rounded mt-1 overflow-auto max-h-40 text-xs bg-muted"
                data-testid="approval-tool-args"
              >
                {JSON.stringify(toolCall.input, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}
