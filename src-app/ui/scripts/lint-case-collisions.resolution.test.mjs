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
 * different file under the two regimes IS the bug, whatever shape produced it. That
 * makes this the check the guard is standing in for, and the reason the guard's rule
 * set can stay bounded instead of growing a predicate per audit round.
 *
 * It is deliberately NOT chained into `npm run check`: it walks ~10k specifiers and
 * takes ~10-20 s, and the guard already covers the committed-today case in
 * milliseconds. Run it when changing resolution-adjacent things, and at phase 8.
 *
 * Run:  npm run test:case-collisions:resolution
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test, { describe } from 'node:test'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const UI_SRC = path.resolve(HERE, '../src')
const DESKTOP_SRC = path.resolve(HERE, '../../desktop/ui/src')
const SKIP = new Set(['node_modules', 'dist', 'build', '.git'])

/** TypeScript's probe order for an extensionless specifier. Order is load-bearing. */
const PROBE_EXTS = ['.ts', '.tsx', '.d.ts', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs', '.json', '.css']
const INDEX_EXTS = PROBE_EXTS.map(e => path.join('index' + e))

const listing = new Map() // dir -> {names:Set, lower:Map(lowername -> realname)}
function readDir(dir) {
  if (listing.has(dir)) return listing.get(dir)
  let entry = { names: new Set(), lower: new Map() }
  try {
    for (const n of fs.readdirSync(dir)) {
      entry.names.add(n)
      // First writer wins, mirroring "some file with this folded name exists".
      if (!entry.lower.has(n.toLowerCase())) entry.lower.set(n.toLowerCase(), n)
    }
  } catch {
    entry = { names: new Set(), lower: new Map() }
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

/** Resolve a specifier the way TS does: extensions first, then dir/index. */
function resolve(base, insensitive) {
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

const SPEC_RE = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]([^'"\n]+)['"]/g

/** `@/x` maps to the CORE ui src from BOTH workspaces (see each tsconfig `paths`). */
function specifierBase(file, spec) {
  if (spec.startsWith('@/')) return path.join(UI_SRC, spec.slice(2))
  if (spec.startsWith('./') || spec.startsWith('../')) return path.resolve(path.dirname(file), spec)
  return null
}

describe('case-collision fix — resolution behaviour', () => {
  test('TEST-14: no specifier resolves differently on a case-insensitive filesystem', { timeout: 600_000 }, () => {
    const files = [...walk(UI_SRC), ...walk(DESKTOP_SRC)]
    assert.ok(files.length > 1000, `expected to scan the real trees, found ${files.length} files`)

    const divergent = []
    let examined = 0
    let resolved = 0
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8')
      SPEC_RE.lastIndex = 0
      let m
      while ((m = SPEC_RE.exec(src))) {
        const base = specifierBase(file, m[1])
        if (base === null) continue
        examined++
        const sensitive = resolve(base, false)
        const insensitive = resolve(base, true)
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

  test('TEST-14 (control): the simulator reproduces both real bug shapes', () => {
    // Without this the "0 divergent" result above is unfalsifiable — a simulator whose
    // insensitive branch silently equalled its sensitive one would report 0 forever.
    // These are the two shapes this branch actually fixed, rebuilt in a temp tree.
    const root = fs.mkdtempSync(path.join(path.resolve(HERE, '../../../'), '.resolution-control-'))
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
    } finally {
      listing.clear() // the control wrote into a fresh dir; drop the memoised listings
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
