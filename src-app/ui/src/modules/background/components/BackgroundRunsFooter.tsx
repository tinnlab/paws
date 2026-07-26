import { useEffect } from 'react'
import { Bot, ChevronRight } from 'lucide-react'
import { Button } from '@ziee/kit'

import { useChatPaneOrNull } from '@/modules/chat/core/pane/ChatPaneContext'
import { Chat } from '@/modules/chat/core/stores/chatBridge'
import { BackgroundRuns, isTerminalRunStatus } from '../stores/BackgroundRuns.store'

/**
 * End-of-conversation affordance for THIS conversation's background tasks —
 * occupies the `message_list_footer` chat slot, so it sits after the last turn
 * where the user's eye already is.
 *
 * Renders **nothing** when the conversation has no tasks, so an ordinary chat
 * gains no chrome. Otherwise: one row summarising running/total tasks that opens
 * the right-panel "Tasks" tab. Answers "is my agent still working?" at a glance
 * without leaving the conversation — which is what the deleted global page got
 * wrong.
 *
 * Pane-scoped (mirrors `LiteratureToolResultCard`): a split pane reads and opens
 * ITS OWN conversation's tab, never the focused pane's.
 *
 * KNOWN CONSTRAINT: `MessageList` early-returns for a conversation with no
 * messages and that branch does not render this slot, so a conversation with
 * tasks but zero turns has no route to its panel. That cannot occur in
 * production — tasks are spawned BY a turn — but it is the reason every test
 * fixture seeds a message.
 */
export function BackgroundRunsFooter() {
  const pane = useChatPaneOrNull()
  const chatStore = (pane?.store ?? Chat) as typeof Chat
  const conversation = chatStore.conversation
  const convId = conversation?.id

  // Reactive reads, hoisted ABOVE the `convId` condition: a store-proxy field
  // read IS a hook, and a conditionally-evaluated one varies the hook order.
  // NOTE this subscribes to the whole keyed map, so any conversation's write
  // re-renders every mounted footer — a render cost, not a correctness problem
  // (the values derived below are keyed by THIS conversation).
  const runsByConversation = BackgroundRuns.runsByConversation
  const totalByConversation = BackgroundRuns.totalByConversation

  // Register as a live consumer so the sync refresh covers this scope (including
  // when the first load FAILED, which writes no data key) and release on unmount
  // so a long session cannot accumulate one refetched scope per conversation
  // visited.
  useEffect(() => {
    if (!convId) return
    BackgroundRuns.retainConversationScope(convId)
    void BackgroundRuns.loadConversationRuns(convId, 1)
    return () => BackgroundRuns.releaseConversationScope(convId)
  }, [convId])

  const runs = convId ? runsByConversation[convId] : undefined
  // `total` is the SERVER's count for the whole scope; `runs` is only the loaded
  // page. Counting from `runs` under-reports a conversation with more tasks than
  // one page — and under-reporting is the one thing this row must not do.
  const total = convId ? (totalByConversation[convId] ?? 0) : 0

  if (!convId || !runs || total === 0) return null

  // The running count can only be computed over LOADED rows, so it is a floor
  // ("at least N running") whenever more pages exist; the total is always exact.
  const runningLoaded = runs.filter(r => !isTerminalRunStatus(r.status)).length
  const label =
    runningLoaded > 0
      ? `${runningLoaded} of ${total} ${total === 1 ? 'task' : 'tasks'} running`
      : `${total} ${total === 1 ? 'task' : 'tasks'}`

  const panelId = `background-${convId}`
  const open = (): void => {
    void chatStore.displayInRightPanel({
      id: panelId,
      title: 'Tasks',
      type: 'background',
      data: { conversationId: convId },
    })
  }

  return (
    <div className="w-full pb-3">
      <Button
        variant="outline"
        onClick={open}
        data-testid="background-footer-open"
        aria-expanded={false}
        aria-controls={panelId}
        className="w-full justify-between"
      >
        {/* No aria-label: it would OVERRIDE this visible text and hide the count
            — the row's entire payload — from screen readers (WCAG 2.5.3 Label in
            Name). `role=status` announces the count as it changes live. */}
        <span className="flex min-w-0 items-center gap-2">
          {runningLoaded > 0 && (
            <span
              aria-hidden
              className="bg-primary size-2 shrink-0 rounded-full motion-safe:animate-pulse"
            />
          )}
          <Bot className="size-4 shrink-0" aria-hidden />
          <span className="truncate" role="status" aria-live="polite">
            Background: {label}
          </span>
        </span>
        <ChevronRight className="size-4 shrink-0 rtl:rotate-180" aria-hidden />
      </Button>
    </div>
  )
}
