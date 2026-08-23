/**
 * TEST-14 — the BEHAVIOURAL anchor: no import in either UI workspace resolves to a
 * different module on a case-insensitive filesystem than it does here.
 *
 * WHY THIS EXISTS RATHER THAN A FOURTH GUARD RULE
 * -----------------------------------------------
 * `lint-case-collisions.mjs` matches SHAPES: sibling names that look like they would
 * confuse a resolver. That is fast, runs on every `npm run check`, and is what stops a
 * new collision being committed. But a shape-matcher can only ever see the shapes
 * someone thought of — three audit rounds each found another one (file-vs-file across
 * extensions, the `.desktop` infix, case-insensitive suffix matching, and Tier 1's
 * cross-tree probe, which no sibling rule can see at all).
 *
 * This test asks the question by OUTCOME instead. For every real import specifier in
 * both workspaces it performs the resolution twice — once against the real
 * case-sensitive filesystem, and once through a case-INSENSITIVE sibling lookup in
 * TypeScript's probe order — and diffs the two answers. A specifier that lands on a
 * different file under the two regimes IS the bug, and it does not matter which
 * arrangement of names produced it. That is why the guard's rule set can stay bounded
 * instead of growing a predicate per audit round.
 *
 * ONE SHAPE IT CANNOT SEE, stated so the guard's header is not relying on a promise
 * this file does not keep: a FULL-NAME case duplicate (`Foo.ts` beside `foo.ts`).
 * Both regimes find the exact name first, so no divergence is reported — yet on a
 * case-insensitive checkout only one file survives and it may hold the other's bytes.
 * That shape is rule 3 of `lint-case-collisions.mjs`, which does catch it. The two
 * checks are complements, not one subsuming the other.
 *
 * It IS chained into `npm run check`. An earlier header justified excluding it on a
 * cost of "~10-20 s"; measured, it is **0.29 s**, so the stated reason was simply
 * wrong. (That header also called it "dead code, §15" — it was not: it already had a
 * named runner. The §15 argument was overreach; the real argument is just that the
 * general oracle belongs in the gate.) It replaced a 47 s duplicate `tsc` pass in the
 * same chain, so the gate got both cheaper and more general.
 *
 * KNOWN LIMITS, so no other file's header leans on a promise this one does not keep:
 *   - only the FINAL path segment is case-folded, so a mis-cased intermediate
 *     directory (`./Stores/foo`) is invisible here. `tsc` catches that one — it is
 *     unresolvable on Linux — and `tsc` is `check`'s first step.
 *   - the three desktop tiers are applied to specifiers in DESKTOP-tree files. In the
 *     desktop build the plugin is not importer-scoped, so a core-tree file's `@/x` is
 *     also tiered; modelling that adds no findings today (verified: 0 divergences
 *     either way) and is left out to keep the model small.
 *   - tier 2 is modelled through the full probe chain, where the real
 *     `probeDesktopInfix` only tries `<rel>.desktop.<ext>`. Strictly broader, so it can
 *     only over-report, and there are zero `*.desktop` paths in either tree.
 *
 * Run:  npm run test:case-collisions:resolution   (~0.3 s)
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { describe } from 'node:test'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '../../..')
const UI_SRC = path.resolve(HERE, '../src')
const DESKTOP_SRC = path.resolve(HERE, '../../desktop/ui/src')
const SKIP = new Set(['node_modules', 'dist', 'build', '.git'])

/**
 * TypeScript's probe order for an extensionless specifier. Order is load-bearing.
 *
 * `.css` is deliberately ABSENT: neither `tsc` nor Vite (`resolve.extensions`)
 * extension-probes it, so including it invents a probe and manufactures false
 * positives — `./styles` beside `styles/index.ts` and `Styles.css` would be reported
 * as a macOS break that no resolver could produce. Only the desktop override plugin
 * probes `.css`, and only for `@/…`, which is a narrower case than this list is used
 * for.
 */
