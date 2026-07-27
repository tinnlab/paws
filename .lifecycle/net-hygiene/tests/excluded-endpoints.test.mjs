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

const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

/**
 * Resolve the diff base by MERGE-BASE against the upstream branch, not by a
 * hardcoded sha.
 *
 * This matters: the branch has been re-baselined onto a moving
 * `origin/feat/agent-core` twice. A hardcoded base silently widens the diff to
 * include everything that landed upstream in between, and this check then
 * reports the OTHER branch's changes as this one's violations. Computing the
 * merge-base makes the scan see exactly this branch's own work, always.
 */
const resolveBase = (cwd, upstream, envVar) => {
  if (process.env[envVar]) return process.env[envVar]
  try {
    return git(cwd, 'merge-base', 'HEAD', upstream)
  } catch {
    return git(cwd, 'rev-parse', 'HEAD~1')
  }
}

/** The `sdk` SUBMODULE holds most of this branch's diff, and a submodule shows
 *  up in the superproject as a single pointer change — so scanning only the
 *  superproject would silently miss every framework edit. Each entry is
 *  `{repo, path}` so both trees are checked with one code path. */
const SDK = join(REPO, 'sdk')
const BASE = resolveBase(REPO, 'origin/feat/agent-core', 'BASE')
const SDK_BASE = resolveBase(SDK, 'origin/sdk/agent-core-and-perf', 'SDK_BASE')

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

/**
 * Mechanically-generated INDEXES of the whole app. They necessarily NAME every
 * surface — including the excluded endpoints' — so scanning their CONTENT for a
 * marker is meaningless. They get a stricter, more honest check instead (below):
 * their delta must be nothing but line-number movement.
 */
const GENERATED_INDEXES = [
  'src-app/ui/src/dev/gallery/stateMatrix.generated.ts',
  'src-app/ui/src/dev/gallery/STATE_MATRIX.md',
  'sdk/packages/kit/src/testIds.generated.ts',
]

test('TEST-9 [acceptance/INV-4]: no changed file touches the excluded endpoints', () => {
  const offenders = []
  for (const { display, abs } of changedFiles()) {
    if (GENERATED_INDEXES.includes(display)) continue
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

test('TEST-9 [acceptance/INV-4]: the generated indexes carry NO semantic change', () => {
  // These are excluded from the marker scan because they are machine-generated
  // INDEXES of every surface / testid in the app, so they necessarily NAME the
  // excluded endpoints. That exemption is only sound if their delta adds and
  // removes nothing — assert exactly that, rather than trusting it.
  //
  // Integers are normalized (a line number, a surface/signal COUNT in a header),
  // because those move whenever any unrelated file grows. What CANNOT be
  // normalized away is a line appearing or disappearing — an added or removed
  // surface / testid leaves an unpaired line, which is the real semantic change
  // this guards against.
  const norm = l => l.slice(1).replace(/\d+/g, 'N')
  for (const f of GENERATED_INDEXES) {
    const repo = f.startsWith('sdk/') ? SDK : REPO
    const path = f.startsWith('sdk/') ? f.slice(4) : f
    const base = f.startsWith('sdk/') ? SDK_BASE : BASE
    let diff = ''
    try {
      diff = git(repo, 'diff', `${base}...HEAD`, '--', path)
    } catch {
      continue
    }
    if (!diff) continue
    const changed = diff
      .split('\n')
      .filter(l => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l))
    const removed = changed.filter(l => l[0] === '-').map(norm)
    const added = changed.filter(l => l[0] === '+').map(norm)
    const unpairedRemoved = removed.filter(
      l => !added.includes(l) || removed.filter(x => x === l).length > added.filter(x => x === l).length,
    )
    const unpairedAdded = added.filter(
      l => !removed.includes(l) || added.filter(x => x === l).length > removed.filter(x => x === l).length,
    )
    assert.deepEqual(
      [...new Set([...unpairedRemoved, ...unpairedAdded])],
      [],
      `${f}: a generated-index line was ADDED or REMOVED, not merely renumbered — ` +
        `regenerate and review the real delta`,
    )
  }
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
