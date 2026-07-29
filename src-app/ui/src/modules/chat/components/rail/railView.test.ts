import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  clampLabel,
  formatElapsed,
  railStateKey,
  railSummary,
  splitArtifacts,
  stepAccessibleName,
  stepStateKey,
  stepTiming,
  toolCallTabId,
} from './railView.ts'
import { RAIL_LIMITS, type RailStepDescriptor } from './railTypes.ts'

// TEST-14 (ITEM-3): the ROW's behaviour — label, detail, status, timing,
// truncation and accessible name.
//
// NOTE ON FORM (recorded as a drift in DRIFT-1.md): `TESTS.md` specified this as
// a `.tsx` component-render spec. This workspace's unit runner is
// `node --test "src/**/*.test.ts"` with type-stripping only; it cannot parse JSX
// and there is no jsdom/Testing-Library harness here (zero `.test.tsx` files
// exist in the tree). Rather than add a second runner, every decision the row
// makes was extracted into the pure `railView.ts` and is asserted here, and the
// RENDERED row — single-line truncation at 390px, the accessible name, the
// status dot — is asserted in the browser by TEST-8 and TEST-2. That is a
// stronger proof of the rendering than a jsdom render would be, not a weaker one.

const step = (over: Partial<RailStepDescriptor> = {}): RailStepDescriptor => ({
  key: 'k',
  label: 'Searching the web',
  status: 'success',
  consumed: 1,
  ...over,
})

test('formatElapsed: seconds, minutes, hours — and never renders a bare 0s', () => {
  assert.equal(formatElapsed(1), '1s')
  assert.equal(formatElapsed(0), '1s')
  assert.equal(formatElapsed(12_400), '12s')
  assert.equal(formatElapsed(64_000), '1m 04s')
  assert.equal(formatElapsed(3_723_000), '1h 02m')
  assert.equal(formatElapsed(-5), '')
  assert.equal(formatElapsed(Number.NaN), '')
})

test('stepTiming: a finished step shows its duration; a running step ticks from startedAt (DEC-9)', () => {
  const now = Date.parse('2026-07-27T12:00:30Z')
  assert.equal(stepTiming(step({ durationMs: 12_000 }), now), '12s')
  assert.equal(
    stepTiming(step({ status: 'running', startedAt: '2026-07-27T12:00:00Z' }), now),
    '30s',
  )
  // A final duration always wins over a start instant.
  assert.equal(
    stepTiming(step({ durationMs: 3_000, startedAt: '2026-07-27T12:00:00Z' }), now),
    '3s',
  )
  // Nothing known → no timing text at all (rather than a misleading 0s).
  assert.equal(stepTiming(step(), now), '')
  assert.equal(stepTiming(step({ startedAt: 'not-a-date' }), now), '')
})

test('clampLabel: collapses whitespace, bounds length, and never yields an empty row', () => {
  assert.equal(clampLabel('  Searching   the web \n'), 'Searching the web')
  assert.equal(clampLabel(''), 'Working…')
  assert.equal(clampLabel('   '), 'Working…')
  const long = 'x'.repeat(RAIL_LIMITS.labelMaxChars + 50)
  const out = clampLabel(long)
  assert.equal(out.length, RAIL_LIMITS.labelMaxChars)
  assert.ok(out.endsWith('…'), 'an over-long label is ellipsised, not silently cut')
})

test('splitArtifacts: caps chips at RAIL_LIMITS and reports the overflow count', () => {
  const arts = Array.from({ length: 7 }, (_, i) => ({ key: `k${i}`, name: `f${i}.csv` }))
  const { shown, overflow } = splitArtifacts(arts)
  assert.equal(shown.length, RAIL_LIMITS.artifactChips)
  assert.equal(overflow, 7 - RAIL_LIMITS.artifactChips)
  assert.deepEqual(splitArtifacts(undefined), { shown: [], overflow: 0 })
  assert.deepEqual(splitArtifacts([]), { shown: [], overflow: 0 })
})

test('stepAccessibleName: status FIRST, then label, detail and timing', () => {
  // A screen-reader user must hear "Failed" before the tool name, not after
  // scrubbing to the end of the line.
  assert.equal(
    stepAccessibleName(step({ status: 'failed', detail: '2 results' }), '12s'),
    'Failed, Searching the web, 2 results, 12s',
  )
  assert.equal(stepAccessibleName(step(), ''), 'Completed, Searching the web')
})

test('railSummary: counts steps and files, and sums KNOWN per-step durations', () => {
  const p = (over: Partial<RailStepDescriptor>) => ({ index: 0, step: step(over) })
  const s = railSummary([
    p({ key: 'a', durationMs: 8_000, artifacts: [{ key: 'f1', name: 'a.csv' }] }),
    p({ key: 'b', durationMs: 4_000 }),
    p({ key: 'c', artifacts: [{ key: 'f2', name: 'b.png' }, { key: 'f3', name: 'c.png' }] }),
  ])
  assert.equal(s.status, 'success')
  assert.equal(s.text, 'Worked for 12s · 3 steps · 3 files')
})

test('railSummary: with no timing known it still reads sensibly, and a live rail says "Working"', () => {
  const p = (over: Partial<RailStepDescriptor>) => ({ index: 0, step: step(over) })
  assert.equal(railSummary([p({})]).text, 'Worked · 1 step')
  assert.equal(railSummary([p({ status: 'running' })]).text, 'Working · 1 step')
})

test('view-state keys are message-scoped, and the panel tab id is derived from tool_use_id (DEC-8)', () => {
  // Message scoping is what lets a conversation switch evict exactly one
  // conversation's rail state without touching another split pane's.
  assert.equal(railStateKey('m1', 'toolu_1'), 'm1#toolu_1')
  assert.equal(stepStateKey('m1', 'toolu_9'), 'm1#step#toolu_9')
  assert.ok(railStateKey('m1', 'toolu_1').startsWith('m1#'))
  assert.ok(stepStateKey('m1', 'toolu_9').startsWith('m1#'))
  // Deterministic tab id ⇒ re-opening a step focuses its tab instead of stacking.
  assert.equal(toolCallTabId('toolu_9'), 'tool:toolu_9')
  assert.equal(toolCallTabId('toolu_9'), toolCallTabId('toolu_9'))
})
