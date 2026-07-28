import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

// TEST-1 [acceptance] [invariant: INV-1] + TEST-36 (ITEM-24 / ITEM-25).
//
// INV-1: "The rail never imports, names, or special-cases any extension; each
// extension contributes its own step descriptor and detail body."
//
// This walks the REAL import graph of the shipped rail files rather than
// asserting on a curated list, so the rail cannot silently learn about an
// extension later. It is the single mechanical guard standing between this
// feature and the pattern it exists to delete — a central module that knows
// every other module's tools.

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(HERE, '../../../..') // src-app/ui/src

/** Every source file under a directory, recursively. */
function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      out.push(...sourceFiles(p))
      continue
    }
    if (!/\.(ts|tsx)$/.test(name)) continue
    if (/\.test\.tsx?$/.test(name)) continue // the spec itself is not shipped
    out.push(p)
  }
  return out
}

/**
 * Module specifiers imported by a file — static (`from '…'`), dynamic
 * (`import('…')`) AND bare side-effect (`import '…'`).
 *
 * FIX_ROUND-3: the side-effect form was missing, which made both guards below
 * defeatable by a one-line `import '@/modules/mcp/stores/mcpComposer'`. That is
 * not a hypothetical form — `js-tool/module.tsx` and `mcp/module.tsx` both use
 * it today for their own registrations, so the guard had a real blind spot on
 * exactly the syntax these modules already write.
 */
function importsOf(file: string): string[] {
  // Strip comments first (FIX_ROUND-4): otherwise a commented-out or
  // documentation-example import registers as a real edge — a FALSE POSITIVE
  // that would fail the guard for prose. `railIsolation`'s sibling tool-name
  // guard already strips comments for exactly this reason.
  const text = readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .map(l => l.replace(/\/\/.*$/, ''))
    .join('\n')
  const specs: string[] = []
  // `(?:^|[;}\s])import` rather than `^\s*import` (FIX_ROUND-4): a side-effect
  // import is valid JS anywhere a statement is, including `foo();import 'x'` on
  // one line, which the line-anchored form missed.
  const re = /(?:from\s+|import\s*\(\s*|(?:^|[;}\s])import\s*)['"]([^'"]+)['"]/gm
  for (const m of text.matchAll(re)) specs.push(m[1])
  return specs
}

/**
 * What the rail is allowed to depend on: the chat module itself, generated API
 * types, the design-system kit + framework, shared lib utilities, and packages.
 * Anything matching `@/modules/<x>` where `<x>` is not `chat` is an extension,
 * and is forbidden.
 */
const FORBIDDEN = /^@\/modules\/(?!chat\/)/

/**
 * Every location the rail OWNS. The first cut walked only `components/rail/`,
 * which meant the guard could be defeated by putting the coupling one directory
 * over — and three of these four directories were added by the same change.
 */
const RAIL_DIRS = [
  'modules/chat/components/rail',
  'modules/chat/core/rail',
  'modules/chat/components/toolCallPanel',
  'modules/chat/extensions/tool-call',
]

/** `railRegistryCore.ts` lives beside unrelated files, so it is named directly. */
const RAIL_FILES = ['modules/chat/core/extensions/railRegistryCore.ts']

/** Every rail-owned source file. */
function railSources(): string[] {
  const out: string[] = []
  for (const d of RAIL_DIRS) out.push(...sourceFiles(join(SRC, d)))
  for (const f of RAIL_FILES) out.push(join(SRC, f))
  return out
}

/**
 * Resolve a specifier to a repo-relative path when it points into `src/`, so a
 * RELATIVE escape (`../../../mcp/foo`) is caught as well as an aliased one. The
 * first cut tested the `@/` alias only.
 */
function resolvedModulePath(importer: string, spec: string): string | null {
  // `@/modules/x` is already covered by FORBIDDEN; any other `@/` alias
  // (`@/lib`, `@/api-client`, `@/core`) is shared infrastructure, not a module.
  if (spec.startsWith('@/')) return null
  if (!spec.startsWith('.')) return null
  const abs = resolve(dirname(importer), spec)
  return abs.startsWith(SRC) ? abs.slice(SRC.length + 1) : null
}

