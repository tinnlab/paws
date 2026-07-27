import { ApiClient } from '@/api-client'
import type { ChatSet, ChatInitialState } from '@/modules/chat/core/stores/chat'
import { EventBus } from '@ziee/framework/stores'
import { noteSessionCreatedConversation } from '@/core/sessionCreatedConversations'

export default (set: ChatSet, _getRaw: () => ChatInitialState) => {
  return async (
      title?: string,
      modelId?: string,
      emitCreated: boolean = true,
    ) => {
      // Extensions can layer additional attribution onto the
      // freshly-created conversation via the
      // `afterCreateConversation` hook in sendMessage.
      set({ loading: true, error: null })

      try {
        const conversation = await ApiClient.Conversation.create({
          title: title,
          model_id: modelId,
        })
        // Mark it BEFORE publishing it to the store. Surfaces that would
        // otherwise ask the server a question whose answer is already known for
        // a brand-new conversation (its background runs, its summary) read this
        // synchronously in their mount effect, and `set({ conversation })` is
        // what wakes them — so recording it afterwards, or only on the
        // `conversation.created` event below, loses the race. Measured: the
        // pill fired `GET …/summary` 102 ms after the send, in the window
        // between this `set` and the emit. See `core/sessionCreatedConversations`.
        noteSessionCreatedConversation(conversation.id)
        set({ conversation, loading: false })

        if (emitCreated) {
          await EventBus.emit({
            type: 'conversation.created',
            data: { conversation },
          })
        }

        return conversation
      } catch (error: any) {
        set({
          error: error.message || 'Failed to create conversation',
          loading: false,
        })
        throw error
      }
    }
}
