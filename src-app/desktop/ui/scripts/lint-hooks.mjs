/**
 * Guardrail (Layer 3): Rules of Hooks — conditionally-evaluated hook calls and
 * conditionally-evaluated store-proxy reads (taxonomy O1 / O2).
 *
 * Closes two REAL, already-shipped, user-facing React crashes that every gate the
 * repo had at the time waved through:
 *
 *   O1 / BUG-A (13 sites, fixed in 649ae7180)
 *       const canRead = usePermission(READ_PERM) || usePermission(MANAGE_PERM)
 *     `||` short-circuits, so the SECOND hook is skipped whenever the first is
 *     truthy — the hook COUNT becomes a function of permission state, and React
 *     throws "Rendered more hooks than during the previous render" the moment it
 *     flips. Correct form: call both unconditionally, OR the *results*.
 *
 *   O2 / BUG-B (fixed in 57f9fdb5b)
 *       const m = modelId ? LlmProvider.providers.flatMap(...).find(...) : null
 *     In this codebase a reactive store-proxy field read IS a hook: path 4 of
 *     `createStoreProxy` calls `useEffect` + `useStore(useShallow(...))`
 *     (sdk/packages/framework/src/stores.ts, which carries its own
 *     `rules-of-hooks` eslint-disable). Reading it inside a ternary made the hook
 *     count jump when `modelId` flipped null->set as the drawer opened.
 *
 * Why nothing off-the-shelf catches these: `react-hooks/rules-of-hooks` is not run
 * here (the repo lints with Biome, and `useHookAtTopLevel` is not enabled), and
 * even if it were, O2 is invisible to it — `LlmProvider.providers` is a property
 * read, not a `use*()` call. Only a project-specific lint can know that.
 *
 * ── Rules ──────────────────────────────────────────────────────────────────────
 * An expression is CONDITIONALLY EVALUATED when, walking up its ancestors and
 * stopping at the nearest enclosing function boundary, it sits in one of:
 *   ternary-branch · logical-rhs (&&, ||, ??) · if-body · loop-body ·
 *   switch-case · after-early-return
 * Stopping at the function boundary is what keeps callbacks (`onClick={() => …}`,
 * `useEffect(() => …)`) out of scope — their body is not the enclosing
 * component's render path.
 *
 *   H1  any `use[A-Z]…()` call in a conditional context, EXCLUDING
 *       `after-early-return` (that is the classic type-guard idiom, ~20
 *       pre-existing sites, and is the standard rules-of-hooks rule's territory —
 *       see DEC-6).
 *   H2  a read of `Proxy.field` (or `const { … } = Proxy`) in ANY of the six
 *       contexts, where `Proxy` passes a two-factor store-proxy test and `field`
 *       is neither a hook-free special, nor an action, nor a call callee.
 *
 * Store-proxy identification (two factors, BOTH required — load-bearing, not
 * defensive: `EditLlmModelDrawer` is both a store-proxy export AND a component
 * name, so a name-only registry would false-flag component imports):
 *   1. the binding is imported from a store-module specifier
 *      (`…/stores/…`, `…/store`, `*.store`, `@ziee/framework/stores`), AND
 *   2. its ORIGINAL exported name is in the proxy registry — every
 *      `export const X = registerLazyStore|defineStore|defineLocalStore|
 *      createStoreProxy|…(…)` or `= <Ident>.store` found across the roots.
 *
 * NOT a hook, never flagged (paths 1-3 of `createStoreProxy`): the specials
 * `$` / `__setState` / `__refCount` / `__refTracker` / `__destroyed`; ACTIONS,
 * whether called (`Store.doThing()`) or passed by reference
 * (`onClose={Auth.clearAuthenticationError}` — the only shape that produces false
 * positives without the action registry); and a member that is a call callee.
 *
 * Escape hatch: a genuinely-stable conditional (a value that cannot flip for the
 * lifetime of a mounted component) opts out with an inline `hook-order-ok` marker
 * on the offending line or the line immediately above, and must carry a reason.
 * Mirrors the `rtl-ok` marker of the logical-direction lint. Ships with ZERO uses.
 *
 * Gating: exits 1 on any finding. Wired into `npm run check` in BOTH UI
 * workspaces. This file is kept BYTE-IDENTICAL between `src-app/ui/scripts/` and
 * `src-app/desktop/ui/scripts/` (the same duplication contract as
 * `lint-icon-action.mjs` / `lint-native-scroll.mjs`; a drift guard asserts it) —
 * the candidate-root list below is what lets one file scan both workspaces from
 * either location.
 *
 * The natural long-term home for H2 is `sdk/packages/config/src/lint/`, next to
 * the other shared lints: it encodes a property of the SDK's store-kit, not of
 * ziee. It lives here for now because `sdk` is a submodule (DEC-2); promoting it
 * is a mechanical move — the only dependency is `typescript`.
 *
 *   node scripts/lint-hooks.mjs [--root=<dir>] [--json]
 */
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const HERE = path.dirname(fileURLToPath(import.meta.url))