test('TEST-1 [acceptance][INV-1]: no rail module imports any extension module', () => {
  const files = railSources()
  assert.ok(files.length >= 8, `expected the rail to have shipped files, found ${files.length}`)

  const violations: string[] = []
  for (const f of files) {
    for (const spec of importsOf(f)) {
      // Aliased escape…
      if (FORBIDDEN.test(spec)) {
        violations.push(`${f.replace(SRC + '/', '')} → ${spec}`)
        continue
      }
      // …and a RELATIVE one, which the alias regex cannot see.
      const rel = resolvedModulePath(f, spec)
      if (rel && rel.startsWith('modules/') && !rel.startsWith('modules/chat/')) {
        violations.push(`${f.replace(SRC + '/', '')} → ${spec} (resolves to ${rel})`)
      }
    }
  }
  assert.deepEqual(
    violations,
    [],
    `the activity rail must not import any extension module:\n${violations.join('\n')}`,
  )
})

test('TEST-1 [acceptance][INV-1]: the rail source names no extension-specific tool or module', () => {
  // A rail that avoided the IMPORT but hardcoded a tool name would violate the
  // invariant just as badly — that is exactly the shape of the map this feature
  // deletes (`workflow/.../activityDescriptors.ts` held nine modules' tools).
  const files = railSources()
  // Tool names drawn from the nine modules the deleted central map covered.
  const extensionTools = [
    // …plus the structured-content keys that belong to ONE backend surface. The
    // invariant forbids SPECIAL-CASING an extension, not merely importing one,
    // and core briefly encoded these two scheduler markers.
    'unattended_denied',
    'admin_disabled',
    'web_search',
    'literature_search',
    'fetch_paper_fulltext',
    'execute_command',
    'search_knowledge',
    'biomcp',
    'invoke_capability',
    'run_js',
    'semantic_search',
  ]
  const violations: string[] = []
  for (const f of files) {
    const text = readFileSync(f, 'utf8')
    // Strip block + line comments: prose that NAMES the anti-pattern it removes
    // is documentation, not coupling.
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    for (const tool of extensionTools) {
      if (code.includes(tool)) violations.push(`${f.replace(SRC + '/', '')} names "${tool}"`)
    }
  }
  assert.deepEqual(violations, [], violations.join('\n'))
})

test('TEST-36 (ITEM-24): literature / knowledge-base / workflow no longer import file’s MessageFilesView', () => {
  const offenders = [
    'modules/literature/components/LiteratureToolResultCard.tsx',
    'modules/knowledge-base/chat-extension/components/SearchKnowledgeToolResultCard.tsx',
    'modules/workflow/chat-extension/components/WorkflowWorkspaceRunCard.tsx',
  ]
  const violations: string[] = []
  for (const rel of offenders) {
    // No `catch { continue }` (FIX_ROUND-10): the same tolerance was removed from
    // the sibling guard below on the grounds that a rename must fail loudly, and
    // an identical construct in the same file did not deserve an exception —
    // proven by renaming one of these files WITH the forbidden import re-added.
    const text = readFileSync(join(SRC, rel), 'utf8')
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    if (/from\s+['"][^'"]*MessageFilesView['"]/.test(code)) {
      violations.push(`${rel} still imports MessageFilesView`)
    }
  }
  assert.deepEqual(violations, [], violations.join('\n'))
})

