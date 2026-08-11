#!/usr/bin/env node
/**
 * PACKAGE-SUITE GATE — every workspace package's own test suite has a runner,
 * BY CONSTRUCTION.
 *
 * Ported from CytoAnalyst's `scripts/check-package-suites.mjs`, which found this
 * class in the first place. The two apps share the `ziee-ai/sdk` submodule, so the
 * gate travels with it; the SCOPE RULES below are where ziee differs, and each
 * difference is stated rather than silently inherited.
 *
 * ── The bug this exists to stop ────────────────────────────────────────────────
 * A package ships test FILES and nothing runs them. Measured in ziee when this gate
 * was written, with the sdk pinned to `chat`:
 *
 *   @ziee/framework   8 files  — no `test` script; had NEVER executed, anywhere
 *   @ziee/gallery    12 files  — no `test` script; had NEVER executed, anywhere
 *   @ziee/config      2 files  — a `test` script that HAND-LISTED one of them
 *   @ziee/kit         9 files  — a `test` script, but its one `node:test` file was
 *                                excluded from vitest and run by nothing
 *
 * The `@ziee/config` case is the instructive one: a `test` script is necessary but
 * not sufficient. A hand-list runs the files someone remembered, and the file added
 * afterwards is dark while the gate reports green — the same failure mode as a
 * hand-written route list or a hand-maintained lint allow-list, both of which this
 * repo has already paid for.
 *
 * Worse than dark is dark-and-green: vitest COLLECTS a `node:test` file, finds no
 * `describe`/`it`, and reports it as a PASSING file with zero tests. So "add
 * `"test": "vitest run"`" would have turned 14 unrun suites into 14 green ticks.
 * The SDK's answer is `sdk/scripts/node-test-files.mjs` — ONE criterion ("imports
 * node:test") used both to EXCLUDE from vitest and to RUN under `node --test`, so
 * the two lists cannot drift. This gate checks that a runner EXISTS; that module is
 * what makes the runner COMPLETE. Neither substitutes for the other.
 *
 * ── What is checked (all fail-closed, all with positive counts) ────────────────
 *  P1 DERIVED   the package set is expanded from the ROOT `package.json`'s
 *               `workspaces` globs — the same declaration npm itself resolves —
 *               never hand-listed. A new directory under `sdk/packages/` therefore
 *               joins the gate with no edit here. A workspace pattern this expander
 *               does not understand is a HARD FAILURE, not a silent drop.
 *  P2 SCOPED    every resolved workspace is either IN SCOPE or excluded by ONE
 *               named, printed rule. There is no third, quiet outcome.
 *  P3 COVERED   an in-scope package with test FILES but no `test` script is a HARD
 *               FAILURE, naming the files. A package with neither is skipped LOUDLY
 *               (named in the table).
 *  P4 FLOOR     `MIN_GATED_PACKAGES` is a committed constant. If the derived set
 *               collapses below it (a rename, a moved directory, a broken glob) the
 *               gate FAILS instead of congratulating itself on an empty run.
 *  P5 RUN ALL   every gated package is executed to completion — a failing package
 *               does NOT mask the ones after it — and a per-package exit table is
 *               printed. Any non-zero exit fails the gate, naming the package.
 *
 * ── SCOPE RULES ───────────────────────────────────────────────────────────────
 *  - SUBMODULE **NOT IN PLAY**: workspaces under a path declared in `.gitmodules`
 *    (`sdk`), while this branch leaves that submodule alone. A submodule is a PIN to
 *    another repository; gating every unrelated ziee change on another repo's suite
 *    makes this repo hostage to it. Read from `.gitmodules`, so adding a submodule
 *    needs no edit here. CONDITIONAL — see S2.
 *  - KNOWN_UNRUNNABLE: the two first-party app workspaces, which have test files and
 *    no `test` script. See the long note on that constant — it is a ratchet, not an
 *    exemption.
 *
 * ── S1/S2/S3: the submodule exclusion, and the hole it left ───────────────────
 *  S1 PRESENT     every path in `.gitmodules` must exist AND be initialised (a
 *                 resolvable `HEAD` inside). An uninitialised submodule makes its
 *                 workspace globs expand to NOTHING, so the gate would pass while
 *                 covering strictly less than it claims. Refuse that silence.
 *  S2 IN PLAY     a submodule is IN PLAY when this branch is changing it: its
 *                 working tree is DIRTY, or its recorded pointer MOVED vs the base
 *                 (`merge-base(BASE, HEAD)..HEAD`, plus an uncommitted gitlink
 *                 change). While in play, its packages that HAVE a `test` script are
 *                 GATED like any other workspace — a submodule edit is this branch's
 *                 change and this branch's responsibility. `PACKAGE_SUITES_BASE`
 *                 overrides the base (default `origin/main`); an unresolvable base
 *                 counts as IN PLAY rather than silently skipping.
 *  S3 UPSTREAM GAP  an in-play submodule package with test FILES but no `test`
 *                 script is reported LOUDLY on every run but is NOT the P3 hard
 *                 failure it would be for a first-party package: the remedy lives in
 *                 the other repository, and failing here would only teach people to
 *                 bypass the gate.
 *
 * The measured cost of a BLANKET submodule exclusion, in CytoAnalyst, was three
 * user-facing `@ziee/kit` defects shipping in a single day through the hole. ziee
 * renders every surface through that same kit, so S2 is why this gate is worth
 * having here at all.
 *
 * ── What is NOT checked (stated so it is not mistaken for covered) ────────────
 * That a package's `test` script COLLECTS every test file in that package. A file
 * excluded by the package's own vitest `include`/`exclude`, or omitted from a
 * hand-list, is invisible here — this gate closes "the package has no runner", not
 * "the runner's globs are complete". `sdk/scripts/node-test-files.mjs` is the
 * per-package analogue and it belongs inside each package. `@ziee/config`'s
 * hand-list was fixed by switching it to that shared runner, not by a check here.
 *
 * Usage:
 *   node scripts/check-package-suites.mjs            # gate: enumerate + RUN
 *   node scripts/check-package-suites.mjs --list     # enumerate + report, run nothing
 *   node scripts/check-package-suites.mjs --json     # machine-readable plan (implies --list)
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..')

/**
 * P4 — the committed floor. Today the gated set is whatever the `sdk` submodule
 * contributes while it is IN PLAY (4 packages: kit, framework, gallery, config).
 * When the submodule is NOT in play the gated set is legitimately EMPTY, so the
 * floor is only enforced in that case — see the guard at its use site.
 */