// Both UI workspaces are scanned from EITHER copy of this script: resolve every
// candidate relative to this file's own dir and keep the ones that exist.
//   from src-app/ui/scripts      → ui/src + desktop/ui/src
//   from src-app/desktop/ui/scripts → desktop/ui/src + ui/src
const ROOT_CANDIDATES = ['../src', '../../desktop/ui/src', '../../../ui/src']
const FIXTURE_DIR_NAME = '__detector_fixtures__'
const OPT_OUT = 'hook-order-ok'

// Paths 1-3 of createStoreProxy: returned synchronously, no hooks, safe anywhere.
const SPECIAL_PROPS = new Set(['$', '__setState', '__refCount', '__refTracker', '__destroyed'])
const PROXY_FACTORY =
  /^(registerLazyStore|registerStore|defineStore|defineLocalStore|createStoreProxy|createNotificationsStore)$/
const STORE_SPECIFIER = /(^|\/)stores?(\/|$)|\.store$|\/store$/
const HOOK_NAME = /^use[A-Z]/
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', 'tests', 'coverage'])

const uniq = (xs) => [...new Set(xs)]
const defaultRoots = () =>
  uniq(ROOT_CANDIDATES.map((r) => path.resolve(HERE, r)).filter((p) => fs.existsSync(p)))

function findFiles(dir, { includeFixtures }, acc = []) {
  if (!fs.existsSync(dir)) return acc
  if (fs.statSync(dir).isFile()) return /\.tsx?$/.test(dir) ? [...acc, dir] : acc
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry)
    let st
    try {
      st = fs.statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue
      if (entry === FIXTURE_DIR_NAME && !includeFixtures) continue
      findFiles(full, { includeFixtures }, acc)
    } else if (/\.tsx?$/.test(entry) && !entry.endsWith('.d.ts')) {
      acc.push(full)
    }
  }
  return acc
}

const parse = (file, text) =>
  ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    /\.tsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )

const isFunctionBoundary = (n) =>
  ts.isFunctionDeclaration(n) ||
  ts.isFunctionExpression(n) ||
  ts.isArrowFunction(n) ||
  ts.isMethodDeclaration(n) ||
  ts.isGetAccessor(n) ||
  ts.isSetAccessor(n) ||
  ts.isClassDeclaration(n)

const isFunctionValued = (n) =>
  !!n && (ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionTypeNode(n))

/**
 * Registries built once over the roots:
 *   proxies — names exported as a store proxy (factor 2 of the proxy test)
 *   actions — property names that resolve to an ACTION (hook-free, path 2), so a
 *             conditional `Store.someAction` reference is never reported. Union of
 *             (a) `stores/<store>/actions/<name>.ts` basenames (the
 *             `import.meta.glob` action convention), (b) function-valued / function-typed members
 *             declared in store files, (c) any property observed being CALLED on a
 *             known proxy anywhere in the tree.
 */
