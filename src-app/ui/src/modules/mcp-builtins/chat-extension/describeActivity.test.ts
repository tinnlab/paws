import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { MessageContent } from '@/api-client/types'
import type { RailActivityContext } from '@/modules/chat/components/rail/railTypes'
import { describeBackgroundActivity } from '../../background/chat-extension/railContribution.ts'
import { describeSkillActivity } from '../../skill/chat-extension/railContribution.ts'
import {
  BIO_TOOL_NAMES,
  describeBioActivity,
  describeControlActivity,
  describeToolResultActivity,
} from './railContribution.ts'

/**
 * TEST-31 (ITEM-20 + ITEM-28) — the built-in MCP families that have no renderer
 * of their own: `background_mcp`, `control_mcp`, `skill_mcp`, `tool_result_mcp`,
 * and (fixture-derived) `bio_mcp`.
 *
 * Every tool name asserted here was read from the server, not invented:
 *   background_mcp  server/src/modules/background_mcp/tools.rs:47,87,98
 *   control_mcp     sdk/crates/ziee-control-mcp/src/tools.rs:5-7
 *   skill_mcp       server/src/modules/skill_mcp/tools.rs:30,44
 *   tool_result_mcp server/src/modules/tool_result_mcp/tools.rs:8
 *   bio_mcp         server/tests/bio_mcp/tool_names_fixture.json (LIVE probe)
 *
 * The `structuredContent` payloads are likewise the real ones (cited per case).
 * Each family is also asserted to survive a MISSING payload with a name-only row
 * (ITEM-6) — the backend's `cap_structured_content` drops oversized payloads
 * outright, and the bio sidecar never sends one at all.
 */

type Describe = (ctx: RailActivityContext) => ReturnType<typeof describeBioActivity>

const use = (id: string, name: string, input: unknown = {}): MessageContent =>
  ({
    id: `blk-${id}`,
    content_type: 'tool_use',
    content: { type: 'tool_use', id, name, input, server_id: 'srv' },
  }) as unknown as MessageContent

const result = (useId: string, name: string, structured?: unknown): MessageContent =>
  ({
    id: `res-${useId}`,
    content_type: 'tool_result',
    content: {
      type: 'tool_result',
      tool_use_id: useId,
      name,
      content: 'ok',
      is_error: false,
      ...(structured !== undefined ? { structured_content: structured } : {}),
    },
  }) as unknown as MessageContent

/** Run `describe` over a one-call message. */
function step(
  describe: Describe,
  name: string,
  structured?: unknown,
  input: unknown = {},
) {
  const blocks = [use('u1', name, input), result('u1', name, structured)]
  return describe({ content: blocks[0], blocks, index: 0 })
}

// ── background_mcp ──────────────────────────────────────────────────────────

test('background_mcp: all three tools are claimed and relabelled', () => {
  // spawn_background → {run_id, kind, status, note}  (tools.rs:251-256)
  const spawn = step(describeBackgroundActivity, 'spawn_background', {
    run_id: 'r1',
    kind: 'subagent',
    status: 'pending',
  })
  assert.equal(spawn?.label, 'Starting background work')
  assert.equal(spawn?.detail, 'sub-agent')

  // check_status → {run_id, kind, status, terminal, current_step, ...} (tools.rs:764-772)
  const status = step(describeBackgroundActivity, 'check_status', {
    run_id: 'r1',
    status: 'running',
    current_step: 'drafting',
  })
  assert.equal(status?.label, 'Checking on background work')
  assert.equal(status?.detail, 'running · drafting')

  // collect_result → {run_id, status, complete, final_output_chunk, total_chars, truncated}
  //                                                                 (tools.rs:828-837)
  const collect = step(describeBackgroundActivity, 'collect_result', {
    run_id: 'r1',
    status: 'completed',
    complete: true,
    total_chars: 1234,
    truncated: false,
  })
  assert.equal(collect?.label, 'Collecting the background result')
  assert.equal(collect?.detail, '1,234 chars')
})

