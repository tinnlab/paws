/**
 * Gating lint: sibling names that differ ONLY by case.
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
 * KNOWN LIMIT, stated rather than implied: all three rules compare SIBLINGS INSIDE ONE
 * DIRECTORY. The desktop resolver's Tier 1 (`probeFileOrIndex(localSrc, relative)` in
 * vite-plugin-local-override.ts) resolves a core-tree specifier against the DESKTOP
 * tree, so `desktop/ui/src/x/Foo.tsx` beside `ui/src/x/foo/` diverges the same way and
 * no rule here sees it. There are zero such pairs today (checked across both trees).
 * The behavioural backstop is `lint-case-collisions.resolution.test.mjs`, which
 * resolves every real import specifier twice — once case-sensitively, once as a
 * case-insensitive filesystem would — and diffs the results; it catches divergence by
 * OUTCOME rather than by shape, so it is not blind to this the way a sibling rule is.
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
 *      disappears on clone. Evaluated FIRST, because it is the strictly worse
 *      diagnosis and its fix advice differs.
 *
 * A file has more than one RESOLVER STEM when the desktop resolver would match it for
 * a bare specifier: `probeDesktopInfix` in `vite-plugin-local-override.ts` probes
 * `<name>.desktop.<ext>` BEFORE the directory, so `ProviderGroupAssignmentCard.desktop.tsx`
 * collides with a sibling `providerGroupAssignmentCard/` just as the plain file would.
 * That pair was live on `origin/main` until the store move dissolved it incidentally;
 * nothing but this rule stops it coming back.
 *
 * Extension and infix matching are themselves CASE-INSENSITIVE. Modelling a
 * case-insensitive filesystem with case-SENSITIVE suffix comparisons is the same
 * mistake this guard exists to catch: `Foo.Desktop.tsx` beside `foo/` mis-resolves on
 * macOS exactly as `Foo.desktop.tsx` does, and so does `Widget.TSX` beside `widget/`.
 *
 * None of the rules fires on a same-case pair, so the legitimate coexisting shapes
 * stay green by construction and need no allowlist: `use-mobile.ts` + `use-mobile.tsx`
 * (identical stem), `types/` + `types.ts`, `constants/` + `constants.tsx`.
 *
 * There is deliberately NO allowlist and NO per-entry opt-out for the trees this repo
 * OWNS: they are at zero findings, so an escape hatch would be a hole with no
 * occupant. A genuine future exception is a conversation, not a silent JSON entry.
 *
 * IT FAILS CLOSED on those trees. A mandatory root that does not exist, is not a
 * directory, or cannot be read is a hard error — never a quiet "OK". An earlier
 * revision swallowed those and printed the same green line whether it had scanned 623
 * directories or none. A symlinked directory is named (so it can still collide) but
 * not walked, and every one is reported, so no subtree is ever called clean by
 * omission.
 *
 * `sdk/` IS DIFFERENT, and deliberately ADVISORY. It is a read-only submodule
 * (`ziee-ai/sdk`, not pushable from here), yet both workspaces compile it through
 * their `@ziee/*` path mappings, so a collision there really would break the macOS
 * build. Reporting it is useful; HARD-BLOCKING on it is not — nobody working in this
 * repo could clear it, and there is no allowlist to escape through, so `npm run check`
 * would simply be unpassable until an upstream release. sdk findings therefore print
 * in full, name the upstream repo, and do not by themselves set a non-zero exit. If
 * sdk is not checked out that is stated explicitly, rather than silently dropping
 * roots and still printing OK.
 *
 * Run:
 *   node scripts/lint-case-collisions.mjs              # every compiled tree; exit 1 on any owned-tree finding
 *   node scripts/lint-case-collisions.mjs --root=<dir> # scan ONLY <dir>, as mandatory (repeatable; used by the tests)
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
 * the specifier WITHOUT it, so it needs the extra stem. Applied in every root: it only
 * ever ADDS a stem, so at worst it is over-strict, and it has zero occupants outside
 * the two app trees.
 */
const RESOLVER_INFIXES = ['.desktop']

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git'])

/** Things the operator must be told even when the run is green. */
const notices = []

function fail(message) {
  console.error(`[case-collisions] FATAL: ${message}`)
  process.exit(1)
}