function buildRegistries(asts) {
  const proxies = new Set()
  const actions = new Set()
  const isStoreFile = (f) => /[\\/]stores?[\\/]/.test(f) || /\.store\.tsx?$/.test(f)

  for (const [file, src] of asts) {
    const actionFile = file.match(/[\\/]actions[\\/]([A-Za-z0-9_$]+)\.tsx?$/)
    if (actionFile && isStoreFile(file) && !actionFile[1].startsWith('_')) actions.add(actionFile[1])
    const storeFile = isStoreFile(file)

    const visit = (n) => {
      if (ts.isVariableStatement(n) && n.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
        for (const d of n.declarationList.declarations) {
          if (!ts.isIdentifier(d.name) || !d.initializer) continue
          const init = d.initializer
          if (ts.isCallExpression(init)) {
            const callee = init.expression
            const name = ts.isIdentifier(callee)
              ? callee.text
              : ts.isPropertyAccessExpression(callee)
                ? callee.name.text
                : null
            if (name && PROXY_FACTORY.test(name)) proxies.add(d.name.text)
          }
          // `export const Foo = FooDef.store` — the defineStore(...).store accessor.
          if (ts.isPropertyAccessExpression(init) && init.name.text === 'store') proxies.add(d.name.text)
        }
      }
      if (storeFile) {
        if (ts.isPropertyAssignment(n) && (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name)) && isFunctionValued(n.initializer))
          actions.add(n.name.text)
        if (ts.isMethodDeclaration(n) && ts.isIdentifier(n.name)) actions.add(n.name.text)
        if (ts.isMethodSignature(n) && ts.isIdentifier(n.name)) actions.add(n.name.text)
        if (ts.isPropertySignature(n) && ts.isIdentifier(n.name) && isFunctionValued(n.type)) actions.add(n.name.text)
      }
      ts.forEachChild(n, visit)
    }
    visit(src)
  }

  // (c) any property CALLED on a known proxy is an action, wherever it appears.
  for (const [, src] of asts) {
    const visit = (n) => {
      if (
        ts.isCallExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        ts.isIdentifier(n.expression.expression) &&
        proxies.has(n.expression.expression.text)
      )
        actions.add(n.expression.name.text)
      ts.forEachChild(n, visit)
    }
    visit(src)
  }
  return { proxies, actions }
}

/** Local bindings in `src` that pass BOTH factors of the store-proxy test. */
function localProxyBindings(src, proxies) {
  const local = new Set()
  for (const st of src.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue
    if (!STORE_SPECIFIER.test(st.moduleSpecifier.text)) continue
    if (st.importClause?.isTypeOnly) continue
    const bindings = st.importClause?.namedBindings
    if (!bindings || !ts.isNamedImports(bindings)) continue
    for (const el of bindings.elements) {
      if (el.isTypeOnly) continue
      if (proxies.has((el.propertyName || el.name).text)) local.add(el.name.text)
    }
  }
  return local
}

/**
 * The conditional-evaluation walk. Returns the context label, or null when the
 * node is evaluated unconditionally within its enclosing function.
 * `allowEarlyReturn=false` drops the after-early-return context (H1, DEC-6).
 */
