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
 * The `citations` module's rail step descriptors (ITEM-19).
 *
 * Wire contract, read out of the server (not invented) — the six tools are
 * declared in `citations/tools.rs:36,45,57,66,76,90` (and pinned as a set at
 * `tools.rs:116-121`) and dispatched in `citations/handlers.rs:194-341`. Every
 * result goes through the one envelope helper `tool_result(text, structured)`
 * (`handlers.rs:114-119`), so `structuredContent` is exactly:
 *
 * | tool | `structuredContent` | site |
 * |---|---|---|
 * | `lookup_citations` | `{results: CitationItemResult[]}` | `handlers.rs:246` |
 * | `add_citations` | `{results: CitationItemResult[]}` | `handlers.rs:258` |
 * | `verify_citations` | `{results: CitationItemResult[]}` | `handlers.rs:268` |
 * | `list_citations` | `{entries: BibliographyEntry[]}` | `handlers.rs:200` |
 * | `format_citations` | `{output: string}` | `handlers.rs:347` |
 * | `remove_citations` | `{removed: number}` | `handlers.rs:232` |
 *
 * `CitationItemResult.verification_status` (`citations/models.rs:115`) is a
 * snake_case `VerificationStatus` — exactly `verified | mismatch | not_found |
 * unverified` (`models.rs:16-23`). The module's defining rule is "never invent a
 * citation", so those outcomes are surfaced in the detail suffix rather than
 * being hidden behind a generic "N items" — a `not_found` is the fabricated-DOI
 * signal and must be visible on the collapsed row.
 *
 * The text channel is a prose summary (`handlers.rs:397-414`); nothing here
 * reads it. A dropped `structuredContent` still yields the base name-only row
 * (ITEM-6).
 */

/** The four `VerificationStatus` values, in the order they are reported. */
const VERIFICATION_ORDER = [
  'verified',
  'mismatch',
  'not_found',
  'unverified',
] as const
type Verification = (typeof VERIFICATION_ORDER)[number]

const VERIFICATION_LABEL: Record<Verification, string> = {
  verified: 'verified',
  mismatch: 'mismatch',
  not_found: 'not found',
  unverified: 'unverified',
}

/**
 * `"3 items · 2 verified, 1 not found"` from a `{results:[…]}` payload. Returns
 * `undefined` when there is nothing typed to read (ITEM-6 degradation).
 */
export function verificationSummary(
  sc: Record<string, unknown> | null,
): string | undefined {
  const results = sc?.results
  if (!Array.isArray(results)) return undefined
  const counts: Partial<Record<Verification, number>> = {}
  for (const r of results) {
    if (!r || typeof r !== 'object') continue
    const status = (r as Record<string, unknown>).verification_status
    if (typeof status !== 'string') continue
    if (!(VERIFICATION_ORDER as readonly string[]).includes(status)) continue
    const key = status as Verification
    counts[key] = (counts[key] ?? 0) + 1
  }
  const parts = VERIFICATION_ORDER.filter(k => counts[k]).map(
    k => `${counts[k]} ${VERIFICATION_LABEL[k]}`,
  )
  const head = countLabel(results.length, 'item')
  return parts.length ? `${head} · ${parts.join(', ')}` : head
}

export function describeActivity(
  ctx: RailActivityContext,
): RailStepDescriptor | null {
  const base = railToolStepBase(ctx)
  if (!base) return null
  const sc = structuredOf(ctx)

  switch (base.label) {
    case 'lookup_citations':
      return {
        ...base,
        label: 'Looking up citations',
        detail: verificationSummary(sc),
      }
    case 'add_citations':
      return {
        ...base,
        label: 'Adding citations',
        detail: verificationSummary(sc),
      }
    case 'verify_citations':
      return {
        ...base,
        label: 'Verifying citations',
        detail: verificationSummary(sc),
      }
    case 'list_citations': {
      const n = countOf(sc, 'entries')
      return {
        ...base,
        label: 'Reading the bibliography',
        detail: n != null ? countLabel(n, 'citation') : undefined,
      }
    }
    case 'format_citations': {
      // `output` is the formatted bibliography itself — a potentially huge
      // string. Report its SIZE, never its contents, on a one-line row.
      const output = stringOf(sc, 'output')
      return {
        ...base,
        label: 'Formatting references',
        detail: output
          ? countLabel(output.split('\n').length, 'line')
          : undefined,
      }
    }
    case 'remove_citations': {
      const n = countOf(sc, 'removed')
      return {
        ...base,
        label: 'Removing citations',
        detail: n != null ? countLabel(n, 'citation') : undefined,
      }
    }
    default:
      return null
  }
}

/** Steps for the six citation tools. Order 40 — below mcp's generic fallback at
 *  1000, so this module's language wins over the title-cased id. */
export const citationsRailContributions: RailContribution[] = [
  {
    contentTypes: ['tool_use'],
    order: 40,
    describeActivity,
  },
]
