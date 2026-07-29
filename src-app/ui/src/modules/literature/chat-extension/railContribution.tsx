import type { RailContribution } from '@/modules/chat/components/rail/railTypes'
import { resultBlockFor } from '@/modules/chat/components/rail/railBlocks'
import { LiteratureToolResultCard } from '../components/LiteratureToolResultCard'
import {
  describeLiteratureSearch,
  describeLitSearchTool,
} from './describeActivity'

/**
 * literature's ACTIVITY-RAIL contributions (ITEM-18/19).
 *
 * Both sit at `order: 40`, ahead of mcp's generic fallback at 1000, so a
 * `lit_search` step reads as "Searching the literature" rather than a
 * title-cased tool id — and mcp never learns the tool exists.
 *
 * `literature_search` is the only one of the six with an inline card, so it is
 * the only one that supplies a `renderDetail`. The rail anchors a step at the
 * `tool_use` block, so the DEFAULT delegation would resolve the `tool_use`
 * renderer (mcp's generic card) rather than this module's `tool_result` card;
 * pointing at the module's OWN already-registered component with the paired
 * RESULT block keeps the screening affordance reachable. The other five take
 * the default delegation.
 */

/** `literature_search` — detail is the "Open in screening" card. */
const literatureSearchStep: RailContribution = {
  contentTypes: ['tool_use'],
  order: 40,
  describeActivity: describeLiteratureSearch,
  renderDetail: ctx => {
    const result = resultBlockFor(ctx)
    // Still running ⇒ no body. The row + the full-record panel still carry it.
    if (!result) return null
    return <LiteratureToolResultCard content={result} isUser={false} />
  },
}

/** The remaining five `lit_search` tools; the default detail delegation applies. */
const litSearchToolStep: RailContribution = {
  contentTypes: ['tool_use'],
  order: 40,
  describeActivity: describeLitSearchTool,
}

export const literatureRailContributions: RailContribution[] = [
  literatureSearchStep,
  litSearchToolStep,
]
