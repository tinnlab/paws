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
 * WHAT IT CHECKS — two rules, per directory, over sibling entries
 * --------------------------------------------------------------
 *   1. file-vs-directory — a source file whose basename WITHOUT its extension is
 *      case-insensitively EQUAL to, but case-sensitively DIFFERENT from, a sibling
 *      directory's name. This is the bug above.
 *   2. any-vs-any — two sibling entries whose FULL names are case-insensitively equal
 *      but not identical (file/file, dir/dir, file/dir). This is a TRUE filesystem
 *      collision: a case-insensitive checkout cannot represent both, so one silently
 *      disappears on clone.
 *
 * Neither rule fires on same-case pairs, so the legitimate coexisting shapes stay
 * green by construction and need no allowlist: `use-mobile.ts` + `use-mobile.tsx`
 * (identical basename), `types/` + `types.ts`, `constants/` + `constants.tsx`.
 *
 * There is deliberately NO allowlist and NO per-entry opt-out: the tree is at zero
 * findings, so an escape hatch here would be a hole with no occupant. A genuine
 * future exception is a conversation, not a silent entry in a JSON file.
 *
 * Run:
 *   node scripts/lint-case-collisions.mjs              # both UI trees; exit 1 on any finding
 *   node scripts/lint-case-collisions.mjs --root=<dir> # scan ONLY <dir> (repeatable; used by the tests)
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

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

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git'])

// Roots are anchored to THIS FILE, never to the CWD, so the single script is correct
// when invoked from src-app/ui *or* from src-app/desktop/ui (which registers it as
// `node ../../ui/scripts/lint-case-collisions.mjs`, mirroring check:override-registry).
const rootArgs = process.argv
  .filter(a => a.startsWith('--root='))
  .map(a => path.resolve(process.cwd(), a.slice('--root='.length)))
const ROOTS = rootArgs.length
  ? rootArgs
  : [path.resolve(HERE, '../src'), path.resolve(HERE, '../../desktop/ui/src')]

/** Strip a probed extension; returns the name unchanged if it has none. */
function stripProbedExt(name) {
  const ext = PROBED_EXTENSIONS.find(e => name.endsWith(e) && name.length > e.length)
  return ext ? name.slice(0, -ext.length) : null
}

const findings = []
/**
 * Directories actually walked. Reported on every run so a caller can tell "clean"
 * from "scanned nothing" — a guard whose roots silently stopped resolving would
 * otherwise print the same green line as a guard that really checked the tree.
 */
let scannedDirs = 0

function scan(dir) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  scannedDirs++

  const dirsByLower = new Map() // lowercased dir name -> actual dir name
  for (const e of entries) {
    if (!e.isDirectory() || SKIP_DIRS.has(e.name)) continue
    dirsByLower.set(e.name.toLowerCase(), e.name)
  }

  // Rule 1 — file basename (extension stripped) vs a sibling directory name.
  for (const e of entries) {
    if (!e.isFile()) continue
    const base = stripProbedExt(e.name)
    if (base === null) continue
    const dirName = dirsByLower.get(base.toLowerCase())
    if (dirName !== undefined && dirName !== base) {
      findings.push({
        rule: 'file-vs-dir',
        dir,
        a: e.name,
        b: `${dirName}/`,
        why: `\`${e.name}\` is extension-probed as \`${base}\`, which a case-insensitive filesystem matches against the sibling directory \`${dirName}/\` — so an import of \`${dirName}\` resolves to the FILE on macOS/Windows and to the DIRECTORY on Linux`,
      })
    }
  }

  // Rule 2 — two sibling entries whose FULL names collide case-insensitively.
  const byLower = new Map() // lowercased full name -> [actual names]
  for (const e of entries) {
    if (e.isDirectory() && SKIP_DIRS.has(e.name)) continue
    const key = e.name.toLowerCase()
    if (!byLower.has(key)) byLower.set(key, [])
    byLower.get(key).push(e.name)
  }
  for (const names of byLower.values()) {
    if (names.length < 2) continue
    const distinct = [...new Set(names)]
    if (distinct.length < 2) continue // identical names cannot coexist; defensive
    distinct.sort()
    findings.push({
      rule: 'any-vs-any',
      dir,
      a: distinct[0],
      b: distinct[1],
      why: 'two sibling entries differ only by case — a case-insensitive checkout cannot represent both, so one is silently lost on clone',
    })
  }

  for (const e of entries) {
    if (e.isDirectory() && !SKIP_DIRS.has(e.name)) scan(path.join(dir, e.name))
  }
}

for (const root of ROOTS) scan(root)

const scope = `scanned ${scannedDirs} director${scannedDirs === 1 ? 'y' : 'ies'} under ${ROOTS.length} root(s)`

if (findings.length) {
  console.log(
    `[case-collisions] ${findings.length} case collision(s) — these break the build on macOS and Windows (${scope}):\n`,
  )
  for (const f of findings) {
    console.log(`  ${path.relative(process.cwd(), f.dir)}/`)
    console.log(`    ${f.a}  <->  ${f.b}   [${f.rule}]`)
    console.log(`      ${f.why}\n`)
  }
  console.log(
    'Fix: move the store directory under a `stores/` parent beside its component\n' +
      '(the convention 90+ stores already follow), e.g.\n' +
      '  components/user/editUserDrawer/  ->  components/user/stores/editUserDrawer/\n' +
      'then update its import sites. Never rely on a case-sensitive filesystem.',
  )
  process.exit(1)
} else {
  console.log(`[case-collisions] OK - no sibling names differ only by case (${scope}).`)
}
