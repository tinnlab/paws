import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { RailStepDescriptor } from '@/modules/chat/components/rail/railTypes'
import {
  type AgentActivityEntry,
  type RailStepResolver,
  describeActivity,
  phraseForTool,
  railContextForTool,
} from './activityDescriptors.ts'

// TEST-35 [covers ITEM-23] — the centralized tool map is GONE.
//
// `activityDescriptors.ts` used to hold `TOOL_ACTIVITY_PHRASES`, a map in which
// this ONE module hardcoded NINE other modules' tool names. That map is the
// anti-pattern the activity rail exists to delete, so this spec asserts two
// things: the module's source names none of those tools, and the label now
// comes from the rail contribution registry.

const HERE = dirname(fileURLToPath(import.meta.url))

const entry = (over: Partial<AgentActivityEntry>): AgentActivityEntry =>
  ({
    type: 'agent_activity',
    title: '',
    kind: 'tool_call',
    seq: 1,
    status: 'running',
    tool: null,
    ...over,
  }) as AgentActivityEntry

/** A stub registry resolver, standing in for `chatExtensionRegistry`. */
function resolverFor(labels: Record<string, string>): RailStepResolver {
  return ctx => {
    const name = (ctx.content.content as { name?: string }).name ?? ''
    const label = labels[name]
    if (!label) return null
    return {
      key: name,
      label,
      status: 'running',
      consumed: 1,
    } satisfies RailStepDescriptor
  }
}

// ── the map is gone ────────────────────────────────────────────────────────
test('TEST-35: no central tool-name map remains — the module names ZERO other modules tools', () => {
  // The exact nine tool ids the deleted `TOOL_ACTIVITY_PHRASES` hardcoded.
  const otherModulesTools = [
    'web_search',
    'literature_search',
    'fetch_url',
    'fetch_paper_fulltext',
    'code_sandbox',
    'execute_command',
    'search_knowledge',
    'remember',
    'recall',
    'biomcp',
  ]
  const source = readFileSync(join(HERE, 'activityDescriptors.ts'), 'utf8')
  // Comments that NAME the anti-pattern being removed are documentation, not
  // coupling — strip them before asserting, exactly as railIsolation.test.ts does.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

  const named = otherModulesTools.filter(t => code.includes(t))
  assert.deepEqual(named, [], `activityDescriptors.ts still names: ${named.join(', ')}`)
  assert.ok(
    !code.includes('TOOL_ACTIVITY_PHRASES'),
    'the central TOOL_ACTIVITY_PHRASES map must be deleted, not renamed',
  )
})

test('TEST-35: `titleCaseToolId` is imported from the rail, not re-declared here', () => {
  const source = readFileSync(join(HERE, 'activityDescriptors.ts'), 'utf8')
  assert.match(
    source,
    /import\s*\{[^}]*titleCaseToolId[^}]*\}\s*from\s*'@\/modules\/chat\/components\/rail\/railBlocks'/,
    'the mechanism moved to railBlocks; this module must import it',
  )
  assert.doesNotMatch(
    source,
    /export function titleCaseToolId/,
    'a local copy of titleCaseToolId is a second source of truth',
  )
})

// ── labels resolve THROUGH the registry ───────────────────────────────────
test('TEST-35: the label is resolved through the rail contribution registry', () => {
  const resolve = resolverFor({ web_search: 'Searching the web' })
  assert.equal(phraseForTool('web_search', resolve), 'Searching the web')
  assert.equal(describeActivity(entry({ tool: 'web_search' }), resolve), 'Searching the web')
})

test('TEST-35: the adapter hands the registry a minimal tool_use-shaped block', () => {
  const ctx = railContextForTool('search_knowledge')
  assert.equal(ctx.content.content_type, 'tool_use')
  assert.equal((ctx.content.content as { name?: string }).name, 'search_knowledge')
  // An entry carries no arguments and no result, so contributions take their
  // structuredContent-absent path (ITEM-6).
  assert.deepEqual((ctx.content.content as { input?: unknown }).input, {})
  assert.equal(ctx.index, 0)
  assert.deepEqual(ctx.blocks, [ctx.content])
})

test('TEST-35: a tool NO contribution claims falls back to a title-cased id', () => {
  const resolve = resolverFor({})
  assert.equal(phraseForTool('run_forecast', resolve), 'Run Forecast')
  assert.equal(phraseForTool('some-weird.tool_id', resolve), 'Some Weird Tool Id')
})

test('TEST-35: a throwing contribution degrades the label, never the timeline', () => {
  const resolve: RailStepResolver = () => {
    throw new Error('broken contribution')
  }
  assert.equal(phraseForTool('run_forecast', resolve), 'Run Forecast')
})

test('TEST-35: with no resolver at all the module still produces a readable line', () => {
  assert.equal(phraseForTool('run_forecast'), 'Run Forecast')
  assert.equal(phraseForTool(''), 'Working…')
  assert.equal(phraseForTool('   '), 'Working…')
  assert.equal(phraseForTool(null), 'Working…')
  assert.equal(phraseForTool(undefined), 'Working…')
})

// ── the pre-existing precedence rule survives ─────────────────────────────
test('TEST-35: a non-blank backend `title` still wins over the registry label', () => {
  const resolve = resolverFor({ web_search: 'Searching the web' })
  assert.equal(
    describeActivity(entry({ title: 'Cross-checking dosages', tool: 'web_search' }), resolve),
    'Cross-checking dosages',
  )
  // whitespace-only title is treated as blank
  assert.equal(
    describeActivity(entry({ title: '   ', tool: 'web_search' }), resolve),
    'Searching the web',
  )
})

test('TEST-35: no title and no tool -> Working…', () => {
  assert.equal(describeActivity(entry({ title: '', tool: null })), 'Working…')
})

// ── the timeline is wired to the REAL registry ────────────────────────────
test('TEST-35: AgentActivityTimeline resolves labels through chatExtensionRegistry', () => {
  const source = readFileSync(join(HERE, 'AgentActivityTimeline.tsx'), 'utf8')
  assert.match(
    source,
    /import\s*\{\s*chatExtensionRegistry\s*\}\s*from\s*'@\/modules\/chat\/core\/extensions'/,
    'the timeline must take its labels from the contribution registry',
  )
  assert.match(source, /chatExtensionRegistry\.resolveRailStep\(/)
  // ...and actually pass that resolver into describeActivity.
  assert.match(source, /describeActivity\(entry,\s*resolveRailStep\)/)
})