test('TEST-36 (ITEM-25): mcp contains no control_mcp UUID literal and no run_js tool-name literal', () => {
  const files = sourceFiles(join(SRC, 'modules/mcp'))
  const violations: string[] = []
  for (const f of files) {
    const text = readFileSync(f, 'utf8')
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    // The deterministic id of the built-in App Control server, which mcp used to
    // hardcode to decide whether to hide "Approve for this conversation".
    if (code.includes('d878787e-aa48-5f16-a31f-673052083f34')) {
      violations.push(`${f.replace(SRC + '/', '')} hardcodes the control_mcp server UUID`)
    }
    if (/['"]run_js(_approval)?['"]/.test(code)) {
      violations.push(`${f.replace(SRC + '/', '')} names the run_js tool family`)
    }
  }
  assert.deepEqual(violations, [], violations.join('\n'))
})

test('FIX_ROUND-2 #3 (AP-4): js-tool and mcp are decoupled in BOTH directions', () => {
  // The test above pins ONE direction: mcp no longer names `run_js`. That is
  // only half of AP-4. Moving the approval card into js-tool left the moved code
  // reaching back into `McpComposer` for the elicitation transport, so the
  // coupling INVERTED rather than disappearing — a cross-module store read plus
  // a deep import past a module's public surface (coding-guidelines §9), and the
  // exact failure mode this test family exists to catch.
  //
  // The fix inverted the dependency instead: `chat/core/elicitation/transport`
  // is core-owned, mcp pushes an implementation in, js-tool consumes it through
  // core. This asserts neither module can reach the other again, by ALIAS or by
  // a relative escape.
  //
  // SCOPE, stated plainly: this pins the AP-4 PAIR, not a repo-wide
  // "no extension imports another extension" rule. Many other cross-module
  // edges exist today (mcp → code-sandbox, knowledge-base → file,
  // scheduler → workflow, …); a blanket guard would be red for reasons this
  // change did not create. Add a pair here when one is genuinely decoupled.
  const pairs: Array<[string, string]> = [
    ['modules/js-tool', 'modules/mcp'],
    ['modules/mcp', 'modules/js-tool'],
  ]
  const violations: string[] = []
  for (const [fromDir, toDir] of pairs) {
    // FIX_ROUND-3: match the BARREL form too. `@/modules/mcp` (no trailing
    // slash) was caught by neither branch — not by the `@/modules/mcp/` prefix
    // test, and not by `resolvedModulePath`, which returns null for every `@/`
    // specifier. Latent only because neither module has an `index.ts` today;
    // live the moment one is added, which is exactly when a barrel import
    // becomes the natural way to re-couple them.
    const alias = `@/${toDir}/`
    const barrel = `@/${toDir}`
    for (const f of sourceFiles(join(SRC, fromDir))) {
      for (const spec of importsOf(f)) {
        if (spec === barrel || spec.startsWith(alias)) {
          violations.push(`${f.replace(SRC + '/', '')} → ${spec}`)
          continue
        }
        const rel = resolvedModulePath(f, spec)
        if (rel === toDir || (rel && rel.startsWith(`${toDir}/`))) {
          violations.push(`${f.replace(SRC + '/', '')} → ${spec} (resolves to ${rel})`)
        }
      }
    }
  }
  assert.deepEqual(
    violations,
    [],
    `AP-4 must not re-couple js-tool and mcp in either direction:\n${violations.join('\n')}`,
  )
})

/**
 * FIX_ROUND-5 — SEAM GUARD: the rail's re-resolution must route through
 * `withSegmentationShape`.
 *
 * `withSegmentationShape` is pinned behaviourally by `railSegmentation.test.ts`,
 * but that only proves the helper is correct — not that anything USES it. The
 * one-line revert that actually matters is at the call site
 * (`ChatMessage.resolveStep` returning the registry's step directly), and no
 * unit or e2e test can observe it: the divergence only shows on a message that
 * REPLAYS a `tool_use_id`, and the workspace's unit runner cannot mount JSX.
 *
 * So this is a source-level guard, and it is labelled as one. It does not assert
 * behaviour; it asserts that the single production consumer still goes through
 * the seam, which is the property the extraction exists to keep.
 */
test('FIX_ROUND-5: ChatMessage re-resolves rail steps THROUGH withSegmentationShape', () => {
  const file = join(SRC, 'modules/chat/components/ChatMessage.tsx')
  // Strip comments (FIX_ROUND-6): matched against RAW text, a doc comment merely
  // MENTIONING `withSegmentationShape(...)` would keep this green after a real
  // revert — the same prose-as-code trap `importsOf` already strips for.
  const code = readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .map(l => l.replace(/\/\/.*$/, ''))
    .join('\n')

  // Both halves: it must IMPORT the helper from the segmentation module (so a
  // locally-defined shadow of the same name cannot satisfy the call check) and
  // CALL it. FIX_ROUND-7 restored the import half, which FIX_ROUND-6 dropped
  // while removing a genuinely redundant assertion next to it.
  // The NAMED specifier, not merely the module (FIX_ROUND-8): ChatMessage already
  // imports `segmentRail` and `PlacedRailStep` from here, so a module-level check
  // was satisfied by those — a local function of the same name shadowing the
  // helper passed both this and the call check, verified by mutation.
  assert.match(
    code,
    /import\s*\{[^}]*\bwithSegmentationShape\b[^}]*\}\s*from\s*['"][^'"]*rail\/railSegmentation['"]/,
    'withSegmentationShape must be IMPORTED from the segmentation module by name — ' +
      'a local shadow of the same name would satisfy the call check below',
  )
  assert.match(
    code,
    /withSegmentationShape\s*\(/,
    'ChatMessage must call withSegmentationShape — segmentation owns key/consumed/blocking',
  )
  // The revert this guards, written the way it would actually be written.
  // FIX_ROUND-6: the first version used `[^)]*`, which cannot cross the inner `)`
  // of `railCtx(placed)` — so it did not match the real revert spelling at all
  // and was decoration reading as coverage.
  // Scoped to the `resolveStep` DECLARATION and collapsed within it (FIX_ROUND-8).
  // Whole-file collapse let the lazy `.*?` span unrelated code (a false RED);
  // per-line collapse then missed a line-WRAPPED revert (a false GREEN). Bounding
  // the search to the declaration gives both properties.
  const declStart = code.indexOf('const resolveStep')
  assert.notEqual(declStart, -1, 'ChatMessage must still declare resolveStep')
  // Bounded by the declaration's REAL end, not a byte count (FIX_ROUND-9): a
  // hardcoded 400-char window put an ordinary multi-branch body's revert at
  // offset 417 and went silently green — the same defect this branch had just
  // condemned in the Rust drift parser's 400-byte window. Scan to the start of
  // the next top-level `const `/`function `/`return ` at indentation 2.
  const after = code.slice(declStart + 'const resolveStep'.length)
  // Terminate on ANY 2-indent construct, not just const/function/return
  // (FIX_ROUND-10): an `if`/`for`/`useEffect` following the declaration was
  // swallowed into the window, so a `withSegmentationShape(` in a NEIGHBOURING
  // statement satisfied the declaration-level check — reopening the "merely the
  // file" hole at a smaller radius.
  const nextDecl = after.search(/\n {2}[A-Za-z]/)
  const decl = after
    .slice(0, nextDecl === -1 ? after.length : nextDecl)
    .replace(/\s+/g, ' ')
  // The DECLARATION itself must route through the helper (FIX_ROUND-9): checking
  // only that the file mentions it somewhere let a multi-statement revert of
  // `resolveStep` pass while an unrelated call kept the file-level match alive.
  assert.match(
    decl,
    /withSegmentationShape\s*\(/,
    'resolveStep itself must call withSegmentationShape, not merely the file',
  )
  assert.doesNotMatch(
    decl,
    /resolveRailStep\(.*?\)\?\.step \?\? placed\.step/,
    'resolveStep must not return the contribution step directly — that discards ' +
      'segmentation’s disambiguated key and its consumed clamp',
  )
})

/**
 * FIX_ROUND-8 — a `tooltip` must never be passed to a control that can be
 * `disabled`; and FIX_ROUND-9 — the disable decision must go through the seam.
 *
 * Two mechanical facts about the kit make the first a real defect rather than a
 * style preference:
 *  1. `Button` derives `aria-label` from a STRING `tooltip` when no explicit
 *     `aria-label` is given — and these controls give none — so a tooltip
 *     silently REPLACES the visible label in the accessibility tree:
 *     FIX_ROUND-5 shipped exactly this and made Approve and Deny announce
 *     identically (WCAG 2.5.3 / 4.1.2).
 *  2. `disabled` becomes the native attribute and the base class carries
 *     `disabled:pointer-events-none`, so the trigger can never fire anyway.
 *
 * These are SOURCE guards, and they are here because neither can be an e2e: the
 * regression's tooltip was CONDITIONAL on a degraded state, and no spec can reach
 * a state that needs mcp's transport to be absent mid-conversation.
 *
 * FIX_ROUND-9 closed three proven evasions of the first cut — boolean-shorthand
 * `disabled`, a spread carrying it, and a `>` inside an earlier quoted attribute
 * truncating the props window — and removed the `catch { continue }` that made
 * the whole guard vacuous the moment a scanned file was renamed. That tolerance
 * was the same standing-hole shape this branch had just condemned on the Rust
 * side; it did not deserve an exception here.
 */

/** The surface whose approve/deny controls carry the disable decision. */
const APPROVAL_SURFACE_WITH_CONTROLS =
  'modules/js-tool/chat-extension/components/JsToolApprovalContent.tsx'

/**
 * Every surface these guards cover. A rename must FAIL, not silently pass.
 */
const APPROVAL_SURFACES = [
  APPROVAL_SURFACE_WITH_CONTROLS,
  'modules/mcp/chat-extension/components/ToolCallPendingApprovalContent.tsx',
]

/**
 * These guards parse a real TYPESCRIPT AST, not text.
 *
 * FIX_ROUND-13: rounds 8 through 12 each hardened a regex scanner and each
 * subsequent blind audit found another spelling that walked past it — boolean
 * shorthand, a spread, a `>` in a quoted attribute, `!!x`, `x != null`,
 * `Boolean(x)`, `|| latch`, a `let` reassigned later, a second ternary branch, a
 * non-literal argument, an apostrophe in JSX text, a `}` inside a string. Each
 * fix enumerated one more case, which is the unbounded-enumeration mistake these
 * very guards were rewritten to stop making.
 *
 * The cause was parsing TypeScript with regexes. The compiler is already a
 * dependency (it runs on every `npm run check`), so the guards ask IT what the
 * code says. Every one of the twelve evasions above is answered by construction:
 * an AST knows a JSX attribute from prose, a spread from a prop, and an
 * expression's exact shape from a substring of it.
 */
function parse(rel: string): ts.SourceFile {
  return ts.createSourceFile(
    rel,
    readFileSync(join(SRC, rel), 'utf8'),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX,
  )
}

/** Every JSX opening element named `tag` (exactly). */
function elements(sf: ts.SourceFile, tag: string): ts.JsxOpeningLikeElement[] {
  const out: ts.JsxOpeningLikeElement[] = []
  const walk = (n: ts.Node): void => {
    if (
      (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) &&
      n.tagName.getText(sf) === tag
    ) {
      out.push(n)
    }
    ts.forEachChild(n, walk)
  }
  walk(sf)
  return out
}

/** The attribute named `name` on an element, or `undefined`. */
function attr(el: ts.JsxOpeningLikeElement, name: string): ts.JsxAttribute | undefined {
  return el.attributes.properties.find(
    (a): a is ts.JsxAttribute => ts.isJsxAttribute(a) && a.name.getText() === name,
  )
}

/** Does the element carry a spread, which could supply or override any prop? */
function hasSpread(el: ts.JsxOpeningLikeElement): boolean {
  return el.attributes.properties.some(ts.isJsxSpreadAttribute)
}

/** The expression of `name={…}`, or `undefined` (absent, or a string literal). */
function attrExpr(el: ts.JsxOpeningLikeElement, name: string): ts.Expression | undefined {
  const a = attr(el, name)
  if (!a?.initializer) return undefined
  return ts.isJsxExpression(a.initializer) ? a.initializer.expression : undefined
}

/**
 * Is `expr` EXACTLY a call to `predicate`, with the given argument identifier —
 * directly, or through a `const` whose sole initializer is that call and which is
 * never reassigned?
 *
 * "Exactly" is enforced on the AST: the node must BE a CallExpression, so
 * `!p(x)`, `p(x) || latch`, `p(x) === false`, `p(x) ? a : b` are all rejected
 * because they are Prefix/Binary/Conditional expressions. The argument is checked
 * too, so `p(blocked ?? 'no-transport')` and `p(f ? 'no-transport' : blocked)`
 * are rejected — the previous text guard pinned the callee and ignored the
 * argument entirely.
 */
/** Is `name` a const initialised from `elicitationBlockedReason(...)`? */
function isBlockedReasonBinding(sf: ts.SourceFile, name: string, fallback: string): boolean {
  let ok = false
  const walk = (n: ts.Node): void => {
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.name.getText(sf) === name &&
      n.initializer &&
      ts.isCallExpression(n.initializer) &&
      n.initializer.expression.getText(sf) === 'elicitationBlockedReason'
    ) {
      ok = true
    }
    ts.forEachChild(n, walk)
  }
  walk(sf)
  return ok || name === fallback
}