const MIN_GATED_PACKAGES = 4

/**
 * First-party workspaces that have test FILES and NO `test` script.
 *
 * This is a RATCHET, not an exemption, and it is modelled on this repo's existing
 * `scripts/deadcode-blanket-baseline.txt` idiom: baseline what is already there,
 * always allow it to shrink, never allow it to grow.
 *
 * The situation being baselined is real and was measured, not assumed:
 *
 *   src-app/ui          169 test files, 1002 tests, 24 FAILING
 *   src-app/desktop/ui   13 test files
 *
 * Neither declares a `test` script, and neither `test:unit` nor `test:component` is
 * invoked by `just check`, by `npm run check`, or by any workflow — the single
 * exception is `just check-updater`, which runs ONE hand-named file. So ~1000 tests
 * sit outside every gate, and 24 of them are red on `origin/main` today.
 *
 * Making that a P3 hard failure would put `just check` in the red on day one for a
 * pre-existing condition, and a gate that is red for reasons unrelated to your
 * change is a gate people learn to skip — which is precisely how the SDK suites went
 * dark. So the entries are reported LOUDLY on every run, and are bounded three ways:
 *
 *   · the recorded `files` count is a CEILING. Add a test file to one of these
 *     workspaces without wiring a runner and the gate FAILS. The hole cannot grow.
 *   · an entry whose workspace GAINS a `test` script is STALE and FAILS, so the
 *     baseline cannot outlive the problem it records.
 *   · an entry naming a workspace with NO test files is STALE and FAILS, so a
 *     rename cannot leave a dead entry silently suppressing a real one.
 *
 * Lowering a count is always allowed and never needs a note. The way OUT is to wire
 * `test:unit` + `test:component` into a `test` script and fix the 24 — a real piece
 * of work, deliberately not smuggled into the commit that adds this gate.
 */
