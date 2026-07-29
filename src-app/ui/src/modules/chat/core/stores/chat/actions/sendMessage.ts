import { ApiClient } from '@/api-client'
import { chatExtensionRegistry } from '@/modules/chat/core/extensions'
import type { MessageWithContent, SendMessageRequest } from '@/api-client/types'
import {
  buildMissingFieldMessage,
  RequestFieldCompositionError,
} from '@/modules/chat/core/extensions/requestFieldFailure'

import type { ChatSet, ChatInitialState, ChatState } from '@/modules/chat/core/stores/chat'
import type { ExtensionLifecycle } from '@/modules/chat/core/extensions/types'
import { EventBus } from '@ziee/framework/stores'
import {
  buildSendFailureState,
  isAbortError,
  SEND_FAILED_FALLBACK_MESSAGE,
  type SendMessageOptions,
} from '@/modules/chat/core/stores/chat/sendFailureState'

export default (set: ChatSet, getRaw: () => ChatInitialState) => {
  const get = getRaw as unknown as () => ChatState
  const extLifecycle = (): ExtensionLifecycle => get().extensionRuntime ?? chatExtensionRegistry

  // ── SYNCHRONOUS in-flight latch ────────────────────────────────────────────
  // The store's own `sending` flag CANNOT serve as the re-entrancy guard: it is
  // only set ~70 lines below, AFTER `await beforeSendMessage()` (and possibly
  // after `createConversation`). Two submits ~10ms apart therefore both observe
  // `sending === false`, both clear the guard, and the turn is sent TWICE — two
  // user bubbles, two assistant replies (seen as a double-send when Enter is hit
  // twice quickly, or when a pane's keyboard handler and the button both fire).
  //
  // This latch closes that window because it is set SYNCHRONOUSLY, before the
  // first `await`: the second caller cannot interleave, since it can only run on
  // a later microtask by which time `inFlight` is already true.
  //
  // Scope: the factory closure, i.e. ONE latch per store instance. Split-chat
  // panes each own a Chat store, so they still send independently — this
  // serializes a single pane only.
  //
  // Release: the `try/finally` below wraps the ENTIRE body, so every exit path
  // releases it — the silent-cancel `return`, the loud-cancel `throw`, a throw
  // from the unprotected pre-flight region (composeRequestFields /
  // createConversation / afterCreateConversation / EventBus.emit / initialize /
  // onConversationLoad), the normal success tail, and the inner catch's
  // recovery return. Getting this wrong wedges the composer permanently, so the
  // release lives in exactly ONE place that no future edit can bypass.
  let inFlight = false

  return async (options?: SendMessageOptions) => {
    if (inFlight) {
      console.debug('[Chat.store] send ignored: a send is already in flight')
      return
    }
    inFlight = true
    try {
        let { conversation } = get()

        const beforeResult = await chatExtensionRegistry.beforeSendMessage()

        if (beforeResult.cancel) {
          // A cancel THROWS by default — byte-identical to the historical
          // behaviour — because most callers of `sendMessage` are PROGRAMMATIC
          // (regenerate, edit-resubmit, transmitting a tool approval/denial) and
          // for them a veto is a genuine failure that must not evaporate: e.g.
          // `startRegenerateMessage` has already trimmed the transcript and
          // latched the pending-branch fields by the time it calls us, so a quiet
          // return would leave the UI trimmed, nothing regenerating, and no error.
          //
          // Only a USER-INITIATED composer submit opts into the quiet path, and
          // only for a cancel the extension itself classified as a no-op
          // (`silent` — today just "the composer is empty"). Both signals are
          // required: the REASON must be a non-failure, and the CALLER must be the
          // one place where "the user submitted nothing" is not an error.
          if (options?.allowSilentCancel && beforeResult.silent) {
            console.debug(
              '[Chat.store] send skipped (no-op):',
              beforeResult.errorMessage || 'nothing to send',
            )
            return
          }
          console.log('[Chat.store] Message send cancelled by extension')
          throw new Error(
            beforeResult.errorMessage || 'Message send was cancelled',
          )
        }

        // Collect all request fields from extensions. Pass THIS pane's
        // conversation id so per-conversation composer selections (e.g. model)
        // resolve to the sending pane (ITEM-5); null = a new-chat pane.
        //
        // FAIL-CLOSED (see `extensions/composeRequestFields.ts`): a contributor
        // failure REJECTS here rather than yielding a silently-incomplete body.
        // The throw must still reach the caller — the composers turn it into a
        // toast, and a loud extension veto uses the same path — but it is also
        // recorded on `store.error` first, because the PROGRAMMATIC callers
        // (`startRegenerateMessage`, the tool-approval transmit) have no local
        // catch that shows anything, and the conversation error Alert is the one
        // surface every path renders.
        let allRequestFields: Awaited<
          ReturnType<typeof chatExtensionRegistry.composeRequestFields>
        >
        try {
          allRequestFields = await chatExtensionRegistry.composeRequestFields({
            conversationId: get().conversation?.id ?? null,
            paneId: get().paneId,
          })
          // The server declares `content` and `model_id` REQUIRED
          // (`SendMessageRequest` in server/src/modules/chat/core/extension/
          // request.rs), and both are extension-contributed — so a contributor
          // that resolves but returns nothing (rather than throwing) leaves the
          // body just as invalid, and nothing between here and the POST used to
          // notice. Validate ONCE, here, before anything with a side effect:
          // this runs before the conversation is auto-created and before the
          // optimistic user bubble, so a rejected turn leaves no debris.
          //
          // PRESENCE + type only — an empty `content` is legitimate at this
          // layer (an attachment-only turn); "the composer is empty" is
          // `beforeSendMessage`'s veto, not this guard's.
          const missing: string[] = []
          if (typeof allRequestFields.content !== 'string') {
            missing.push('the message text')
          }
          if (
            typeof allRequestFields.model_id !== 'string' ||
            !allRequestFields.model_id.trim()
          ) {
            missing.push('a model selection')
          }
          if (missing.length > 0) {
            throw new RequestFieldCompositionError(
              buildMissingFieldMessage(missing),
              { missingFields: missing },
            )
          }
        } catch (error) {
          set({
            error:
              error instanceof Error && error.message.trim()
                ? error.message
                : SEND_FAILED_FALLBACK_MESSAGE,
          })
          throw error
        }

        // Inject branching fields directly (moved from branching extension)
        const pendingBranchFromMessageId = get().pendingBranchFromMessageId
        if (pendingBranchFromMessageId) {
          allRequestFields.create_branch_from_message_id =
            pendingBranchFromMessageId
          allRequestFields.fork_level = get().pendingBranchForkLevel ?? 'user'
        }

        if (!conversation) {
          // Deferred emission: extensions get to mutate the freshly
          // created conversation BEFORE subscribers see the event.
          // The `afterCreateConversation` hook can return a replacement
          // shape; chat adopts it and emits the post-hook conversation.
          conversation = await get().createConversation(
            undefined,
            allRequestFields.model_id as string | undefined,
            /* emitCreated */ false,
          )
          const afterHook =
            await chatExtensionRegistry.afterCreateConversation(conversation)
          if (afterHook !== conversation) {
            conversation = afterHook
            set({ conversation })
          }
          await EventBus.emit({
            type: 'conversation.created',
            data: { conversation },
          })
          await extLifecycle().initialize()
          await chatExtensionRegistry.onConversationLoad(conversation)
        }

        set({
          sending: true,
          isStreaming: true,
          error: null,
          lastTurnInterrupted: false,
          finalizingTurn: false,
        })

        // EVERYTHING after the flags go true lives inside this try. The flags are
        // what render the streaming spinner and disable the composer, so any throw
        // that escapes without running the catch below wedges the UI permanently:
        // a spinner that never stops, a composer that never re-enables, no error
        // text, and — because `reloadOpen` bails while `isStreaming` is true — no
        // recovery even on stream reconnect. The `try` used to open ~40 lines
        // lower, leaving `loadMessages` and `provideUserContent` unprotected.
        try {
          // If the window is anchored MID-conversation (after an around=/find/
          // deep-link jump, so `hasMoreAfter` is true), the loaded slice does not
          // abut the real tail. Snap to the tail first so the new turn's optimistic
          // bubble appends at the actual end instead of after a gap of unloaded
          // messages (reconciled again on `complete`, but this fixes the optimistic
          // render order too).
          if (get().hasMoreAfter) {
            await get().loadMessages(conversation.id)
          }

          const userContents = await chatExtensionRegistry.provideUserContent(
            (allRequestFields.content as string) || '',
            allRequestFields,
            get().paneId,
          )

          const tempUserMessage: MessageWithContent = {
            id: `temp-${Date.now()}`,
            role: 'user',
            contents: userContents,
            originated_from_id: '',
            edit_count: 0,
            created_at: new Date().toISOString(),
          }

          set(state => {
            const newMessages = new Map(state.messages)
            newMessages.set(tempUserMessage.id, tempUserMessage)
            return {
              messages: newMessages,
              tempUserMessageId: tempUserMessage.id,
            }
          })

          // Subscribe this device's token stream to the (possibly just-created)
          // conversation BEFORE kicking off generation, so it receives all of its
          // own tokens. Idempotent/deduped for an already-open conversation.
          await get().chatStreamClient?.setActiveConversation(conversation.id)

          // Fire-and-forget: the assistant reply streams over the chat-token
          // stream (applied by `applyStreamFrame` via the `chat:token` router),
          // not this response.
          // Typed payload — the `as any` this replaced erased the compiler's
          // knowledge that `content`/`model_id` are required, which is how a
          // body missing `model_id` reached the wire and came back a raw 422.
          // The extension-contributed record is narrowed once, and the three
          // fields the server requires are supplied explicitly and checked.
          const sendPayload: { id: string } & SendMessageRequest = {
            ...(allRequestFields as Partial<SendMessageRequest>),
            id: conversation.id,
            branch_id: conversation.active_branch_id || '',
            content: allRequestFields.content as string,
            model_id: allRequestFields.model_id as string,
          }
          const { user_message_id, assistant_message_id } =
            await ApiClient.Message.send(sendPayload)

          // Remember the assistant message so the stop button can address it.
          set({ streamingMessageId: assistant_message_id })

          // Reconcile the optimistic temp user message to its real id. The
          // `started` frame may also do this swap; both are idempotent.
          if (user_message_id && get().tempUserMessageId) {
            const tempId = get().tempUserMessageId!
            const tempMessage = get().messages.get(tempId)
            if (tempMessage) {
              set(state => {
                const newMessages = new Map(state.messages)
                newMessages.delete(tempId)
                newMessages.set(user_message_id, {
                  ...tempMessage,
                  id: user_message_id,
                  contents: tempMessage.contents.map(c => ({
                    ...c,
                    message_id: user_message_id,
                  })),
                })
                return { messages: newMessages, tempUserMessageId: null }
              })
            }
          }

          await chatExtensionRegistry.onMessageSent(get().paneId)
          await get().clearPendingBranch()
          set({ sending: false })
        } catch (error: any) {
          const aborted = isAbortError(error)

          if (!aborted) {
            // The extension hook runs BEFORE the state reset, so a hook that
            // throws would take the whole recovery down with it and leave exactly
            // the wedged spinner this catch exists to prevent. Notifying
            // extensions is best-effort; resetting the store is not. The
            // secondary error is logged, never discarded.
            try {
              await chatExtensionRegistry.onStreamError(
                error instanceof Error
                  ? error
                  : new Error(error?.message || SEND_FAILED_FALLBACK_MESSAGE),
                get().paneId,
              )
            } catch (hookError) {
              console.error(
                '[Chat.store] onStreamError extension hook failed; continuing with state recovery',
                hookError,
              )
            }
          }

          const state = get()
          const baseUpdate = buildSendFailureState(error)

          if (state.tempUserMessageId) {
            set(state => {
              const newMessages = new Map(state.messages)
              newMessages.delete(state.tempUserMessageId!)
              return {
                messages: newMessages,
                tempUserMessageId: null,
                ...baseUpdate,
              }
            })
          } else {
            set(baseUpdate)
          }

          if (aborted) {
            // Best-effort refetch after a user cancel. Guarded because the store
            // is ALREADY fully reset above: letting a refetch failure reject
            // `sendMessage` would surface an error toast for an action the user
            // deliberately took, on top of a state that is already correct.
            try {
              const conversation = get().conversation
              if (conversation) {
                await get().loadMessages(conversation.id)
              }
            } catch (reloadError) {
              console.error(
                '[Chat.store] post-abort message reload failed; state already recovered',
                reloadError,
              )
            }
          }
        }
    } finally {
      // Release on EVERY exit path — success, silent-cancel return, loud-cancel
      // throw, a pre-flight throw, or the inner catch's recovery. A missed
      // release would leave `inFlight` true forever and the composer dead.
      inFlight = false
    }
  }
}
