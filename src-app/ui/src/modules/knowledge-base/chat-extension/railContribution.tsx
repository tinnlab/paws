import type { RailContribution } from '@/modules/chat/components/rail/railTypes'
import { resultBlockFor } from '@/modules/chat/components/rail/railBlocks'
import { SearchKnowledgeToolResultCard } from './components/SearchKnowledgeToolResultCard'
import {
  describeListKnowledgeBases,
  describeSearchKnowledge,
} from './describeActivity'

/**
 * knowledge-base's ACTIVITY-RAIL contributions (ITEM-18).
 *
 * Both sit at `order: 40`, comfortably ahead of mcp's generic fallback at 1000,
 * so a knowledge-base tool is described in knowledge-base language and mcp never
 * has to know the tool exists.
 *
 * ### Why `renderDetail` is supplied here
 *
 * The rail anchors a tool step at the `tool_use` block, so the DEFAULT
 * delegation (`renderContent({ content })` when `renderDetail` is omitted)
 * resolves the `tool_use` renderer — mcp's generic tool card — not this module's
 * `tool_result` card. The retrieval-transparency card IS this step's detail, so
 * the contribution points at the module's OWN already-registered component and
 * hands it the paired RESULT block. Still delegation, not re-implementation:
 * the component is unchanged and is the same one the non-rail path renders.
 *
 * `list_knowledge_bases` has no card of its own, so it omits `renderDetail` and
 * takes the default delegation.
 */

/** `search_knowledge` — detail is the retrieval-transparency card. */
const searchKnowledgeStep: RailContribution = {
  contentTypes: ['tool_use'],
  order: 40,
  describeActivity: describeSearchKnowledge,
  renderDetail: ctx => {
    const result = resultBlockFor(ctx)
    // No result yet (still running) ⇒ no body. The row's status + the full
    // record panel still carry the step, so nothing becomes unreachable.
    if (!result) return null
    return <SearchKnowledgeToolResultCard content={result} isUser={false} />
  },
}

/** `list_knowledge_bases` — a plain step; the default detail delegation applies. */
const listKnowledgeBasesStep: RailContribution = {
  contentTypes: ['tool_use'],
  order: 40,
  describeActivity: describeListKnowledgeBases,
}

export const knowledgeBaseRailContributions: RailContribution[] = [
  searchKnowledgeStep,
  listKnowledgeBasesStep,
]
