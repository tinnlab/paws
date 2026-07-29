import {
  countLabel,
  countOf,
  railToolStepBase,
  stringOf,
  structuredOf,
} from '@/modules/chat/components/rail/railBlocks'
import type {
  RailActivityContext,
  RailContribution,
  RailStepDescriptor,
} from '@/modules/chat/components/rail/railTypes'

/**
 * The `memory_mcp` module's rail step descriptors (ITEM-19).
 *
 * **Why this one MUST be structured-only.** `memory_mcp` stringifies its text
 * channel: the envelope is `content:[{type:"text", text: v.to_string()}]` with
 * the SAME value as `structuredContent`
 * (`server/src/modules/memory_mcp/handlers.rs:224-227`). So the "readable" text
 * a user sees today is raw JSON — the raw-JSON-dump case ITEM-19 exists to fix.
 * Reading anything out of that channel would be parsing JSON out of prose;
 * every field below comes from `structuredContent`.
 *
 * Wire contract, read out of the server (not invented) — tools are declared at
 * `memory_mcp/tools.rs:9,40,57` and dispatched at `handlers.rs:212-214`:
 *
 * | tool | `structuredContent` | site |
 * |---|---|---|
 * | `remember` | `{memory_id, content, scope}` | `handlers.rs:394` |
 * | `recall` | `{memories:[{id, content}]}` | `handlers.rs:455-459` |
 * | `forget` | `{memory_id, deleted: true}` | `handlers.rs:484` |
 *
 * A dropped payload (`cap_structured_content`) still yields the base name-only
 * row (ITEM-6).
 */

/** Longest memory excerpt rendered on a one-line row before ellipsis. */
const EXCERPT_MAX = 64

/** One-line excerpt of a stored memory: collapse whitespace, then ellipsise. */
export function excerpt(text: string, max = EXCERPT_MAX): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

export function describeActivity(
  ctx: RailActivityContext,
): RailStepDescriptor | null {
  const base = railToolStepBase(ctx)
  if (!base) return null
  const sc = structuredOf(ctx)

  switch (base.label) {
    case 'remember': {
      const content = stringOf(sc, 'content')
      const scope = stringOf(sc, 'scope')
      const bits: string[] = []
      if (content) bits.push(excerpt(content))
      if (scope) bits.push(`${scope} scope`)
      return {
        ...base,
        label: 'Saving a memory',
        detail: bits.join(' · ') || undefined,
      }
    }
    case 'recall': {
      const n = countOf(sc, 'memories')
      return {
        ...base,
        label: 'Recalling memories',
        detail: n != null ? countLabel(n, 'memory', 'memories') : undefined,
      }
    }
    case 'forget': {
      return {
        ...base,
        label: 'Forgetting a memory',
        detail: sc?.deleted === true ? 'deleted' : undefined,
      }
    }
    default:
      return null
  }
}

/** Steps for the three memory tools. Order 40 — below mcp's generic fallback at
 *  1000, so this module's language wins over the title-cased id. */
export const memoryRailContributions: RailContribution[] = [
  {
    contentTypes: ['tool_use'],
    order: 40,
    describeActivity,
  },
]
