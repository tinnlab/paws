import { useEffect, useRef } from 'react'
import { Textarea, message } from '@ziee/kit'
import { SEND_FAILED_FALLBACK_MESSAGE } from '@/modules/chat/core/stores/chat/sendFailureState'
import { useChatPaneOrNull } from '@/modules/chat/core/pane/ChatPaneContext'
import {
  getDraft,
  setDraft,
  makeDraftKey,
} from '@/modules/chat/extensions/text/chatDrafts'
import { createComposerAccess } from '@/modules/chat/extensions/text/composerAccess'
import { Auth } from '@/modules/auth/Auth.store'
import { Chat } from '@/modules/chat/core/stores/chatBridge'

/**
 * TextInput Component
 * Self-contained text input for chat messages
 *
 * Features:
 * - Uses an uncontrolled ref for imperative get/set/clear access
 * - Registers getter/clearer functions with TextStore for external access
 * - Handles keyboard shortcuts (Enter to send, Shift+Enter for new line)
 * - Persists an unsent draft per conversation across navigation (ITEM-7)
 * - Ref stays local (not frozen by immer), functions provide external access
 */
export function TextInput() {
  const ref = useRef<HTMLTextAreaElement>(null)
  // Synchronous re-entrancy latch for the Enter path — see handleKeyDown.
  const inFlightRef = useRef(false)
  // Resolve THIS pane's chat store directly (not the focused-pane bridge): the
  // composer's TextStore is a NESTED store, and `Chat.TextStore` resolves
  // nested stores via getState()->focusedApi() (the focused pane), NOT the
  // subtree's PaneApiContext — so a non-focused pane's composer would register
  // its get/set/clear on, and read from, the WRONG pane's TextStore. Binding to
  // `pane.store` keeps each pane's composer isolated (single-pane: pane is null →
  // Chat, unchanged).
  const pane = useChatPaneOrNull()
  const chatStore = (pane?.store ?? Chat) as typeof Chat
  // `isStreaming` is read alongside `sending` so the Enter guard matches the
  // Send button's `disabled` condition (ChatInput.tsx) — see handleKeyDown.
  const { sending, isStreaming } = chatStore
  const {
    setGetMessage,
    setSetMessage,
    setClearMessage,
    setGetSelection,
    setApplyEdit,
    setFocusInput,
  } = chatStore.TextStore

  // The draft bucket for the composer's CURRENT conversation. `new` when there
  // is no conversation yet (new-chat page). Read reactively so it follows an
  // in-app A→B conversation switch. `editingMessage` gates persistence so an
  // edit/regenerate prefill (which calls TextStore.setText) is never captured
  // as, or clobbered by, a draft (DEC-7).
  const conversationId = chatStore.conversation?.id
  const isEditing = chatStore.editingMessage != null
  // Namespace the draft by the current user so a shared browser never surfaces
  // another user's unsent text (esp. the fixed `new` bucket) — see makeDraftKey.
  const draftKey = makeDraftKey(Auth.user?.id, conversationId)

  // Keep the latest key/editing flag in refs so the DOM-driven save handler and
  // the registered clearer read current values without re-subscribing.
  const draftKeyRef = useRef(draftKey)
  const isEditingRef = useRef(isEditing)
  draftKeyRef.current = draftKey
  isEditingRef.current = isEditing

  // Register the composer-element access closures with TextStore on mount.
  // Their bodies live in `createComposerAccess` so the component harness can
  // drive the SAME production code against a real textarea; see that file for
  // why none of them may reach the element by `data-testid`.
  useEffect(() => {
    const access = createComposerAccess(() => ref.current)
    setGetMessage(access.getMessage)
    setSetMessage(access.setMessage)
    setClearMessage(access.clearMessage)
    setGetSelection(access.readSelection)
    setApplyEdit(access.applyComposerEdit)
    setFocusInput(access.focusMessage)
  }, [
    setGetMessage,
    setSetMessage,
    setClearMessage,
    setGetSelection,
    setApplyEdit,
    setFocusInput,
  ])

  // Restore the saved draft when the composer binds to a NEW conversation key.
  // ConversationPage/TextInput are reused (not remounted) across an in-app
  // A→B switch, so we must key restoration off draftKey CHANGES (tracked in a
  // ref) — restoring once per key REPLACES the textarea with the target key's
  // draft. This both (a) loads B's draft and (b) discards A's leftover text
  // (already persisted under A), preventing it from bleeding into B and being
  // re-saved under B's key. Suppressed while editing so an edit/regenerate
  // prefill is never clobbered (DEC-7); re-restoring within the same key is a
  // no-op so in-progress typing is never overwritten.
  const restoredKeyRef = useRef<string | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (isEditing) {
      // Entering edit: the edit prefill (TextStore.setText) owns the textarea.
      // Forget the "already restored" latch so that when the edit ends —
      // cancelEdit clears the textarea WITHOUT changing draftKey — the effect
      // re-runs and re-restores the pre-edit draft instead of leaving it empty.
      restoredKeyRef.current = null
      return
    }
    if (restoredKeyRef.current === draftKey) return
    restoredKeyRef.current = draftKey
    el.value = getDraft(draftKey)
  }, [draftKey, isEditing])

  // Persist on input (debounced). Suppressed while editing so the edit buffer
  // isn't written over the real draft.
  const handleInput = () => {
    if (isEditingRef.current) return
    setDraft(draftKeyRef.current, ref.current?.value ?? '')
  }

  const handleKeyDown = async (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Submit on Enter (without Shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()

      // Guard, then catch — the two things the Send button already did and this
      // path did not.
      //
      // NOT a full mirror of `ChatInput.handleSend`: that also gates on
      // `disabled` and on `useSendBlocked()`. Both are ChatInput-owned — the
      // blocker hook returns probe NODES that its owner must render, so calling
      // it here would mount a second copy of every extension's blocker hook.
      // The consequence is bounded and acceptable: an extension that blocks
      // (today only "files still uploading") returns a LOUD veto from
      // `beforeSendMessage`, so Enter mid-upload still cannot send — it shows
      // that extension's message via the catch below instead of being inert.
      //
      // `sending`/`isStreaming` come from the render closure, and the store only
      // flips `sending` AFTER several awaits (including, on a new chat, a
      // create-conversation round-trip), so they do NOT close the
      // repeat-keypress window on their own. `inFlightRef` is the synchronous
      // latch that does — a held Enter fires keydown repeatedly, which is the
      // audit's `rapid-double-submit` cell. The reactive flags still matter:
      // they cover a turn started by the BUTTON, which this ref knows nothing
      // about.
      if (sending || isStreaming || inFlightRef.current) return

      inFlightRef.current = true
      try {
        // `allowSilentCancel` is passed ONLY here, and deliberately NOT by the
        // Send button. Enter on an empty composer is a stray keypress the user
        // never aimed at anything, so it should do nothing; a deliberate click
        // on a visible Send button still earns the explanatory toast. Every
        // PROGRAMMATIC caller (regenerate, edit-resubmit, tool approval) also
        // omits it, so a veto there still throws instead of evaporating.
        await chatStore.sendMessage({ allowSilentCancel: true })
      } catch (error: any) {
        // Reachable for a LOUD extension veto (e.g. "files still uploading")
        // and for a pre-flight failure such as conversation creation. A failure
        // of the send REQUEST itself is handled inside the store, which records
        // it on `store.error` and renders it in the conversation's error Alert.
        // Without this catch the rejection escaped an `async` React handler as
        // an UNHANDLED one — a page-level error event, with nothing shown.
        console.error('Failed to send message:', error)
        message.error(error?.message || SEND_FAILED_FALLBACK_MESSAGE)
      } finally {
        inFlightRef.current = false
      }
    }
  }

  return (
    <div className="w-full">
      <Textarea
        data-testid="chat-message-textarea"
        ref={ref}
        aria-label="Message"
        onKeyDown={handleKeyDown}
        onChange={handleInput}
        placeholder="Type your message..."
        autoSize={{ minRows: 2, maxRows: 8 }}
        disabled={sending}
        defaultValue=""
        className="resize-none !border-none bg-transparent dark:bg-transparent text-base !py-1 outline-none focus-visible:ring-0 focus-visible:border-transparent focus-visible:shadow-none"
      />
    </div>
  )
}
