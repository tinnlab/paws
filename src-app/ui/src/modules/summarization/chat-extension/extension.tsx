import { createExtension, type ChatExtension } from '@/modules/chat/core/extensions'
import { SummaryBoundaryMarker } from '@/modules/summarization/chat-extension/components/SummaryBoundaryMarker'
import { SummarizationStatusPill } from '@/modules/summarization/chat-extension/components/SummarizationStatusPill'

// Summarization Extension (frontend chat-extension shim).
//
// The actual apply-summary / refresh-summary backend lives in
// modules/summarization/{chat_extension,engine} on the server side.
// This extension registers two slot components:
//   - `toolbar_status`: SummarizationStatusPill (per-conversation
//     mode + drives the read-model load for the in-thread marker).
//   - `message_footer`: SummaryBoundaryMarker (renders on the message
//     at `summary.summarized_up_to_id`, expandable).
//
// Auto-discovered by chat/extensions/index.ts via the
// import.meta.glob pattern over `../../*/chat-extension/extension.tsx`.
//
// No composeRequestFields: the backend summarization bridge reads the
// per-conversation mode from `conversation_summarization_settings`
// when assembling the prompt; the frontend pill writes via
// PUT /api/conversations/{id}/summarization-mode.
const summarizationExtension: ChatExtension = createExtension({
  name: 'summarization',
  description:
    'Per-conversation summarization override pill + in-thread summary boundary marker',
  // Render after the memory pill (order 30) so the two appear in a
  // predictable left-to-right reading order.
  priority: 90,

  slots: {
    toolbar_status: { component: SummarizationStatusPill, order: 40 },
    message_footer: { component: SummaryBoundaryMarker, order: 10 },
  },

  // The TURN-END half of the summary read-model trigger (the pill owns the
  // open/switch half). The server rewrites the summary in its `after_llm_call`
  // hook, and this hook is the client-side moment that corresponds to it: the
  // stream handler invokes it exactly ONCE per completed turn, in the OWNING
  // pane.
  //
  // WHY NOT watch `Chat.isStreaming` fall to false: measured on the live rig,
  // that flag produces TWO falling edges per send, because navigating from `/`
  // to `/chat/{id}` mid-send runs `loadConversation`, which sets
  // `isStreaming:false` transiently before the stream's own frames set it true
  // again. The audit still reported a duplicate summary read with that trigger.
  //
  // The pill previously re-read on every `messages.size` change, which is what
  // the live-UI audit measured as 3–4 `GET …/summary` per step
  // (`network/duplicate` + `network/excess`). See `summaryRefreshTrigger.ts`.
  // PANE-CORRECT: read the OWNING pane's conversation from `ownerPaneId`, never
  // the focused-pane bridge. `applyStreamFrame` threads this id precisely
  // because focus is unreliable at this async boundary (see the hook's doc in
  // `chat/core/extensions/types.ts`), and both sibling implementations
  // (`chat/extensions/text`, `file/chat-extension`) do the same. Reading the
  // bridge instead would, in split view, refresh the FOCUSED pane's summary when
  // the UNFOCUSED pane finished a turn — rotating a single-entry cache onto the
  // wrong conversation and never refreshing the one that actually changed.
  // Imported DYNAMICALLY, not statically. A chat-extension module is EAGERLY
  // discovered by `chat/core/extensions/index.ts`'s `import.meta.glob`, so a
  // static import here pulls the chat store bridge and this module's store into
  // that eager pass and changes module-evaluation order during chat boot. A
  // blind-audit note suggested static imports would be cheaper (the pill already
  // pulls both into the same chunk); measured, the e2e new-chat send stopped
  // rendering its assistant turn, so the cheaper form is NOT worth it. Deferring
  // to first-use keeps the eager pass byte-identical to before this change.
  afterStreamComplete: async (_message, ownerPaneId) => {
    const { Chat, paneRegistry } = await import(
      '@/modules/chat/core/stores/chatBridge'
    )
    const { ConversationSummarization } = await import(
      '@/modules/summarization/stores/conversationSummarization'
    )
    const owner = ownerPaneId ? paneRegistry.get(ownerPaneId)?.api : undefined
    const conversationId = (owner?.getState() ?? Chat.$).conversation?.id
    if (!conversationId) return {}
    // `force`: an open read issued moments earlier (before the server wrote) may
    // still be on the wire; adopting its answer would leave the pre-turn summary
    // on screen with no later trigger to correct it.
    void ConversationSummarization.loadForConversation(conversationId, {
      force: true,
    })
    return {}
  },
})

export default summarizationExtension