const KNOWN_UNRUNNABLE = new Map([
  ['src-app/ui', { files: 169, why: '1002 tests, 24 failing on origin/main; test:unit + test:component wired to nothing' }],
  ['src-app/desktop/ui', { files: 13, why: 'test:unit wired to nothing but one hand-named file in `just check-updater`' }],
])

/** Directories npm itself never treats as a workspace. */
const NEVER_A_WORKSPACE = new Set(['node_modules'])

/** Build output / vendored trees that must not be walked for test files. */
const SKIP_WALK = new Set(['node_modules', 'dist', 'build', 'coverage', '.vite', '.turbo', '.git'])

const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/

const failures = []
const fail = (id, msg) => failures.push(`${id}: ${msg}`)

const rel = p => path.relative(REPO, p).split(path.sep).join('/')

// ── P1: expand the ROOT package.json workspace globs ─────────────────────────
const rootPkgPath = path.join(REPO, 'package.json')
if (!existsSync(rootPkgPath)) {
  console.error(`check-packages FAIL — no root package.json at ${rootPkgPath}`)
  process.exit(1)
}
const rootPkg = JSON.parse(readFileSync(rootPkgPath, 'utf8'))
const patterns = Array.isArray(rootPkg.workspaces) ? rootPkg.workspaces : rootPkg.workspaces?.packages
if (!Array.isArray(patterns) || patterns.length === 0) {
  console.error('check-packages FAIL — the root package.json declares no `workspaces`; this gate would be vacuous.')
  process.exit(1)
}

/**
 * Deliberately MINIMAL glob support: a literal path, or exactly one trailing `/*`.
 * Anything richer is refused rather than half-handled — a pattern this cannot expand
 * would silently drop every package under it, which is the bug being fixed.
 */
function expand(pattern) {
  if (!pattern.includes('*')) return [path.join(REPO, pattern)]
  if (!/^[^*]+\/\*$/.test(pattern)) {
    fail(
      'P1',
      `workspace pattern \`${pattern}\` is not one this gate understands (literal path, or a ` +
        `single trailing \`/*\`). Teach \`expand()\` rather than let every package under it ` +
        `drop out of the gate unnoticed.`,
    )
    return []
  }
  const parent = path.join(REPO, pattern.slice(0, -2))
  if (!existsSync(parent)) return []
  return readdirSync(parent, { withFileTypes: true })
    .filter(e => e.isDirectory() && !NEVER_A_WORKSPACE.has(e.name))
    .map(e => path.join(parent, e.name))
    .sort()
}

// ── submodule paths, read from .gitmodules (derived, not typed out) ──────────
const gitmodulesPath = path.join(REPO, '.gitmodules')
const submodulePaths = existsSync(gitmodulesPath)
  ? [...readFileSync(gitmodulesPath, 'utf8').matchAll(/^\s*path\s*=\s*(.+)$/gm)].map(m => m[1].trim())
  : []
const underSubmodule = r => submodulePaths.find(s => r === s || r.startsWith(s + '/'))

// ── S1/S2: is each submodule present, and is THIS BRANCH changing it? ────────
const git = (args, cwd = REPO) =>
  spawnSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

const BASE = process.env.PACKAGE_SUITES_BASE || 'origin/main'

/** True when some root workspace glob resolves INSIDE this submodule. */
const declaresWorkspaces = sub => patterns.some(p => p === sub || p.startsWith(sub + '/'))

/**
 * Is `dir` its OWN git repository, rather than a directory inside the parent's?
 *
 * `git -C <dir> rev-parse HEAD` is NOT this test, and using it was a bug: git walks
 * UP from `dir` until it finds a repository, so inside an EMPTY (uninitialised)
 * submodule directory it happily returns the PARENT's HEAD and exit 0. The presence
 * check then passed for a submodule that is not there, and — worse — `git status
 * --porcelain` in that directory reported the PARENT's dirty files, so every
 * uninitialised submodule was judged "working tree dirty" and therefore IN PLAY
 * whenever the parent tree had any uncommitted change at all.
 *
 * Comparing the resolved toplevel to `dir` is the actual question: an initialised
 * submodule is a repository boundary and answers itself; an empty directory answers
 * with its parent.
 */
