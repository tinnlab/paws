import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TOOL_STATUS, type ToolStatusKey } from '@/modules/chat/core/tool-status'
import { railSummary } from './railView.ts'

// TEST-9 [acceptance] [invariant: INV-9] (ITEM-4).
//
// INV-9: "There is exactly one status vocabulary; the rail reuses the existing
// one rather than defining a second."
//
// Two halves. (1) every status the rail can PRODUCE is a member of the existing
// `ToolStatusKey` union — proven by driving the only rail code path that CHOOSES
// a status, `railSummary`. (2) the rail SOURCE declares no status string literal
// of its own — proven by reading the shipped files, because a second vocabulary
// would most likely arrive as a stray literal rather than a new type.

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(HERE, '../../../..')

const KEYS = Object.keys(TOOL_STATUS) as ToolStatusKey[]

test('the six canonical statuses are the only vocabulary', () => {
  assert.deepEqual(
    [...KEYS].sort(),
    ['cancelled', 'failed', 'pending-approval', 'running', 'success', 'timeout'],
  )
})

test('TEST-9 [acceptance][INV-9]: every status railSummary can emit is a ToolStatusKey', () => {
  // Drive every single-status span plus every pair, and assert the summary's
  // chosen status is always a member of the existing union.
  const mk = (status: ToolStatusKey) => ({
    index: 0,
    step: { key: `k-${status}`, label: 'l', status, consumed: 1 },
  })
  for (const a of KEYS) {
    assert.ok(KEYS.includes(railSummary([mk(a)]).status))
    for (const b of KEYS) {
      const chosen = railSummary([mk(a), mk(b)]).status
      assert.ok(KEYS.includes(chosen), `railSummary emitted a non-canonical status: ${chosen}`)
      assert.ok([a, b].includes(chosen), 'the summary must pick one of the statuses present')
    }
  }
})

test('TEST-9 [acceptance][INV-9]: a collapsed summary can never read "Completed" over a failure', () => {
  // This is the operational bite of INV-9 + INV-5 together: one vocabulary is
  // pointless if the summary picks the friendliest member.
  const mk = (status: ToolStatusKey) => ({
    index: 0,
    step: { key: `k-${status}`, label: 'l', status, consumed: 1 },
  })
  assert.equal(railSummary([mk('success'), mk('failed')]).status, 'failed')
  assert.equal(railSummary([mk('success'), mk('timeout')]).status, 'timeout')
  assert.equal(railSummary([mk('success'), mk('running')]).status, 'running')
  assert.equal(railSummary([mk('failed'), mk('timeout')]).status, 'failed')
})

test('TEST-9 [acceptance][INV-9]: the rail source declares no status string of its own', () => {
  const files: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) {
        walk(p)
        continue
      }
      if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(p)
    }
  }
  walk(join(SRC, 'modules/chat/components/rail'))

  const allowed = new Set<string>(KEYS)
  const violations: string[] = []
  for (const f of files) {
    const code = readFileSync(f, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      // A kit `tone=` is the DESIGN-SYSTEM's semantic-color vocabulary
      // (`success|error|warning|default|primary`), not a tool-status vocabulary —
      // `TOOL_STATUS` itself maps each status ONTO one of those tones. Scanning
      // it would flag the very indirection INV-9 asks for.
      .replace(/\btone=("[^"]*"|\{[^}]*\})/g, 'tone=…')
    // Any string literal that LOOKS like a status but is not a canonical member.
    for (const m of code.matchAll(/['"]([a-z][a-z-]{2,20})['"]/g)) {
      const lit = m[1]
      if (allowed.has(lit)) continue
      // A status-shaped word that is NOT in the union would be a second vocabulary.
      if (/^(ok|error|done|pending|complete|completed|errored|skipped|warn|warning|aborted|crashed|fail)$/.test(lit)) {
        violations.push(`${f.replace(SRC + '/', '')} uses "${lit}"`)
      }
    }
  }
  assert.deepEqual(violations, [], violations.join('\n'))
})
