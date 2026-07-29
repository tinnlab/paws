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
 * The literature module's ACTIVITY-RAIL step descriptors (ITEM-18/19).
 *
 * Pure — no React, no store, no JSX — so the domain language is unit-testable
 * (TEST-28) and the `.tsx` sibling only wires a detail body.
 *
 * The `lit_search` MCP server exposes **SIX** tools, not the two CLAUDE.md
 * documents. The list below is read from the server's own `tools/list`
 * descriptor (`server/src/modules/lit_search/tools.rs`), and every
 * `structuredContent` field consulted here is read from the handler that emits
 * it (`server/src/modules/lit_search/handlers.rs`, `fulltext/mod.rs`) — nothing
 * is guessed.
 */

/** Aggregated scholarly search across the enabled connectors. */
export const LITERATURE_SEARCH = 'literature_search'
/** Open-access full-text retrieval for specific paper ids. */
export const FETCH_PAPER_FULLTEXT = 'fetch_paper_fulltext'
/** Pure in-process merge + DOI de-duplication of several record sets. */
export const DEDUP_RECORDS = 'dedup_records'
/** Turn screening decisions into the included-id list. */
export const SELECT_INCLUDED = 'select_included'
/** Deterministic verbatim-span check of a quote against a cached full text. */
export const VERIFY_QUOTE = 'verify_quote'
/** Citation snowballing (backward references / forward citations). */
export const FETCH_REFERENCES = 'fetch_references'

/** Every tool the `lit_search` server exposes, in `tools/list` order. */
export const LIT_SEARCH_TOOLS = [
  LITERATURE_SEARCH,
  FETCH_PAPER_FULLTEXT,
  DEDUP_RECORDS,
  SELECT_INCLUDED,
  VERIFY_QUOTE,
  FETCH_REFERENCES,
] as const

/**
 * INV-3: a step waiting on the user's approval NEEDS the user, so it must never
 * be folded into a collapsible rail row. Core does not know WHICH steps block —
 * each contribution declares it for its own tools.
 */
function withBlocking(step: RailStepDescriptor | null): RailStepDescriptor | null {
  if (!step) return null
  return step.status === 'pending-approval' ? { ...step, blocking: true } : step
}

/** Join the non-empty parts of a detail line. */
function detailOf(bits: (string | null | undefined)[]): string | undefined {
  const kept = bits.filter((b): b is string => !!b && b.length > 0)
  return kept.length > 0 ? kept.join(' · ') : undefined
}

/**
 * How many of a `fetch_paper_fulltext` result's papers actually came back with
 * open-access full text. Each entry carries `status` ∈
 * `full_text | not_open_access | not_found` (fulltext/mod.rs).
 */
function fullTextCount(sc: Record<string, unknown> | null): number | null {
  const papers = sc?.papers
  if (!Array.isArray(papers)) return null
  return papers.filter(
    p =>
      !!p &&
      typeof p === 'object' &&
      (p as { status?: unknown }).status === 'full_text',
  ).length
}

/**
 * `literature_search` — "Searching the literature · 42 records · 1 source
 * degraded".
 *
 * Split from {@link describeLitSearchTool} because this is the ONE lit_search
 * tool with an inline card of its own, so its contribution carries a
 * `renderDetail` and the other five do not.
 */
export function describeLiteratureSearch(
  ctx: RailActivityContext,
): RailStepDescriptor | null {
  const base = railToolStepBase(ctx)
  if (!base || base.label !== LITERATURE_SEARCH) return null
  const sc = structuredOf(ctx)
  const records = countOf(sc, 'records')
  const degraded = countOf(sc, 'degraded_sources')
  return withBlocking({
    ...base,
    label: 'Searching the literature',
    detail: detailOf([
      records != null ? countLabel(records, 'record') : null,
      degraded ? `${countLabel(degraded, 'source')} degraded` : null,
    ]),
  })
}

/**
 * The other five `lit_search` tools. Each degrades to a label-only row when
 * `structuredContent` is absent (ITEM-6) — the backend's
 * `cap_structured_content` DROPS an oversized payload, which a full-text fetch
 * routinely produces.
 */
export function describeLitSearchTool(
  ctx: RailActivityContext,
): RailStepDescriptor | null {
  return withBlocking(describeLitSearchToolStep(ctx))
}

function describeLitSearchToolStep(
  ctx: RailActivityContext,
): RailStepDescriptor | null {
  const base = railToolStepBase(ctx)
  if (!base) return null
  const sc = structuredOf(ctx)

  switch (base.label) {
    case FETCH_PAPER_FULLTEXT: {
      const papers = countOf(sc, 'papers')
      const full = fullTextCount(sc)
      return {
        ...base,
        label: papers === 1 ? 'Reading a paper' : 'Reading papers',
        detail: detailOf([
          papers != null ? countLabel(papers, 'paper') : null,
          full != null ? `${full} with full text` : null,
        ]),
      }
    }
    case DEDUP_RECORDS: {
      const after = countOf(sc, 'after_dedup')
      const dropped = countOf(sc, 'dropped')
      return {
        ...base,
        label: 'Merging duplicate records',
        detail: detailOf([
          after != null ? `${countLabel(after, 'record')} after dedup` : null,
          dropped ? `${dropped} malformed skipped` : null,
        ]),
      }
    }
    case SELECT_INCLUDED: {
      const included = countOf(sc, 'included')
      const excluded = countOf(sc, 'excluded')
      return {
        ...base,
        label: 'Selecting the included studies',
        detail: detailOf([
          included != null ? `${included} included` : null,
          excluded != null ? `${excluded} excluded` : null,
        ]),
      }
    }
    case VERIFY_QUOTE: {
      // `verified` is the boolean the tool answers with; `status` explains WHY
      // it could not verify (not_found / not_open_access / not_cached).
      const status = stringOf(sc, 'status')
      const verified = sc?.verified
      return {
        ...base,
        label: 'Checking a quote against the paper',
        detail: detailOf([
          verified === true ? 'verified' : null,
          verified !== true ? status?.replace(/_/g, ' ') : null,
        ]),
      }
    }
    case FETCH_REFERENCES: {
      const records = countOf(sc, 'records')
      return {
        ...base,
        label: 'Following the citation trail',
        detail: records != null ? countLabel(records, 'reference') : undefined,
      }
    }
    default:
      // Not a lit_search tool — decline so the next contribution gets a turn.
      return null
  }
}