function isOwnRepo(dir) {
  const top = git(['rev-parse', '--show-toplevel'], dir)
  if (top.status !== 0) return false
  try {
    return path.resolve(top.stdout.trim()) === path.resolve(dir)
  } catch {
    return false
  }
}

function submoduleState(sub) {
  const dir = path.join(REPO, sub)
  // S1 — present + initialised.
  if (!existsSync(dir) || !statSync(dir).isDirectory() || !isOwnRepo(dir)) {
    // Only FATAL when this submodule is where some workspace glob points: that is the
    // case where an uninitialised tree makes the globs expand to nothing and the gate
    // silently covers less than it reports. `agent-kit` (docs + skills) and
    // `src-app/server/vendor/pgvector` (C source) declare no npm workspaces, so their
    // being uninitialised costs this gate exactly nothing — failing on them would just
    // force every contributor to check out trees this gate has no opinion about.
    if (declaresWorkspaces(sub))
      fail(
        'S1',
        `submodule \`${sub}\` is absent or uninitialised, and the root \`workspaces\` globs point ` +
          `INSIDE it, so its packages expand to nothing and this gate would silently cover less ` +
          `than it reports. Run \`git submodule update --init ${sub}\`.`,
      )
    return {
      present: false,
      dirty: false,
      pointerMoved: false,
      inPlay: false,
      why: declaresWorkspaces(sub)
        ? 'absent/uninitialised'
        : 'absent/uninitialised — declares no npm workspaces, so nothing here to gate',
    }
  }

  // S2a — dirty working tree inside the submodule (uncommitted submodule edits).
  const st = git(['status', '--porcelain'], dir)
  const dirty = st.status === 0 && st.stdout.trim().length > 0

  // S2b — the recorded pointer moved. Committed: merge-base(BASE, HEAD)..HEAD.
  // Uncommitted: a staged/unstaged gitlink change, with `--ignore-submodules=dirty`
  // so a merely-dirty submodule is not double-counted as a pointer move.
  let pointerMoved = false
  let baseNote = ''
  const mb = git(['merge-base', BASE, 'HEAD'])
  if (mb.status === 0 && mb.stdout.trim()) {
    const d = git(['diff', '--name-only', mb.stdout.trim(), 'HEAD', '--', sub])
    pointerMoved = d.status === 0 && d.stdout.trim().length > 0
  } else {
    // Fail toward RUNNING: an unresolvable base must not become a quiet skip.
    baseNote = ` (base \`${BASE}\` unresolvable — treating as in play)`
    pointerMoved = true
  }
  const wt = git(['diff', '--ignore-submodules=dirty', '--name-only', 'HEAD', '--', sub])
  if (wt.status === 0 && wt.stdout.trim()) pointerMoved = true

  const inPlay = dirty || pointerMoved
  const why = inPlay
    ? [dirty && 'working tree dirty', pointerMoved && `pointer moved vs ${BASE}`]
        .filter(Boolean)
        .join(' + ') + baseNote
    : `untouched by this branch (clean, pointer == ${BASE})`
  return { present: true, dirty, pointerMoved, inPlay, why }
}

const subState = new Map(submodulePaths.map(s => [s, submoduleState(s)]))

/** In-play submodule packages that have tests but no runner — reported, never silent (S3). */
const upstreamGaps = []