const PROBE_EXTS = ['.ts', '.tsx', '.d.ts', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs', '.json']
const INDEX_EXTS = PROBE_EXTS.map(e => path.join('index' + e))

const listing = new Map() // dir -> {names:Set, lower:Map(lowername -> realname)}
function readDir(dir) {
  if (listing.has(dir)) return listing.get(dir)
  const entry = { names: new Set(), lower: new Map() }
  try {
    for (const n of fs.readdirSync(dir)) {
      entry.names.add(n)
      // First writer wins, mirroring "some file with this folded name exists".
      if (!entry.lower.has(n.toLowerCase())) entry.lower.set(n.toLowerCase(), n)
    }
  } catch (e) {
    // ENOENT is normal — most probe paths do not exist. Anything else (EACCES on a
    // directory we cannot read) must NOT degrade to "empty listing": that returns the
    // same answer under both regimes, so an unreadable subtree would contribute zero
    // divergences and the test would stay green over a tree it could not see. The
    // sibling guard is explicitly fail-closed on the same condition.
    if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') throw e
  }
  listing.set(dir, entry)
  return entry
}

/** Does `p` exist, honouring case (sensitive) or folding it (insensitive)? */
function statAs(p, insensitive) {
  const dir = path.dirname(p)
  const base = path.basename(p)
  const { names, lower } = readDir(dir)
  if (names.has(base)) return path.join(dir, base)
  if (insensitive) {
    const hit = lower.get(base.toLowerCase())
    if (hit) return path.join(dir, hit)
  }
  return null
}
const isDirAs = p => {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

/**
 * Resolve a specifier the way TS does: extensions first, then dir/index.
 *
 * A trailing `.js`/`.jsx`/`.mjs`/`.cjs` is ALSO tried with its TypeScript counterpart
 * substituted — `./Foo.js` resolves to `Foo.ts`/`Foo.tsx`/`Foo.d.ts`. Without that,
 * `./Foo.js` beside `foo.ts` + `Foo.tsx` resolved to null under both regimes and the
 * divergence was invisible.
 */
const JS_TO_TS = { '.js': ['.ts', '.tsx', '.d.ts'], '.jsx': ['.tsx'], '.mjs': ['.mts'], '.cjs': ['.cts'] }

function resolve(base, insensitive) {
  // The substitution runs BEFORE the literal probe, because that is tsc's order —
  // `--traceResolution` shows `has a '.js' extension - stripping it` and then resolving
  // `foo.ts`, WITHOUT ever stat-ing `foo.js`. Running it after produced a divergence no
  // real resolver can (`./foo.js` with `Foo.js` + `foo.ts` present: tsc picks `foo.ts`
  // under both regimes; the after-order model reported `foo.ts` vs `Foo.js`).
  for (const [js, tsExts] of Object.entries(JS_TO_TS)) {
    if (!base.toLowerCase().endsWith(js)) continue
    const stem = base.slice(0, -js.length)
    for (const ts of tsExts) {
      const hit = statAs(stem + ts, insensitive)
      if (hit && !isDirAs(hit)) return hit
    }
  }
  for (const ext of ['', ...PROBE_EXTS]) {
    const hit = statAs(base + ext, insensitive)
    if (hit && !isDirAs(hit)) return hit
  }
  for (const idx of INDEX_EXTS) {
    const hit = statAs(path.join(base, idx), insensitive)
    if (hit && !isDirAs(hit)) return hit
  }
  return null
}

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walk(full, acc)
    else if (/\.(tsx?|jsx?|mts|cts)$/.test(e.name)) acc.push(full)
  }
  return acc
}

/**
 * Import specifiers, including SIDE-EFFECT imports (`import './types'`), which have no
 * `from` and were missed entirely by an earlier `from`-anchored pattern — ~90 of them,
 * and `./types` beside a `Types.ts` is a textbook collision.
 */
