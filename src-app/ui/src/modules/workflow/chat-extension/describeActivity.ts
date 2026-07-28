import type {
  RailActivityContext,
  RailStepDescriptor,
} from '@/modules/chat/components/rail/railTypes'
import {
  countLabel,
  countOf,
  railToolStepBase,
  stringOf,
  structuredOf,
} from '@/modules/chat/components/rail/railBlocks'

/**
 * The workflow chat-extension's ACTIVITY-RAIL step descriptor (ITEM-18).
 *
 * Pure — no React, no store, no JSX. Scoped to the ONE tool this extension owns
 * a renderer for; every other `workflow_mcp` verb is left to the next
 * contribution, exactly as its `contentMatch` leaves every other `tool_result`
 * to the next renderer.
 *
 * The tool name is `workflow_mcp::tools::RUN_FROM_WORKSPACE`; the
 * `structuredContent` shape (`{outputs, metadata, workspace_dir}`, with
 * `metadata = {run_id, total_tokens, ms_elapsed, status, steps_completed}`) is
 * read from `server/src/modules/workflow_mcp/tools.rs`.
 */

/** Materialize + run the workflow the model authored in its sandbox workspace. */
export const RUN_FROM_WORKSPACE = 'run_from_workspace'

/** `metadata.steps_completed` / `metadata.status`, when the payload survived. */
function metadataOf(
  sc: Record<string, unknown> | null,
): Record<string, unknown> | null {
  const raw = sc?.metadata
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null
}

/**
 * `run_from_workspace` — "Running a workflow · 4 steps · completed".
 *
 * Degrades to a label-only row when `structuredContent` is absent (ITEM-6): a
 * run with large outputs is exactly the case the backend's
 * `cap_structured_content` DROPS.
 */
export function describeWorkspaceRun(
  ctx: RailActivityContext,
): RailStepDescriptor | null {
  const base = railToolStepBase(ctx)
  if (!base || base.label !== RUN_FROM_WORKSPACE) return null
  const meta = metadataOf(structuredOf(ctx))
  const steps = countOf(meta, 'steps_completed')
  const status = stringOf(meta, 'status')
  const bits: string[] = []
  if (steps != null) bits.push(countLabel(steps, 'step'))
  if (status) bits.push(status)
  return {
    ...base,
    label: 'Running a workflow',
    detail: bits.join(' · ') || undefined,
    // INV-3: a run waiting on the user's approval NEEDS the user, so it must
    // never be folded into a collapsible rail row. `workflow_mcp` is
    // deliberately absent from the approval-bypass list
    // (`mcp/chat_extension/mcp.rs::builtin_server_ids`), so this is reachable.
    // Each contribution declares this for its own tools — core does not know
    // which content types block.
    blocking: base.status === 'pending-approval',
  }
}
