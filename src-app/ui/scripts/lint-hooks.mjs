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
 * The walk never crosses OUT of a function, so a callback does not inherit the
 * conditions of the component around it (a read that is UNCONDITIONAL inside an
 * `onClick={() => …}` is not reported just because the component has an early
 * return). A read that is CONDITIONAL within the callback itself IS reported —
 * a reactive proxy read in a callback is an invalid hook call regardless, so
 * there is nothing to lose by flagging it.
 *
 *   H1  any `use[A-Z]…()` call in a conditional context, EXCLUDING
 *       `after-early-return` (that is the classic type-guard idiom — 5 such hook
 *       calls across 3 pre-existing components — and is the standard
 *       rules-of-hooks rule's territory; see DEC-6).
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
 * NOT a hook, never flagged: the path-1 specials `$` / `__setState` /
 * `__refCount` / `__refTracker` / `__destroyed`; and path-2 ACTIONS, whether
 * called (`Store.doThing()`) or passed by reference
 * (`onClose={Auth.clearAuthenticationError}` — the only shape that produces false
 * positives without the action registry). Actions are tracked PER PROXY: a single
 * global name set would permanently exempt every state field whose name collides
 * with some action somewhere (`error`, `open`, `progress`, `refresh` are all both).
 * Path 3 (a NESTED proxy — an object carrying `__refTracker`, also hook-free) is
 * NOT statically distinguishable from a plain state object here, so a conditional
 * nested-proxy read would be reported; none exists in either tree today.
 *
 * Known gaps, all measured against the live tree (0 instances of each today):
 * a proxy reached through a namespace/default import; a `defineLocalStore(…).use()`
 * instance bound to a local (only a hook-returned `handle.store.<field>` is
 * covered); and a proxy imported through a barrel that re-exports it.
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

// Path 1 of createStoreProxy: returned synchronously, no hooks, safe anywhere.
// (Path 2 = actions, handled by the per-proxy action registry. Path 3 = a NESTED
// proxy — an object carrying `__refTracker`, also hook-free — is not statically
// distinguishable from a plain state object here, so a conditional nested-proxy
// read would be reported; none exists in either tree today. Known limit.)
const SPECIAL_PROPS = new Set(['$', '__setState', '__refCount', '__refTracker', '__destroyed'])
const PROXY_FACTORY =
  /^(registerLazyStore|registerStore|defineStore|defineLocalStore|createStoreProxy|createNotificationsStore|lazyStoreProxy)$/
// Fallback factor-1 shape, used ONLY when an import specifier cannot be resolved
// to a file on disk (an alias this script does not know). The primary factor 1 is
// real module resolution — see `resolveSpecifier`.
const STORE_SPECIFIER = /(^|\/)stores?(\/|$)|\.store$|\/store$/
const HOOK_NAME = /^use[A-Z]/
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', 'tests', 'coverage'])
// The registry must never be silently empty: a rename inside the SDK's store-kit
// would otherwise drop the proxy set to 0 and turn H2 into a green no-op. The
// floor is deliberately far below the real count (~300) so it only ever trips on
// a structural break, never on ordinary churn.
export const PROXY_REGISTRY_FLOOR = 50

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
      // lstat, NOT stat: a symlink inside src/ would otherwise let the scan
      // escape the tree (a `vendor -> ../node_modules` link defeats SKIP_DIRS,
      // which matches by directory NAME, and makes the gate parse and report on
      // out-of-tree files). Symlinks are skipped outright — no source file in
      // either workspace is reached through one.
      st = fs.lstatSync(full)
    } catch {
      continue
    }
    if (st.isSymbolicLink()) continue
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
 *   proxies — `name -> Set<defining file>`; the name is factor 2 of the proxy
 *             test and the defining files are what factor 1 resolves against.
 *   actions — `proxy name -> Set<action property>`. PER PROXY, deliberately: a
 *             single global name set makes any state field whose name collides
 *             with SOME action anywhere (`error`, `open`, `progress`, `refresh` —
 *             all common reactive fields here) permanently un-lintable. Sources:
 *             (a) `<storeDir>/actions/<name>.ts` basenames (the `import.meta.glob`
 *             action convention), (b) function-valued / function-typed members
 *             declared inside that store's own directory, (c) any property
 *             observed being CALLED on THAT proxy anywhere in the tree.
 */
