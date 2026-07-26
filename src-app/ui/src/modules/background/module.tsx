import { createModule } from '@ziee/framework'

import { useBackgroundRunsStore } from './stores/BackgroundRuns.store'
import '@/modules/background/types' // register Stores.BackgroundRuns (declaration merge)

/**
 * Background sub-agent runs.
 *
 * There is deliberately NO nav entry, route, or page here. A background run is
 * spawned BY a conversation turn (both spawners in `background_mcp::tools`
 * require a conversation), so it belongs to that conversation and is surfaced
 * there: the right-panel "Tasks" tab plus the end-of-conversation affordance,
 * both registered by the background chat-extension at
 * `chat-extension/extension.tsx`. A standalone global page pulled the user OUT of
 * the conversation they were reading to show them work that conversation had
 * started. Completed results surface through the central notification bell, which
 * navigates to the conversation the result landed in.
 *
 * Scheduled tasks are NOT served from here — their run history is the scheduler's
 * own `scheduled_task_runs`, a different table that `GET /api/background/runs`
 * never returned.
 *
 * KNOWN GAP (tracked for the owner, not introduced by the surfacing change):
 * `workflow_runs.conversation_id` is `ON DELETE SET NULL`, so DELETING a
 * conversation detaches its runs. A detached run — possibly still running — now
 * has no UI surface at all. The endpoint's unscoped (conversation-less) read is
 * exactly the query a future "detached tasks" surface needs; nothing consumes it
 * today.
 *
 * This module therefore only registers the shared runs store, consumed by the
 * in-chat panel + footer.
 */
export default createModule({
  metadata: {
    name: 'background',
    version: '1.0.0',
    description:
      'Background sub-agent runs — surfaced in-conversation (right-panel Tasks tab + footer); no global page.',
  },
  stores: [{ name: 'BackgroundRuns', store: useBackgroundRunsStore }],
})
