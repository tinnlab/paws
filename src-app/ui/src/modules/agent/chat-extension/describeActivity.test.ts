import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { MessageContent } from '@/api-client/types'
import { segmentRail } from '@/modules/chat/components/rail/railSegmentation'
import {
  setRailLiveSource,
  __resetRailLiveSourceForTests,
} from '@/modules/chat/core/rail/liveSteps'
import { describeAgentActivity } from './railContribution.ts'

/**
 * TEST-32 (ITEM-21) — the agent loop's six CORE META-TOOLS.
 *
 * The names + payload shapes asserted here are the ones the loop really emits:
 * `agent-core/src/core_tools.rs` (`delegate`, `schedule_next`) and
 * `agent-core/src/tasklist.rs` (`task_create/update/get/list`). `delegate` and
 * `schedule_next` return `structured_content: None`, which is why their
 * name-only degradation is asserted as a first-class case, not an edge case.
 */

const use = (id: string, name: string, input: unknown = {}): MessageContent =>
  ({
    id: `blk-${id}`,
    content_type: 'tool_use',
    content: { type: 'tool_use', id, name, input, server_id: 'agent-core' },
  }) as unknown as MessageContent

const result = (
  useId: string,
  name: string,
  structured?: unknown,
): MessageContent =>
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

/** Describe the block at `index` of `blocks` through the agent contribution. */
const describe = (blocks: MessageContent[], index = 0) =>
  describeAgentActivity({ content: blocks[index], blocks, index })

const task = (content: string, status: string, activeForm?: string) => ({
  id: `t-${content}`,
  content,
  active_form: activeForm ?? `${content}ing`,
  status,
})

// ── all six meta-tools yield a step ─────────────────────────────────────────

test('every agent meta-tool yields a step with a human label', () => {
  const cases: Array<[string, unknown]> = [
    ['delegate', undefined],
    ['schedule_next', undefined],
    ['task_create', { tasks: [task('Run tests', 'pending')] }],
    ['task_update', { tasks: [task('Run tests', 'completed')] }],
    ['task_get', { task: task('Run tests', 'in_progress') }],
    ['task_list', { tasks: [task('Run tests', 'pending')] }],
  ]
  for (const [name, structured] of cases) {
    const blocks = [use('u1', name, {}), result('u1', name, structured)]
    const step = describe(blocks)
    assert.ok(step, `${name} must be claimed by the agent contribution`)
    assert.notEqual(
      step.label,
      name,
      `${name} must be relabelled into domain language, not left as the raw tool id`,
    )
    assert.ok(step.label.trim().length > 0, `${name} label must be non-empty`)
    assert.equal(step.key, 'u1', `${name} step identity must be the tool_use_id`)
  }
})

test('a tool that is not a core meta-tool is declined (falls through)', () => {
  const blocks = [use('u1', 'web_search'), result('u1', 'web_search', { results: [] })]
  assert.equal(describe(blocks), null)
})

// ── ITEM-6: delegate / schedule_next carry NO structured_content ─────────────

test('delegate degrades to a name-only row when it has no structured_content', () => {
  // `core_tools.rs:446` — handle_delegate returns `structured_content: None`.
  const blocks = [use('u1', 'delegate', {}), result('u1', 'delegate')]
  const step = describe(blocks)
  assert.ok(step)
  assert.equal(step.label, 'Delegating to sub-agents')
  assert.equal(step.detail, undefined, 'no structured content ⇒ no detail')
  assert.equal(step.status, 'success')
})

test('schedule_next degrades to a name-only row when it has no structured_content or input', () => {
  // `core_tools.rs:380` — handle_schedule_next returns `structured_content: None`.
  const blocks = [use('u1', 'schedule_next', null), result('u1', 'schedule_next')]
  const step = describe(blocks)
  assert.ok(step)
  assert.equal(step.label, 'Scheduling its next run')
  assert.equal(step.detail, undefined)
})

test('delegate still names its child count when the INPUT carries one', () => {
  const blocks = [
    use('u1', 'delegate', { children: [{ system: 'a' }, { system: 'b' }] }),
    result('u1', 'delegate'),
  ]
  assert.equal(describe(blocks)?.detail, '2 sub-agents')
})

