import { createModule } from '@ziee/framework'

import { useBackgroundRunsStore } from './stores/BackgroundRuns.store'
import '@/modules/background/types' // register Stores.BackgroundRuns (declaration merge)

/**
 * Background sub-agent runs.
 *
 * There is deliberately NO nav entry, route, or page here: every background run
 * belongs to exactly one owner, and that owner surfaces it —
 *   - a CONVERSATION's sub-agents → that conversation's right-panel "Tasks" tab
 *     plus the end-of-conversation affordance, both registered by the background
 *     chat-extension at `chat-extension/extension.tsx`; and
 *   - a SCHEDULED TASK's runs → that task's own run history under Scheduled Tasks.
 *
 * A conversation-less run only ever comes from detached/scheduled work, so a
 * standalone global "Background tasks" page would merely duplicate the
 * scheduler's run history while pulling the user OUT of the conversation they
 * were reading. Completed results surface through the central notification bell,
 * which navigates to the conversation the result landed in.
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