/** Is `name` imported from the core elicitation seam (not a same-named local)? */
function importedFromSeam(sf: ts.SourceFile, name: string): boolean {
  let ok = false
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st)) continue
    const from = (st.moduleSpecifier as ts.StringLiteral).text
    if (!from.endsWith('core/elicitation/transport')) continue
    const named = st.importClause?.namedBindings
    if (named && ts.isNamedImports(named)) {
      if (named.elements.some(e => e.name.getText(sf) === name)) ok = true
    }
  }
  return ok
}

function isExactCall(
  sf: ts.SourceFile,
  expr: ts.Expression | undefined,
  predicate: string,
  argument: string,
): boolean {
  if (!expr) return false
  const callOf = (e: ts.Expression): boolean =>
    ts.isCallExpression(e) &&
    e.expression.getText(sf) === predicate &&
    e.arguments.length === 1 &&
    ts.isIdentifier(e.arguments[0]) &&
    // The argument is checked by BINDING, not spelling (FIX_ROUND-14): it must be
    // the local initialised from `elicitationBlockedReason(...)`. Hardcoding the
    // name false-RED on a pure rename; ignoring it entirely let
    // `p(blocked ?? 'no-transport')` and `p(f ? 'no-transport' : blocked)` through.
    isBlockedReasonBinding(sf, e.arguments[0].getText(sf), argument)
  if (callOf(expr)) return true
  // One local hop: a `const` initialised to exactly that call, never reassigned.
  if (!ts.isIdentifier(expr)) return false
  const ident = expr.getText(sf)
  let ok = false
  let reassigned = false
  const walk = (n: ts.Node): void => {
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.name.getText(sf) === ident
    ) {
      const isConst =
        ts.isVariableDeclarationList(n.parent) &&
        (n.parent.flags & ts.NodeFlags.Const) !== 0
      if (isConst && n.initializer && callOf(n.initializer)) ok = true
      else reassigned = true
    }
    if (
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      n.left.getText(sf) === ident
    ) {
      reassigned = true
    }
    ts.forEachChild(n, walk)
  }
  walk(sf)
  return ok && !reassigned
}

