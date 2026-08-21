/**
 * Acceptance suite for `lint-case-collisions.mjs` — the guard that stops a
 * component/store case collision from silently returning and breaking the macOS and
 * Windows builds again.
 *
 * Almost every assertion here is BEHAVIOURAL: it spawns the real guard (or the real
 * generator, or `git`) and reads exit codes and output. This repo has already paid
 * twice for hand-written static analysers that could only ever prove WIRING, never
 * LOGIC (CLAUDE.md: "Do not add source-text assertions there — assert behaviour in
 * the harness instead"). Two assertions are deliberately NOT behavioural and say so
 * at their site: TEST-3 reads `package.json` (registration is data, not behaviour)
 * and TEST-4(a) greps the guard for `.lifecycle` (the absence of a dependency cannot
 * be observed by running the thing).
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

/** Total directories the guard reports having walked, from its own output. */
const scannedFrom = out => Number(/scanned (\d+) director/.exec(out)?.[1] ?? -1)
/** Per-root counts the guard reports, as {relPath: n}. */
function perRootFrom(out) {
  const tail = /root\(s\): (.*?)\)\.?\s*$/m.exec(out)?.[1] ?? ''
  const map = {}
  for (const pair of tail.trim().split(/\s+/)) {
    const i = pair.lastIndexOf('=')
    if (i > 0) map[pair.slice(0, i)] = Number(pair.slice(i + 1))
  }
  return map
}

/**
 * The roots the guard is CONTRACTED to scan, and an INDEPENDENT count of the
 * directories under them.
 *
 * This is the anti-vacuity mechanism, and it is deliberately a re-implementation
 * rather than a threshold. A loose floor ("scanned > 300") is satisfied by a guard
 * that skips the very subtree the bug lived in — adding `components` to the guard's
 * SKIP_DIRS drops the real 728 to ~490 and a floor of 300 stays green. It is also
 * satisfied by a guard that simply LIES, since the number is self-reported. Counting
 * the tree here, from this file, makes both mutations RED.
 */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git'])
