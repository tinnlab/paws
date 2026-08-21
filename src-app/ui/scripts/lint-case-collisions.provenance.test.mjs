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
 * `git log --follow` fixes both, because a rename is recorded in history permanently.
 * Asking "does this file's history cross a rename from the pre-`stores/` path?" is
 * true on the branch, still true on main a year later, and false exactly when the
 * files were copied-and-deleted instead of moved. No base ref, no diff, no count of
 * one particular branch's work.
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

/** Renames in a file's own history, oldest-path first. [] when history is unavailable. */
function renameHistory(fileAbs) {
  const rel = path.relative(REPO, fileAbs)
  const r = spawnSync(
    'git',
    ['-C', REPO, 'log', '--follow', '--diff-filter=R', '--name-status', '--format=', '--', rel],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  )
  if (r.status !== 0) return null
  return r.stdout
    .split('\n')
    .filter(l => l.startsWith('R'))
    .map(l => {
      const c = l.split('\t')
      return { from: c[1], to: c[2] }
    })
}

describe('case-collision fix — provenance', () => {
  // TEST-6 [acceptance] [invariant: INV-4]
  test('TEST-6: the relocated stores MOVED — their history crosses the rename', () => {
    const candidates = relocatedCandidates(UI_SRC)
    assert.ok(candidates.length >= 20, `expected the relocated stores to be present, found ${candidates.length}`)

    // Sample rather than shell out ~120 times; `--follow` is the expensive call here.
    // Any store whose index.ts was COPIED instead of moved has no rename in its
    // history, so a sample of this size cannot miss a wholesale copy-then-delete.
    const sample = candidates.slice(0, 8)
    let checked = 0
    for (const { dir } of sample) {
      const index = path.join(dir, 'index.ts')
      const renames = renameHistory(index)
      if (renames === null) {
        // No git, or no history for this path (shallow clone). Say so and stop —
        // reporting a green here would certify INV-4 against nothing.
        assert.fail(
          `TEST-6 cannot read history for ${path.relative(REPO, index)} — \`git log --follow\` failed. This test certifies that the stores MOVED; it refuses to report a pass it did not earn. Run it in a full (non-shallow) clone.`,
        )
      }
      // The rename that matters: from the SAME path without the `/stores` segment.
      const rel = path.relative(REPO, index)
      const preMove = rel.replace(/\/stores\/([^/]+)\/index\.ts$/, '/$1/index.ts')
      const crossed = renames.some(r => r.from === preMove && r.to === rel)
      assert.ok(
        crossed,
        `${rel} has no rename from ${preMove} in its history — it was copied, not moved (renames seen: ${JSON.stringify(renames)})`,
      )
      checked++
    }
    assert.equal(checked, sample.length)
  })

  // TEST-7 [acceptance] [invariant: INV-7]
  test('TEST-7: every relocated store sits under a `stores/` parent beside its component', () => {
    const candidates = relocatedCandidates(UI_SRC)
    assert.ok(candidates.length >= 20, `expected relocated stores, found ${candidates.length}`)

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
