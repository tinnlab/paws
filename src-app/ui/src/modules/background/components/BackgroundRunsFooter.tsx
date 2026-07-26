import { useEffect } from 'react'
import { Bot, ChevronRight } from 'lucide-react'
import { Button } from '@ziee/kit'

import { useChatPaneOrNull } from '@/modules/chat/core/pane/ChatPaneContext'
import { Chat } from '@/modules/chat/core/stores/chatBridge'
import { BackgroundRuns, isTerminalRunStatus } from '../stores/BackgroundRuns.store'

/**
 * End-of-conversation affordance for THIS conversation's background sub-agent
 * runs — occupies the `message_list_footer` chat slot, so it sits after the last
 * turn where the user's eye already is.
 *
 * Renders **nothing** when the conversation has no runs, so an ordinary chat
 * gains no chrome. Otherwise: one row summarizing running/total tasks that opens
 * the right-panel "Tasks" tab. Answers "is my agent still working?" at a glance
 * without leaving the conversation — which is what the deleted global page got
 * wrong.
 *
 * Pane-scoped (mirrors `LiteratureToolResultCard`): a split pane reads and opens
 * ITS OWN conversation's tab, never the focused pane's.
 */
export function BackgroundRunsFooter() {
  const pane = useChatPaneOrNull()
  const chatStore = (pane?.store ?? Chat) as typeof Chat
  const conversation = chatStore.conversation
  const convId = conversation?.id

  // Reactive read of the keyed map — hoisted ABOVE the `convId` condition,
  // because a store-proxy field read IS a hook (useEffect + useStore) and a
  // conditionally-evaluated one varies the hook order between renders. The
  // per-conversation lookup below is then plain object indexing, so this row
  // still depends only on THIS conversation's slice and a refetch of another
  // conversation can never blank it.
  const runsByConversation = BackgroundRuns.runsByConversation
  const runs = convId ? runsByConversation[convId] : undefined

  useEffect(() => {
    if (convId) void BackgroundRuns.loadConversationRuns(convId, 1)
  }, [convId])

  if (!convId || !runs || runs.length === 0) return null

  const running = runs.filter(r => !isTerminalRunStatus(r.status)).length
  const label =
    running > 0
      ? `${running} agent${running > 1 ? 's' : ''} running`
      : `${runs.length} task${runs.length > 1 ? 's' : ''}`

  const open = (): void => {
    void chatStore.displayInRightPanel({
      id: `background-${convId}`,
      title: 'Tasks',
      type: 'background',
      data: { conversationId: convId },
    })
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 pb-3">
      <Button
        variant="outline"
        onClick={open}
        data-testid="background-footer-open"
        aria-label="View this conversation’s background tasks"
        className="w-full justify-between"
      >
        <span className="flex items-center gap-2">
          {running > 0 && (
            <span aria-hidden className="bg-primary size-2 animate-pulse rounded-full" />
          )}
          <Bot className="size-4" />
          {label}
        </span>
        <ChevronRight className="size-4" />
      </Button>
    </div>
  )
}