test('FIX_ROUND-8: no `tooltip` on a Button that can be disabled (kit clobbers aria-label)', () => {
  // Two mechanical facts about the kit make this a defect, not a style choice:
  // `Button` derives `aria-label` from a STRING `tooltip` WHEN NO EXPLICIT
  // `aria-label` IS GIVEN (`ariaLabelProp ?? (typeof tooltip === 'string' ? …)`)
  // — and these controls give none, so a tooltip silently REPLACES the visible
  // label, which is what FIX_ROUND-5 shipped and made Approve and Deny announce
  // identically (WCAG 2.5.3 / 4.1.2). And `disabled` becomes the native attribute
  // under `disabled:pointer-events-none`, so the trigger can never fire anyway.
  const violations: string[] = []
  for (const rel of APPROVAL_SURFACES) {
    // No try/catch: a renamed file must fail, not silently pass.
    const sf = parse(rel)
    const buttons = elements(sf, 'Button')
    assert.ok(
      buttons.length > 0,
      `${rel} renders no <Button> — this guard would be vacuous for it. Either the ` +
        `control was renamed (update the scanner) or the surface no longer belongs here.`,
    )
    for (const el of buttons) {
      const canDisable = attr(el, 'disabled') !== undefined || hasSpread(el)
      if (canDisable && attr(el, 'tooltip') !== undefined) {
        violations.push(`${rel}: a <Button> takes BOTH \`disabled\` and \`tooltip\``)
      }
    }
  }
  assert.deepEqual(
    violations,
    [],
    `a tooltip on a disable-able Button overwrites its accessible name and can never ` +
      `render:\n${violations.join('\n')}`,
  )
})