/**
 * The trees the two UI builds actually compile, split by whether THIS repo can fix a
 * finding in them.
 *
 *  - MANDATORY (fail closed): both app `src` dirs; both `tests` dirs (in each
 *    tsconfig's `include`); both `plugins` dirs (desktop's is compiled via
 *    `tsconfig.node.json` → `vite.config.ts` → `plugins/vite-plugin-local-override.ts`);
 *    both `scripts` dirs (Node ESM, resolved at runtime by the `check` stages).
 *  - ADVISORY (report, do not block): `sdk/packages/<pkg>/src`, reachable through the
 *    `@ziee/*` path mappings but owned by a read-only submodule. See the header.
 *
 * Roots are anchored to THIS FILE, never to the CWD, so the single script is correct
 * when invoked from src-app/ui *or* from src-app/desktop/ui (which registers it as
 * `node ../../ui/scripts/lint-case-collisions.mjs`, mirroring check:override-registry).
 */
function defaultRoots() {
  const mandatory = [
    path.resolve(HERE, '../src'),
    path.resolve(HERE, '../tests'),
    path.resolve(HERE, '../plugins'),
    path.resolve(HERE, '.'),
    path.resolve(HERE, '../../desktop/ui/src'),
    path.resolve(HERE, '../../desktop/ui/tests'),
    path.resolve(HERE, '../../desktop/ui/plugins'),
    path.resolve(HERE, '../../desktop/ui/scripts'),
  ].map(dir => ({ dir, advisory: false }))

  const sdkPackages = path.join(REPO, 'sdk', 'packages')
  if (!fs.existsSync(sdkPackages)) {
    notices.push(
      'sdk/packages is not present (submodule not checked out) — the `@ziee/*` package sources were NOT scanned. Run `git submodule update --init`.',
    )
    return mandatory
  }
  const advisory = []
  for (const e of fs.readdirSync(sdkPackages, { withFileTypes: true })) {
    if (!e.isDirectory()) continue
    const src = path.join(sdkPackages, e.name, 'src')
    if (fs.existsSync(src)) advisory.push({ dir: src, advisory: true })
  }
  if (advisory.length === 0)
    fail('sdk/packages exists but contains no <pkg>/src — the sdk roots would be silently empty')
  return [...mandatory, ...advisory]
}

/**
 * `--root=<dir>` REPLACES the defaults with ONE mandatory root. It exists only so the
 * guard's own fixture tests can point it at a throwaway tree.
 *
 * It accepts exactly one, deliberately. An earlier revision took a repeatable
 * `--root=` and grew realpath dedup plus a "drop a root nested inside another" rule to
 * keep the counts honest — and that machinery then produced two of its own defects: a
 * mandatory root whose realpath fell inside an advisory root was silently reclassified
 * as advisory (fail-OPEN), and a root under another root's `SKIP_DIRS` was dropped and
 * then scanned by nobody. Neither shape had a real caller: the defaults are disjoint
 * by construction and every test passes a single root. Removing the feature removes
 * both defects outright, which is a better answer than a third predicate guarding the
 * second predicate.
 */
const rootArgs = process.argv.filter(a => a.startsWith('--root='))
if (rootArgs.length > 1) fail('--root= accepts exactly one directory (pass one root, or none for the defaults)')

const rawRoots = rootArgs.length
  ? [{ dir: path.resolve(process.cwd(), rootArgs[0].slice('--root='.length)), advisory: false }]
  : defaultRoots()

const ROOTS = []
for (const r of rawRoots) {
  let real
  try {
    real = fs.realpathSync(r.dir)
  } catch (e) {
    if (r.advisory) continue
    fail(`root does not exist: ${r.dir} (${e.code ?? e.message})`)
  }
  ROOTS.push({ ...r, real })
}

/**
 * Every specifier stem this filename answers to. `EditUserDrawer.tsx` → `EditUserDrawer`;
 * `LeftSidebar.desktop.tsx` → `LeftSidebar.desktop` AND `LeftSidebar`. Returns [] for
 * a name with no probed extension (`README.md`, `foo.scss`), which no resolver probes.
 */
function resolverStems(name) {
  const lower = name.toLowerCase()
  const ext = PROBED_EXTENSIONS.find(e => lower.endsWith(e) && name.length > e.length)
  if (!ext) return []
  const stem = name.slice(0, -ext.length)
  const stems = [stem]
  const stemLower = stem.toLowerCase()
  for (const infix of RESOLVER_INFIXES)
    if (stemLower.endsWith(infix) && stem.length > infix.length) stems.push(stem.slice(0, -infix.length))
  return stems
}

