import type { MessageContent, ProgressKind } from '@/api-client/types'
import type {
  RailActivityContext,
  RailStepDescriptor,
} from '@/modules/chat/components/rail/railTypes'
import { titleCaseToolId } from '@/modules/chat/components/rail/railBlocks'

/**
 * The `agent_activity` member of the generated {@link ProgressKind} union — one
 * accreting row in an agent step's ACTIVITY TIMELINE. Extracted (not re-typed)
 * so it can never drift from the backend contract.
 */
export type AgentActivityEntry = Extract<ProgressKind, { type: 'agent_activity' }>

/**
 * **This file used to hold the anti-pattern this whole feature exists to delete**
 * (ITEM-23 / AP-1): a `TOOL_ACTIVITY_PHRASES` map in which ONE module hardcoded
 * NINE other modules' tool names, so that adding a tool anywhere meant editing
 * here. The map is gone. Naming is now resolved through the activity-rail
 * CONTRIBUTION registry, where each module describes its own tools — and this
 * module names none but its own.
 *
 * `titleCaseToolId` — the harmless half of the old file — moved to
 * `chat/components/rail/railBlocks.ts` and is imported from there: the MECHANISM
 * survived, the central MAP did not.
 */

/**
 * Resolve a rail step from a describe-context. Structurally identical to
 * `chatExtensionRegistry.resolveRailStep`, but taken as a PARAMETER so this
 * module stays pure (no registry import ⇒ no React/JSX in its import graph ⇒
 * directly unit-testable, and no risk of a circular import from a run page).
 * {@link AgentActivityTimeline} supplies the real registry-backed resolver.
 */
export type RailStepResolver = (
  ctx: RailActivityContext,
) => RailStepDescriptor | null

/**
 * Adapt a timeline entry into something the rail registry can describe.
 *
 * A timeline entry is an `AgentActivityEntry` (`{seq, kind, tool, title,
 * detail, status}`), NOT a `MessageContent` block — the backend reports agent
 * progress, it does not replay the transcript. So we synthesise the MINIMUM
 * `tool_use`-shaped block a contribution needs: the tool name and an empty
 * input. No id, no result — which means every contribution takes its
 * `structuredContent`-absent path, exactly the ITEM-6 degradation each one
 * already has to support.
 */
export function railContextForTool(tool: string): RailActivityContext {
  const content = {
    id: `agent-activity:${tool}`,
    message_id: '',
    content_type: 'tool_use',
    content: { type: 'tool_use', name: tool, input: {} },
    sequence_order: 0,
    created_at: '',
    updated_at: '',
  } as unknown as MessageContent
  return { content, blocks: [content], index: 0 }
}

/**
 * Domain-language phrase for a tool id.
 *
 * Precedence: the owning module's rail contribution → a title-cased fallback
 * derived from the id → a generic "Working…" for a blank tool. `resolve` is
 * optional so a caller with no registry available (a unit test, a page rendered
 * before the chat extensions register) still gets a readable line.
 */
export function phraseForTool(
  tool?: string | null,
  resolve?: RailStepResolver,
): string {
  const t = (tool ?? '').trim()
  if (!t) return 'Working…'
  if (resolve) {
    try {
      const label = resolve(railContextForTool(t))?.label?.trim()
      if (label) return label
    } catch {
      // A broken contribution degrades the label, never the timeline.
    }
  }
  return titleCaseToolId(t)
}

/**
 * The display line for one activity entry. Prefers the backend-provided `title`
 * when it is a non-blank string (the backend already writes a good editorial
 * line for most activities) — the SAME precedence rule the deleted map had —
 * otherwise asks the contribution registry via {@link phraseForTool}. Pure.
 */
export function describeActivity(
  entry: AgentActivityEntry,
  resolve?: RailStepResolver,
): string {
  const title = (entry.title ?? '').trim()
  if (title) return title
  return phraseForTool(entry.tool, resolve)
}