test('FIX_ROUND-9: the approval controls disable ONLY through the seam predicate', () => {
  const sf = parse(APPROVAL_SURFACE_WITH_CONTROLS)
  assert.ok(
    importedFromSeam(sf, 'elicitationIsUnactionable'),
    'elicitationIsUnactionable must be imported from the core elicitation seam — a ' +
      'same-named local or sibling-module function satisfies a text match and is ' +
      'tsc-clean, while deciding something else entirely',
  )
  const buttons = elements(sf, 'Button')
  const disabling = buttons.filter(el => attr(el, 'disabled') !== undefined)
  assert.ok(disabling.length >= 2, `expected the approve/deny controls, found ${disabling.length}`)

  for (const el of buttons) {
    assert.ok(
      !hasSpread(el),
      'an approval control must not take props through a spread — a spread can ' +
        'supply or override `disabled` and the guard cannot see through it',
    )
    if (attr(el, 'disabled') === undefined) continue
    const expr = attrExpr(el, 'disabled')
    assert.ok(
      isExactCall(sf, expr, 'elicitationIsUnactionable', 'blocked'),
      `an approval control's \`disabled\` must BE elicitationIsUnactionable(blocked) ` +
        `(or a const whose sole initializer is that call), got ` +
        `\`${expr?.getText(sf) ?? '<boolean shorthand>'}\`. Anything combined with it — ` +
        `\`|| blocked !== null\`, a negation, a different argument — changes which ` +
        `states disable, and every time a state the user could still act through was ` +
        `disabled, the card became unanswerable (FIX_ROUND-4, -6, -7).`,
    )
  }
})

