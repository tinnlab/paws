import type { BackgroundRunSummary } from '@/api-client/types'

/**
 * Should a run card offer its "Open conversation" affordance?
 *
 * The card renders in two contexts now: the in-conversation Tasks panel (where
 * the surrounding conversation IS the run's conversation) and anywhere a run is
 * shown out of context. Navigating to the conversation you are already reading is
 * a no-op — and inside a split pane the card's `useNavigate()` moves the WHOLE
 * window rather than the pane, so the affordance is actively wrong there.
 *
 * Pure + exported so the rule is pinned by a unit test rather than only by a
 * render. `contextConversationId` omitted ⇒ no context ⇒ keep today's behaviour.
 */
export function shouldShowOpenConversation(
  run: Pick<BackgroundRunSummary, 'conversation_id'>,
  contextConversationId?: string,
): boolean {
  if (!run.conversation_id) return false
  if (!contextConversationId) return true
  return run.conversation_id !== contextConversationId
}
