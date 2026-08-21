/**
 * Gating lint: sibling names that differ ONLY by ASCII case.
 *
 * WHY THIS EXISTS — the bug it closes
 * -----------------------------------
 * The repo used to build only on a case-SENSITIVE filesystem. It built on Linux and
 * failed on macOS and Windows, with 24 pairs shaped like:
 *
 *     components/user/EditUserDrawer.tsx     <- the component
 *     components/user/editUserDrawer/        <- its store (index.ts, state.ts, actions/)
 *
 * TypeScript (and the desktop resolver in
 * `src-app/desktop/ui/plugins/vite-plugin-local-override.ts`) resolve a bare
 * specifier by probing EXTENSIONS FIRST — `./editUserDrawer.ts`, `./editUserDrawer.tsx`,
 * … — before ever trying `./editUserDrawer/index.ts`. On Linux those probes miss and
 * the directory wins. On a case-INSENSITIVE filesystem `editUserDrawer.tsx` stats as
 * `EditUserDrawer.tsx`, so the STORE import silently resolves to the COMPONENT. The
 * macOS runner reported an included file named `modelDetailsDrawer.tsx` — a file that
 * does not exist in this repo — and everything downstream (`Property 'open' does not
 * exist`, `useModelDetailsDrawerStore` not exported) was fallout of that one
 * mis-resolution. `forceConsistentCasingInFileNames` defaults to true in TS 5+, so it
 * is a hard error, not a warning.
 *   Failing run: https://github.com/tinnlab/paws/actions/runs/32516353496
 *   (job `dev build aarch64-apple-darwin`, step `Build`).
 *
 * WHAT IT CHECKS — three rules, per directory, over sibling entries
 * ----------------------------------------------------------------
 * Each rule maps to a real resolver probe, which is why the rule set is BOUNDED
 * rather than a growing pile of predicates.
 *
 *   1. file-vs-directory — a file's RESOLVER STEM is case-insensitively EQUAL to,
 *      but case-sensitively DIFFERENT from, a sibling directory's name. This is the
 *      bug above: `EditUserDrawer.tsx` (stem `EditUserDrawer`) beside `editUserDrawer/`.
 *   2. file-vs-file — two sibling files whose RESOLVER STEMS collide the same way,
 *      e.g. `AgentStepForm.tsx` (the component) beside `agentStepForm.ts` (its
 *      helpers). Because `.ts` is probed BEFORE `.tsx`, `./AgentStepForm` resolves to
 *      the HELPERS on macOS and to the COMPONENT on Linux. This shape was live in
 *      this tree and is exactly as fatal as rule 1 — a guard that only knew rule 1
 *      called the tree clean while it still had one.
 *   3. any-vs-any — two sibling entries whose FULL names are case-insensitively equal
 *      but not identical (file/file, dir/dir, file/dir). This is a TRUE filesystem
 *      collision: a case-insensitive checkout cannot represent both, so one silently
 *      disappears on clone.
 *
 * A file has more than one RESOLVER STEM when the desktop resolver would match it
 * for a bare specifier: `probeDesktopInfix` in `vite-plugin-local-override.ts` probes
 * `<name>.desktop.<ext>` BEFORE the directory, so `ProviderGroupAssignmentCard.desktop.tsx`
 * collides with a sibling `providerGroupAssignmentCard/` just as the plain file would.
 * That pair was live on `origin/main` until the store move dissolved it incidentally;
 * nothing but this rule stops it coming back.
 *
 * None of the rules fires on a same-case pair, so the legitimate coexisting shapes
 * stay green by construction and need no allowlist: `use-mobile.ts` + `use-mobile.tsx`
 * (identical stem), `types/` + `types.ts`, `constants/` + `constants.tsx`.
 *
 * There is deliberately NO allowlist and NO per-entry opt-out: the tree is at zero
 * findings, so an escape hatch here would be a hole with no occupant. A genuine
 * future exception is a conversation, not a silent entry in a JSON file.
 *
 * IT FAILS CLOSED. A root that does not exist, is not a directory, or cannot be read
 * is a hard error — never a quiet "OK". An earlier revision swallowed those and
 * printed the same green line whether it had scanned 623 directories or none, which
 * is the fail-open shape this repo has been bitten by before.
 *
 * Run:
 *   node scripts/lint-case-collisions.mjs              # every compiled tree; exit 1 on any finding
 *   node scripts/lint-case-collisions.mjs --root=<dir> # scan ONLY <dir> (repeatable; used by the tests)
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '../../..')

/**
 * Extensions a module resolver EXTENSION-PROBES. This is a correctness constraint,
 * not a preference: it is the union of the desktop override resolver's own list
 * (`['.ts','.tsx','.js','.jsx','.json','.css']` in vite-plugin-local-override.ts),
 * TypeScript's `.mts`/`.cts`, and Node/Vite's `.mjs`/`.cjs`. Narrower would leave a
 * reachable hole; wider would flag assets no resolver probes.
 */
const PROBED_EXTENSIONS = [
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.json', '.css',
]