test('background_mcp: a sandbox_exec spawn is named as such', () => {
  const s = step(describeBackgroundActivity, 'spawn_background', { kind: 'sandbox_exec' })
  assert.equal(s?.detail, 'sandbox command')
})

test('background_mcp: an unfinished collect_result says so', () => {
  // tools.rs:789-794 — the not-yet-terminal shape.
  const s = step(describeBackgroundActivity, 'collect_result', {
    run_id: 'r1',
    status: 'running',
    complete: false,
  })
  assert.equal(s?.detail, 'still running')
})

test('background_mcp: declines a tool it does not own', () => {
  assert.equal(step(describeBackgroundActivity, 'web_search', { results: [] }), null)
})

// ── control_mcp ─────────────────────────────────────────────────────────────

test('control_mcp: all three capability tools are claimed and relabelled', () => {
  // list_capabilities → {operations, returned, total, truncated} (handlers.rs:562-567)
  const list = step(describeControlActivity, 'list_capabilities', {
    operations: [{ operation_id: 'a' }],
    returned: 1,
    total: 7,
    truncated: false,
  })
  assert.equal(list?.label, 'Looking up what it can do in ziee')
  assert.equal(list?.detail, '7 operations')

  // describe_capability → {operation_id, method, path_template, ...} (handlers.rs:614-625)
  const describe = step(describeControlActivity, 'describe_capability', {
    operation_id: 'create_project',
    method: 'POST',
    path_template: '/api/projects',
  })
  assert.equal(describe?.label, 'Reading a ziee operation')
  assert.equal(describe?.detail, 'create_project')

  // invoke_capability → {operation_id, status, ok, truncated, response} (handlers.rs:723-729)
  const invoke = step(describeControlActivity, 'invoke_capability', {
    operation_id: 'create_project',
    status: 201,
    ok: true,
    truncated: false,
    response: {},
  })
  assert.equal(invoke?.label, 'Running a ziee operation')
  assert.equal(invoke?.detail, 'create_project → HTTP 201')
})

test('control_mcp: a single operation is not pluralised', () => {
  const s = step(describeControlActivity, 'list_capabilities', { total: 1 })
  assert.equal(s?.detail, '1 operation')
})

test('control_mcp: declines a tool it does not own', () => {
  assert.equal(step(describeControlActivity, 'load_skill', { name: 'x' }), null)
})

// ── skill_mcp ───────────────────────────────────────────────────────────────

test('skill_mcp: both tools are claimed, and the reverse-DNS name is shortened', () => {
  // load_skill → {name, content} (skill_mcp/tools.rs:91)
  const load = step(describeSkillActivity, 'load_skill', {
    name: 'io.github.ziee/configure-llm-providers',
    content: '# body',
  })
  assert.equal(load?.label, 'Loading a skill')
  assert.equal(load?.detail, 'configure-llm-providers')

  // read_skill_file → {name, path, content} (skill_mcp/tools.rs:164,179)
  const read = step(describeSkillActivity, 'read_skill_file', {
    name: 'io.github.ziee/configure-llm-providers',
    path: 'references/foo.md',
    content: 'x',
  })
  assert.equal(read?.label, 'Reading a skill file')
  assert.equal(read?.detail, 'references/foo.md · configure-llm-providers')
})

test('skill_mcp: declines a tool it does not own', () => {
  assert.equal(step(describeSkillActivity, 'get_tool_result', { total_chars: 1 }), null)
})

// ── tool_result_mcp ─────────────────────────────────────────────────────────

test('tool_result_mcp: get_tool_result reports its paging window', () => {
  // {tool_use_id, total_chars, offset, returned_chars, has_more} (handlers.rs:235-243)
  const paged = step(describeToolResultActivity, 'get_tool_result', {
    tool_use_id: 'earlier',
    total_chars: 40000,
    offset: 0,
    returned_chars: 8000,
    has_more: true,
  })
  assert.equal(paged?.label, 'Re-reading an earlier tool result')
  assert.equal(paged?.detail, '8,000 of 40,000 chars')

  const whole = step(describeToolResultActivity, 'get_tool_result', {
    tool_use_id: 'earlier',
    total_chars: 120,
    offset: 0,
    returned_chars: 120,
    has_more: false,
  })
  assert.equal(whole?.detail, '120 chars')
})