test('FIX_ROUND-14: the click handler gates on the SAME predicate as the control', () => {
  // The FIX_ROUND-9 guard covered only the JSX `disabled` attribute. The
  // re-entrancy early-return in `resolve()` decides whether the POST actually
  // happens, and it was unguarded — an auditor proved that latching it there
  // reintroduces the FIX_ROUND-4 bug in a WORSE form: the control still RENDERS
  // enabled, so the user clicks, and the click silently no-ops.
  const sf = parse(APPROVAL_SURFACE_WITH_CONTROLS)
  const resolveFn = (() => {
    let found: ts.VariableDeclaration | undefined
    const walk = (n: ts.Node): void => {
      if (ts.isVariableDeclaration(n) && n.name.getText(sf) === 'resolve') found = n
      ts.forEachChild(n, walk)
    }
    walk(sf)
    return found
  })()
  assert.ok(resolveFn, 'the card must still declare a `resolve` handler')

  // Its guard clause must include the seam predicate as a whole operand.
  const guards: string[] = []
  const walk = (n: ts.Node): void => {
    if (ts.isIfStatement(n)) guards.push(n.expression.getText(sf))
    ts.forEachChild(n, walk)
  }
  walk(resolveFn)
  const gate = guards.find(g => g.includes('submitting'))
  assert.ok(gate, `resolve() must keep its re-entrancy guard, found ${guards.join(' | ')}`)
  assert.match(
    gate.replace(/\s+/g, ' '),
    /elicitationIsUnactionable\(/,
    `resolve()'s guard must gate on elicitationIsUnactionable, got \`${gate}\` — ` +
      `gating it on the raw blocked reason latches the card while the control still ` +
      `renders ENABLED, so the click silently no-ops with no signal at all`,
  )
  assert.doesNotMatch(
    gate.replace(/\s+/g, ' '),
    /blocked\s*(!==|===|!=|==)/,
    `resolve()'s guard must not re-derive from the raw blocked reason, got \`${gate}\``,
  )
})

test('FIX_ROUND-11: the two extracted DECISIONS decide at their call sites', () => {
  const sf = parse(APPROVAL_SURFACE_WITH_CONTROLS)
  for (const p of ['elicitationIsError', 'resolveDidFail']) {
    assert.ok(
      importedFromSeam(sf, p),
      `${p} must be imported from the core elicitation seam — a same-named local ` +
        `satisfies a text match while deciding something else`,
    )
  }

  // ── the status tone ────────────────────────────────────────────────────────
  // Located by the element whose own attributes carry `data-testid={statusId}`,
  // so an element-valued prop before it cannot mis-anchor the search.
  const status = elements(sf, 'Text').find(
    el => attrExpr(el, 'data-testid')?.getText(sf) === 'statusId',
  )
  assert.ok(status, 'the status region must be identifiable by data-testid={statusId}')
  const tone = attrExpr(status, 'type')
  assert.ok(tone, 'the status region must set a tone')

  // The WHOLE expression: `!resolved && <predicate> ? 'danger' : 'secondary'`.
  // Checking only the condition let a second `: blocked ? 'danger'` branch paint
  // every recoverable state destructive-red while passing.
  assert.ok(ts.isConditionalExpression(tone), `the tone must be a ternary, got \`${tone.getText(sf)}\``)
  assert.equal(
    tone.whenTrue.getText(sf),
    "'danger'",
    'the tone ternary must yield danger on its TRUE branch',
  )
  assert.equal(
    tone.whenFalse.getText(sf),
    "'secondary'",
    `the tone's false branch must be plain 'secondary' — another branch reaching ` +
      `'danger' re-paints the recoverable states, got \`${tone.whenFalse.getText(sf)}\``,
  )
  assert.ok(
    ts.isBinaryExpression(tone.condition) &&
      tone.condition.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
      tone.condition.left.getText(sf) === '!resolved',
    `the tone condition must read \`!resolved && <predicate>\`, got ` +
      `\`${tone.condition.getText(sf)}\``,
  )
  assert.ok(
    isExactCall(sf, (tone.condition as ts.BinaryExpression).right, 'elicitationIsError', 'blocked'),
    `the status tone must be decided by elicitationIsError(blocked), got ` +
      `\`${(tone.condition as ts.BinaryExpression).right.getText(sf)}\` — otherwise a ` +
      `transient, answerable state gets painted in the destructive red ` +
      `DESIGN_SYSTEM.md reserves for errors`,
  )

  // ── the failure judgement ──────────────────────────────────────────────────
  // Every JUDGING call (anything but the `(false)` reset) must be the consequent
  // of an `if (resolveDidFail(...))`. Counting the literal `(true)` missed
  // `setResolveFailed(hadEntry === false)` sitting beside the conforming one.
  const judging: ts.CallExpression[] = []
  const walk = (n: ts.Node): void => {
    if (
      ts.isCallExpression(n) &&
      n.expression.getText(sf) === 'setResolveFailed' &&
      n.arguments[0]?.getText(sf) !== 'false'
    ) {
      judging.push(n)
    }
    ts.forEachChild(n, walk)
  }
  walk(sf)
  assert.equal(
    judging.length,
    1,
    `setResolveFailed must judge in exactly one place, found ${judging.length} ` +
      `(${judging.map(c => c.getText(sf)).join(', ')}) — a second judgement beside the ` +
      `conforming one re-introduces the bug it replaced`,
  )

  // …and that one call must be governed by the predicate. Walk up to the
  // enclosing `if`, tolerating a braced consequent, so a `curly` lint rule cannot
  // break the suite.
  let guard: ts.Node | undefined = judging[0].parent
  while (guard && !ts.isIfStatement(guard)) guard = guard.parent
  assert.ok(guard && ts.isIfStatement(guard), 'the judgement must sit inside an `if`')
  const cond = guard.expression
  assert.ok(
    ts.isCallExpression(cond) && ts.isObjectLiteralExpression(cond.arguments[0]),
    `resolveDidFail must be called with the live signals object, got ` +
      `\`${cond.getText(sf)}\``,
  )
  // Constant arguments make the call constant-true (FIX_ROUND-14): every property
  // must be a shorthand or an identifier reference, never a literal.
  for (const prop of (
    (cond as ts.CallExpression).arguments[0] as ts.ObjectLiteralExpression
  ).properties) {
    const live =
      ts.isShorthandPropertyAssignment(prop) ||
      (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.initializer))
    assert.ok(
      live,
      `resolveDidFail's signals must be live values, got \`${prop.getText(sf)}\` — a ` +
        `constant makes the judgement constant`,
    )
  }
  assert.ok(
    ts.isCallExpression(guard.expression) &&
      guard.expression.expression.getText(sf) === 'resolveDidFail',
    `the failure judgement must be governed by resolveDidFail(...), got ` +
      `\`${guard.expression.getText(sf)}\` — judging it inline marked a SUCCESSFUL ` +
      `approve as failed whenever the provider held no entry`,
  )
  // …and in the THEN branch (FIX_ROUND-14). Walking to the enclosing `if` and
  // checking only its condition let `if (resolveDidFail(...)) {} else
  // setResolveFailed(true)` pass — a one-token inversion that marks every
  // SUCCESSFUL approve as failed. The regex this replaced required adjacency and
  // did catch it; the AST rewrite traded that away.
  const then = guard.thenStatement
  assert.ok(
    judging[0].getStart(sf) >= then.getStart(sf) && judging[0].getEnd() <= then.getEnd(),
    'the failure judgement must be in the THEN branch of resolveDidFail — an `else` ' +
      'inverts it and marks every successful approve as failed',
  )
})