/**
 * The build-time infix the desktop resolver probes ahead of a directory
 * (`vite-plugin-local-override.ts::probeDesktopInfix`). A file carrying it answers to
 * the specifier WITHOUT it, so it needs the extra stem.
 */
const RESOLVER_INFIXES = ['.desktop']

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git'])

/**
 * Every tree the two UI builds actually COMPILE — not just the two app `src` dirs.
 * A collision under `tests/` or under an `@ziee/*` package breaks the macOS build
 * identically, and both are inside `tsconfig`'s reach:
 *   - `src-app/ui/tsconfig.json`         → include: ["src", "tests"]
 *   - `src-app/desktop/ui/tsconfig.json` → include: ["src", "tests", "../../ui/src"]
 *   - both map `@ziee/*` into `sdk/packages/<pkg>/src`
 * `sdk/` is a read-only submodule, so a finding there cannot be fixed in this repo —
 * it is scanned anyway, because a macOS build that fails on an sdk collision is worse
 * than a red local gate that names it. Every one of `npm run check`'s other stages
 * already requires the submodule to be checked out, so depending on it adds no new
 * precondition.
 *
 * Roots are anchored to THIS FILE, never to the CWD, so the single script is correct
 * when invoked from src-app/ui *or* from src-app/desktop/ui (which registers it as
 * `node ../../ui/scripts/lint-case-collisions.mjs`, mirroring check:override-registry).
 */
function defaultRoots() {
  const roots = [
    path.resolve(HERE, '../src'),
    path.resolve(HERE, '../tests'),
    path.resolve(HERE, '../../desktop/ui/src'),
    path.resolve(HERE, '../../desktop/ui/tests'),
  ]
  const sdkPackages = path.join(REPO, 'sdk', 'packages')
  let pkgSrcCount = 0
  if (fs.existsSync(sdkPackages)) {
    for (const e of fs.readdirSync(sdkPackages, { withFileTypes: true })) {
      if (!e.isDirectory()) continue
      const src = path.join(sdkPackages, e.name, 'src')
      if (fs.existsSync(src)) {
        roots.push(src)
        pkgSrcCount++
      }
    }
    if (pkgSrcCount === 0) fail(`sdk/packages exists but contains no <pkg>/src — the sdk roots would be silently empty`)
  }
  return roots
}

function fail(message) {
  console.error(`[case-collisions] FATAL: ${message}`)
  process.exit(1)
}

// `--root=<dir>` REPLACES the defaults and is used only by this guard's own fixture
// tests. Duplicates are collapsed so a repeated root cannot double-count a finding.
const rootArgs = process.argv
  .filter(a => a.startsWith('--root='))
  .map(a => path.resolve(process.cwd(), a.slice('--root='.length)))
const ROOTS = [...new Set(rootArgs.length ? rootArgs : defaultRoots())]

/**
 * Every specifier stem this filename answers to. `EditUserDrawer.tsx` → `EditUserDrawer`;
 * `LeftSidebar.desktop.tsx` → `LeftSidebar.desktop` AND `LeftSidebar`. Returns [] for
 * a name with no probed extension (`README.md`, `foo.scss`), which no resolver probes.
 */
function resolverStems(name) {
  const ext = PROBED_EXTENSIONS.find(e => name.endsWith(e) && name.length > e.length)
  if (!ext) return []
  const stem = name.slice(0, -ext.length)
  const stems = [stem]
  for (const infix of RESOLVER_INFIXES) {
    if (stem.endsWith(infix) && stem.length > infix.length) stems.push(stem.slice(0, -infix.length))
  }
  return stems
}

const findings = []
const seen = new Set() // dedupe: one finding per (dir, ruleless name pair)
/** Directories walked, PER ROOT — an aggregate would hide a root that resolved to nothing. */
const scannedPerRoot = new Map()

function addFinding(rule, dir, names, why) {
  const key = `${dir} ${[...names].sort().join(' ')}`
  if (seen.has(key)) return
  seen.add(key)
  findings.push({ rule, dir, names: [...names].sort(), why })
}

