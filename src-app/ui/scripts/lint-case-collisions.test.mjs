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
  // MANDATORY roots — trees this repo owns, where a finding blocks.
  const roots = [
    path.join(UI, 'src'),
    path.join(UI, 'tests'),
    path.join(UI, 'plugins'),
    path.join(UI, 'scripts'),
    path.join(DESKTOP_UI, 'src'),
    path.join(DESKTOP_UI, 'tests'),
    path.join(DESKTOP_UI, 'plugins'),
    path.join(DESKTOP_UI, 'scripts'),
  ].map(dir => ({ dir, advisory: false }))
  // ADVISORY roots — the read-only sdk submodule, reported but not blocking.
  const sdkPackages = path.join(REPO, 'sdk', 'packages')
  const pkgs = fs
    .readdirSync(sdkPackages, { withFileTypes: true })
    .filter(e => e.isDirectory() && fs.existsSync(path.join(sdkPackages, e.name, 'src')))
    .map(e => ({ dir: path.join(sdkPackages, e.name, 'src'), advisory: true }))
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
    for (const { dir, advisory } of roots) {
      assert.ok(fs.existsSync(dir), `contracted root is missing: ${dir}`)
      // The guard tags advisory roots in its own output, so the label is part of the
      // contract: silently reclassifying the owned trees as advisory would otherwise
      // turn every blocking finding into a report and pass this assertion.
      const rel = `${path.relative(REPO, dir)}${advisory ? '(advisory)' : ''}`
      const n = countDirs(dir)
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
    // The owned trees must be BLOCKING, not advisory — otherwise a real collision in
    // them would print and exit 0.
    for (const k of Object.keys(reported))
      if (!k.startsWith('sdk/')) assert.ok(!k.includes('(advisory)'), `${k} must not be advisory`)
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

    // (g) The suffix comparisons must themselves be CASE-INSENSITIVE. Modelling a
    //     case-insensitive filesystem with case-sensitive `endsWith` is the same
    //     mistake the guard exists to catch, and it produced two real false
    //     negatives: `Foo.Desktop.tsx` (probeDesktopInfix builds the literal
    //     `foo.desktop.tsx`, which stats as this on macOS) and `Widget.TSX`.
    for (const [file, dir] of [
      ['Foo.Desktop.tsx', 'foo'],
      ['Widget.TSX', 'widget'],
      ['Thing.MTS', 'thing'],
    ]) {
      withFixture({ [file]: 'x\n', [`${dir}/index.ts`]: 'y\n' }, root => {
        const r = runGuard([`--root=${root}`])
        assert.equal(r.status, 1, `${file} beside ${dir}/ must exit 1, got ${r.status}:\n${r.stdout}`)
        assert.match(r.stdout, new RegExp(file.replace('.', '\\.')))
      })
    }

    // (h) When several files answer to the SAME stem, ALL of them must be named. A
    //     last-writer-wins map reported only one, so the operator fixed half a pair
    //     and re-ran into the other half. This exact shape (a component plus its
    //     `.desktop` override, both beside the store dir) was live on origin/main.
    withFixture(
      { 'Foo.tsx': 'x\n', 'Foo.desktop.tsx': 'x\n', 'foo/index.ts': 'y\n' },
      root => {
        const r = runGuard([`--root=${root}`])
        assert.equal(r.status, 1, `must exit 1:\n${r.stdout}`)
        assert.match(r.stdout, /Foo\.tsx/)
        assert.match(r.stdout, /Foo\.desktop\.tsx/)
      },
    )

    // (i) A subtree the guard did NOT walk must never be reported clean by omission.
    //     Symlinked directories are named (so they can still collide) but not walked,
    //     to keep the walk acyclic — the guard has to SAY so.
    withFixture({ 'real/inner/Widget.tsx': 'x\n', 'real/inner/widget/index.ts': 'y\n', 'root/keep.ts': 'z\n' }, root => {
      fs.symlinkSync(path.join(root, 'real'), path.join(root, 'root', 'linked'), 'dir')
      const r = runGuard([`--root=${path.join(root, 'root')}`])
      assert.equal(r.status, 0, 'the walked tree is clean')
      assert.match(r.stdout, /NOTE:.*symlinked directory.*NOT walked/s)
      assert.match(r.stdout, /linked/)
    })
  })

  // TEST-12 — the durable half of the convention claim, true on this branch AND on
  // main (the branch-scoped provenance assertions live in
  // `lint-case-collisions.provenance.test.mjs`, deliberately outside `check`).
  test('TEST-12: the `stores/` convention is the dominant one and every store under it is real', () => {
    const underStores = []
    const outsideStores = []
    const walk = (dir, insideStores) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!e.isDirectory() || SKIP_DIRS.has(e.name)) continue
        const full = path.join(dir, e.name)
        if (fs.existsSync(path.join(full, 'index.ts')) && fs.existsSync(path.join(full, 'actions')))
          (insideStores ? underStores : outsideStores).push(full)
        walk(full, insideStores || e.name === 'stores')
      }
    }
    walk(path.join(UI, 'src'), false)
    walk(path.join(DESKTOP_UI, 'src'), false)

    assert.ok(underStores.length > 0, 'expected stores under a `stores/` ancestor')
    for (const d of underStores)
      assert.ok(fs.existsSync(path.join(d, 'index.ts')), `${d} is not a real store`)

    // A RATIO, not a magic threshold. The claim is "this is the majority convention",
    // and a count like `>= 110` would go red the day someone legitimately consolidates
    // six stores, with a message about case collisions that had nothing to do with it.
    assert.ok(
      underStores.length > outsideStores.length * 2,
      `\`stores/\` should be the dominant convention: ${underStores.length} under it vs ${outsideStores.length} outside`,
    )
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
    assert.match(
      uiPkg.scripts.check,
      /npm run test:case-collisions:tsc\b/,
      "the tsc oracle's unique value is its non-empty-program assertions; outside `check` nothing ever runs them",
    )

    // One harness, not several.
    assert.equal(
      fs.existsSync(path.join(DESKTOP_UI, 'scripts', 'lint-case-collisions.mjs')),
      false,
      'the guard must NOT be forked into the desktop scripts dir',
    )

    assert.equal(
      uiPkg.scripts['test:case-collisions:tsc'],
      'node --test scripts/lint-case-collisions.tsc.test.mjs',
      'the tsc oracle must have a named runner, or nothing can ever run it',
    )

    // The provenance suite asserts facts about THIS branch's diff, so it must have a
    // runner but must NOT be chained: on any later branch that relocates a store, its
    // "exactly 24" claim would fail `npm run check` for a change it knows nothing about.
    assert.equal(
      uiPkg.scripts['test:case-collisions:provenance'],
      'node --test scripts/lint-case-collisions.provenance.test.mjs',
      'the provenance suite must be runnable by name',
    )
    assert.doesNotMatch(
      uiPkg.scripts.check,
      /npm run test:case-collisions:provenance\b/,
      'the provenance suite must NOT be chained into `check` — it is a one-time claim about one diff',
    )
    assert.doesNotMatch(dtPkg.scripts.check, /npm run test:case-collisions:provenance\b/)

    // The gallery spec must be in the visual set gate:ui actually runs, for the same
    // reason: a spec no runner names will rot.
    // `visualConfig` is a STRING (the playwright config path), not an object — an
    // earlier `galleryCfg.visualConfig?.visualSpecs ?? …` first branch was dead.
    const galleryCfg = JSON.parse(fs.readFileSync(path.join(UI, 'gallery.config.json'), 'utf8'))
    assert.equal(typeof galleryCfg.visualConfig, 'string', 'visualConfig is the config PATH')
    assert.ok(
      (galleryCfg.visualSpecs ?? []).some(s =>
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

})