function expectedRoots() {
  const roots = [
    path.join(UI, 'src'),
    path.join(UI, 'tests'),
    path.join(DESKTOP_UI, 'src'),
    path.join(DESKTOP_UI, 'tests'),
  ]
  const sdkPackages = path.join(REPO, 'sdk', 'packages')
  const pkgs = fs
    .readdirSync(sdkPackages, { withFileTypes: true })
    .filter(e => e.isDirectory() && fs.existsSync(path.join(sdkPackages, e.name, 'src')))
    .map(e => path.join(sdkPackages, e.name, 'src'))
  assert.ok(pkgs.length >= 5, `expected the sdk to expose several package srcs, found ${pkgs.length}`)
  return [...roots, ...pkgs]
}
function countDirs(dir) {
  let n = 1
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || SKIP_DIRS.has(e.name)) continue
    n += countDirs(path.join(dir, e.name))
  }
  return n
}

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
const withFixture = (spec, fn) => {
  const root = fixture(spec)
  try {
    return fn(root)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
describe('lint-case-collisions', () => {
  // TEST-1 [acceptance] [invariant: INV-1]
  test('TEST-1: every compiled tree contains ZERO case collisions', () => {
    const r = runGuard()
    assert.equal(
      r.status,
      0,
      `guard must be green on the real trees, got exit ${r.status}:\n${r.stdout}${r.stderr}`,
    )
    assert.match(r.stdout, /no sibling names differ only by case/)

    // Anti-vacuity, part 1: it walked EXACTLY the contracted trees. Not a floor —
    // an independent recount (see expectedRoots/countDirs above).
    const roots = expectedRoots()
    const reported = perRootFrom(r.stdout)
    const expected = {}
    let expectedTotal = 0
    for (const root of roots) {
      assert.ok(fs.existsSync(root), `contracted root is missing: ${root}`)
      const rel = path.relative(REPO, root)
      const n = countDirs(root)
      expected[rel] = n
      expectedTotal += n
    }
    assert.deepEqual(
      reported,
      expected,
      'the guard did not walk exactly the contracted roots (a dropped root, an extra SKIP_DIRS entry, or a self-reported count that does not match the tree)',
    )
    assert.equal(scannedFrom(r.stdout), expectedTotal, 'reported total does not match the tree')

    // Anti-vacuity, part 2: the contracted set includes the trees a collision would
    // actually break the build in — both app srcs, both test dirs, and the sdk
    // packages both tsconfigs compile through `@ziee/*`.
    assert.ok(reported[path.relative(REPO, path.join(UI, 'src'))] > 400)
    assert.ok(reported[path.relative(REPO, path.join(DESKTOP_UI, 'src'))] > 10)
    assert.ok(Object.keys(reported).some(k => k.startsWith('sdk/packages/')))
  })

  // TEST-2 — the no-op proof, in every direction that matters.
  test('TEST-2: RED on each real collision shape, GREEN on the shapes that legitimately coexist', () => {
    // (a) file-vs-dir — the originally reported bug.
    withFixture(
      { 'Widget.tsx': 'export const Widget = () => null\n', 'widget/index.ts': 'export const S = {}\n' },
      root => {
        const r = runGuard([`--root=${root}`])
        assert.equal(r.status, 1, `file-vs-dir must exit 1, got ${r.status}:\n${r.stdout}`)
        assert.match(r.stdout, /Widget\.tsx/)
        assert.match(r.stdout, /widget\//)
        assert.match(r.stdout, /file-vs-dir/)
      },
    )

    // (b) file-vs-file across extensions — the shape a file-vs-dir-only guard called
    //     clean while `AgentStepForm.tsx` + `agentStepForm.ts` were live in the tree.
    //     `.ts` is probed before `.tsx`, so `./AgentStepForm` picks the helper on macOS.
    withFixture(
      { 'AgentStepForm.tsx': 'export const AgentStepForm = () => null\n', 'agentStepForm.ts': 'export const EFFORTS = []\n' },
      root => {
        const r = runGuard([`--root=${root}`])
        assert.equal(r.status, 1, `file-vs-file must exit 1, got ${r.status}:\n${r.stdout}`)
        assert.match(r.stdout, /file-vs-file/)
        assert.match(r.stdout, /AgentStepForm\.tsx/)
        assert.match(r.stdout, /agentStepForm\.ts/)
      },
    )

    // (c) the desktop resolver's `.desktop` infix — `probeDesktopInfix` matches
    //     `X.desktop.tsx` for the bare specifier `X`, so it collides with `x/` too.
    //     This exact pair (ProviderGroupAssignmentCard) was live on origin/main.
    withFixture(
      {
        'ProviderGroupAssignmentCard.desktop.tsx': 'export const C = () => null\n',
        'providerGroupAssignmentCard/index.ts': 'export const S = {}\n',
      },
      root => {
        const r = runGuard([`--root=${root}`])
        assert.equal(r.status, 1, `.desktop infix vs dir must exit 1, got ${r.status}:\n${r.stdout}`)
        assert.match(r.stdout, /ProviderGroupAssignmentCard\.desktop\.tsx/)
      },
    )

    // (d) the three shapes the task brief explicitly rules OUT — they differ in no
    //     character's case, so they must stay green with no allowlist entry. Plus a
    //     legitimate `.desktop` override sitting beside its own core file.
    withFixture(
      {
        'Widget.tsx': 'export const Widget = () => null\n',
        'Widget.desktop.tsx': 'export const Widget = () => null\n',
        'helpers/index.ts': 'export const h = 1\n',
        'use-mobile.ts': 'export const a = 1\n',
        'use-mobile.tsx': 'export const b = 1\n',
        'types.ts': 'export type T = 1\n',
        'types/index.ts': 'export type U = 1\n',
        'constants.tsx': 'export const C = 1\n',
        'constants/index.ts': 'export const D = 1\n',
        // Non-probed extensions: no resolver ever extension-probes `.scss`, so a
        // stem clash with `styles/` would not mis-resolve anything. (A `.scss` pair
        // differing only by case WOULD still be a true filesystem collision and is
        // covered by rule 3, fixture (e) — this pair deliberately does not collide.)
        'styles.scss': '.a{}\n',
        'theme.scss': '.b{}\n',
        'styles/index.ts': 'export const s = 1\n',
      },
      root => {
        const r = runGuard([`--root=${root}`])
        assert.equal(
          r.status,
          0,
          `same-case pairs and a co-located .desktop override must NOT be flagged:\n${r.stdout}`,
        )
      },
    )

    // (e) rule 3 — two siblings whose FULL names differ only by case. Unrepresentable
    //     on a case-INSENSITIVE host, so branch on what the host actually produced
    //     rather than skipping (a skip would go green for the wrong reason on exactly
    //     the platforms this guard exists to protect).
    withFixture({ 'Foo.ts': 'export const a = 1\n' }, root => {
      fs.writeFileSync(path.join(root, 'foo.ts'), 'export const b = 2\n')
      const names = fs.readdirSync(root)
      const r = runGuard([`--root=${root}`])
      if (names.includes('Foo.ts') && names.includes('foo.ts')) {
        assert.equal(r.status, 1, `case-duplicate siblings must exit 1:\n${r.stdout}`)
        assert.match(r.stdout, /any-vs-any/)
      } else {
        assert.equal(names.length, 1, `expected the host to collapse the pair, saw ${names}`)
        assert.equal(r.status, 0, `nothing to find on a case-insensitive host:\n${r.stdout}`)
      }
    })

    // (f) FAIL CLOSED. A root that cannot be walked must be a hard error, never a
    //     green line — the fail-open shape where a renamed tree silently drops out.
    const missing = runGuard([`--root=${path.join(os.tmpdir(), 'definitely-not-here-9d3f')}`])
    assert.equal(missing.status, 1, 'a missing root must exit 1')
    assert.match(missing.stderr, /FATAL/)

    withFixture({ 'a/Widget.tsx': 'x\n', 'a/widget/index.ts': 'y\n' }, root => {
      const locked = path.join(root, 'a')
      fs.chmodSync(locked, 0o000)
      try {
        const r = runGuard([`--root=${root}`])
        // Running as root defeats chmod; only assert when the mode really bit.
        let readable = true
        try {
          fs.readdirSync(locked)
        } catch {
          readable = false
        }
        if (!readable) {
          assert.equal(r.status, 1, `an unreadable directory must exit 1, not report clean:\n${r.stdout}`)
          assert.match(r.stderr, /FATAL/)
        } else {
          assert.equal(r.status, 1, 'the fixture collision must still be reported')
        }
      } finally {
        fs.chmodSync(locked, 0o755)
      }
    })
  })

  // TEST-3 [acceptance] [invariant: INV-5]
  test('TEST-3: the guard is registered and CHAINED in both workspaces, from one script', () => {
    // NOT behavioural by design: registration is a fact about package.json.
    const uiPkg = JSON.parse(fs.readFileSync(path.join(UI, 'package.json'), 'utf8'))
    const dtPkg = JSON.parse(fs.readFileSync(path.join(DESKTOP_UI, 'package.json'), 'utf8'))

    assert.equal(uiPkg.scripts['check:case-collisions'], 'node scripts/lint-case-collisions.mjs')
    assert.equal(
      dtPkg.scripts['check:case-collisions'],
      'node ../../ui/scripts/lint-case-collisions.mjs',
      'src-app/desktop/ui must reuse the SAME ui-tree script (see check:override-registry), not a fork',
    )

    // Registered but never chained is the failure this half catches.
    assert.match(uiPkg.scripts.check, /npm run check:case-collisions\b/)
    assert.match(dtPkg.scripts.check, /npm run check:case-collisions\b/)
    assert.match(uiPkg.scripts.check, /npm run test:case-collisions\b/)

    // One harness, not several.
    assert.equal(
      fs.existsSync(path.join(DESKTOP_UI, 'scripts', 'lint-case-collisions.mjs')),
      false,
      'the guard must NOT be forked into the desktop scripts dir',
    )

    // The tsc oracle is intentionally outside `check` (tsc is already check's first
    // step per workspace) — but it must still be runnable by name, or it is dead code.
    assert.equal(
      uiPkg.scripts['test:case-collisions:tsc'],
      'node --test scripts/lint-case-collisions.tsc.test.mjs',
      'the tsc oracle must have a named runner, or nothing can ever run it',
    )

    // The gallery spec must be in the visual set gate:ui actually runs, for the same
    // reason: a spec no runner names will rot.
    const galleryCfg = JSON.parse(fs.readFileSync(path.join(UI, 'gallery.config.json'), 'utf8'))
    assert.ok(
      (galleryCfg.visualConfig?.visualSpecs ?? galleryCfg.visualSpecs ?? []).some(s =>
        String(s).includes('store-case-collision'),
      ),
      'store-case-collision.spec.ts must be listed in gallery.config.json visualSpecs so gate:ui runs it',
    )
  })

  // TEST-4 [acceptance] [invariant: INV-6]
  test('TEST-4: the guard survives the `.lifecycle/` merge strip (permanent paths only)', () => {
    // (a) NOT behavioural by design: you cannot observe the ABSENCE of a dependency
    //     by running the thing. A gate that read `.lifecycle/` would pass in the
    //     feature worktree and then fail on main forever (rule B6).
    const source = fs.readFileSync(GUARD, 'utf8')
    assert.equal(
      source.includes('.lifecycle'),
      false,
      'the guard must not reference any .lifecycle path — that directory is stripped at merge',
    )

    // (b) Its roots are anchored to its own file, not the CWD, so it is correct when
    //     invoked from either workspace — and still walks the SAME trees from an
    //     unrelated directory. Compared against the independent recount, not a floor.
    const fromUi = runGuard([], UI)
    const fromTmp = runGuard([], os.tmpdir())
    assert.equal(fromTmp.status, 0, `guard must run correctly from a foreign cwd:\n${fromTmp.stdout}${fromTmp.stderr}`)
    assert.equal(
      scannedFrom(fromTmp.stdout),
      scannedFrom(fromUi.stdout),
      'the guard scanned a different tree from a foreign cwd — its roots are CWD-dependent',
    )
    assert.deepEqual(perRootFrom(fromTmp.stdout), perRootFrom(fromUi.stdout))
  })

  // TEST-5 [acceptance] [invariant: INV-2]
  test('TEST-5: store-actions codegen REPRODUCES the committed output at the new locations', () => {
    const GEN = path.resolve(REPO, 'sdk/packages/config/src/lint/store-actions.mjs')
    assert.ok(fs.existsSync(GEN), 'the store-actions generator must exist')

    // Snapshot every committed actions.gen.ts.
    const committed = new Map()
    const collect = (dir, rel) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (['node_modules', 'dist', 'build', '.git'].includes(e.name)) continue
        const full = path.join(dir, e.name)
        if (e.isDirectory()) collect(full, path.join(rel, e.name))
        else if (e.name === 'actions.gen.ts') committed.set(path.join(rel, e.name), fs.readFileSync(full, 'utf8'))
      }
    }
    collect(path.join(UI, 'src'), path.join('ui', 'src'))
    collect(path.join(DESKTOP_UI, 'src'), path.join('desktop', 'ui', 'src'))
    assert.ok(committed.size > 50, `expected many actions.gen.ts files, found ${committed.size}`)

    // Work on a COPY. `npm run check` must never write to the developer's tree, and
    // an in-place write here would do exactly that if the generator ever differed.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'store-actions-'))
    try {
      fs.cpSync(path.join(UI, 'src'), path.join(tmp, 'ui', 'src'), { recursive: true })
      fs.cpSync(path.join(DESKTOP_UI, 'src'), path.join(tmp, 'desktop', 'ui', 'src'), { recursive: true })

      // DELETE every generated file, then regenerate from scratch. This is the part
      // `--check` does not imply: `--check` only proves have === want for files that
      // exist, so a passing `--check` makes an in-place rewrite tautological. Building
      // them from nothing proves the generator still DISCOVERS all 24 relocated stores
      // at their new `stores/` paths and emits byte-identical content.
      let deleted = 0
      const wipe = dir => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, e.name)
          if (e.isDirectory()) wipe(full)
          else if (e.name === 'actions.gen.ts') {
            fs.rmSync(full)
            deleted++
          }
        }
      }
      wipe(path.join(tmp, 'ui', 'src'))
      wipe(path.join(tmp, 'desktop', 'ui', 'src'))
      assert.equal(deleted, committed.size, 'the copy should hold every generated file')

      const gen = spawnSync(process.execPath, [GEN, '--root=src', '--root=../desktop/ui/src'], {
        cwd: path.join(tmp, 'ui'),
        encoding: 'utf8',
      })
      assert.equal(gen.status, 0, `gen:store-actions must succeed:\n${gen.stdout}${gen.stderr}`)
      assert.match(gen.stdout, new RegExp(`generated/updated ${committed.size} actions\\.gen\\.ts`))

      for (const [rel, text] of committed) {
        const regenerated = path.join(tmp, rel)
        assert.ok(fs.existsSync(regenerated), `codegen did not recreate ${rel} — a store was not discovered at its new path`)
        assert.equal(fs.readFileSync(regenerated, 'utf8'), text, `codegen output drifted for ${rel}`)
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }

    // Finally, the live tree must be current + structurally conformant (read-only).
    const check = spawnSync(process.execPath, [GEN, '--root=src', '--root=../desktop/ui/src', '--check'], {
      cwd: UI,
      encoding: 'utf8',
    })
    assert.equal(check.status, 0, `check:store-actions must be green:\n${check.stdout}${check.stderr}`)
  })

  // ---- shared git-rename analysis for TEST-6 / TEST-7 ----------------------
  /**
   * Renames this branch makes relative to its base.
   *
   * `available` is false when there is no base to diff against — which is the NORMAL
   * state once this work merges (`HEAD === origin/main`, so the diff is empty) and in
   * a clone with no `origin/main`. TEST-6/TEST-7 must stay green there: a gate wired
   * into `npm run check` that asserts "this branch relocated stores" would go red on
   * main the day it lands, permanently. That is rule B6's failure mode reached
   * through a branch-relative git assumption instead of a `.lifecycle/` path, and it
   * is why both tests fall back to a tree-shape assertion below.
   */
  function branchRenames() {
    const base = spawnSync('git', ['-C', REPO, 'rev-parse', '--verify', '--quiet', 'origin/main'], {
      encoding: 'utf8',
    })
    if (base.status !== 0) return { available: false, renames: [], addedOrDeleted: [] }
    const d = spawnSync(
      'git',
      ['-C', REPO, 'diff', '--find-renames', '--name-status', 'origin/main...HEAD'],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    )
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
  /**
   * Every store directory currently under a `stores/` parent — i.e. every
   * `**\/stores/<name>/index.ts`, which is exactly how the task brief counted the
   * 91 pre-existing stores. (Not every store has an `actions/` folder, so requiring
   * one here would under-count the convention by ~24 and make the "is it the
   * majority?" assertion measure something else.)
   */
  function storeDirsInTree(root, underStores = false, acc = []) {
    for (const e of fs.readdirSync(root, { withFileTypes: true })) {
      if (!e.isDirectory() || ['node_modules', 'dist', 'build', '.git'].includes(e.name)) continue
      const full = path.join(root, e.name)
      const inside = underStores || e.name === 'stores'
      if (underStores && fs.existsSync(path.join(full, 'index.ts'))) acc.push(full)
      storeDirsInTree(full, inside, acc)
    }
    return acc
  }

  // TEST-6 [acceptance] [invariant: INV-4]
  test('TEST-6: the stores MOVED (git renames) — history follows the files', () => {
    const { available, renames, addedOrDeleted } = branchRenames()
    const storeRenames = storeRenamesOf(renames)

    if (!available || storeRenames.length === 0) {
      // Post-merge (or no base ref): the diff this assertion is ABOUT no longer
      // exists. Assert the durable consequence instead — every store the move
      // produced is still a well-formed store under a `stores/` parent — so the test
      // stays meaningful without going red on main. See branchRenames()'s note.
      const dirs = storeDirsInTree(path.join(UI, 'src'))
      assert.ok(dirs.length >= 110, `expected the relocated stores to still be present, found ${dirs.length}`)
      for (const d of dirs) {
        assert.ok(
          path.relative(path.join(UI, 'src'), d).split(path.sep).includes('stores'),
          `${d} is not under a stores/ ancestor`,
        )
        assert.ok(fs.existsSync(path.join(d, 'index.ts')), `${d} is not a store`)
      }
      return
    }

    // Each rename must be exactly "insert /stores before the last directory segment".
    for (const r of storeRenames) {
      const parts = r.to.split('/')
      const i = parts.lastIndexOf('stores')
      assert.equal(r.from, [...parts.slice(0, i), ...parts.slice(i + 1)].join('/'), `unexpected rename shape: ${r.from} -> ${r.to}`)
    }

    // A copy-then-delete would show up as A/D pairs instead of R. Nothing under the
    // web app's src/ is added or deleted by this branch — every path change is a move.
    const srcAD = addedOrDeleted.filter(x => x.file.startsWith('src-app/ui/src/'))
    assert.deepEqual(srcAD, [], `src-app/ui/src must contain only renames, saw: ${JSON.stringify(srcAD)}`)

    assert.equal(
      new Set(storeRenames.map(r => storeDirOf(r.to))).size,
      24,
      'expected 24 relocated store directories',
    )
  })

  // TEST-7 [acceptance] [invariant: INV-7]
  test('TEST-7: every relocated store joined the existing `stores/` convention', () => {
    const { available, renames } = branchRenames()
    const relocated = new Set(storeRenamesOf(renames).map(r => path.join(REPO, storeDirOf(r.to))))

    // Durable half — true on the branch AND on main. Every store directory in the
    // web tree lives under a `stores/` ancestor (not a bespoke suffix) and is a real
    // store. A handful nest one level deeper (`stores/llmModelDrawers/<name>/`),
    // which is why this asserts an ANCESTOR rather than an immediate parent; the
    // stricter immediate-parent check applies to the dirs this branch moved, below.
    const dirs = storeDirsInTree(path.join(UI, 'src'))
    assert.ok(dirs.length >= 110, `expected the stores/ convention to be populated, found ${dirs.length}`)
    let coLocated = 0
    for (const abs of dirs) {
      assert.ok(
        path.relative(path.join(UI, 'src'), abs).split(path.sep).includes('stores'),
        `${abs} is not under a stores/ ancestor`,
      )
      const storeName = path.basename(abs)
      const componentDir = path.dirname(path.dirname(abs))
      const pascal = storeName[0].toUpperCase() + storeName.slice(1)
      if (fs.readdirSync(componentDir).some(n => n.toLowerCase() === `${storeName.toLowerCase()}.tsx` || n === `${pascal}.tsx`))
        coLocated++
    }

    if (!available || relocated.size === 0) {
      // Post-merge: nothing to attribute to this diff. The assertions above already
      // hold, and are the property that actually matters going forward.
      assert.ok(coLocated > 0, 'expected at least some stores to sit beside their component')
      return
    }

    // Branch half — every store THIS branch moved kept its component sibling, which
    // is what makes this the minimal move rather than a re-architecture.
    assert.equal(relocated.size, 24)
    for (const abs of relocated) {
      assert.equal(
        path.basename(path.dirname(abs)),
        'stores',
        `${path.relative(REPO, abs)} is not under a parent literally named stores/`,
      )
      const storeName = path.basename(abs)
      const componentDir = path.dirname(path.dirname(abs))
      const pascal = storeName[0].toUpperCase() + storeName.slice(1)
      assert.ok(
        fs.readdirSync(componentDir).some(n => n.toLowerCase() === `${storeName.toLowerCase()}.tsx` || n === `${pascal}.tsx`),
        `${path.relative(REPO, abs)} lost co-location: no component matching ${pascal}.tsx`,
      )
    }

    // The convention it joined must be the pre-existing majority, not one this branch
    // invented — so count the stores that were ALREADY there, excluding its own 24.
    const preExisting = dirs.filter(d => !relocated.has(d)).length
    assert.ok(
      preExisting >= 90,
      `expected the **/stores/<name>/ convention to pre-date this branch, counted only ${preExisting} pre-existing`,
    )
  })
})
