/**
 * TEST-6 / TEST-7 — provenance assertions about THIS branch's diff.
 *
 * WHY THIS IS A SEPARATE FILE, AND NOT IN `npm run check`
 * ------------------------------------------------------
 * These two tests assert facts about `git diff origin/main...HEAD`: that the 24 store
 * directories MOVED (renames, not add/delete — design invariant INV-4), and that each
 * one landed under a parent literally named `stores/` beside its component (INV-7).
 * Both are true exactly once, on the branch that performs the move.
 *
 * A first attempt put them in `lint-case-collisions.test.mjs`, which IS chained into
 * `npm run check`. That is wrong in two ways, and the second is not obvious:
 *
 *   1. after the merge, `HEAD == origin/main`, the diff is empty, and the assertions
 *      fail on main forever (rule B6's failure mode, reached through a branch-relative
 *      git assumption rather than a `.lifecycle/` path); and
 *   2. even with (1) guarded, ANY future branch that relocates a store would take the
 *      branch path and hit `assert.equal(dirs.size, 24)` — a count that describes this
 *      diff and nothing else — and any branch cut from a stale base would re-see these
 *      24 renames plus its own additions and trip the "only renames" assertion.
 *
 * A permanent gate cannot carry a one-time claim. So the durable properties stay in
 * `lint-case-collisions.test.mjs` (chained into `check`), and the provenance claims
 * live here, run once at phase 8 via `npm run test:case-collisions:provenance`, and
 * are never inflicted on anyone else's branch.
 *
 * On a tree where the claim does not apply (no base ref, or a diff that relocates no
 * store) each test says so and asserts the durable shape instead of a made-up number.
 *
 * Run:  npm run test:case-collisions:provenance
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test, { describe } from 'node:test'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const UI = path.resolve(HERE, '..')
const REPO = path.resolve(HERE, '../../..')

/** This branch's claim: exactly this many store directories were relocated. */
const RELOCATED_COUNT = 24

