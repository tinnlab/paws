import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * TEST-9 — INV-4 (acceptance).
 *
 * "EXCLUDE two endpoints owned by another agent right now:
 *  `/api/projects/by-conversation/{id}` (N+1) and `/api/llm-models`
 *  (duplicate ×3) — do NOT touch those two fixes."
 *
 * Those fixes live on `feat/live-ui-audit-fixes` (a batch by-conversation
 * endpoint + an OpenAPI regen + the llm-models caller de-dup). This branch must
 * be mechanically incapable of colliding with them, so the invariant is asserted
 * against the real diff rather than trusted.
 *
 * It would FAIL the moment this branch edited either owner's surface — which is
 * exactly the property "I did not touch it" needs to be provable rather than
 * claimed.
 *
 *   node --test .lifecycle/net-hygiene/tests/excluded-endpoints.test.mjs
 *   BASE=<ref> node --test .lifecycle/net-hygiene/tests/excluded-endpoints.test.mjs
 */

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const BASE = process.env.BASE ?? '60b0db310'

const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

/** The `sdk` SUBMODULE holds most of this branch's diff, and a submodule shows
 *  up in the superproject as a single pointer change — so scanning only the
 *  superproject would silently miss every framework edit. Each entry is
 *  `{repo, path}` so both trees are checked with one code path. */
const SDK = join(REPO, 'sdk')
const SDK_BASE = process.env.SDK_BASE ?? '01a96b7'

const changedFiles = () => {
  const out = []
  const collect = (repo, base, prefix) => {
    for (const f of git(repo, 'diff', '--name-only', `${base}...HEAD`).split('\n')) {
      const name = f.trim()
      if (!name) continue
      // Lifecycle artifacts are process records, stripped at merge — the DESIGN /
      // PLAN / this very test legitimately NAME the excluded endpoints.
      if (name.startsWith('.lifecycle/')) continue
      // The submodule POINTER itself is not a content change.
      if (name === 'sdk') continue
      out.push({ display: prefix + name, abs: join(repo, name) })
    }
  }
  collect(REPO, BASE, '')
  if (existsSync(join(SDK, '.git'))) collect(SDK, SDK_BASE, 'sdk/')
  return out
}

/** Endpoint markers owned by the other agent's fix. */
const OWNED_MARKERS = [
  'by-conversation',
  'byConversation',
  'llm-models',
  'llmModels',
  'LlmModel.list',
]

/** Mechanically-generated / contract files their branch regenerates. */
const OWNED_GENERATED = [
  'openapi/openapi.json',
  'api-client/apiEndpoints.ts',
  'api-client/types.ts',
]

test('TEST-9 [acceptance/INV-4]: no changed file touches the excluded endpoints', () => {
  const offenders = []
  for (const { display, abs } of changedFiles()) {
    if (!existsSync(abs)) continue // deleted file
    let text
    try {
      text = readFileSync(abs, 'utf8')
    } catch {
      continue // binary
    }
    const hit = OWNED_MARKERS.filter(m => text.includes(m))
    if (hit.length) offenders.push(`${display} → ${hit.join(', ')}`)
  }
  assert.deepEqual(
    offenders,
    [],
    'this branch must not edit a file that references the excluded endpoints:\n' +
      offenders.join('\n'),
  )
})

test('TEST-9 [acceptance/INV-4]: no generated api-contract file is regenerated here', () => {
  const offenders = changedFiles()
    .map(c => c.display)
    .filter(f => OWNED_GENERATED.some(g => f.endsWith(g)))
  assert.deepEqual(
    offenders,
    [],
    'an openapi/api-client regen on this branch would collide with the ' +
      'concurrent branch that owns the by-conversation batch endpoint:\n' +
      offenders.join('\n'),
  )
})

test('TEST-9: no server-side code is touched at all (this is a client-only fix)', () => {
  const offenders = changedFiles()
    .map(c => c.display)
    .filter(
      f =>
        f.startsWith('src-app/server/') || f.startsWith('src-app/desktop/tauri/'),
    )
  assert.deepEqual(offenders, [], offenders.join('\n'))
})

test('TEST-9: the diff is non-empty (the check is actually looking at something)', () => {
  assert.ok(
    changedFiles().length > 0,
    `no changed files against ${BASE} — wrong BASE, or nothing implemented`,
  )
})

test('TEST-9: the sdk SUBMODULE was actually scanned (no silent degraded mode)', () => {
  // Most of this branch's diff lives in the submodule. If it were uninitialised,
  // `collect` would skip it and all the assertions above would pass vacuously —
  // so assert the scan reached it, rather than trusting the skip.
  assert.ok(
    existsSync(join(SDK, '.git')),
    'the sdk submodule must be initialised for this check to mean anything ' +
      '(`git submodule update --init`)',
  )
  const sdkFiles = changedFiles().filter(c => c.display.startsWith('sdk/'))
  assert.ok(
    sdkFiles.length > 0,
    `expected changed files inside the sdk submodule against ${SDK_BASE}; got none ` +
      `— either SDK_BASE is wrong or the submodule scan silently did nothing`,
  )
})
