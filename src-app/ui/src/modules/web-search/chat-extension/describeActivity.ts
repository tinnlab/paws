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
 * The `web_search` module's rail step descriptors (ITEM-19).
 *
 * These two tools render as a raw JSON dump today. Every string below is DOMAIN
 * language owned by this module — core never learns the names `web_search` /
 * `fetch_url`, which is the whole point of the contribution inversion (INV-1).
 *
 * Wire contract, read out of the server (not invented):
 *  - tool names: `web_search/tools.rs:9` (`web_search`) and `:29` (`fetch_url`),
 *    dispatched at `web_search/handlers.rs:137-138`.
 *  - `web_search` → `structuredContent = { provider, results }`
 *    (`web_search/handlers.rs:216`); each hit is a `SearchHit { title, url,
 *    snippet }` (`web_search/providers/mod.rs:35-41`).
 *  - `fetch_url` → `structuredContent` is a serialized `FetchedPage
 *    { url, final_url, title, content, truncated, byte_count }`
 *    (`web_search/fetch.rs:19-33`, serialized at `handlers.rs:262`).
 *
 * The readable digest the model reads lives in the TEXT channel
 * (`handlers.rs:193-211`); nothing here parses it — every number and title comes
 * from `structuredContent`. When `structuredContent` is absent (the backend's
 * `cap_structured_content` DROPS an oversized payload rather than truncating
 * it), each branch still returns the base descriptor, i.e. a name-only row
 * (ITEM-6).
 */
export function describeActivity(
  ctx: RailActivityContext,
): RailStepDescriptor | null {
  const base = railToolStepBase(ctx)
  if (!base) return null
  // `railToolStepBase` hands back the RAW tool name as the label; a branch that
  // claims it replaces it with domain language, and `default` declines so the
  // block falls through to the next contribution.
  switch (base.label) {
    case 'web_search': {
      const sc = structuredOf(ctx)
      const results = countOf(sc, 'results')
      const provider = stringOf(sc, 'provider')
      const bits: string[] = []
      if (results != null) bits.push(countLabel(results, 'result'))
      if (provider) bits.push(`via ${provider}`)
      return {
        ...base,
        label: 'Searching the web',
        detail: bits.join(' · ') || undefined,
      }
    }
    case 'fetch_url': {
      const sc = structuredOf(ctx)
      // Title first (what a human recognises), then the resolved URL. `title`
      // may legitimately be an empty string — `stringOf` already rejects blanks.
      const page = stringOf(sc, 'title') ?? stringOf(sc, 'final_url', 'url')
      const truncated = sc?.truncated === true
      const bits: string[] = []
      if (page) bits.push(page)
      if (truncated) bits.push('truncated')
      return {
        ...base,
        label: 'Reading a page',
        detail: bits.join(' · ') || undefined,
      }
    }
    default:
      return null
  }
}

/** Steps for the two web-search tools. Order 40 — well below mcp's generic
 *  fallback at 1000, so this module's language wins over the title-cased id. */
export const webSearchRailContributions: RailContribution[] = [
  {
    contentTypes: ['tool_use'],
    order: 40,
    describeActivity,
  },
]