function branchRenames() {
  const base = spawnSync('git', ['-C', REPO, 'rev-parse', '--verify', '--quiet', 'origin/main'], {
    encoding: 'utf8',
  })
  if (base.status !== 0) return { available: false, renames: [], addedOrDeleted: [] }
  const d = spawnSync('git', ['-C', REPO, 'diff', '--find-renames', '--name-status', 'origin/main...HEAD'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (d.status !== 0) return { available: false, renames: [], addedOrDeleted: [] }
  const renames = []
  const addedOrDeleted = []
  for (const line of d.stdout.split('\n')) {
    if (!line.trim()) continue
    const cols = line.split('\t')
    if (cols[0].startsWith('R')) renames.push({ from: cols[1], to: cols[2] })
    else if (cols[0] === 'A' || cols[0] === 'D') addedOrDeleted.push({ status: cols[0], file: cols[1] })
  }
  return { available: true, renames, addedOrDeleted }
}

const storeRenamesOf = renames =>
  renames.filter(
    r => r.to.startsWith('src-app/ui/src/') && r.to.includes('/stores/') && !r.from.includes('/stores/'),
  )
const storeDirOf = p => {
  const parts = p.split('/')
  return parts.slice(0, parts.lastIndexOf('stores') + 2).join('/')
}
const componentExists = (abs, storeName) => {
  const componentDir = path.dirname(path.dirname(abs))
  const pascal = storeName[0].toUpperCase() + storeName.slice(1)
  return fs
    .readdirSync(componentDir)
    .some(n => n.toLowerCase() === `${storeName.toLowerCase()}.tsx` || n === `${pascal}.tsx`)
}

/**
 * Refuse to certify an invariant this tree cannot evaluate.
 *
 * The earlier fallback here asserted `fs.existsSync(<UI>/src)` and returned — which
 * cannot be false in any tree where this file exists. So on a shallow checkout, a
 * clone with no `origin/main`, or after a squash that defeats rename detection, both
 * tests reported `ok` having verified nothing, and the only signal was a `console.log`
 * buried in TAP output. That is a green certificate for INV-4/INV-7 backed by no
 * evidence — worse than a failure, because it reads as proof.
 *
 * This suite is deliberately manual and run once, at phase 8, precisely to certify
 * those two invariants. If it cannot, the honest answer is to say so loudly and fail,
 * not to pass quietly.
 */
function requireEvaluable(id, available, relocatedCount) {
  assert.ok(
    available,
    `${id} cannot be evaluated: \`origin/main\` is unresolvable, or \`git diff\` failed. This suite exists to certify a claim about this branch's diff — refusing rather than reporting a green it did not earn. Fetch origin/main (and ensure the clone is not shallow), then re-run.`,
  )
  assert.ok(
    relocatedCount > 0,
    `${id} cannot be evaluated: the diff against origin/main relocates no store directory. Either the branch does not contain the move, or rename detection was defeated (a squash, or a low \`diff.renameLimit\`). Refusing rather than reporting a green it did not earn.`,
  )
}

describe('case-collision fix — branch provenance', () => {
  // TEST-6 [acceptance] [invariant: INV-4]
  test('TEST-6: the stores MOVED (git renames) — history follows the files', () => {
    const { available, renames, addedOrDeleted } = branchRenames()
    const storeRenames = storeRenamesOf(renames)

    requireEvaluable('TEST-6', available, storeRenames.length)

    // Each rename must be exactly "insert /stores before the last directory segment".
    for (const r of storeRenames) {
      const parts = r.to.split('/')
      const i = parts.lastIndexOf('stores')
      assert.equal(
        r.from,
        [...parts.slice(0, i), ...parts.slice(i + 1)].join('/'),
        `unexpected rename shape: ${r.from} -> ${r.to}`,
      )
    }

    // A copy-then-delete would show up as A/D pairs instead of R. Scoped to files
    // inside the relocated store directories, which is the claim being made — an
    // earlier version asserted "nothing anywhere under src-app/ui/src is added or
    // deleted", which is a much wider statement than INV-4 and broke under a low
    // `diff.renameLimit`: an unrelated helper test that was renamed WITH content
    // changes degrades to A/D, while the (byte-identical) store files still report R.
    const storeDirs = new Set(storeRenames.flatMap(r => [storeDirOf(r.to), storeDirOf(r.to).replace('/stores/', '/')]))
    const inAStore = f => [...storeDirs].some(d => f.startsWith(`${d}/`))
    const storeAD = addedOrDeleted.filter(x => inAStore(x.file))
    assert.deepEqual(
      storeAD,
      [],
      `the relocated stores must appear as renames, not add/delete: ${JSON.stringify(storeAD)}`,
    )

    assert.equal(
      new Set(storeRenames.map(r => storeDirOf(r.to))).size,
      RELOCATED_COUNT,
      `expected ${RELOCATED_COUNT} relocated store directories`,
    )
  })

  // TEST-7 [acceptance] [invariant: INV-7]
  test('TEST-7: every relocated store joined the existing `stores/` convention', () => {
    const { available, renames } = branchRenames()
    const relocated = new Set(storeRenamesOf(renames).map(r => path.join(REPO, storeDirOf(r.to))))

    requireEvaluable('TEST-7', available, relocated.size)

    assert.equal(relocated.size, RELOCATED_COUNT)
    for (const abs of relocated) {
      // Under a parent literally named `stores` — not a bespoke suffix…
      assert.equal(
        path.basename(path.dirname(abs)),
        'stores',
        `${path.relative(REPO, abs)} is not under a parent literally named stores/`,
      )
      // …still a real store…
      assert.ok(fs.existsSync(path.join(abs, 'index.ts')), `${path.relative(REPO, abs)}/index.ts missing`)
      assert.ok(fs.existsSync(path.join(abs, 'actions')), `${path.relative(REPO, abs)}/actions missing`)
      // …and still co-located with its component, which is what makes this the
      // minimal move rather than a re-architecture.
      assert.ok(
        componentExists(abs, path.basename(abs)),
        `${path.relative(REPO, abs)} lost co-location with its component`,
      )
    }
  })
})
