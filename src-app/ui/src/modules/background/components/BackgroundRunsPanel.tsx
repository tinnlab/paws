import { useEffect } from 'react'
import { Button, Empty, ErrorState, Flex, Spin, Text } from '@ziee/kit'

import { BackgroundRuns } from '../stores/BackgroundRuns.store'
import { BackgroundRunCard } from './BackgroundRunCard'

/**
 * Right-panel "Tasks" tab — the background sub-agent runs for ONE conversation.
 *
 * This is the primary surface for a conversation's detached work (there is no
 * global background-tasks page): a run belongs to the conversation that spawned
 * it, so it is read here with the endpoint's disjoint `conversation_id` scope and
 * held in that conversation's own store slice. No client-side filtering is needed
 * — and none is done, because a client-side filter over a shared list is exactly
 * what silently empties when a refetch changes scope.
 *
 * `conversationId` arrives as the panel tab's serialized `data`, spread as props
 * by `ChatRightPanel`.
 */
export function BackgroundRunsPanel({ conversationId }: { conversationId: string }) {
  // Reactive reads — the panel re-renders when this conversation's slice changes
  // (including the live `sync:workflow_run` refetch).
  const runs = BackgroundRuns.runsByConversation[conversationId]
  const total = BackgroundRuns.totalByConversation[conversationId] ?? 0
  const loading = BackgroundRuns.loadingByConversation[conversationId] ?? false
  const error = BackgroundRuns.errorByConversation[conversationId] ?? null

  useEffect(() => {
    void BackgroundRuns.loadConversationRuns(conversationId, 1)
  }, [conversationId])

  const loaded = runs ?? []
  const hasMore = loaded.length < total

  // First paint for this conversation (no slice yet) — never a spinner over an
  // already-populated list, which would flicker on every sync refetch.
  if (loading && runs === undefined) {
    return (
      <Flex className="justify-center py-12">
        <Spin data-testid="background-panel-loading" label="Loading tasks" />
      </Flex>
    )
  }

  if (error && loaded.length === 0) {
    return (
      <div className="p-3">
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
      <Flex className="flex-1 items-center justify-center p-6">
        <Empty
          data-testid="background-panel-empty"
          title="No background tasks"
          description="When this conversation launches a background sub-agent, it appears here — running, steerable, and cancellable."
        />
      </Flex>
    )
  }

  return (
    <Flex className="w-full flex-col gap-3 p-3" data-testid="background-panel-list">
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
        <BackgroundRunCard
          key={run.id}
          run={run}
          contextConversationId={conversationId}
        />
      ))}

      <Flex className="flex-col items-center gap-2 pt-1">
        <Text className="text-muted-foreground text-xs" data-testid="background-panel-count">
          Showing {loaded.length} of {total}
        </Text>
        {hasMore && (
          <Button
            variant="outline"
            loading={loading}
            data-testid="background-panel-load-more"
            onClick={() => void BackgroundRuns.loadMoreConversationRuns(conversationId)}
          >
            Load more
          </Button>
        )}
      </Flex>
    </Flex>
  )
}