function conditionalContext(node, { allowEarlyReturn }) {
  let cur = node
  let parent = node.parent
  while (parent && !isFunctionBoundary(parent)) {
    if (ts.isConditionalExpression(parent) && (parent.whenTrue === cur || parent.whenFalse === cur))
      return 'ternary-branch'
    if (
      ts.isBinaryExpression(parent) &&
      parent.right === cur &&
      (parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
        parent.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
    )
      return 'logical-rhs'
    if (ts.isIfStatement(parent) && (parent.thenStatement === cur || parent.elseStatement === cur)) return 'if-body'
    if (
      (ts.isForStatement(parent) ||
        ts.isForOfStatement(parent) ||
        ts.isForInStatement(parent) ||
        ts.isWhileStatement(parent) ||
        ts.isDoStatement(parent)) &&
      parent.statement === cur
    )
      return 'loop-body'
    if (ts.isCaseClause(parent) || ts.isDefaultClause(parent)) return 'switch-case'
    cur = parent
    parent = parent.parent
  }
  if (!allowEarlyReturn || !parent || !isFunctionBoundary(parent)) return null

  // after-early-return: does a guard that can return/throw precede this
  // statement in the enclosing function's own body?
  const body = parent.body
  if (!body || !ts.isBlock(body)) return null
  const idx = body.statements.findIndex((s) => s.pos <= node.pos && node.end <= s.end)
  if (idx <= 0) return null
  for (let i = 0; i < idx; i++) {
    const stmt = body.statements[i]
    if (!ts.isIfStatement(stmt)) continue
    let exits = false
    const walk = (n) => {
      if (ts.isReturnStatement(n) || ts.isThrowStatement(n)) exits = true
      if (!isFunctionBoundary(n)) ts.forEachChild(n, walk)
    }
    ts.forEachChild(stmt, walk)
    if (exits) return 'after-early-return'
  }
  return null
}

/**
 * @param {{registryRoots?: string[], targets?: string[]}} opts
 *   registryRoots — where the proxy/action registries are learned from (default:
 *     both workspace `src` roots). Always includes the targets, so a fixture dir
 *     that declares its own store is self-describing.
 *   targets — what is REPORTED on (default: the registry roots, fixtures excluded).
 * @returns {{findings: Array, proxyCount: number, actionCount: number, fileCount: number}}
 */
export function analyze(opts = {}) {
  const roots = opts.registryRoots?.length ? opts.registryRoots : defaultRoots()
  const explicitTargets = opts.targets?.length ? opts.targets.map((t) => path.resolve(t)) : null
  const includeFixtures = !!explicitTargets

  const registryFiles = uniq([
    ...roots.flatMap((r) => findFiles(r, { includeFixtures: true })),
    ...(explicitTargets ?? []).flatMap((t) => findFiles(t, { includeFixtures: true })),
  ])
  const targetFiles = explicitTargets
    ? uniq(explicitTargets.flatMap((t) => findFiles(t, { includeFixtures: true })))
    : uniq(roots.flatMap((r) => findFiles(r, { includeFixtures })))

  const texts = new Map()
  const read = (f) => {
    if (!texts.has(f)) texts.set(f, fs.readFileSync(f, 'utf8'))
    return texts.get(f)
  }
  const asts = new Map(registryFiles.map((f) => [f, parse(f, read(f))]))
  const { proxies, actions } = buildRegistries(asts)

  const findings = []
  for (const file of targetFiles) {
    const src = asts.get(file) ?? parse(file, read(file))
    const lines = read(file).split('\n')
    const local = localProxyBindings(src, proxies)
    const lineOf = (pos) => src.getLineAndCharacterOfPosition(pos).line + 1
    const optedOut = (line) =>
      (lines[line - 1] ?? '').includes(OPT_OUT) || (lines[line - 2] ?? '').includes(OPT_OUT)

    const report = (rule, node, context, code) => {
      const line = lineOf(node.getStart(src))
      if (optedOut(line)) return
      findings.push({ rule, file, line, context, code })
    }

    const visit = (n) => {
      // H1 — a hook CALL that is only conditionally evaluated.
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && HOOK_NAME.test(n.expression.text)) {
        const ctx = conditionalContext(n, { allowEarlyReturn: false })
        if (ctx) report('H1', n, ctx, `${n.expression.text}(…)`)
      }
      // H2 — a store-proxy field read that is only conditionally evaluated.
      if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && local.has(n.expression.text)) {
        const prop = n.name.text
        const isCallee = ts.isCallExpression(n.parent) && n.parent.expression === n
        if (!isCallee && !SPECIAL_PROPS.has(prop) && !actions.has(prop)) {
          const ctx = conditionalContext(n, { allowEarlyReturn: true })
          if (ctx) report('H2', n, ctx, `${n.expression.text}.${prop}`)
        }
      }
      // H2 — `const { a, b } = Proxy` destructure (one hook per read field).
      if (
        ts.isVariableDeclaration(n) &&
        n.initializer &&
        ts.isIdentifier(n.initializer) &&
        local.has(n.initializer.text) &&
        ts.isObjectBindingPattern(n.name)
      ) {
        const ctx = conditionalContext(n, { allowEarlyReturn: true })
        if (ctx) report('H2', n, ctx, `const { … } = ${n.initializer.text}`)
      }
      ts.forEachChild(n, visit)
    }
    visit(src)
  }

  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
  return { findings, proxyCount: proxies.size, actionCount: actions.size, fileCount: targetFiles.length }
}

const EXPLAIN = {
  H1: 'hook call is only conditionally evaluated — the hook COUNT varies with the condition (React: "Rendered more hooks than during the previous render"). Call it unconditionally and combine the RESULTS.',
  H2: 'store-proxy field read is only conditionally evaluated — a reactive proxy read IS a hook (useEffect + useStore). Hoist the read above the condition, or use the hook-free `.$` snapshot.',
}

function main() {
  const rootArg = (process.argv.find((a) => a.startsWith('--root=')) || '').split('=').slice(1).join('=')
  const asJson = process.argv.includes('--json')
  const targets = rootArg ? [path.resolve(process.cwd(), rootArg)] : null
  const { findings, fileCount } = analyze(targets ? { targets } : {})

  if (asJson) {
    console.log(JSON.stringify(findings, null, 2))
  } else if (findings.length) {
    console.error(`lint-hooks: ${findings.length} Rules-of-Hooks violation(s) in ${fileCount} file(s)\n`)
    for (const f of findings) {
      console.error(`  ${f.rule} ${path.relative(process.cwd(), f.file)}:${f.line}  [${f.context}]  ${f.code}`)
      console.error(`     ${EXPLAIN[f.rule]}`)
    }
    console.error(
      `\n  A justified, provably-stable condition opts out with an inline \`${OPT_OUT}\` marker (+ a reason) on the line or the line above.`,
    )
  } else {
    console.log(`lint-hooks: OK — 0 violations across ${fileCount} file(s)`)
  }
  process.exit(findings.length ? 1 : 0)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