function scan(dir, rootKey) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch (e) {
    // Fail CLOSED. An unreadable directory is indistinguishable from a clean one to
    // a `catch { return }`, and reporting it clean is the worst possible answer.
    fail(`cannot read ${dir}: ${e.code ?? e.message}`)
  }
  scannedPerRoot.set(rootKey, (scannedPerRoot.get(rootKey) ?? 0) + 1)

  // Classify by following symlinks (a symlinked module resolves like the real thing),
  // falling back to the link's own type if the target is missing.
  const files = []
  const dirs = []
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) dirs.push(e.name)
      continue
    }
    if (e.isFile()) {
      files.push(e.name)
      continue
    }
    if (e.isSymbolicLink()) {
      let st
      try {
        st = fs.statSync(path.join(dir, e.name))
      } catch {
        continue // broken link: resolves to nothing, so it collides with nothing
      }
      if (st.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) dirs.push(e.name) // named, but not recursed into
      } else if (st.isFile()) files.push(e.name)
    }
  }

  const dirByLower = new Map()
  for (const d of dirs) dirByLower.set(d.toLowerCase(), d)

  // Rule 3 FIRST — a full-name case duplicate is strictly the worst diagnosis (the
  // two entries cannot both exist on a case-insensitive checkout, so one is LOST,
  // not merely mis-resolved) and the fix advice differs. Findings are deduped by
  // (directory, name set), so running it first means such a pair is reported as the
  // filesystem collision it is rather than as the stem collision it also happens
  // to be.
  const byLower = new Map()
  for (const n of [...files, ...dirs]) {
    const k = n.toLowerCase()
    if (!byLower.has(k)) byLower.set(k, new Set())
    byLower.get(k).add(n)
  }
  for (const names of byLower.values()) {
    if (names.size < 2) continue
    addFinding(
      'any-vs-any',
      dir,
      names,
      'sibling entries differ only by case — a case-insensitive checkout cannot represent all of them, so one is silently lost on clone',
    )
  }

  // Rules 1 + 2 — resolver-stem collisions.
  const stemOwners = new Map() // lowercased stem -> Map(actual stem -> filename)
  for (const f of files) {
    for (const stem of resolverStems(f)) {
      const k = stem.toLowerCase()
      if (!stemOwners.has(k)) stemOwners.set(k, new Map())
      stemOwners.get(k).set(stem, f)
    }
  }

  for (const [lower, owners] of stemOwners) {
    // Rule 1 — file stem vs a sibling DIRECTORY name.
    const dirName = dirByLower.get(lower)
    if (dirName !== undefined) {
      for (const [stem, file] of owners) {
        if (stem === dirName) continue
        addFinding(
          'file-vs-dir',
          dir,
          [file, `${dirName}/`],
          `\`${file}\` is extension-probed as \`${stem}\`, which a case-insensitive filesystem matches against the sibling directory \`${dirName}/\` — so an import of \`${dirName}\` resolves to the FILE on macOS/Windows and to the DIRECTORY on Linux`,
        )
      }
    }
    // Rule 2 — file stem vs another FILE's stem.
    if (owners.size > 1) {
      const stems = [...owners.keys()].sort()
      const names = [...new Set(owners.values())]
      if (names.length > 1) {
        addFinding(
          'file-vs-file',
          dir,
          names,
          `${names.map(n => `\`${n}\``).join(' and ')} are extension-probed as ${stems.map(s => `\`${s}\``).join(' / ')}, which a case-insensitive filesystem cannot tell apart — a bare import of either resolves by PROBE ORDER (\`.ts\` before \`.tsx\`), so it picks a different module on macOS/Windows than on Linux`,
        )
      }
    }
  }

  for (const d of dirs) {
    // Only recurse into REAL directories; a symlinked dir is named above (so it can
    // collide) but not walked, which keeps the walk acyclic.
    const full = path.join(dir, d)
    let st
    try {
      st = fs.lstatSync(full)
    } catch (e) {
      fail(`cannot stat ${full}: ${e.code ?? e.message}`)
    }
    if (st.isDirectory()) scan(full, rootKey)
  }
}

// Fail CLOSED on the roots themselves before walking anything.
if (ROOTS.length === 0) fail('no roots to scan')
for (const root of ROOTS) {
  let st
  try {
    st = fs.statSync(root)
  } catch (e) {
    fail(`root does not exist: ${root} (${e.code ?? e.message})`)
  }
  if (!st.isDirectory()) fail(`root is not a directory: ${root}`)
  scannedPerRoot.set(root, 0)
  scan(root, root)
  if ((scannedPerRoot.get(root) ?? 0) === 0) fail(`root scanned 0 directories: ${root}`)
}

const totalScanned = [...scannedPerRoot.values()].reduce((a, b) => a + b, 0)
const scope = `scanned ${totalScanned} director${totalScanned === 1 ? 'y' : 'ies'} across ${ROOTS.length} root(s): ${ROOTS.map(r => `${path.relative(REPO, r) || r}=${scannedPerRoot.get(r)}`).join(' ')}`

if (findings.length) {
  console.log(
    `[case-collisions] ${findings.length} case collision(s) — these break the build on macOS and Windows (${scope}):\n`,
  )
  for (const f of findings) {
    console.log(`  ${path.relative(process.cwd(), f.dir)}/`)
    console.log(`    ${f.names.join('  <->  ')}   [${f.rule}]`)
    console.log(`      ${f.why}\n`)
  }
  console.log(
    'Fix: rename or relocate one side so the two names no longer differ only by case.\n' +
      'For a component/store pair, move the store under a `stores/` parent beside its\n' +
      'component (the convention 90+ stores already follow):\n' +
      '  components/user/editUserDrawer/  ->  components/user/stores/editUserDrawer/\n' +
      'For a component/helper pair, give the helper a distinct stem:\n' +
      '  builder/agentStepForm.ts  ->  builder/agentStepForm.helpers.ts\n' +
      'then update its import sites. Never rely on a case-sensitive filesystem.',
  )
  process.exit(1)
} else {
  console.log(`[case-collisions] OK - no sibling names differ only by case (${scope}).`)
}
