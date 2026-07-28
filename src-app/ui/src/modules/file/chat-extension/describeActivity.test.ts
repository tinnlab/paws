import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { MessageContent } from '@/api-client/types'
import type { RailActivityContext } from '@/modules/chat/components/rail/railTypes'
import {
  __resetRailLiveSourceForTests,
  setRailLiveSource,
} from '@/modules/chat/core/rail/liveSteps'
import {
  CONVERT_DOCUMENT,
  CREATE_FILE,
  EDIT_FILE,
  FILE_READ_TOOLS,
  FILE_WRITE_TOOLS,
  GREP_FILES,
  LIST_FILES,
  READ_FILE,
  SEMANTIC_SEARCH,
  describeFileReadStep,
  describeFileWriteStep,
} from './describeActivity.ts'

// TEST-30 [covers ITEM-18/19] — the file module's rail contributions over the
// `files_mcp` surface (server/src/modules/files_mcp/{tools,handlers}.rs).
//
// The load-bearing case is the LAST one: `read_file` on an image or a binary
// returns an image block / a plain note and emits NO `structuredContent` at all,
// so the descriptor must still produce a usable name-only row (ITEM-6).

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

function ctxFor(name: string, structured?: unknown): RailActivityContext {
  const blocks =
    structured === undefined ? [use(name)] : [use(name), result(name, structured)]
  return { content: blocks[0], blocks, index: 0 }
}

/** Whichever of the module's two contributions claims this tool. */
function describe(name: string, structured?: unknown) {
  const ctx = ctxFor(name, structured)
  return describeFileReadStep(ctx) ?? describeFileWriteStep(ctx)
}

// ── coverage ───────────────────────────────────────────────────────────────
test('TEST-30: every files_mcp tool yields a described step (never a raw tool id)', () => {
  const undescribed: string[] = []
  for (const tool of [...FILE_READ_TOOLS, ...FILE_WRITE_TOOLS]) {
    const step = describe(tool)
    if (!step || step.label === tool) undescribed.push(tool)
  }
  assert.deepEqual(undescribed, [], `undescribed files_mcp tools: ${undescribed}`)
})

// ── semantic_search / grep_files: hit counts + retrieval mode ──────────────
test('TEST-30: semantic_search reports the passage count AND the retrieval mode', () => {
  const step = describe(SEMANTIC_SEARCH, {
    results: [{ file_id: 'a' }, { file_id: 'b' }, { file_id: 'c' }],
    mode: 'Hybrid',
    truncated: false,
    query: 'mitochondria',
  })
  assert.ok(step)
  assert.equal(step.label, 'Searching your documents')
  assert.match(step.detail ?? '', /3 passages/)
  assert.match(step.detail ?? '', /hybrid/)
})

test('TEST-30: semantic_search flags a truncated result set', () => {
  const step = describe(SEMANTIC_SEARCH, {
    results: [{ file_id: 'a' }],
    mode: 'Fts',
    truncated: true,
    query: 'q',
  })
  assert.match(step?.detail ?? '', /truncated/)
})

test('TEST-30: grep_files reports the match count', () => {
  const step = describe(GREP_FILES, {
    matches: [{ page: 1 }, { page: 2 }],
    truncated: false,
    missing_pages: [],
  })
  assert.ok(step)
  assert.equal(step.label, 'Searching your files')
  assert.match(step.detail ?? '', /2 matches/)
})

test('TEST-30: grep_files pluralises a single match and flags truncation', () => {
  const one = describe(GREP_FILES, { matches: [{ page: 1 }], truncated: true })
  assert.match(one?.detail ?? '', /1 match(?!es)/)
  assert.match(one?.detail ?? '', /truncated/)
})

// ── read_file ──────────────────────────────────────────────────────────────
test('TEST-30: read_file on a paginated document reports the page range', () => {
  const step = describe(READ_FILE, {
    file_id: 'f1',
    name: 'protocol.pdf',
    page_start: 1,
    page_end: 3,
    total_pages: 12,
  })
  assert.ok(step)
  assert.equal(step.label, 'Reading protocol.pdf')
  assert.equal(step.detail, 'pages 1–3 of 12')
})

