import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { MessageContent } from '@/api-client/types'
import type { RailActivityContext } from '@/modules/chat/components/rail/railTypes'
import {
  DEDUP_RECORDS,
  FETCH_PAPER_FULLTEXT,
  FETCH_REFERENCES,
  LITERATURE_SEARCH,
  LIT_SEARCH_TOOLS,
  SELECT_INCLUDED,
  VERIFY_QUOTE,
  describeLitSearchTool,
  describeLiteratureSearch,
} from './describeActivity.ts'

// TEST-28 [covers ITEM-18/19] — the literature module's rail contributions.
//
// The point of this spec is COVERAGE OF THE REAL SURFACE: the `lit_search` MCP
// server exposes SIX tools (server/src/modules/lit_search/tools.rs), while
// CLAUDE.md documents only two. A contribution that covers the two documented
// ones would leave `dedup_records`, `select_included`, `verify_quote` and
// `fetch_references` falling through to a title-cased raw tool id.

const use = (name: string): MessageContent =>
  ({
    id: `blk-${name}`,
    content_type: 'tool_use',
    content: { type: 'tool_use', id: `use-${name}`, name },
  }) as unknown as MessageContent

const result = (name: string, structured?: unknown): MessageContent =>
  ({
    id: `res-${name}`,
    content_type: 'tool_result',
    content: {
      type: 'tool_result',
      tool_use_id: `use-${name}`,
      name,
      ...(structured !== undefined ? { structured_content: structured } : {}),
    },
  }) as unknown as MessageContent

/** A one-step message: the `tool_use`, optionally followed by its result. */
function ctxFor(name: string, structured?: unknown): RailActivityContext {
  const blocks =
    structured === undefined
      ? [use(name)]
      : [use(name), result(name, structured)]
  return { content: blocks[0], blocks, index: 0 }
}

/** Whichever of the module's two contributions claims this tool. */
function describe(name: string, structured?: unknown) {
  const ctx = ctxFor(name, structured)
  return describeLiteratureSearch(ctx) ?? describeLitSearchTool(ctx)
}

// ── coverage: every lit_search tool yields a step ──────────────────────────
test('TEST-28: all SIX lit_search tools yield a rail step (not just the two CLAUDE.md documents)', () => {
  assert.equal(LIT_SEARCH_TOOLS.length, 6)
  const undescribed: string[] = []
  for (const tool of LIT_SEARCH_TOOLS) {
    const step = describe(tool)
    if (!step) {
      undescribed.push(tool)
      continue
    }
    // A step whose label is still the raw tool id has not actually been
    // described — that is the failure mode this spec exists to catch.
    if (step.label === tool) undescribed.push(`${tool} (raw id)`)
  }
  assert.deepEqual(undescribed, [], `undescribed lit_search tools: ${undescribed}`)
})

test('TEST-28: the two tools CLAUDE.md omits entirely are covered', () => {
  for (const tool of [DEDUP_RECORDS, SELECT_INCLUDED, VERIFY_QUOTE, FETCH_REFERENCES]) {
    const step = describe(tool)
    assert.ok(step, `${tool} yielded no step`)
    assert.notEqual(step.label, tool)
  }
})

// ── per-tool domain language + detail ─────────────────────────────────────
test('TEST-28: literature_search reports record count and degraded sources', () => {
  const step = describeLiteratureSearch(
    ctxFor(LITERATURE_SEARCH, {
      query: 'crispr',
      records: [{ title: 'a' }, { title: 'b' }, { title: 'c' }],
      after_dedup: 3,
      degraded_sources: ['core'],
    }),
  )
  assert.ok(step)
  assert.equal(step.label, 'Searching the literature')
  assert.match(step.detail ?? '', /3 records/)
  assert.match(step.detail ?? '', /1 source degraded/)
})

test('TEST-28: fetch_paper_fulltext counts papers and how many had full text', () => {
  const step = describe(FETCH_PAPER_FULLTEXT, {
    papers: [
      { id: '10.1/a', status: 'full_text' },
      { id: '10.1/b', status: 'not_open_access' },
    ],
    lit_dir: '/lit',
  })
  assert.ok(step)
  assert.equal(step.label, 'Reading papers')
  assert.match(step.detail ?? '', /2 papers/)
  assert.match(step.detail ?? '', /1 with full text/)
})

test('TEST-28: dedup_records reports the post-dedup union size', () => {
  const step = describe(DEDUP_RECORDS, {
    query: 'x',
    records: [{}, {}],
    after_dedup: 2,
    dropped: 1,
  })
  assert.ok(step)
  assert.equal(step.label, 'Merging duplicate records')
  assert.match(step.detail ?? '', /2 records after dedup/)
  assert.match(step.detail ?? '', /1 malformed skipped/)
})

test('TEST-28: select_included reports the include/exclude split', () => {
  const step = describe(SELECT_INCLUDED, {
    included_ids: ['10.1/a', '10.1/b'],
    included: 2,
    excluded: 5,
    skipped: 0,
  })
  assert.ok(step)
  assert.equal(step.label, 'Selecting the included studies')
  assert.match(step.detail ?? '', /2 included/)
  assert.match(step.detail ?? '', /5 excluded/)
})

test('TEST-28: verify_quote distinguishes verified from a failure status', () => {
  const ok = describe(VERIFY_QUOTE, { id: '10.1/a', status: 'verified', verified: true })
  assert.ok(ok)
  assert.equal(ok.label, 'Checking a quote against the paper')
  assert.equal(ok.detail, 'verified')

  const bad = describe(VERIFY_QUOTE, {
    id: '10.1/a',
    status: 'not_open_access',
    verified: false,
  })
  assert.ok(bad)
  assert.equal(bad.detail, 'not open access')
})

test('TEST-28: fetch_references counts the citations it followed', () => {
  const step = describe(FETCH_REFERENCES, {
    query: 'cited-by references of 1 paper(s)',
    records: [{}, {}, {}, {}],
    after_dedup: 4,
  })
  assert.ok(step)
  assert.equal(step.label, 'Following the citation trail')
  assert.equal(step.detail, '4 references')
})

// ── ITEM-6: no structuredContent must still yield a usable row ─────────────
test('TEST-28 [ITEM-6]: every lit_search tool degrades to a label-only row without structuredContent', () => {
  for (const tool of LIT_SEARCH_TOOLS) {
    const step = describe(tool)
    assert.ok(step, `${tool} yielded no step`)
    assert.equal(step.detail, undefined, `${tool} invented a detail from nothing`)
    assert.ok(step.label.length > 0)
  }
})

test('TEST-28: a non-lit_search tool is DECLINED so the next contribution gets a turn', () => {
  assert.equal(describeLiteratureSearch(ctxFor('web_search')), null)
  assert.equal(describeLitSearchTool(ctxFor('web_search')), null)
})
