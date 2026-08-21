/**
 * Acceptance suite for `lint-case-collisions.mjs` — the guard that stops a
 * component/store case collision from silently returning and breaking the macOS and
 * Windows builds again.
 *
 * Every assertion here is BEHAVIOURAL: it spawns the real guard (or the real
 * generator, or `git`) and reads exit codes and output. There are deliberately no
 * source-text assertions on product code — this repo has already paid twice for
 * hand-written static analysers that could only ever prove WIRING, never LOGIC
 * (see CLAUDE.md: "Do not add source-text assertions there — assert behaviour in
 * the harness instead").
 *
 * Run:  node --test scripts/lint-case-collisions.test.mjs
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { describe } from 'node:test'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const UI = path.resolve(HERE, '..') // src-app/ui
const DESKTOP_UI = path.resolve(HERE, '../../desktop/ui') // src-app/desktop/ui
const REPO = path.resolve(HERE, '../../..') // repo root
const GUARD = path.join(HERE, 'lint-case-collisions.mjs')

const runGuard = (args = [], cwd = UI) =>
  spawnSync(process.execPath, [GUARD, ...args], { cwd, encoding: 'utf8' })

/** Number of directories the guard reports having walked, from its own output. */
const scannedFrom = out => Number(/scanned (\d+) director/.exec(out)?.[1] ?? -1)

/** A throwaway fixture tree; returns its root. Caller removes it. */
function fixture(spec) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'case-collisions-'))
  for (const [rel, contents] of Object.entries(spec)) {
    const full = path.join(root, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, contents)
  }
  return root
}