const findings = []
const seen = new Set() // dedupe: one finding per (dir, name set)
/**
 * Entries ANALYSED, per root — not directories traversed.
 *
 * This distinction is load-bearing, and it was learned the hard way. When this counter
 * measured directories walked, a mutation that recursed into a subtree but performed
 * no collision analysis inside it kept the count byte-identical, so the test comparing
 * the guard's self-report against an independent recount stayed green while a planted
 * collision went undetected. Counting the entries the rules actually looked at makes
 * "walked past it" and "checked it" different numbers, which is the only way an
 * external recount can tell them apart.
 */
const analysedPerRoot = new Map()

function addFinding(rule, root, dir, names, why) {
  const key = `${dir} ${[...names].sort().join(' ')}`
  if (seen.has(key)) return
  seen.add(key)
  findings.push({ rule, root, dir, names: [...names].sort(), why })
}

function scan(dir, root) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch (e) {
    // Fail CLOSED. An unreadable directory is indistinguishable from a clean one to a
    // `catch { return }`, and reporting it clean is the worst possible answer.
    fail(`cannot read ${dir}: ${e.code ?? e.message}`)
  }
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
      // Follow the link to classify it — a symlinked module resolves like the real
      // thing. A broken link resolves to nothing, so it collides with nothing.
      let st
      try {
        st = fs.statSync(path.join(dir, e.name))
      } catch {
        continue
      }
      if (st.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) {
          dirs.push(e.name) // named, so it can still collide…
          // …but NOT walked, which keeps the walk acyclic. Say so: a subtree we did
          // not look at must never be reported clean by omission.
          notices.push(
            `${path.relative(REPO, path.join(dir, e.name))} is a symlinked directory — named for collision purposes but NOT walked. Scan its target directly with --root= if it needs checking.`,
          )
        }
      } else if (st.isFile()) files.push(e.name)
    }
  }

  // Every entry below this line is one the rules actually LOOK at. Counted here, at
  // the point of analysis, so a subtree that is traversed but not analysed changes the
  // number — see analysedPerRoot.
  analysedPerRoot.set(root.real, (analysedPerRoot.get(root.real) ?? 0) + files.length + dirs.length)

  // Rule 3 FIRST — a full-name case duplicate is strictly the worst diagnosis (the two
  // entries cannot both exist on a case-insensitive checkout, so one is LOST, not
  // merely mis-resolved) and its fix advice differs. Findings are deduped by
  // (directory, name set), so running it first means such a pair is reported as the
  // filesystem collision it is rather than the stem collision it also happens to be.
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
      root,
      dir,
      names,
      'sibling entries differ only by case — a case-insensitive checkout cannot represent all of them, so one is silently lost on clone',
    )
  }

  // Rules 1 + 2 — resolver-stem collisions. A stem can be produced by SEVERAL files
  // (`Foo.tsx` and `Foo.desktop.tsx` both answer to `Foo`), so the value is a Set;
  // last-writer-wins would name only one of them in the report.
  const stemOwners = new Map() // lowercased stem -> Map(actual stem -> Set(filenames))
  for (const f of files) {
    for (const stem of resolverStems(f)) {
      const k = stem.toLowerCase()
      if (!stemOwners.has(k)) stemOwners.set(k, new Map())
      const owners = stemOwners.get(k)
      if (!owners.has(stem)) owners.set(stem, new Set())
      owners.get(stem).add(f)
    }
  }
  const dirsByLower = new Map()
  for (const d of dirs) {
    const k = d.toLowerCase()
    if (!dirsByLower.has(k)) dirsByLower.set(k, new Set())
    dirsByLower.get(k).add(d)
  }

  for (const [lower, owners] of stemOwners) {
    // Rule 1 — file stem vs a sibling DIRECTORY name.
    for (const dirName of dirsByLower.get(lower) ?? []) {
      const offenders = new Set()
      for (const [stem, names] of owners) if (stem !== dirName) for (const n of names) offenders.add(n)
      if (offenders.size)
        addFinding(
          'file-vs-dir',
          root,
          dir,
          [...offenders, `${dirName}/`],
          `${[...offenders].map(n => `\`${n}\``).join(', ')} ${offenders.size > 1 ? 'are' : 'is'} extension-probed as a stem that a case-insensitive filesystem matches against the sibling directory \`${dirName}/\` — so an import of \`${dirName}\` resolves to a FILE on macOS/Windows and to the DIRECTORY on Linux`,
        )
    }
    // Rule 2 — file stem vs another FILE's stem.
    if (owners.size > 1) {
      const stems = [...owners.keys()].sort()
      const names = [...new Set([...owners.values()].flatMap(s => [...s]))]
      if (names.length > 1)
        addFinding(
          'file-vs-file',
          root,
          dir,
          names,
          `${names.map(n => `\`${n}\``).join(' and ')} are extension-probed as ${stems.map(s => `\`${s}\``).join(' / ')}, which a case-insensitive filesystem cannot tell apart — a bare import of either resolves by PROBE ORDER (\`.ts\` before \`.tsx\`), so it picks a different module on macOS/Windows than on Linux`,
        )
    }
  }

  for (const d of dirs) {
    const full = path.join(dir, d)
    let st
    try {
      st = fs.lstatSync(full)
    } catch (e) {
      fail(`cannot stat ${full}: ${e.code ?? e.message}`)
    }
    if (st.isDirectory()) scan(full, root) // real dirs only; symlinked ones noticed above
  }
}