// ── walk a package for test files ────────────────────────────────────────────
/**
 * Test files a `npm test` runner would own — which is NOT every file matching
 * `*.test.*`/`*.spec.*`.
 *
 * A workspace's TOP-LEVEL `tests/` directory is the Playwright e2e tree in both app
 * workspaces (`src-app/ui/tests` = 697 specs, `src-app/desktop/ui/tests` = 16). Those
 * have a runner already — `npm run test:e2e`, driven by `playwright.config.ts` and by
 * `just e2e-*` — and they need a booted server, so a unit-test gate must never claim
 * them. Counting them here would have reported `src-app/ui` as 866 unrunnable suites
 * when the real number outside e2e is 169, i.e. it would have inflated the finding
 * ~5x and pointed the fix at the wrong runner.
 *
 * Anchored to depth 0 so a NESTED `src/**\/tests/` directory (a unit-test grouping,
 * not the e2e root) is still walked and still counted.
 */
function testFiles(dir, acc = [], depth = 0) {
  if (depth > 12) return acc
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_WALK.has(e.name)) continue
    if (depth === 0 && e.isDirectory() && e.name === 'tests') continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) testFiles(p, acc, depth + 1)
    else if (TEST_FILE.test(e.name)) acc.push(p)
  }
  return acc
}

// ── classify every resolved workspace ────────────────────────────────────────
const rows = []
const seen = new Set()
for (const pattern of patterns) {
  for (const dir of expand(pattern)) {
    const r = rel(dir)
    if (seen.has(r)) continue
    seen.add(r)
    if (!existsSync(dir) || !statSync(dir).isDirectory()) continue
    const pkgPath = path.join(dir, 'package.json')
    if (!existsSync(pkgPath)) continue // npm ignores a dir with no manifest; so do we
    let pkg
    try {
      pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    } catch (e) {
      fail('P2', `\`${r}/package.json\` is unparseable, so its suite cannot be classified: ${e.message}`)
      continue
    }
    const name = pkg.name ?? null
    const testScript = pkg.scripts?.test ?? null

    const sub = underSubmodule(r)
    if (sub) {
      const state = subState.get(sub)
      if (!state?.inPlay) {
        rows.push({
          dir,
          rel: r,
          name,
          status: 'excluded',
          reason: `submodule \`${sub}\` — ${state?.why ?? 'gated in its own repo'}`,
          testScript,
          testFiles: 0,
        })
        continue
      }
      // IN PLAY (S2): this branch is changing the submodule, so its suites are this
      // branch's responsibility.
      const subFiles = testFiles(dir)
      if (!testScript) {
        if (subFiles.length > 0) {
          upstreamGaps.push({ rel: r, name, files: subFiles.length })
          rows.push({
            dir,
            rel: r,
            name,
            status: 'UPSTREAM-GAP',
            reason: `${subFiles.length} test file(s), no \`test\` script — fix belongs in the \`${sub}\` repo`,
            testScript,
            testFiles: subFiles.length,
          })
        } else {
          rows.push({ dir, rel: r, name, status: 'skipped', reason: `submodule \`${sub}\` in play, but no tests on disk`, testScript, testFiles: 0 })
        }
        continue
      }
      if (!name) {
        fail('P2', `\`${r}\` has a \`test\` script but no package \`name\`, so it cannot be invoked by workspace.`)
        continue
      }
      rows.push({
        dir,
        rel: r,
        name,
        status: 'gated',
        reason: `${testScript}  [submodule \`${sub}\` IN PLAY: ${state.why}]`,
        testScript,
        testFiles: subFiles.length,
      })
      continue
    }

    const files = testFiles(dir)
    const baseline = KNOWN_UNRUNNABLE.get(r)
    if (baseline) {
      // The ratchet. Three ways an entry can be WRONG, all fatal.
      if (testScript)
        fail(
          'P3',
          `\`${r}\` is baselined in KNOWN_UNRUNNABLE but now HAS a \`test\` script ` +
            `(\`${testScript}\`). Remove its entry so the gate actually runs it — a stale ` +
            `baseline suppresses a suite that is ready to be gated.`,
        )
      else if (files.length === 0)
        fail(
          'P3',
          `\`${r}\` is baselined in KNOWN_UNRUNNABLE but has NO test files on disk. Remove the ` +
            `entry — a dead entry can silently absorb a real gap after a rename.`,
        )
      else if (files.length > baseline.files)
        fail(
          'P3',
          `\`${r}\` has ${files.length} test file(s), above its recorded baseline of ` +
            `${baseline.files}. ${files.length - baseline.files} suite(s) were added to a ` +
            `workspace with no \`test\` script, so nothing runs them. Wire a runner, or lower ` +
            `the count if files were removed.`,
        )
      rows.push({
        dir,
        rel: r,
        name,
        status: files.length > baseline.files ? 'UNRUNNABLE' : 'KNOWN-GAP',
        reason: `${files.length}/${baseline.files} test file(s), no \`test\` script — ${baseline.why}`,
        testScript,
        testFiles: files.length,
      })
      continue
    }

    if (!testScript) {
      if (files.length > 0) {
        // P3 — the literal bug class.
        fail(
          'P3',
          `\`${r}\` (${name ?? 'unnamed'}) has ${files.length} test file(s) on disk but NO \`test\` ` +
            `script, so nothing can run them: e.g. ${files.slice(0, 3).map(f => rel(f)).join(', ')}` +
            `${files.length > 3 ? ', …' : ''}. Add a \`test\` script to ${r}/package.json.`,
        )
        rows.push({ dir, rel: r, name, status: 'UNRUNNABLE', reason: `${files.length} test file(s), no \`test\` script`, testScript, testFiles: files.length })
      } else {
        rows.push({ dir, rel: r, name, status: 'skipped', reason: 'no tests on disk, no `test` script', testScript, testFiles: 0 })
      }
      continue
    }
    if (!name) {
      fail('P2', `\`${r}\` has a \`test\` script but no package \`name\`, so it cannot be invoked by workspace.`)
      continue
    }
    rows.push({ dir, rel: r, name, status: 'gated', reason: testScript, testScript, testFiles: files.length })
  }
}

