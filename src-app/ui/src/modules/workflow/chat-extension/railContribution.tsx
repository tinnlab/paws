import type { RailContribution } from '@/modules/chat/components/rail/railTypes'
import { resultBlockFor, toolResultOf } from '@/modules/chat/components/rail/railBlocks'
import { WorkflowWorkspaceRunCard } from './components/WorkflowWorkspaceRunCard'
import { describeWorkspaceRun } from './describeActivity'

/**
 * workflow-workspace's ACTIVITY-RAIL contribution (ITEM-18).
 *
 * `order: 40` puts it ahead of mcp's generic fallback at 1000, so a workspace
 * run reads as "Running a workflow" and mcp never learns the tool exists.
 *
 * `renderDetail` points at this module's OWN already-registered card with the
 * paired RESULT block: the rail anchors a step at the `tool_use` block, so the
 * default delegation would resolve the `tool_use` renderer (mcp's generic card)
 * and the Save / Download affordance would become unreachable from the rail.
 */
const workspaceRunStep: RailContribution = {
  contentTypes: ['tool_use'],
  order: 40,
  describeActivity: describeWorkspaceRun,
  renderDetail: ctx => {
    const result = resultBlockFor(ctx)
    // Still running ⇒ no body; the row and the full-record panel carry the step.
    if (!result) return null
    const data = toolResultOf(result)
    const sc = (data?.structured_content ?? null) as { workspace_dir?: string } | null
    // The card's ONLY content is the graduation affordance, which needs a
    // successful run that reported its authored `workspace_dir`. Without one
    // there is nothing to disclose, so offer no expander rather than an empty
    // body the reader can open onto nothing.
    if (data?.is_error === true || !sc?.workspace_dir) return null
    return <WorkflowWorkspaceRunCard content={result} isUser={false} />
  },
}

export const workflowRailContributions: RailContribution[] = [workspaceRunStep]