test('tool_result_mcp: declines a tool it does not own', () => {
  assert.equal(step(describeToolResultActivity, 'check_status', { status: 'x' }), null)
})

// ── bio_mcp (fixture-derived — DEC-10 / ITEM-28) ─────────────────────────────

test('bio_mcp: the fixture surface is exactly the single observed tool', () => {
  // The live `tools/list` probe of biomcp 0.8.23 returned ONE tool. Anything
  // beyond it must come from a re-probe + a fixture update, never from a guess.
  assert.deepEqual([...BIO_TOOL_NAMES], ['biomcp'])
})

test('bio_mcp: the step is derived from the tool INPUT, since the sidecar sends no structuredContent', () => {
  const s = step(describeBioActivity, 'biomcp', undefined, {
    command: 'search trial -c melanoma',
  })
  assert.equal(s?.label, 'Searching biomedical databases')
  assert.equal(s?.detail, 'search trial -c melanoma')
})

test('bio_mcp: a long command is ellipsised, never wrapped into the label', () => {
  const long = `search article -k ${'x'.repeat(120)}`
  const s = step(describeBioActivity, 'biomcp', undefined, { command: long })
  assert.ok(s?.detail)
  assert.ok(s.detail.length <= 64, `detail was ${s.detail.length} chars`)
  assert.ok(s.detail.endsWith('…'))
  assert.equal(s.label, 'Searching biomedical databases')
})

test('bio_mcp: a name absent from the fixture is declined (degrades to name-only)', () => {
  assert.equal(step(describeBioActivity, 'article_searcher', undefined, {}), null)
})

// ── ITEM-6 across every family ──────────────────────────────────────────────

test('every family degrades to a NAME-ONLY row when structured_content is absent', () => {
  const cases: Array<[string, Describe, string, string]> = [
    ['background', describeBackgroundActivity, 'spawn_background', 'Starting background work'],
    ['background', describeBackgroundActivity, 'check_status', 'Checking on background work'],
    ['background', describeBackgroundActivity, 'collect_result', 'Collecting the background result'],
    ['control', describeControlActivity, 'list_capabilities', 'Looking up what it can do in ziee'],
    ['control', describeControlActivity, 'describe_capability', 'Reading a ziee operation'],
    ['control', describeControlActivity, 'invoke_capability', 'Running a ziee operation'],
    ['skill', describeSkillActivity, 'load_skill', 'Loading a skill'],
    ['skill', describeSkillActivity, 'read_skill_file', 'Reading a skill file'],
    ['tool_result', describeToolResultActivity, 'get_tool_result', 'Re-reading an earlier tool result'],
    ['bio', describeBioActivity, 'biomcp', 'Searching biomedical databases'],
  ]
  for (const [family, describe, name, label] of cases) {
    const s = step(describe, name)
    assert.ok(s, `${family}/${name} must still yield a row`)
    assert.equal(s.label, label, `${family}/${name} label`)
    assert.equal(s.detail, undefined, `${family}/${name} must carry no detail`)
    assert.equal(s.key, 'u1')
  }
})

test('no describeActivity throws on a hostile / malformed payload', () => {
  const describers: Describe[] = [
    describeBackgroundActivity,
    describeControlActivity,
    describeSkillActivity,
    describeToolResultActivity,
    describeBioActivity,
  ]
  const names = [
    'spawn_background',
    'check_status',
    'collect_result',
    'list_capabilities',
    'describe_capability',
    'invoke_capability',
    'load_skill',
    'read_skill_file',
    'get_tool_result',
    'biomcp',
  ]
  const payloads: unknown[] = [null, undefined, 0, '', 'text', [], [1, 2], { tool_name: 5 }]
  for (const describe of describers) {
    for (const name of names) {
      for (const p of payloads) {
        assert.doesNotThrow(
          () => step(describe, name, p, p),
          `${name} with payload ${JSON.stringify(p)}`,
        )
      }
    }
  }
})
