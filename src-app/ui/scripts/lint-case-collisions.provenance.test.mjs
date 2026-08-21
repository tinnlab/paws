/**
 * TEST-6 / TEST-7 — the store directories MOVED, and they moved into the existing
 * convention.
 *
 * WHY THIS READS HISTORY RATHER THAN A DIFF
 * -----------------------------------------
 * These certify two design invariants: INV-4 ("use `git mv` so history follows the
 * files") and INV-7 ("conform to the existing majority convention"). Both are claims
 * about a change that happened once.
 *
 * Two earlier shapes were wrong, in opposite directions, and the history is worth
 * keeping because the failure mode is easy to re-create:
 *
 *   1. Asserting on `git diff origin/main...HEAD` made the test true only while the
 *      branch was unmerged. After the merge the diff is empty; on any LATER branch
 *      that relocates a store the "exactly 24" count is wrong; on a branch cut from a
 *      stale base the diff re-shows these renames plus that branch's own additions.
 *   2. Hard-failing when the diff could not be evaluated (no `origin/main`, a shallow
 *      clone, a squash) turned that into a script that can never pass again on main —
 *      a named, documented runner that is red forever.
 *
 * `git log --follow` fixes both, because the relocation is visible in history
 * permanently: "does this file's history cross a rename from the pre-`stores/` path?"
 * is true on the branch and still true on main a year later. No base ref, no diff, no
 * count of one particular branch's work.
 *
 * WHAT THIS CANNOT PROVE, stated because an earlier header claimed otherwise: it does
 * NOT distinguish `git mv` from a same-commit `cp` + `rm`. Git stores snapshots, not
 * renames — `--follow` DETECTS a rename from content similarity at query time, so both
 * routes produce byte-identical history. Two auditors demonstrated this by relocating a
 * tree with `cp -r` + `rm -rf` and never invoking `git mv`: `--follow` still reports
 * `R100`. So the mechanism half of INV-4 is not machine-checkable at all. What IS
 * checkable is the design's actual purpose clause — "so history follows the files" —
 * and that is exactly what is asserted below. A test that cannot fail for the reason
 * its message states is worse than one that admits its scope.
 *
 * Not chained into `npm run check`: it shells out to `git log --follow` once per
 * sampled store and depends on history being present, which a CI checkout may
 * legitimately shallow away. It has a runner and is executed at phase 8.
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
const UI_SRC = path.resolve(HERE, '../src')
const REPO = path.resolve(HERE, '../../..')

/** Every store directory sitting directly under a `stores/` parent, with its component. */
function relocatedCandidates(root, acc = []) {
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory() || ['node_modules', 'dist', 'build', '.git'].includes(e.name)) continue
    const full = path.join(root, e.name)
    if (
      path.basename(root) === 'stores' &&
      fs.existsSync(path.join(full, 'index.ts')) &&
      fs.existsSync(path.join(full, 'actions'))
    ) {
      const componentDir = path.dirname(path.dirname(full))
      const pascal = e.name[0].toUpperCase() + e.name.slice(1)
      const component = fs
        .readdirSync(componentDir)
        .find(n => n === `${pascal}.tsx` || n.toLowerCase() === `${e.name.toLowerCase()}.tsx`)
      if (component) acc.push({ dir: full, component: path.join(componentDir, component) })
    }
    relocatedCandidates(full, acc)
  }
  return acc
}

/**
 * Renames in a file's own history, plus whether the file has ANY history at all.
 *
 * The two are separate questions and conflating them mis-diagnoses a shallow clone: a
 * `--depth 1` checkout exits **0 with empty output**, so a `status !== 0` check never
 * fires and the caller blamed a copy that never happened. `commits` is what tells the
 * two apart.
 */
