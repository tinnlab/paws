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
 * The knowledge-base module's ACTIVITY-RAIL step descriptors (ITEM-18).
 *
 * Pure — no React, no store, no JSX — so the domain language is unit-testable
 * and the `.tsx` sibling only has to wire a detail body. Core asks "is this a
 * step of yours?"; this file answers in knowledge-base language. Nothing here
 * is known to the rail.
 *
 * Tool names are read from the module's own MCP server
 * (`server/src/modules/knowledge_base/tools.rs`), never guessed.
 */

/** Retrieval over the conversation's / caller's attached knowledge bases. */
export const SEARCH_KNOWLEDGE = 'search_knowledge'
/** Enumerate the caller's knowledge bases. */
export const LIST_KNOWLEDGE_BASES = 'list_knowledge_bases'

/**
 * INV-3: a step waiting on the user's approval NEEDS the user, so it must never
 * be folded into a collapsible rail row. Core does not know WHICH steps block —
 * each contribution declares it, so every module carries this three-line rule
 * for its own tools rather than importing a shared one across module lines.
 */
function withBlocking(step: RailStepDescriptor): RailStepDescriptor {
  return step.status === 'pending-approval' ? { ...step, blocking: true } : step
}

/**
 * True when the tool reported a corpus that was NOT fully indexed at query time
 * (`structuredContent.indexing_incomplete = {searchable, total}`). Surfacing it
 * on the row matters: a half-indexed corpus answers as if it were complete.
 */
function partialIndex(sc: Record<string, unknown> | null): boolean {
  const raw = sc?.indexing_incomplete
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
  const { searchable, total } = raw as { searchable?: unknown; total?: unknown }
  return (
    typeof searchable === 'number' &&
    typeof total === 'number' &&
    searchable < total
  )
}

/**
 * `search_knowledge` — "Searching your knowledge base · 7 passages · hybrid".
 *
 * Degrades to a label-only row when `structuredContent` is absent (ITEM-6):
 * `cap_structured_content` DROPS an oversized payload, so a big retrieval is a
 * NORMAL reason to see no counts here — never an error.
 */
export function describeSearchKnowledge(
  ctx: RailActivityContext,
): RailStepDescriptor | null {
  const base = railToolStepBase(ctx)
  if (!base || base.label !== SEARCH_KNOWLEDGE) return null
  const sc = structuredOf(ctx)
  const bits: string[] = []
  const hits = countOf(sc, 'hits')
  if (hits != null) bits.push(countLabel(hits, 'passage'))
  const mode = stringOf(sc, 'mode')
  if (mode) bits.push(mode.toLowerCase())
  if (sc?.truncated === true) bits.push('truncated')
  if (partialIndex(sc)) bits.push('partial index')
  return withBlocking({
    ...base,
    label: 'Searching your knowledge base',
    detail: bits.join(' · ') || undefined,
  })
}

/** `list_knowledge_bases` — "Listing your knowledge bases · 3 knowledge bases". */
export function describeListKnowledgeBases(
  ctx: RailActivityContext,
): RailStepDescriptor | null {
  const base = railToolStepBase(ctx)
  if (!base || base.label !== LIST_KNOWLEDGE_BASES) return null
  const n = countOf(structuredOf(ctx), 'knowledge_bases')
  return withBlocking({
    ...base,
    label: 'Listing your knowledge bases',
    detail: n != null ? countLabel(n, 'knowledge base') : undefined,
  })
}