const gated = rows.filter(r => r.status === 'gated')

// ── S2 ratchet: an in-play submodule must actually contribute a runnable suite ─
const noWorkspaceSubmodules = []
for (const [sub, state] of subState) {
  if (!state.inPlay) continue
  const fromSub = rows.filter(r => r.rel === sub || r.rel.startsWith(sub + '/'))
  if (fromSub.length === 0) {
    // A submodule the root `workspaces` globs do not reach at all (`agent-kit`, which
    // ships docs + skills, and `src-app/server/vendor/pgvector`, which is C). There
    // is nothing here to run and never was — say so, but do NOT fail: that would make
    // a routine agent-kit bump red for a reason this gate has no opinion about.
    noWorkspaceSubmodules.push(sub)
    continue
  }
  if (!fromSub.some(r => r.status === 'gated'))
    fail(
      'S2',
      `submodule \`${sub}\` is IN PLAY (${state.why}) and resolves ${fromSub.length} workspace(s), ` +
        `but contributed ZERO runnable suites. A branch that changes a submodule must run ` +
        `something from it, or the change lands ungated.`,
    )
}

// ── P4: the floor ────────────────────────────────────────────────────────────
// Only meaningful when a submodule is in play. With `sdk` untouched the gated set is
// legitimately empty (every runnable suite ziee has today lives in that submodule),
// and failing then would make the gate red on every unrelated branch.
const anySubInPlay = [...subState.values()].some(s => s.inPlay)
if (anySubInPlay && gated.length < MIN_GATED_PACKAGES)
  fail(
    'P4',
    `a submodule is IN PLAY but only ${gated.length} workspace package(s) resolved to a runnable ` +
      `suite, below the floor of ${MIN_GATED_PACKAGES}. Either the workspace globs no longer ` +
      `match (a rename/move), or a package lost its \`test\` script. A gate that runs (almost) ` +
      `nothing must not pass.`,
  )

// ── the KNOWN_UNRUNNABLE baseline must still describe REAL workspaces ────────
for (const r of KNOWN_UNRUNNABLE.keys())
  if (!seen.has(r))
    fail(
      'P2',
      `KNOWN_UNRUNNABLE names \`${r}\`, which the root \`workspaces\` globs no longer resolve. ` +
        `A baseline entry for a workspace that does not exist hides whatever replaced it.`,
    )

