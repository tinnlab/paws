import type { RailContribution } from '@/modules/chat/components/rail/railTypes'
import { resultBlockFor, toolResultOf } from '@/modules/chat/components/rail/railBlocks'
import { MessageFilesView } from './components/MessageFilesView'
import { describeFileReadStep, describeFileWriteStep } from './describeActivity'

/**
 * file's ACTIVITY-RAIL contributions (ITEM-18/19).
 *
 * Split in two because the two halves of the `files_mcp` surface want DIFFERENT
 * detail bodies:
 *
 *  - the WRITE tools produce a file, and this module's own `MessageFilesView` is
 *    that step's detail. The rail anchors a step at the `tool_use` block, so the
 *    default delegation would resolve the `tool_use` renderer (mcp's generic
 *    card) rather than this module's `tool_result` renderer — so the
 *    contribution points at its OWN already-registered component and hands it
 *    the paired RESULT block.
 *  - the READ / SEARCH tools produce no file. `MessageFilesView` renders nothing
 *    for them, so they OMIT `renderDetail` and take the default delegation,
 *    which keeps the result body reachable inline exactly as it is today.
 *
 * Both sit at `order: 40`, ahead of mcp's generic fallback at 1000.
 */

/** Read / search tools — the default detail delegation applies. */
const fileReadStep: RailContribution = {
  contentTypes: ['tool_use'],
  order: 40,
  describeActivity: describeFileReadStep,
}

/** Write tools — detail is this module's inline file preview. */
const fileWriteStep: RailContribution = {
  contentTypes: ['tool_use'],
  order: 40,
  describeActivity: describeFileWriteStep,
  renderDetail: ctx => {
    const result = resultBlockFor(ctx)
    if (!result) return null
    // No links (still running, or a no-op edit) ⇒ NO body, rather than an empty
    // disclosure the reader can open onto nothing. The row's artifact chips and
    // the full-record panel still carry the step.
    const links = toolResultOf(result)?.resource_links ?? []
    if (links.length === 0) return null
    return <MessageFilesView content={result} isUser={false} />
  },
}

export const fileRailContributions: RailContribution[] = [
  fileReadStep,
  fileWriteStep,
]
