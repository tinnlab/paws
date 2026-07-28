//! js-tool chat extension (auto-discovered at `modules/*/chat-extension/`).
//!
//! **Exists to undo an anti-pattern (ITEM-25 / AP-4.)** The `run_js_approval`
//! content type and its approve/deny card used to be registered and rendered by
//! the **mcp** extension — one module owning another module's user-facing
//! surface. `js-tool` owns them now, so mcp no longer names `run_js` anywhere.
//!
//! It also contributes the rail steps for the `run_js` tool family: a script
//! run is a step like any other, and a script SUSPENDED awaiting approval of a
//! gated sub-tool call is a BLOCKING step that breaks out of the rail (INV-3).
import {
  createExtension,
  type ChatExtension,
} from '@/modules/chat/core/extensions'
import type { MessageContent, MessageWithContent } from '@/api-client/types'
import {
  elicitationExists,
  registerElicitation,
} from '@/modules/chat/core/elicitation/transport'
import { runJsStep, runJsApprovalStep } from './railContribution'
import { JsToolApprovalContent } from './components/JsToolApprovalContent'

const jsToolExtension: ChatExtension = createExtension({
  name: 'js-tool',
  description:
    "Owns the run_js suspended-script approval surface and the run_js family's rail steps.",
  // Below mcp's generic fallback (order 1000) by construction, so `run_js`
  // resolves to this module's domain language rather than a title-cased id.
  priority: 40,

  contentTypes: {
    run_js_approval: JsToolApprovalContent,
  },

  // The SSE frame that SUSPENDS a script awaiting approval of a gated sub-tool
  // call, moved here verbatim from the mcp extension (ITEM-25 / AP-4). The
  // registry routes an SSE event to whichever extension handles it, so nothing
  // about the delivery path changes — only who owns the surface.
  //
  // It still opens a shared elicitation entry, because resolution genuinely goes
  // through the side-channel elicitation `/respond` endpoint (the same
  // in-process oneshot `ask_user` uses) rather than the turn-boundary tool
  // approvals flow: a live script stack cannot survive a request boundary.
  //
  // FIX_ROUND-2 #3: that dependency is now expressed through the CORE-owned
  // seam `chat/core/elicitation/transport`, not by importing mcp's store. AP-4
  // had turned `mcp → js-tool` into `js-tool → mcp` — a lateral cross-module
  // store read (coding-guidelines §9) — which is a relocated violation, not a
  // removed one. Core declares the transport; whichever extension owns the
  // `/respond` route pushes an implementation in; this module names nobody.
  sseEventHandlers: {
    runJsApprovalRequired: async (data, get, set) => {
      // A run_js script is SUSPENDED awaiting approval of a gated sub-tool call.
      // Inject a `run_js_approval` content block so JsToolApprovalContent renders
      // approve/deny; resolution goes via the side-channel elicitation /respond
      // endpoint (the same in-process oneshot ask_user uses), NOT the
      // turn-boundary tool_approvals flow — a live script stack can't survive a
      // request boundary.
      //
      // Register an elicitationRequests entry keyed by elicitation_id so
      // resolveElicitation can reflect the resolved status there (and roll it
      // back to 'pending' on a failed POST) — the component reads its status
      // from the store, so a failed approve re-enables the buttons and the
      // resolved state survives a component remount. Guard on !has() so a
      // double-delivered SSE frame can't reset an already-resolved entry to
      // 'pending' (which would re-show the buttons + allow a duplicate POST).
      //
      // FIX_ROUND-5: the outcome is deliberately NOT stamped onto the block.
      // FIX_ROUND-4 wrote `unresolvable: !registered` into the block's content —
      // a transient CLIENT transport condition recorded in the message CONTENT
      // vocabulary, snapshotted once and never correctable (the block is deduped
      // by elicitation_id and never rewritten). Because mcp's `initialize`
      // awaits a dynamic import BEFORE installing the transport, a frame landing
      // in that window latched the card into a permanently disabled state even
      // after mcp finished wiring. The card RECONCILES against the live seam
      // instead and re-registers itself, so the same failure self-heals.
      if (!elicitationExists(data.elicitation_id)) {
        registerElicitation({
          elicitation_id: data.elicitation_id,
          message: `run_js wants to call ${data.tool_name}`,
          server: data.server,
          message_id: null,
        })
      }

      const chatState = get()
      const streamingMessage = chatState.streamingMessage
      const now = new Date().toISOString()

      const approvalContent = {
        id: '',
        message_id: '',
        content_type: 'run_js_approval',
        content: {
          type: 'run_js_approval',
          status: 'pending',
          elicitation_id: data.elicitation_id,
          tool_name: data.tool_name,
          server: data.server,
          input: data.input,
        },
        sequence_order: 0,
        created_at: now,
        updated_at: now,
      } as unknown as MessageContent

      if (streamingMessage) {
        // Dedup by the unique per-approval elicitation_id.
        const exists = streamingMessage.contents.some(
          c =>
            c.content_type === 'run_js_approval' &&
            (c.content as unknown as { elicitation_id: string }).elicitation_id === data.elicitation_id,
        )
        if (!exists) {
          approvalContent.id = `${streamingMessage.id}-runjs-${data.elicitation_id}`
          approvalContent.message_id = streamingMessage.id
          approvalContent.sequence_order = streamingMessage.contents.length

          const updatedMessage = {
            ...streamingMessage,
            contents: [...streamingMessage.contents, approvalContent],
          }
          const newMessages = new Map(chatState.messages)
          newMessages.set(updatedMessage.id, updatedMessage)
          set({ streamingMessage: updatedMessage, messages: newMessages })
        }
      } else {
        // No streaming message (e.g. after reload / SSE-resume, since generation
        // is a detached server task) — create one so the approval prompt renders
        // and the suspended script can still be resumed. Mirrors
        // mcpElicitationRequired's else-branch.
        const messageId = `streaming-${Date.now()}`
        approvalContent.id = `${messageId}-runjs-${data.elicitation_id}`
        approvalContent.message_id = messageId

        const newMessage: MessageWithContent = {
          id: messageId,
          role: 'assistant',
          contents: [approvalContent],
          originated_from_id: '',
          edit_count: 0,
          created_at: now,
        }
        const newMessages = new Map(chatState.messages)
        newMessages.set(newMessage.id, newMessage)
        set({ streamingMessage: newMessage, messages: newMessages })
      }
    },
  },

  railContributions: [runJsStep, runJsApprovalStep],
})

export default jsToolExtension
