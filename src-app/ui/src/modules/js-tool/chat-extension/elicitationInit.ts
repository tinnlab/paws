import type { ElicitationRequestInit } from '@/modules/chat/core/elicitation/transport'

/** The fields a `run_js_approval` block carries that identify its elicitation. */
export interface RunJsApprovalIdentity {
  elicitation_id: string
  tool_name: string
  server: string
}

/**
 * The elicitation entry a suspended `run_js` sub-tool call opens.
 *
 * ONE definition (FIX_ROUND-6). It is opened from two places — the SSE handler
 * when the frame arrives, and the card's self-heal effect when it finds the entry
 * missing because mcp's transport was not yet installed — and the card
 * reconciles against the entry the handler opened, so the two payloads must be
 * identical. Duplicating the literal put a silent drift surface between them.
 */
export function runJsElicitationInit(data: RunJsApprovalIdentity): ElicitationRequestInit {
  return {
    elicitation_id: data.elicitation_id,
    message: `run_js wants to call ${data.tool_name}`,
    server: data.server,
    message_id: null,
  }
}