const SPEC_RE = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"]([^'"\n]+)['"]/g

/**
 * Every base path a specifier may resolve against, IN PROBE ORDER.
 *
 * For a file in the desktop tree, `@/x` is not one lookup but three:
 * `vite-plugin-local-override.ts::resolveOverridePath` probes tier 1
 * (`desktop/ui/src/x`), then tier 2 (`ui/src/x.desktop.*`), then tier 3 (`ui/src/x`).
 *
 * Modelling only tier 3 is what made an earlier version of this test unable to see the
 * cross-tree shape — `desktop/ui/src/x/Foo.tsx` beside `ui/src/x/foo/` — while the
 * guard's header claimed this file was the backstop for exactly that. It is now,
 * because tier 1 is modelled: under a case-insensitive filesystem the tier-1 probe of
 * `x/foo.tsx` stats as `x/Foo.tsx` and WINS, diverging from the tier-3 directory that
 * wins on Linux.
 */
/**
 * `@ziee/*` subpath aliases, from the two tsconfigs' `paths`. These map into REAL
 * source trees, not node packages — `@ziee/desktop/modules/updater/stores/updater` is
 * exactly the store-directory shape this branch is about — so skipping them left ~570
 * specifiers unchecked, including every reference into the sdk packages the shape
 * guard can only treat as advisory.
 */
const PKG_ALIASES = [
  ['@ziee/ui-core/', UI_SRC],
  ['@ziee/desktop/', DESKTOP_SRC],
  ['@ziee/kit/', path.resolve(REPO, 'sdk/packages/kit/src')],
  ['@ziee/framework/', path.resolve(REPO, 'sdk/packages/framework/src')],
  ['@ziee/shell/', path.resolve(REPO, 'sdk/packages/shell/src')],
  ['@ziee/gallery/', path.resolve(REPO, 'sdk/packages/gallery/src')],
  ['@ziee/notification-ui/', path.resolve(REPO, 'sdk/packages/notification-ui/src')],
]

/**
 * Desktop's tsconfig maps these EXACT specifiers into desktop's own tree; an exact
 * `paths` key beats the `@/*` wildcard, so they must not be resolved into `ui/src`.
 */
const DESKTOP_EXACT = new Set([
  '@/api-client/types',
  '@/api-client/permissions',
  '@/api-client/permissionDescriptions',
  '@/api-client/apiEndpoints',
])

function specifierBases(file, spec) {
  const inDesktop = file.startsWith(DESKTOP_SRC + path.sep)
  if (spec.startsWith('@/')) {
    if (inDesktop && DESKTOP_EXACT.has(spec)) return [path.join(DESKTOP_SRC, spec.slice(2))]
    const rel = spec.slice(2)
    return inDesktop
      ? [path.join(DESKTOP_SRC, rel), `${path.join(UI_SRC, rel)}.desktop`, path.join(UI_SRC, rel)]
      : [path.join(UI_SRC, rel)]
  }
  for (const [prefix, root] of PKG_ALIASES)
    if (spec.startsWith(prefix)) return [path.join(root, spec.slice(prefix.length))]
  if (spec.startsWith('./') || spec.startsWith('../')) return [path.resolve(path.dirname(file), spec)]
  return []
}

/** First base that resolves, in probe order — the module the build would load. */
function resolveTiered(bases, insensitive) {
  for (const base of bases) {
    const hit = resolve(base, insensitive)
    if (hit) return hit
  }
  return null
}

describe('case-collision fix — resolution behaviour', () => {
  test('TEST-14: no specifier resolves differently on a case-insensitive filesystem', { timeout: 600_000 }, () => {
    const files = [...walk(UI_SRC), ...walk(DESKTOP_SRC)]
    assert.ok(files.length > 1000, `expected to scan the real trees, found ${files.length} files`)

    const divergent = []
    let examined = 0
    let resolved = 0
    // PER-WORKSPACE tallies. A single global floor is satisfied by the web workspace
    // alone (it contributes ~97% of specifiers), so any change that stopped examining
    // the desktop tree would leave the headline claim — "no import in EITHER UI
    // workspace" — half unverified and still green.
    const perWs = { ui: 0, desktop: 0 }
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8')
      SPEC_RE.lastIndex = 0
      let m
      while ((m = SPEC_RE.exec(src))) {
        const bases = specifierBases(file, m[1])
        if (bases.length === 0) continue
        examined++
        perWs[file.startsWith(DESKTOP_SRC + path.sep) ? 'desktop' : 'ui']++
        const sensitive = resolveTiered(bases, false)
        const insensitive = resolveTiered(bases, true)
        if (sensitive) resolved++
        // Only a DIVERGENCE is a defect. A specifier that resolves nowhere under
        // either regime is a doc-comment or a template literal, not an import.
        if (sensitive !== insensitive)
          divergent.push({ file: path.relative(UI_SRC, file), spec: m[1], sensitive, insensitive })
      }
    }

    // Anti-vacuity: a scan that examined nothing would trivially find no divergence.
    assert.ok(examined > 5000, `expected thousands of specifiers, examined ${examined}`)
    assert.ok(resolved > examined * 0.9, `most specifiers should resolve; ${resolved}/${examined} did`)
    assert.ok(perWs.ui > 4000, `the web workspace was barely examined: ${perWs.ui} specifiers`)
    assert.ok(perWs.desktop > 100, `the DESKTOP workspace was barely examined: ${perWs.desktop} specifiers`)

    assert.deepEqual(
      divergent,
      [],
      `${divergent.length} specifier(s) resolve to a DIFFERENT module on a case-insensitive filesystem — this is the macOS/Windows build break:\n` +
        divergent
          .slice(0, 20)
          .map(d => `  ${d.file}: '${d.spec}'\n     linux=${d.sensitive}\n     macos=${d.insensitive}`)
          .join('\n'),
    )
  })

  test('TEST-14 (control): the specifier model covers what it claims to cover', () => {
    // Without this, every coverage widening in this file is unpinned. An auditor
    // reverted each of them in turn — the desktop tiers, the `@ziee/*` aliases, the
    // side-effect-import pattern, the `.js`→`.ts` substitution — and the main test
    // stayed GREEN each time, because the anti-vacuity floors have enough headroom to
    // absorb thousands of dropped specifiers. These assertions make each one load-bearing.
    const webFile = path.join(UI_SRC, 'modules/x/A.tsx')
    const desktopFile = path.join(DESKTOP_SRC, 'modules/x/A.tsx')

    // A web file sees ONE base; a desktop file sees the three resolver tiers in order.
    assert.deepEqual(specifierBases(webFile, '@/modules/y'), [path.join(UI_SRC, 'modules/y')])
    assert.deepEqual(specifierBases(desktopFile, '@/modules/y'), [
      path.join(DESKTOP_SRC, 'modules/y'),
      `${path.join(UI_SRC, 'modules/y')}.desktop`,
      path.join(UI_SRC, 'modules/y'),
    ])
    // Desktop's exact tsconfig keys beat the `@/*` wildcard.
    assert.deepEqual(specifierBases(desktopFile, '@/api-client/types'), [
      path.join(DESKTOP_SRC, 'api-client/types'),
    ])
    // `@ziee/*` subpaths resolve into real source trees, not node packages.
    assert.deepEqual(specifierBases(webFile, '@ziee/kit/kit/list'), [
      path.join(REPO, 'sdk/packages/kit/src/kit/list'),
    ])
    assert.deepEqual(specifierBases(webFile, '@ziee/desktop/modules/updater/stores/updater'), [
      path.join(DESKTOP_SRC, 'modules/updater/stores/updater'),
    ])
    // A bare package specifier is still skipped (false-negative only, by design).
    assert.deepEqual(specifierBases(webFile, 'react'), [])

    // Side-effect imports are matched by the specifier pattern.
    const found = [...`import './types'\nimport x from './y'\nimport('./z')`.matchAll(SPEC_RE)].map(m => m[1])
    assert.deepEqual(found, ['./types', './y', './z'])
  })

  test('TEST-14 (control): the simulator reproduces the real bug shapes', () => {
    // Without this the "0 divergent" result above is unfalsifiable — a simulator whose
    // insensitive branch silently equalled its sensitive one would report 0 forever.
    // These are the two shapes this branch actually fixed, rebuilt in a temp tree.
    // os.tmpdir(), NOT the repo root: an earlier version wrote `.resolution-control-*`
    // into the repo root, which is not gitignored, so a crash between mkdtemp and the
    // `finally` would leave an untracked directory behind and trip a cleanliness gate.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resolution-control-'))
    try {
      // (a) file-vs-dir: `EditUserDrawer.tsx` beside `editUserDrawer/index.ts`
      fs.mkdirSync(path.join(root, 'a', 'editUserDrawer'), { recursive: true })
      fs.writeFileSync(path.join(root, 'a', 'EditUserDrawer.tsx'), 'x\n')
      fs.writeFileSync(path.join(root, 'a', 'editUserDrawer', 'index.ts'), 'y\n')
      const aBase = path.join(root, 'a', 'editUserDrawer')
      assert.equal(path.basename(resolve(aBase, false)), 'index.ts', 'case-sensitive must pick the directory')
      assert.equal(
        path.basename(resolve(aBase, true)),
        'EditUserDrawer.tsx',
        'case-insensitive must pick the FILE — if not, the simulator cannot see the bug',
      )

      // (b) file-vs-file: `AgentStepForm.tsx` beside `agentStepForm.ts`
      fs.mkdirSync(path.join(root, 'b'), { recursive: true })
      fs.writeFileSync(path.join(root, 'b', 'AgentStepForm.tsx'), 'x\n')
      fs.writeFileSync(path.join(root, 'b', 'agentStepForm.ts'), 'y\n')
      const bBase = path.join(root, 'b', 'AgentStepForm')
      assert.equal(path.basename(resolve(bBase, false)), 'AgentStepForm.tsx')
      assert.equal(
        path.basename(resolve(bBase, true)),
        'agentStepForm.ts',
        'case-insensitive must pick the .ts helper — .ts is probed before .tsx',
      )

      // (c) the CROSS-TREE tier-1 shape, which the sibling-rule guard cannot express
      //     and which this file's header claims to backstop. Desktop tree holds
      //     `x/Foo.tsx`; core tree holds `x/foo/index.ts`. Tier 1 probes the desktop
      //     tree first, so on macOS `x/foo.tsx` stats as `x/Foo.tsx` and wins.
      const dTier1 = path.join(root, 'd', 'desktop', 'x')
      const dTier3 = path.join(root, 'd', 'core', 'x')
      fs.mkdirSync(dTier1, { recursive: true })
      fs.mkdirSync(path.join(dTier3, 'foo'), { recursive: true })
      fs.writeFileSync(path.join(dTier1, 'Foo.tsx'), 'x\n')
      fs.writeFileSync(path.join(dTier3, 'foo', 'index.ts'), 'y\n')
      // (d) TS's `.js` → `.ts` substitution. Without it, `./Widget.js` beside
      //     `Widget.ts` resolves to null under both regimes and any divergence in that
      //     shape is invisible — a mutation that deleted JS_TO_TS changed nothing
      //     observable in the main test.
      fs.mkdirSync(path.join(root, 'e'), { recursive: true })
      fs.writeFileSync(path.join(root, 'e', 'Widget.ts'), 'x\n')
      assert.equal(
        path.basename(resolve(path.join(root, 'e', 'Widget.js'), false)),
        'Widget.ts',
        'a `.js` specifier must resolve to its `.ts` source — TS strips the extension before probing',
      )

      const tiers = [path.join(dTier1, 'foo'), path.join(dTier3, 'foo')]
      assert.equal(
        path.basename(resolveTiered(tiers, false)),
        'index.ts',
        'case-sensitive must fall through tier 1 to the core directory',
      )
      assert.equal(
        path.basename(resolveTiered(tiers, true)),
        'Foo.tsx',
        'case-insensitive must stop at the tier-1 desktop file — if not, this file does NOT backstop the cross-tree shape its header claims it does',
      )
    } finally {
      listing.clear() // the control wrote into a fresh dir; drop the memoised listings
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