function buildRegistries(asts) {
  const proxies = new Map() // name -> Set<file>
  const actions = new Map() // proxy name -> Set<prop>
  const dirActions = new Map() // store dir -> Set<prop>
  const isStoreFile = (f) => /[\\/]stores?[\\/]/.test(f) || /\.store\.tsx?$/.test(f)
  const addTo = (map, key, value) => {
    let s = map.get(key)
    if (!s) map.set(key, (s = new Set()))
    s.add(value)
  }
  /** The directory that owns a store: `…/stores/<store>/index.ts` -> `…/stores/<store>`. */
  const storeDirOf = (file) => path.dirname(/[\\/]actions[\\/]/.test(file) ? path.dirname(file) : file)

  for (const [file, src] of asts) {
    const actionFile = file.match(/[\\/]actions[\\/]([A-Za-z0-9_$]+)\.tsx?$/)
    if (actionFile && isStoreFile(file) && !actionFile[1].startsWith('_'))
      addTo(dirActions, storeDirOf(file), actionFile[1])
    const storeFile = isStoreFile(file)
    const dir = path.dirname(file)

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
            if (name && PROXY_FACTORY.test(name)) addTo(proxies, d.name.text, file)
          }
          // `export const Foo = FooDef.store` — the defineStore(...).store accessor.
          if (ts.isPropertyAccessExpression(init) && init.name.text === 'store') addTo(proxies, d.name.text, file)
        }
      }
      if (storeFile) {
        const add = (nm) => addTo(dirActions, dir, nm)
        if (ts.isPropertyAssignment(n) && (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name)) && isFunctionValued(n.initializer))
          add(n.name.text)
        if (ts.isMethodDeclaration(n) && ts.isIdentifier(n.name)) add(n.name.text)
        if (ts.isMethodSignature(n) && ts.isIdentifier(n.name)) add(n.name.text)
        if (ts.isPropertySignature(n) && ts.isIdentifier(n.name) && isFunctionValued(n.type)) add(n.name.text)
      }
      ts.forEachChild(n, visit)
    }
    visit(src)
  }

  // Attribute each directory's actions to the proxies DEFINED in that directory
  // (or in its `index.ts`), so `LlmProvider.providers` is never exempted by an
  // action of some unrelated store that happens to share the name.
  for (const [name, files] of proxies) {
    for (const file of files) {
      const dir = path.dirname(file)
      for (const d of [dir, storeDirOf(file)]) for (const a of dirActions.get(d) ?? []) addTo(actions, name, a)
    }
  }

  // (c) any property CALLED on a known proxy is an action OF THAT PROXY.
  for (const [, src] of asts) {
    const visit = (n) => {
      if (
        ts.isCallExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        ts.isIdentifier(n.expression.expression) &&
        proxies.has(n.expression.expression.text)
      )
        addTo(actions, n.expression.expression.text, n.expression.name.text)
      ts.forEachChild(n, visit)
    }
    visit(src)
  }
  return { proxies, actions }
}

const MODULE_EXTS = ['.ts', '.tsx', '/index.ts', '/index.tsx', '']
/**
 * Factor 1 of the store-proxy test: resolve an import specifier to the file(s) it
 * could denote, so a proxy is recognised by WHERE IT IS DEFINED rather than by
 * whether its path happens to contain a `stores/` segment. That path-shape
 * heuristic (kept below as the unresolvable-specifier fallback) silently excluded
 * ~44 real proxies — `AppLayout` from `@/modules/layouts/app-layout/appLayout`,
 * `Hardware`, and most drawer stores — which is exactly BUG-B's own class.
 * Handles the `@/` alias (against every root, since desktop's `@/` falls back to
 * the web tree) and relative specifiers. Returns [] when it cannot resolve.
 */
function resolveSpecifier(spec, fromFile, roots) {
  const bases = []
  if (spec.startsWith('.')) bases.push(path.resolve(path.dirname(fromFile), spec))
  else if (spec.startsWith('@/')) for (const r of roots) bases.push(path.join(r, spec.slice(2)))
  else return []
  return bases.flatMap((b) => MODULE_EXTS.map((e) => b + e))
}