// ---------------------------------------------------------------------------
describe('lint-case-collisions', () => {
  // TEST-1 [acceptance] [invariant: INV-1]
  test('TEST-1: the real ui + desktop/ui trees contain ZERO case collisions', () => {
    const r = runGuard()
    assert.equal(
      r.status,
      0,
      `guard must be green on the real tree, got exit ${r.status}:\n${r.stdout}${r.stderr}`,
    )
    assert.match(r.stdout, /no sibling names differ only by case/)
    // Anti-vacuity: a guard whose roots stopped resolving would ALSO print the green
    // line. Assert it actually walked a real tree (~620 dirs across both workspaces).
    assert.ok(
      scannedFrom(r.stdout) > 300,
      `guard reported scanning ${scannedFrom(r.stdout)} directories — it did not walk the real trees`,
    )
    // And that both roots exist, so "2 root(s)" is not two paths to nowhere.
    assert.ok(fs.existsSync(path.join(UI, 'src')), 'src-app/ui/src must exist')
    assert.ok(fs.existsSync(path.join(DESKTOP_UI, 'src')), 'src-app/desktop/ui/src must exist')
    assert.match(r.stdout, /under 2 root\(s\)/)
  })

  // TEST-2 — the no-op proof, both directions.
  test('TEST-2: RED on a real collision, GREEN on the shapes that legitimately coexist', () => {
    // (a) the reported bug: `Widget.tsx` beside `widget/`
    const bad = fixture({
      'Widget.tsx': 'export const Widget = () => null\n',
      'widget/index.ts': 'export const WidgetStore = {}\n',
    })
    try {
      const r = runGuard([`--root=${bad}`])
      assert.equal(r.status, 1, `a real collision must exit 1, got ${r.status}:\n${r.stdout}`)
      assert.match(r.stdout, /Widget\.tsx/)
      assert.match(r.stdout, /widget\//)
      assert.match(r.stdout, /file-vs-dir/)
      assert.match(r.stdout, /1 case collision/)
    } finally {
      fs.rmSync(bad, { recursive: true, force: true })
    }

    // (b) the three shapes the task brief explicitly rules OUT — they differ in no
    //     character's case, so they must stay green with no allowlist entry.
    const good = fixture({
      'Widget.tsx': 'export const Widget = () => null\n',
      'helpers/index.ts': 'export const h = 1\n',
      'use-mobile.ts': 'export const a = 1\n',
      'use-mobile.tsx': 'export const b = 1\n',
      'types.ts': 'export type T = 1\n',
      'types/index.ts': 'export type U = 1\n',
      'constants.tsx': 'export const C = 1\n',
      'constants/index.ts': 'export const D = 1\n',
    })
    try {
      const r = runGuard([`--root=${good}`])
      assert.equal(
        r.status,
        0,
        `use-mobile.ts/.tsx, types/ vs types.ts and constants/ vs constants.tsx must NOT be flagged:\n${r.stdout}`,
      )
    } finally {
      fs.rmSync(good, { recursive: true, force: true })
    }

    // (c) rule 2 — two siblings whose FULL names differ only by case. This fixture is
    //     unrepresentable on a case-INSENSITIVE host, so branch on what the host
    //     actually produced rather than skipping (a skip would go green for the wrong
    //     reason on exactly the platforms this guard exists to protect).
    const dup = fixture({ 'Foo.ts': 'export const a = 1\n' })
    try {
      fs.writeFileSync(path.join(dup, 'foo.ts'), 'export const b = 2\n')
      const names = fs.readdirSync(dup)
      const r = runGuard([`--root=${dup}`])
      if (names.includes('Foo.ts') && names.includes('foo.ts')) {
        assert.equal(r.status, 1, `case-duplicate siblings must exit 1:\n${r.stdout}`)
        assert.match(r.stdout, /any-vs-any/)
      } else {
        // Case-insensitive host: the second write overwrote the first, so only one
        // entry exists and there is genuinely nothing to find.
        assert.equal(names.length, 1, `expected the host to collapse the pair, saw ${names}`)
        assert.equal(r.status, 0, `nothing to find on a case-insensitive host:\n${r.stdout}`)
      }
    } finally {
      fs.rmSync(dup, { recursive: true, force: true })
    }
  })

  // TEST-3 [acceptance] [invariant: INV-5]
  test('TEST-3: the guard is registered and CHAINED in both workspaces, from one script', () => {
    const uiPkg = JSON.parse(fs.readFileSync(path.join(UI, 'package.json'), 'utf8'))
    const dtPkg = JSON.parse(fs.readFileSync(path.join(DESKTOP_UI, 'package.json'), 'utf8'))

    assert.equal(
      uiPkg.scripts['check:case-collisions'],
      'node scripts/lint-case-collisions.mjs',
      'src-app/ui must register the guard',
    )
    assert.equal(
      dtPkg.scripts['check:case-collisions'],
      'node ../../ui/scripts/lint-case-collisions.mjs',
      'src-app/desktop/ui must reuse the SAME ui-tree script (see check:override-registry), not a fork',
    )

    // Registered but never chained is the failure this half catches.
    assert.match(
      uiPkg.scripts.check,
      /npm run check:case-collisions\b/,
      "src-app/ui's `check` chain must run the guard",
    )
    assert.match(
      dtPkg.scripts.check,
      /npm run check:case-collisions\b/,
      "src-app/desktop/ui's `check` chain must run the guard",
    )

    // One harness, not several.
    assert.equal(
      fs.existsSync(path.join(DESKTOP_UI, 'scripts', 'lint-case-collisions.mjs')),
      false,
      'the guard must NOT be forked into the desktop scripts dir',
    )

    // The test suite itself must be wired too, or the guard could rot untested.
    assert.match(
      uiPkg.scripts.check,
      /npm run test:case-collisions\b/,
      "src-app/ui's `check` chain must run this suite",
    )
  })

  // TEST-4 [acceptance] [invariant: INV-6]
  test('TEST-4: the guard survives the `.lifecycle/` merge strip (permanent paths only)', () => {
    // (a) It reads nothing from `.lifecycle/` — a gate that did would pass in the
    //     feature worktree and then fail on main forever (rule B6).
    const source = fs.readFileSync(GUARD, 'utf8')
    assert.equal(
      source.includes('.lifecycle'),
      false,
      'the guard must not reference any .lifecycle path — that directory is stripped at merge',
    )

    // (b) Its roots are anchored to its own file, not the CWD, so it is correct when
    //     invoked from either workspace — and, decisively, still finds the real trees
    //     from an unrelated directory.
    const r = runGuard([], os.tmpdir())
    assert.equal(r.status, 0, `guard must run correctly from a foreign cwd:\n${r.stdout}${r.stderr}`)
    assert.ok(
      scannedFrom(r.stdout) > 300,
      `from a foreign cwd the guard scanned ${scannedFrom(r.stdout)} directories — its roots are CWD-dependent`,
    )
  })

  // TEST-5 [acceptance] [invariant: INV-2]
  test('TEST-5: store-actions codegen is stable across the move and does not revert it', () => {
    const GEN = path.resolve(REPO, 'sdk/packages/config/src/lint/store-actions.mjs')
    assert.ok(fs.existsSync(GEN), 'the store-actions generator must exist')
    const args = ['--root=src', '--root=../desktop/ui/src']

    // Nothing stale, no structural problem.
    const check = spawnSync(process.execPath, [GEN, ...args, '--check'], { cwd: UI, encoding: 'utf8' })
    assert.equal(
      check.status,
      0,
      `check:store-actions must be green after the move:\n${check.stdout}${check.stderr}`,
    )

    // And a WRITE run must change nothing — "a fix that codegen reverts is not a fix".
    const snapshot = () => {
      const out = new Map()
      const walk = dir => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          if (['node_modules', 'dist', 'build', '.git'].includes(e.name)) continue
          const full = path.join(dir, e.name)
          if (e.isDirectory()) walk(full)
          else if (e.name === 'actions.gen.ts') out.set(full, fs.readFileSync(full, 'utf8'))
        }
      }
      walk(path.join(UI, 'src'))
      walk(path.join(DESKTOP_UI, 'src'))
      return out
    }
    const before = snapshot()
    assert.ok(before.size > 50, `expected many actions.gen.ts files, found ${before.size}`)
    const write = spawnSync(process.execPath, [GEN, ...args], { cwd: UI, encoding: 'utf8' })
    assert.equal(write.status, 0, `gen:store-actions must succeed:\n${write.stdout}${write.stderr}`)
    const after = snapshot()
    assert.deepEqual(
      [...after.keys()].sort(),
      [...before.keys()].sort(),
      'gen:store-actions must not add or remove an actions.gen.ts',
    )
    for (const [file, text] of before)
      assert.equal(after.get(file), text, `gen:store-actions rewrote ${path.relative(REPO, file)}`)
  })

  // ---- shared git-rename analysis for TEST-6 / TEST-7 ----------------------
  /** Renames on this branch, as {from, to} — empty array when there is no base to diff. */
  function branchRenames() {
    const base = spawnSync('git', ['-C', REPO, 'rev-parse', '--verify', '--quiet', 'origin/main'], {
      encoding: 'utf8',
    })
    assert.equal(base.status, 0, 'origin/main must be resolvable to diff this branch against')
    const d = spawnSync(
      'git',
      ['-C', REPO, 'diff', '--find-renames', '--name-status', 'origin/main...HEAD'],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    )
    assert.equal(d.status, 0, `git diff failed:\n${d.stderr}`)
    const renames = []
    const addedOrDeleted = []
    for (const line of d.stdout.split('\n')) {
      if (!line.trim()) continue
      const cols = line.split('\t')
      if (cols[0].startsWith('R')) renames.push({ from: cols[1], to: cols[2] })
      else if (cols[0] === 'A' || cols[0] === 'D') addedOrDeleted.push({ status: cols[0], file: cols[1] })
    }
    return { renames, addedOrDeleted }
  }

  // TEST-6 [acceptance] [invariant: INV-4]
  test('TEST-6: the stores MOVED (git renames) — history follows the files', () => {
    const { renames, addedOrDeleted } = branchRenames()

    const storeRenames = renames.filter(
      r => r.to.startsWith('src-app/ui/src/') && r.to.includes('/stores/') && !r.from.includes('/stores/'),
    )
    assert.ok(storeRenames.length > 0, 'this branch must record store relocations as renames')

    // Each rename must be exactly "insert /stores before the last directory segment".
    for (const r of storeRenames) {
      const parts = r.to.split('/')
      const i = parts.lastIndexOf('stores')
      const expectedFrom = [...parts.slice(0, i), ...parts.slice(i + 1)].join('/')
      assert.equal(r.from, expectedFrom, `unexpected rename shape: ${r.from} -> ${r.to}`)
    }

    // A copy-then-delete would show up as A/D pairs instead of R. Nothing under the
    // web app's src/ is added or deleted by this branch — every path change is a move.
    const srcAD = addedOrDeleted.filter(x => x.file.startsWith('src-app/ui/src/'))
    assert.deepEqual(
      srcAD,
      [],
      `src-app/ui/src must contain only renames on this branch, saw: ${JSON.stringify(srcAD)}`,
    )

    // The enumerated total: 24 distinct store directories relocated.
    const dirs = new Set(
      storeRenames.map(r => {
        const parts = r.to.split('/')
        return parts.slice(0, parts.lastIndexOf('stores') + 2).join('/')
      }),
    )
    assert.equal(dirs.size, 24, `expected 24 relocated store directories, saw ${dirs.size}`)
  })

  // TEST-7 [acceptance] [invariant: INV-7]
  test('TEST-7: every relocated store joined the existing `stores/` convention', () => {
    const { renames } = branchRenames()
    const dirs = new Set()
    for (const r of renames) {
      if (!r.to.startsWith('src-app/ui/src/') || !r.to.includes('/stores/')) continue
      const parts = r.to.split('/')
      const i = parts.lastIndexOf('stores')
      dirs.add(parts.slice(0, i + 2).join('/'))
    }
    assert.ok(dirs.size > 0, 'expected relocated store directories')

    for (const rel of dirs) {
      const abs = path.join(REPO, rel)
      // …under a parent literally named `stores` (not a bespoke suffix)…
      assert.equal(path.basename(path.dirname(abs)), 'stores', `${rel} is not under a stores/ parent`)
      // …still a real store…
      assert.ok(fs.existsSync(path.join(abs, 'index.ts')), `${rel}/index.ts missing`)
      assert.ok(fs.existsSync(path.join(abs, 'actions')), `${rel}/actions missing`)
      // …and still co-located with the component it belongs to, which is what makes
      // this the minimal move rather than a re-architecture.
      const componentDir = path.dirname(path.dirname(abs))
      const storeName = path.basename(abs)
      const pascal = storeName[0].toUpperCase() + storeName.slice(1)
      const siblings = fs.readdirSync(componentDir)
      const hasComponent = siblings.some(
        n => n.toLowerCase() === `${storeName.toLowerCase()}.tsx` || n === `${pascal}.tsx`,
      )
      assert.ok(
        hasComponent,
        `${rel} lost co-location: no component matching ${pascal}.tsx in ${path.relative(REPO, componentDir)}`,
      )
    }

    // And the convention it joined is the dominant one, not a new one this branch invented.
    let preExisting = 0
    const walk = dir => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!e.isDirectory() || ['node_modules', 'dist', 'build', '.git'].includes(e.name)) continue
        const full = path.join(dir, e.name)
        if (path.basename(dir) === 'stores' && fs.existsSync(path.join(full, 'index.ts'))) preExisting++
        walk(full)
      }
    }
    walk(path.join(UI, 'src'))
    walk(path.join(DESKTOP_UI, 'src'))
    assert.ok(
      preExisting >= 90,
      `expected the **/stores/<name>/ convention to be the majority, counted only ${preExisting}`,
    )
  })
})
