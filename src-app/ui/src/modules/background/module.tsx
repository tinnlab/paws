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
 * own `scheduled_task_runs`, a DIFFERENT table that `GET /api/background/runs` has
 * never returned. (An earlier version of this comment claimed the
 * conversation-less bucket was scheduled-task work surfaced under Scheduled Tasks.
 * That was factually wrong and is corrected here so the next reader is not misled.)
 *
 * WHY NOTHING SURVIVES DETACHED. `workflow_runs.conversation_id` is
 * `ON DELETE SET NULL`, so deleting a conversation would otherwise detach its runs
 * — rows with a NULL conversation and, worse, tasks still executing with no
 * surface able to reach them. That hole is closed AT THE SOURCE rather than by
 * adding a global page: the conversation-delete handler calls
 * `background_mcp::runs::cancel_conversation_background_runs` BEFORE the delete,
 * which flips every non-terminal run to `cancelled` (the same `cancel_cas` the
 * single-run cancel endpoint uses) AND fires `registry::cancel` so the detached
 * task actually stops. The row is then allowed to go conversation-less: it is
 * terminal, so there is nothing left to view, steer, or stop. An already-terminal
 * run keeps its outcome untouched. See DEC-15.
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