/** Local bindings in `src` that pass BOTH factors of the store-proxy test. */
function localProxyBindings(src, proxies, roots) {
  const local = new Set()
  for (const st of src.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue
    if (st.importClause?.isTypeOnly) continue
    const bindings = st.importClause?.namedBindings
    if (!bindings || !ts.isNamedImports(bindings)) continue
    const spec = st.moduleSpecifier.text
    const candidates = resolveSpecifier(spec, src.fileName, roots)
    for (const el of bindings.elements) {
      if (el.isTypeOnly) continue
      const definedIn = proxies.get((el.propertyName || el.name).text)
      if (!definedIn) continue
      // Factor 1: the specifier resolves to a file that DEFINES this proxy;
      // or, when the specifier is un-resolvable here, the legacy path shape.
      const resolved = candidates.length > 0
      if (resolved ? candidates.some((c) => definedIn.has(c)) : STORE_SPECIFIER.test(spec)) local.add(el.name.text)
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
    // NB: `do { … } while (…)` is deliberately absent — its body always runs at
    // least once, so it is not conditionally evaluated.
    if (
      (ts.isForStatement(parent) ||
        ts.isForOfStatement(parent) ||
        ts.isForInStatement(parent) ||
        ts.isWhileStatement(parent)) &&
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
    // Any preceding statement that CAN exit the function — `if (…) return`, a
    // guard nested in a block, a `switch` arm that returns, a try/catch rethrow.
    // (A bare top-level `return`/`throw` would make everything after it dead
    // code, so restricting to `if` was both narrower and arbitrary.)
    const stmt = body.statements[i]
    if (ts.isReturnStatement(stmt) || ts.isThrowStatement(stmt)) return 'after-early-return'
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
/**
 * Parsing the ~2.2k-file registry dominates the runtime (~0.8s of a ~1.3s run),
 * and a single process may call `analyze()` many times (the test suite does).
 * Cache the ROOT parse per root-set for the life of the process.
 *
 * CORRECTNESS RULE: only files that are NOT being reported on may come from the
 * cache. Every TARGET file is re-read and re-parsed on every call — otherwise a
 * second `analyze()` after an edit would mix a stale AST with freshly-read line
 * text and could report an already-fixed violation, or (worse) miss a new one.
 * In the default whole-tree scan the targets ARE the roots, so nothing is served
 * from the cache and the CLI always sees the disk; the cache pays off exactly
 * where it is safe — repeated calls reporting on a small explicit target.
 */
const rootAstCache = new Map()
function registryAsts(roots, targetSet, read) {
  const key = roots.join('\u0000')
  let cached = rootAstCache.get(key)
  if (!cached) {
    cached = new Map(
      uniq(roots.flatMap((r) => findFiles(r, { includeFixtures: true }))).map((f) => [f, parse(f, read(f))]),
    )
    rootAstCache.set(key, cached)
  }
  const out = new Map()
  for (const [f, ast] of cached) out.set(f, targetSet.has(f) ? parse(f, read(f)) : ast)
  return out
}

export function analyze(opts) {
  const o = opts ?? {}
  const roots = o.registryRoots?.length ? o.registryRoots : defaultRoots()
  const explicitTargets = o.targets?.length ? o.targets.map((t) => path.resolve(t)) : null
  const includeFixtures = !!explicitTargets

  const texts = new Map()
  const read = (f) => {
    if (!texts.has(f)) texts.set(f, fs.readFileSync(f, 'utf8'))
    return texts.get(f)
  }

  const targetFiles = explicitTargets
    ? uniq(explicitTargets.flatMap((t) => findFiles(t, { includeFixtures: true })))
    : uniq(roots.flatMap((r) => findFiles(r, { includeFixtures })))
  const targetSet = new Set(targetFiles)

  const asts = registryAsts(roots, targetSet, read)
  // Targets outside the roots (a fixture dir, a temp file) join the registry so
  // a self-describing fixture store is recognised.
  for (const f of targetFiles) if (!asts.has(f)) asts.set(f, parse(f, read(f)))

  const { proxies, actions } = buildRegistries(asts)

  const findings = []
  for (const file of targetFiles) {
    const src = asts.get(file) ?? parse(file, read(file))
    const lines = read(file).split('\n')
    const local = localProxyBindings(src, proxies, roots)
    const paneHandles = hookHandleBindings(src)
    const lineOf = (pos) => src.getLineAndCharacterOfPosition(pos).line + 1
    // The marker must be a COMMENT and must carry a reason (`hook-order-ok: …`),
    // so neither an incidental occurrence in a string nor a bare, unexplained
    // marker can silence a real violation.
    const hasMarker = (text) => {
      const at = text.indexOf('//')
      if (at < 0) return false
      const m = text.slice(at).match(new RegExp(`${OPT_OUT}\\s*:\\s*\\S`))
      return !!m
    }
    const optedOut = (line) => hasMarker(lines[line - 1] ?? '') || hasMarker(lines[line - 2] ?? '')

    const report = (rule, node, context, code) => {
      const line = lineOf(node.getStart(src))
      if (optedOut(line)) return
      findings.push({ rule, file, line, context, code })
    }
    const isAction = (proxyName, prop) => actions.get(proxyName)?.has(prop) ?? false
    /** A property read that is NOT one of createStoreProxy's hook-free paths. */
    const isReactiveRead = (node, proxyName, prop) =>
      !(ts.isCallExpression(node.parent) && node.parent.expression === node) &&
      !SPECIAL_PROPS.has(prop) &&
      !isAction(proxyName, prop)

    const visit = (n) => {
      // H1 — a hook CALL that is only conditionally evaluated. Both the bare
      // `useX()` and the namespaced `React.useX()` forms (both are live here).
      if (ts.isCallExpression(n)) {
        const callee = n.expression
        const hookName = ts.isIdentifier(callee)
          ? callee.text
          : ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)
            ? callee.name.text
            : null
        if (hookName && HOOK_NAME.test(hookName)) {
          const ctx = conditionalContext(n, { allowEarlyReturn: false })
          if (ctx) report('H1', n, ctx, `${callee.getText(src)}(…)`)
        }
      }
      // H2 — a store-proxy field read that is only conditionally evaluated.
      if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && local.has(n.expression.text)) {
        const proxyName = n.expression.text
        if (isReactiveRead(n, proxyName, n.name.text)) {
          const ctx = conditionalContext(n, { allowEarlyReturn: true })
          if (ctx) report('H2', n, ctx, `${proxyName}.${n.name.text}`)
        }
      }
      // H2 — the same read via element access: `Proxy['field']`.
      if (
        ts.isElementAccessExpression(n) &&
        ts.isIdentifier(n.expression) &&
        local.has(n.expression.text) &&
        ts.isStringLiteralLike(n.argumentExpression)
      ) {
        const proxyName = n.expression.text
        const prop = n.argumentExpression.text
        if (isReactiveRead(n, proxyName, prop)) {
          const ctx = conditionalContext(n, { allowEarlyReturn: true })
          if (ctx) report('H2', n, ctx, `${proxyName}['${prop}']`)
        }
      }
      // H2 — a PER-INSTANCE store reached through a hook handle:
      // `const pane = useChatPane(); … pane.store.conversation`. This is the
      // second half of the very bug ITEM-10 fixes (its pre-image read
      // `pane.store.conversation` in one ternary branch and an imported proxy in
      // the other), and an imported-proxy-only rule cannot see it.
      if (ts.isPropertyAccessExpression(n) && ts.isPropertyAccessExpression(unwrap(n.expression))) {
        const inner = unwrap(n.expression)
        const base = unwrap(inner.expression)
        if (inner.name.text === 'store' && ts.isIdentifier(base) && paneHandles.has(base.text)) {
          const prop = n.name.text
          const isCallee = ts.isCallExpression(n.parent) && n.parent.expression === n
          // No per-store action list exists for an anonymous handle, so fall back
          // to the union of every known action name (over-exempting, never over-reporting).
          if (!isCallee && !SPECIAL_PROPS.has(prop) && !anyAction(actions, prop)) {
            const ctx = conditionalContext(n, { allowEarlyReturn: true })
            if (ctx) report('H2', n, ctx, `${base.text}.store.${prop}`)
          }
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
  const actionCount = [...actions.values()].reduce((n, s) => n + s.size, 0)
  return { findings, proxyCount: proxies.size, actionCount, fileCount: targetFiles.length }
}

/** Strip `!` / `(…)` so `pane!.store.x` and `(pane).store.x` read the same. */
const unwrap = (n) => {
  let cur = n
  while (cur && (ts.isNonNullExpression(cur) || ts.isParenthesizedExpression(cur))) cur = cur.expression
  return cur
}

const anyAction = (actions, prop) => {
  for (const set of actions.values()) if (set.has(prop)) return true
  return false
}

/**
 * Locals bound from a `use*()` call — `const pane = useChatPaneOrNull()`. Their
 * `.store` is a per-instance store proxy (see `ChatPaneContext`), so
 * `handle.store.<field>` is a path-4 reactive read. Requiring a HOOK-call
 * initializer is what keeps this precise: `extension.store.name` (a store
 * DEFINITION reached from a registry loop) is not a hook handle and is ignored.
 */
function hookHandleBindings(src) {
  const handles = new Set()
  const visit = (n) => {
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.initializer &&
      ts.isCallExpression(n.initializer) &&
      ts.isIdentifier(n.initializer.expression) &&
      HOOK_NAME.test(n.initializer.expression.text)
    )
      handles.add(n.name.text)
    ts.forEachChild(n, visit)
  }
  visit(src)
  return handles
}

const EXPLAIN = {
  H1: 'hook call is only conditionally evaluated — the hook COUNT varies with the condition (React: "Rendered more hooks than during the previous render"). Call it unconditionally and combine the RESULTS.',
  H2: 'store-proxy field read is only conditionally evaluated — a reactive proxy read IS a hook (useEffect + useStore). Hoist the read above the condition, or use the hook-free `.$` snapshot.',
}

/**
 * The two workspace copies of this file are kept byte-identical (DEC-3). The
 * only assertions of that live in test suites which are NOT in `check`, so a
 * divergence could ship green — check it HERE, where the gate always runs.
 */
export function siblingDriftError() {
  const self = fileURLToPath(import.meta.url)
  for (const rel of ['../../desktop/ui/scripts/lint-hooks.mjs', '../../../ui/scripts/lint-hooks.mjs']) {
    const sibling = path.resolve(HERE, rel)
    if (sibling === self || !fs.existsSync(sibling)) continue
    if (fs.readFileSync(sibling, 'utf8') !== fs.readFileSync(self, 'utf8'))
      return `the two workspace copies have DIVERGED:\n    ${self}\n    ${sibling}\n  Copy one over the other (they are required to be byte-identical).`
  }
  return null
}

/** `--root=<dir>` (repeatable) and `--root <dir>`, matching the sibling lints. */
export function parseArgs(argv) {
  const roots = []
  let json = false
  const bad = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--json') json = true
    else if (a.startsWith('--root=')) roots.push(a.slice('--root='.length))
    else if (a === '--root') {
      const next = argv[++i]
      if (next === undefined || next.startsWith('--')) bad.push('--root needs a directory')
      else roots.push(next)
    } else bad.push(`unknown argument \`${a}\``)
  }
  return { roots, json, bad }
}

/**
 * A detector that reports 0 because it learned NOTHING is indistinguishable from
 * a clean tree. Separated out so it is directly testable — this is the guard that
 * turns an upstream store-kit rename from a silent no-op into a loud failure.
 * @returns an error string, or null when the run is trustworthy.
 */
export function registryHealthError({ fileCount, proxyCount, targets = [] }) {
  if (fileCount === 0)
    return `scanned 0 files${targets.length ? ` under ${targets.join(', ')}` : ''} — nothing was checked`
  if (proxyCount < PROXY_REGISTRY_FLOOR)
    return (
      `the store-proxy registry looks broken — learned only ${proxyCount} proxies (floor ${PROXY_REGISTRY_FLOOR}).\n` +
      `  H2 cannot detect anything in this state. Check PROXY_FACTORY against sdk/packages/framework/src/{stores,store-kit}.ts.`
    )
  return null
}

function main() {
  const { roots: rootArgs, json: asJson, bad } = parseArgs(process.argv.slice(2))
  const fail = (msg) => {
    console.error(`lint-hooks: ${msg}`)
    process.exit(2)
  }
  // Exit 2 (never 0, never the 1 that means "violations found") for every
  // operator error, so a typo can never masquerade as a passing gate.
  if (bad.length) fail(`${bad.join('; ')}\n  usage: node scripts/lint-hooks.mjs [--root=<dir>]... [--json]`)

  const drift = siblingDriftError()
  if (drift) fail(drift)

  const targets = rootArgs.map((r) => path.resolve(process.cwd(), r))
  for (const t of targets) {
    if (!fs.existsSync(t)) fail(`--root ${t} does not exist`)
    if (!fs.statSync(t).isDirectory()) fail(`--root ${t} is not a directory`)
  }

  let result
  try {
    result = analyze(targets.length ? { targets } : {})
  } catch (e) {
    fail(`crashed while scanning: ${e?.stack || e}`)
  }
  const { findings, fileCount, proxyCount, actionCount } = result

  const unhealthy = registryHealthError({ fileCount, proxyCount, targets })
  if (unhealthy) fail(unhealthy)

  if (asJson) {
    console.log(JSON.stringify({ findings, fileCount, proxyCount, actionCount }, null, 2))
  } else if (findings.length) {
    console.error(`lint-hooks: ${findings.length} Rules-of-Hooks violation(s) in ${fileCount} file(s)\n`)
    for (const f of findings) {
      console.error(`  ${f.rule} ${path.relative(process.cwd(), f.file)}:${f.line}  [${f.context}]  ${f.code}`)
      console.error(`     ${EXPLAIN[f.rule]}`)
    }
    console.error(
      `\n  A provably mount-stable condition opts out with an inline \`${OPT_OUT}: <reason>\` comment on the line or the line above.`,
    )
  } else {
    console.log(
      `lint-hooks: OK — 0 violations across ${fileCount} file(s) (registry: ${proxyCount} store proxies, ${actionCount} actions)`,
    )
  }
  process.exit(findings.length ? 1 : 0)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