test('schedule_next reads stop / delay from its INPUT', () => {
  const stopped = [use('u1', 'schedule_next', { stop: true }), result('u1', 'schedule_next')]
  assert.equal(describe(stopped)?.detail, 'finished — will not run again')

  const delayed = [
    use('u2', 'schedule_next', { delay_seconds: 300 }),
    result('u2', 'schedule_next'),
  ]
  assert.equal(describe(delayed)?.detail, 'in ~5 min')
})

test('a malformed input never throws — it degrades', () => {
  for (const bad of [undefined, null, 'a string', 42, ['an', 'array']]) {
    const blocks = [use('u1', 'delegate', bad), result('u1', 'delegate')]
    assert.doesNotThrow(() => describe(blocks))
    assert.equal(describe(blocks)?.detail, undefined)
  }
})

// ── task tools read the real `{tasks}` / `{task}` payloads ───────────────────

test('task_update summarises progress from the {tasks} payload', () => {
  const blocks = [
    use('u1', 'task_update', { id: 't-1', status: 'completed' }),
    result('u1', 'task_update', {
      tasks: [
        task('Run tests', 'completed'),
        task('Ship it', 'in_progress', 'Shipping it'),
        task('Write docs', 'pending'),
      ],
    }),
  ]
  const step = describe(blocks)
  assert.equal(step?.label, 'Updating the task list')
  assert.equal(step?.detail, 'Shipping it · 1 of 3 done')
})

test('task_get names the task it read', () => {
  const blocks = [
    use('u1', 'task_get', { id: 't-1' }),
    result('u1', 'task_get', { task: task('Run tests', 'pending') }),
  ]
  assert.equal(describe(blocks)?.detail, 'Run tests')
})

test('a task tool whose structured_content was dropped still yields a row', () => {
  // `cap_structured_content` DROPS an oversized payload rather than truncating it.
  const blocks = [use('u1', 'task_list'), result('u1', 'task_list')]
  const step = describe(blocks)
  assert.ok(step)
  assert.equal(step.label, 'Reviewing the task list')
  assert.equal(step.detail, undefined)
})

// ── DE-DUP: one step, never two ─────────────────────────────────────────────

test('a task_update accompanied by a live task-list snapshot produces exactly ONE step', t => {
  // The backend reports a task-list change TWICE: as the persisted `task_update`
  // tool call (structured_content `{tasks}`), and as an ephemeral
  // `taskListChanged` SSE frame carrying the same snapshot. The contribution
  // suppresses the FRAME side — it registers no step producer for it — so live
  // information reaches the rail only through the core-owned live-step seam,
  // which merges INTO the step keyed by `tool_use_id`.
  const tasks = [task('Run tests', 'completed'), task('Ship it', 'pending')]
  const blocks = [
    use('u1', 'task_update', { id: 't-1', status: 'completed' }),
    result('u1', 'task_update', { tasks }),
  ]

  // Stand in for the live frame arriving for the SAME turn.
  setRailLiveSource({
    get: id => (id === 'u1' ? { status: 'completed', durationMs: 12 } : null),
    // Static source: nothing ever changes, so unsubscribing is a no-op.
    subscribe: () => () => undefined,
  })
  t.after(() => __resetRailLiveSourceForTests())

  const segments = segmentRail(blocks, describeAgentActivity)
  const steps = segments.flatMap(s => (s.kind === 'span' ? s.steps : []))

  assert.equal(steps.length, 1, 'the live frame must NOT spawn a second step')
  assert.equal(steps[0].step.key, 'u1')
  assert.equal(steps[0].step.label, 'Updating the task list')
  assert.equal(steps[0].step.detail, '1 of 2 done')
  // The live data merged into that one step rather than creating another.
  assert.equal(steps[0].step.durationMs, 12)
  // And the pair of blocks is owned by that single step (no stray prose row).
  assert.equal(steps[0].step.consumed, 2)
  assert.equal(segments.length, 1)
})

test('two DISTINCT task calls still produce two steps (the de-dup is not over-broad)', () => {
  const blocks = [
    use('u1', 'task_create', {}),
    result('u1', 'task_create', { tasks: [task('A', 'pending')] }),
    use('u2', 'task_update', {}),
    result('u2', 'task_update', { tasks: [task('A', 'completed')] }),
  ]
  const steps = segmentRail(blocks, describeAgentActivity).flatMap(s =>
    s.kind === 'span' ? s.steps : [],
  )
  assert.deepEqual(
    steps.map(s => s.step.key),
    ['u1', 'u2'],
  )
})