if (ROOTS.length === 0) fail('no roots to scan')
for (const root of ROOTS) {
  let st
  try {
    st = fs.statSync(root.real)
  } catch (e) {
    if (root.advisory) continue
    fail(`root does not exist: ${root.dir} (${e.code ?? e.message})`)
  }
  if (!st.isDirectory()) fail(`root is not a directory: ${root.dir}`)
  analysedPerRoot.set(root.real, 0)
  // No post-scan "did it scan anything?" check: the only readdir failure path inside
  // `scan()` is `fail()`, so such a check could never fire. A fail-closed guard that
  // cannot fire reads as safety it does not provide; the real protections are the root
  // `statSync` above and TEST-1's independent recount of the ANALYSED entries.
  scan(root.real, root)
}

const rel = r => path.relative(REPO, r) || r
const totalAnalysed = [...analysedPerRoot.values()].reduce((a, b) => a + b, 0)
const scope = `analysed ${totalAnalysed} entr${totalAnalysed === 1 ? 'y' : 'ies'} across ${ROOTS.length} root(s): ${ROOTS.map(r => `${rel(r.real)}${r.advisory ? '(advisory)' : ''}=${analysedPerRoot.get(r.real) ?? 0}`).join(' ')}`

const blocking = findings.filter(f => !f.root.advisory)
const advisoryFindings = findings.filter(f => f.root.advisory)

const print = list => {
  for (const f of list) {
    console.log(`  ${path.relative(process.cwd(), f.dir)}/`)
    console.log(`    ${f.names.join('  <->  ')}   [${f.rule}]`)
    console.log(`      ${f.why}\n`)
  }
}

for (const n of [...new Set(notices)]) console.log(`[case-collisions] NOTE: ${n}`)

if (advisoryFindings.length) {
  console.log(
    `\n[case-collisions] ${advisoryFindings.length} case collision(s) in the READ-ONLY sdk submodule (ADVISORY — this repo cannot fix them):\n`,
  )
  print(advisoryFindings)
  console.log(
    'These WILL break the macOS/Windows build. Fix them upstream in `ziee-ai/sdk` and\n' +
      'bump the submodule pointer here. They do not fail this check, because no change\n' +
      'made in this repo could clear it.\n',
  )
}

if (blocking.length) {
  console.log(
    `[case-collisions] ${blocking.length} case collision(s) — these break the build on macOS and Windows (${scope}):\n`,
  )
  print(blocking)
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
} else if (advisoryFindings.length) {
  // NOT "OK". There ARE collisions; they are simply in a tree this repo cannot fix.
  // Printing the unqualified green line here would contradict the report directly
  // above it, and that line is what a reader skims for.
  console.log(
    `[case-collisions] no BLOCKING collisions in the trees this repo owns, but ${advisoryFindings.length} advisory finding(s) remain upstream — see above (${scope}).`,
  )
} else {
  console.log(`[case-collisions] OK - no sibling names differ only by case (${scope}).`)
}