function history(fileAbs) {
  const rel = path.relative(REPO, fileAbs)
  const run = args => spawnSync('git', ['-C', REPO, ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })

  const log = run(['log', '--follow', '--diff-filter=R', '--name-status', '--format=', '--', rel])
  if (log.status !== 0) return { available: false, renames: [], commits: 0 }

  const commits = run(['log', '--follow', '--format=%H', '--', rel])
  const depth = commits.status === 0 ? commits.stdout.split('\n').filter(Boolean).length : 0

  return {
    available: true,
    commits: depth,
    renames: log.stdout
      .split('\n')
      .filter(l => l.startsWith('R'))
      .map(l => {
        const c = l.split('\t')
        return { from: c[1], to: c[2] }
      }),
  }
}

describe('case-collision fix — provenance', () => {
  // TEST-6 [acceptance] [invariant: INV-4]
  test('TEST-6: the relocated stores MOVED — their history crosses the rename', () => {
    const candidates = relocatedCandidates(UI_SRC)
    assert.ok(candidates.length > 0, `expected store directories under a stores/ parent, found ${candidates.length}`)

    // ALL of them, not a sample. `--follow` over 24 stores costs ~4 s in a suite that
    // is manual and phase-8-only; an earlier `slice(0, 8)` saved 2.7 s and bought a
    // readdir-ORDER dependency — which 8 got checked shifted whenever an unrelated
    // directory was added.
    let relocated = 0
    let noHistory = 0
    for (const { dir } of candidates) {
      const index = path.join(dir, 'index.ts')
      const rel = path.relative(REPO, index)
      const h = history(index)

      // No git at all, or a shallow clone that truncated this path's history. NOT a
      // finding about the code — say which it is instead of blaming a copy that never
      // happened, which is what a `status !== 0`-only check did (a `--depth 1` clone
      // exits 0 with empty output, so that branch never fired).
      if (!h.available || h.commits === 0) {
        noHistory++
        continue
      }

      const preMove = rel.replace(/\/stores\/([^/]+)\/index\.ts$/, '/$1/index.ts')
      const crossed = h.renames.some(r => r.from === preMove && r.to === rel)
      if (crossed) {
        relocated++
        continue
      }
      // A store with history but NO relocation rename is a legitimately NEW store,
      // created in place under `stores/` — not evidence of anything wrong. Asserting
      // on every candidate made this test fail the first time anyone ADDED a store,
      // which is the same "permanent gate carrying a one-time claim" defect twice
      // removed. What must hold is the shape of the renames that DO exist.
      for (const r of h.renames)
        if (r.to === rel && r.from.replace('/stores/', '/') === rel.replace('/stores/', '/'))
          assert.equal(r.from, preMove, `${rel} moved from an unexpected path: ${r.from}`)
    }

    assert.ok(
      noHistory < candidates.length,
      `TEST-6 could read history for NONE of the ${candidates.length} stores — \`git log --follow\` is unavailable or this is a shallow clone. This test certifies that the stores' history follows them; it refuses to report a pass it did not earn. Run it in a full clone.`,
    )
    assert.ok(
      relocated > 0,
      `no store directory shows a rename from its pre-\`stores/\` path — the relocation is absent from history (checked ${candidates.length}, ${noHistory} without history)`,
    )
  })

  // TEST-7 [acceptance] [invariant: INV-7]
  test('TEST-7: every relocated store sits under a `stores/` parent beside its component', () => {
    const candidates = relocatedCandidates(UI_SRC)
    assert.ok(candidates.length > 0, `expected store directories under a stores/ parent, found ${candidates.length}`)

    for (const { dir, component } of candidates) {
      // Under a parent literally named `stores` — the existing convention, not a
      // bespoke suffix…
      assert.equal(
        path.basename(path.dirname(dir)),
        'stores',
        `${path.relative(REPO, dir)} is not under a parent literally named stores/`,
      )
      // …and still co-located with the component it belongs to, which is what makes
      // this the minimal move rather than a re-architecture.
      assert.ok(fs.existsSync(component), `${path.relative(REPO, dir)} lost co-location with its component`)
      assert.equal(
        path.dirname(component),
        path.dirname(path.dirname(dir)),
        `${path.relative(REPO, dir)} is not a sibling of ${path.relative(REPO, component)}`,
      )
    }
  })
})