test('TEST-30: read_file on a text file reports the line range', () => {
  const step = describe(READ_FILE, {
    file_id: 'f2',
    name: 'notes.md',
    line_start: 1,
    line_end: 40,
    total_lines: 200,
  })
  assert.equal(step?.label, 'Reading notes.md')
  assert.equal(step?.detail, 'lines 1–40 of 200')
})

test('TEST-30 [ITEM-6]: read_file on an image/binary emits NO structuredContent and degrades to a name-only row', () => {
  // An image read returns `content:[{type:"image",...}]` and a binary read a
  // plain note — neither carries `structuredContent` (files_mcp/handlers.rs).
  const imageRead = describe(READ_FILE, undefined)
  assert.ok(imageRead, 'a structuredContent-less read_file must still be a step')
  assert.equal(imageRead.label, 'Reading a file')
  assert.equal(imageRead.detail, undefined, 'no payload must invent no detail')
  assert.equal(imageRead.status, 'running')

  // Same, but WITH a result block that simply carries no structured payload —
  // the binary-note shape. Still a row, still no invented detail.
  const binaryRead = describeFileReadStep({
    content: use(READ_FILE),
    blocks: [use(READ_FILE), result(READ_FILE)],
    index: 0,
  })
  assert.ok(binaryRead)
  assert.equal(binaryRead.label, 'Reading a file')
  assert.equal(binaryRead.detail, undefined)
  assert.equal(binaryRead.status, 'success')
})

test('TEST-30: list_files counts the manifest', () => {
  const step = describe(LIST_FILES, { files: [{ id: 'a' }, { id: 'b' }] })
  assert.equal(step?.label, 'Listing the files in this chat')
  assert.equal(step?.detail, '2 files')
})

// ── write tools ────────────────────────────────────────────────────────────
test('TEST-30: create_file / convert_document read as domain actions', () => {
  assert.equal(describe(CREATE_FILE, { file_id: 'a', version: 1 })?.label, 'Creating a file')
  assert.equal(
    describe(CONVERT_DOCUMENT, { file_id: 'a', version: 1 })?.label,
    'Converting a document to PDF',
  )
})

test('TEST-30: an edit reports the new version, and a no-op reports no change', () => {
  const edited = describe(EDIT_FILE, { file_id: 'a', version: 4, version_id: 'v4' })
  assert.equal(edited?.label, 'Editing a file')
  assert.equal(edited?.detail, 'v4')

  const noop = describe(EDIT_FILE, { file_id: 'a', version: 3, unchanged: true })
  assert.equal(noop?.detail, 'no change')
})

// ── INV-3: a step awaiting approval breaks out of the rail ────────────────
test('TEST-30 [INV-3]: a step awaiting approval is marked blocking; a running one is not', () => {
  const ctx = ctxFor(CREATE_FILE)
  const normal = describeFileWriteStep(ctx)
  assert.ok(normal)
  assert.equal(normal.status, 'running')
  assert.notEqual(normal.blocking, true)

  // Drive the REAL status source: `pending-approval` can only come from the
  // core-owned live-step seam, so register one rather than fake the descriptor.
  const unsubscribe = () => undefined
  setRailLiveSource({
    get: () => ({ status: 'pending_approval' }),
    subscribe: () => unsubscribe,
  })
  try {
    const blocked = describeFileWriteStep(ctx)
    assert.ok(blocked)
    assert.equal(blocked.status, 'pending-approval')
    assert.equal(
      blocked.blocking,
      true,
      'a tool waiting on the user must break out of the rail, never collapse into it',
    )
  } finally {
    __resetRailLiveSourceForTests()
  }
})

test('TEST-30: a non-files_mcp tool is DECLINED by both contributions', () => {
  assert.equal(describeFileReadStep(ctxFor('web_search')), null)
  assert.equal(describeFileWriteStep(ctxFor('web_search')), null)
})
