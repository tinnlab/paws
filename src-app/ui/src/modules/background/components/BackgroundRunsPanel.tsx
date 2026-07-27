import { useEffect } from 'react'
import { Bot } from 'lucide-react'
import { Button, Empty, ErrorState, Spin, Text, Title } from '@ziee/kit'

import { BackgroundRuns } from '../stores/BackgroundRuns.store'
import { BackgroundRunCard } from './BackgroundRunCard'

/**
 * Right-panel "Tasks" tab — the background tasks for ONE conversation.
 *
 * This is the primary surface for a conversation's detached work (there is no
 * global background-tasks page): a task belongs to the conversation that spawned
 * it, so it is read here with the endpoint's disjoint `conversation_id` scope and
 * held in that conversation's own store slice. No client-side filtering is needed
 * — and none is done, because a client-side filter over a shared list is exactly
 * what silently empties when a refetch changes scope.
 *
 * `conversationId` arrives as the panel tab's serialized `data`, spread as props
 * by `ChatRightPanel`.
 *
 * The root owns its own scroll: every `ChatRightPanel` host is `overflow-hidden`
 * and expects the renderer to scroll internally (both siblings —
 * `LiteratureScreeningPanel` and `FilePanel` — do the same). Without it the list
 * is clipped and the count + Load more become physically unreachable.
 */
export function BackgroundRunsPanel({ conversationId }: { conversationId?: string }) {
  // Reactive reads — the panel re-renders when this conversation's slice changes
  // (including the live `sync:workflow_run` refetch). NOTE these are whole-map
  // subscriptions: the store proxy reads a FIELD, so any conversation's write
  // re-renders every mounted panel. The rendered CONTENT is still scoped (the
  // derived values below are keyed), so this is a render cost, not a correctness
  // problem — and the tracked-scope set is bounded by mounted consumers.
  const runsByConversation = BackgroundRuns.runsByConversation
  const totalByConversation = BackgroundRuns.totalByConversation
  const loadingByConversation = BackgroundRuns.loadingByConversation
  const errorByConversation = BackgroundRuns.errorByConversation

  // Register this mount as a live consumer of the scope, so the sync refresh
  // covers it (including when the FIRST load failed, which writes no data key)
  // and drops it again on unmount.
  useEffect(() => {
    if (!conversationId) return
    BackgroundRuns.retainConversationScope(conversationId)
    void BackgroundRuns.loadConversationRuns(conversationId, 1)
    return () => BackgroundRuns.releaseConversationScope(conversationId)
  }, [conversationId])

  // A persisted panel tab is client-controllable serialized data; a snapshot that
  // lost its id must NOT fall through to an unscoped read (which, under the
  // endpoint's disjoint semantics, would render the detached runs of OTHER work
  // inside this conversation's tab).
  if (!conversationId) {
    return (
      <div className="h-full overflow-y-auto p-3">
        <ErrorState
          data-testid="background-panel-error"
          resource="tasks"
          description="This panel lost track of which conversation it belongs to. Close the tab and reopen it from the conversation."
        />
      </div>
    )
  }

  const runs = runsByConversation[conversationId]
  const total = totalByConversation[conversationId] ?? 0
  const loading = loadingByConversation[conversationId] ?? false
  const error = errorByConversation[conversationId] ?? null
  const loaded = runs ?? []
  const hasMore = loaded.length < total

  // "Not fetched yet" is `runs === undefined`, NOT `loading`: the fetch starts in
  // an effect that runs after the first commit, so on that first paint `loading`
  // is still false. Keying the spinner off `loading` alone rendered the EMPTY
  // state for a frame on every panel open — and made the e2e empty-state
  // assertion satisfiable without any data.
  if (runs === undefined && error === null) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Spin data-testid="background-panel-loading" label="Loading tasks" />
      </div>
    )
  }

  if (error && loaded.length === 0) {
    return (
      <div className="h-full overflow-y-auto p-3">
        <ErrorState
          data-testid="background-panel-error"
          resource="tasks"
          description="This conversation’s background tasks couldn’t be loaded."
          details={error}
          onRetry={() => void BackgroundRuns.loadConversationRuns(conversationId, 1)}
        />
      </div>
    )
  }

  if (loaded.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6">
        <Empty
          data-testid="background-panel-empty"
          icon={<Bot className="size-16" />}
          title="No background tasks"
          description="When you or the agent start a task that runs in the background, it shows up here so you can check on it, steer it, or stop it."
        />
      </div>
    )
  }

  return (
    <div
      className="flex h-full w-full flex-col gap-3 overflow-y-auto overflow-x-hidden p-3"
      data-testid="background-panel-list"
    >
      <div className="flex items-baseline justify-between gap-2">
        <Title level={5} className="!m-0 !text-sm !font-normal">
          Background tasks
        </Title>
        {/* The count changes on Load more and on every live refresh, so it is
            announced politely rather than silently swapped. */}
        <Text
          className="text-muted-foreground text-xs"
          role="status"
          aria-live="polite"
          data-testid="background-panel-count"
        >
          Showing {loaded.length} of {total} tasks
        </Text>
      </div>

      {/* A refetch failure over an already-populated list is surfaced, never
          swallowed — the list below stays visible (CODING_GUIDELINES §6/§13). */}
      {error && (
        <ErrorState
          data-testid="background-panel-refresh-error"
          resource="tasks"
          description="This conversation’s background tasks couldn’t be refreshed."
          details={error}
          onRetry={() => void BackgroundRuns.loadConversationRuns(conversationId, 1)}
        />
      )}

      {loaded.map(run => (
        <BackgroundRunCard key={run.id} run={run} />
      ))}

      {hasMore && (
        <div className="flex justify-center pt-1">
          <Button
            variant="outline"
            loading={loading}
            data-testid="background-panel-load-more"
            onClick={() => void BackgroundRuns.loadMoreConversationRuns(conversationId)}
          >
            Load more
          </Button>
        </div>
      )}
    </div>
  )
}