// ── report the plan ──────────────────────────────────────────────────────────
const asJson = process.argv.includes('--json')
const listOnly = process.argv.includes('--list') || asJson
if (asJson) {
  console.log(
    JSON.stringify(
      {
        patterns,
        submodulePaths,
        base: BASE,
        submodules: Object.fromEntries(subState),
        floor: MIN_GATED_PACKAGES,
        knownUnrunnable: Object.fromEntries(KNOWN_UNRUNNABLE),
        packages: rows,
        upstreamGaps,
        failures,
      },
      null,
      2,
    ),
  )
} else {
  const w = (s, n) => String(s).padEnd(n)
  console.log(`\ncheck-packages — ${rows.length} workspace(s) from ${patterns.length} glob(s): ${patterns.join(', ')}`)
  for (const [sub, s] of subState) {
    const verdict = !s.inPlay
      ? 'not in play — excluded'
      : noWorkspaceSubmodules.includes(sub)
        ? 'IN PLAY, but it declares no workspace packages — nothing here to run'
        : 'IN PLAY — its suites are GATED here'
    console.log(`  submodule ${sub}: ${verdict} (${s.why})`)
  }
  console.log(`  ${w('workspace', 26)}${w('package', 22)}${w('status', 14)}why`)
  for (const r of rows) console.log(`  ${w(r.rel, 26)}${w(r.name ?? '-', 22)}${w(r.status, 14)}${r.reason}`)
  if (upstreamGaps.length)
    console.log(
      `\n  ! UPSTREAM GAP (S3) — in-play submodule package(s) with test files and no runner, ` +
        `so this gate CANNOT run them; the fix is a \`test\` script in the submodule's own repo:\n` +
        upstreamGaps.map(g => `      ${g.name ?? g.rel}  (${g.files} test file(s))`).join('\n'),
    )
}

if (failures.length) {
  console.error(`\n✗ check-packages — ${failures.length} wiring failure(s):`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}

if (listOnly) {
  if (!asJson)
    console.log(`\n✓ check-packages (--list): ${gated.length} package suite(s) would run: ${gated.map(g => g.name).join(', ')}`)
  process.exit(0)
}

// ── P5: run them ALL, then report ────────────────────────────────────────────
const results = []
for (const g of gated) {
  console.log(`\n══════ check-packages: ${g.name} (${g.rel}) — npm run test --workspace ${g.name} ══════`)
  const r = spawnSync('npm', ['run', 'test', '--workspace', g.name], { cwd: REPO, stdio: 'inherit' })
  results.push({ ...g, code: r.status === null ? 1 : r.status, signal: r.signal ?? null })
}

console.log('\n══════ check-packages summary ══════')
for (const r of results)
  console.log(`  ${r.name.padEnd(22)} exit ${r.code}${r.signal ? ` (signal ${r.signal})` : ''}`)
const knownGaps = rows.filter(r => r.status === 'KNOWN-GAP')
if (knownGaps.length)
  console.log(
    `  KNOWN GAP (baselined, not run, ratcheted): ${knownGaps
      .map(s => `${s.rel} (${s.testFiles} test file(s), no runner)`)
      .join('; ')}`,
  )
const skipped = rows.filter(r => r.status === 'skipped')
if (skipped.length) console.log(`  NOT run (no tests on disk): ${skipped.map(s => s.name ?? s.rel).join(', ')}`)
const excluded = rows.filter(r => r.status === 'excluded')
if (excluded.length) console.log(`  EXCLUDED by scope rule: ${excluded.map(s => `${s.name ?? s.rel} (${s.reason})`).join('; ')}`)
if (upstreamGaps.length)
  console.log(
    `  UPSTREAM GAP (S3, not run, not fatal): ${upstreamGaps.map(g => `${g.name ?? g.rel} (${g.files} test file(s), no runner)`).join('; ')}`,
  )

const bad = results.filter(r => r.code !== 0)
if (bad.length) {
  console.error(`\n✗ check-packages — ${bad.length} package suite(s) FAILED: ${bad.map(b => b.name).join(', ')}`)
  process.exit(1)
}
console.log(`\n✓ check-packages: ${results.length} package suite(s) passed.`)
