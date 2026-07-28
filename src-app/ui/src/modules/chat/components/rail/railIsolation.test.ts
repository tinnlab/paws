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

/** The component in that file. Every local guard scopes its AST walk to it. */
const APPROVAL_COMPONENT = 'JsToolApprovalContent'

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
/**
 * The shipped component's body. EVERY local guard below scopes its walk to this
 * node rather than to the whole file.
 *
 * FIX_ROUND-16: file-wide walks were defeated in both directions. A decoy
 * `resolve` in a dead scope AFTER the component relocated the entire click-gate
 * guard onto itself (the finder kept the LAST match), so the real, latched gate
 * passed; and an unrelated helper containing a local named `blocked` FALSE-RED
 * three tests. Scope answers both by construction.
 */
function componentBody(sf: ts.SourceFile, name: string): ts.Node {
  const found: ts.Node[] = []
  const walk = (n: ts.Node): void => {
    if (ts.isFunctionDeclaration(n) && n.name?.getText(sf) === name && n.body) found.push(n.body)
    ts.forEachChild(n, walk)
  }
  walk(sf)
  assert.equal(
    found.length,
    1,
    `${sf.fileName}: expected exactly ONE \`${name}\` function component, found ${found.length}`,
  )
  return found[0]
}

/** Every declaration of `name` inside `scope` (const/let/function/parameter). */
function declarationsOf(sf: ts.SourceFile, scope: ts.Node, name: string): ts.Node[] {
  const out: ts.Node[] = []
  const walk = (n: ts.Node): void => {
    if (
      (ts.isVariableDeclaration(n) || ts.isFunctionDeclaration(n) || ts.isParameter(n)) &&
      n.name?.getText(sf) === name
    ) {
      out.push(n)
    }
    ts.forEachChild(n, walk)
  }
  walk(scope)
  return out
}

/** Every `&&` left-operand of the JSX expression containers enclosing `el`. */
function renderConditions(scope: ts.Node, el: ts.Node): ts.Expression[] {
  const out: ts.Expression[] = []
  for (let n: ts.Node | undefined = el; n && n !== scope; n = n.parent) {
    if (!ts.isJsxExpression(n) || !n.expression) continue
    let e: ts.Expression = n.expression
    while (
      ts.isBinaryExpression(e) &&
      e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
    ) {
      out.push(e.left)
      e = e.right
    }
  }
  return out
}

/** Is `name` bound by `const [name, setX] = useState(…)` inside `scope`? */
function isUseStateBinding(sf: ts.SourceFile, scope: ts.Node, name: string): boolean {
  let ok = false
  const walk = (n: ts.Node): void => {
    if (
      ts.isVariableDeclaration(n) &&
      n.initializer &&
      ts.isCallExpression(n.initializer) &&
      n.initializer.expression.getText(sf) === 'useState' &&
      ts.isArrayBindingPattern(n.name) &&
      n.name.elements.length > 0 &&
      ts.isBindingElement(n.name.elements[0]) &&
      n.name.elements[0].name.getText(sf) === name
    ) {
      ok = true
    }
    ts.forEachChild(n, walk)
  }
  walk(scope)
  return ok
}

/**
 * The two names the approval controls are themselves keyed on: the in-flight
 * flag they pass to `loading`, and the decided-outcome const their render gate
 * tests for `null`.
 *
 * FIX_ROUND-16: the click-gate allowlist must name the operands it permits, and
 * the obvious spelling of `submitting` / `resolved` would have made a pure rename
 * of either RED — the "punishes a correct refactor, so it gets edited away rather
 * than obeyed" failure this round is also fixing elsewhere. Deriving both names
 * from the JSX ties the handler's gate to the control's own rendering, which is
 * the actual invariant (the handler must act in exactly the states the control
 * renders actionable) and is rename-proof by construction.
 */
function approvalControlNames(
  sf: ts.SourceFile,
  scope: ts.Node,
): { loadingName: string; resolvedName: string } {
  const control = elements(sf, 'Button').find(el => attr(el, 'disabled') !== undefined)
  assert.ok(control, 'expected an approval control carrying `disabled`')

  const loading = attrExpr(control, 'loading')
  assert.ok(
    loading && ts.isIdentifier(loading) && isUseStateBinding(sf, scope, loading.getText(sf)),
    `an approval control's \`loading\` must be a bare useState flag, got ` +
      `\`${loading?.getText(sf) ?? '<absent>'}\` — the kit computes ` +
      `\`isDisabled = surfaceDisabled || loading\` and swaps \`onClick\` for a ` +
      `preventDefault, so any richer expression is a second, unguarded disable channel`,
  )

  const conds = renderConditions(scope, control)
  assert.equal(
    conds.length,
    1,
    `the approval controls may be gated on exactly ONE render condition, got ` +
      `[${conds.map(c => c.getText(sf).replace(/\s+/g, ' ')).join(', ')}] — any further ` +
      `condition un-renders the controls in a state the status region still describes ` +
      `as answerable, which is strictly worse than disabling them`,
  )
  const gate = conds[0]
  assert.ok(
    ts.isBinaryExpression(gate) &&
      gate.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
      ts.isIdentifier(gate.left) &&
      gate.right.kind === ts.SyntaxKind.NullKeyword,
    `the controls' render gate must read \`<decided> === null\`, got ` +
      `\`${gate.getText(sf).replace(/\s+/g, ' ')}\``,
  )
  return {
    loadingName: (loading as ts.Identifier).getText(sf),
    resolvedName: (gate as ts.BinaryExpression).left.getText(sf),
  }
}

/**
 * The setter paired with the local that feeds the classifier's `resolveFailed`
 * signal — derived, never spelled. FIX_ROUND-16: hardcoding `setResolveFailed`
 * made a behaviour-preserving rename of the state pair RED with the message
 * "must judge in exactly one place, found 0", which reads as "the judgement was
 * deleted" when it was renamed.
 */
function resolveFailedSetter(sf: ts.SourceFile, scope: ts.Node): string | undefined {
  let local: string | undefined
  const findLocal = (n: ts.Node): void => {
    if (
      ts.isCallExpression(n) &&
      n.expression.getText(sf) === 'elicitationBlockedReason' &&
      n.arguments.length === 1 &&
      ts.isObjectLiteralExpression(n.arguments[0])
    ) {
      for (const p of n.arguments[0].properties) {
        if (p.name?.getText(sf) !== 'resolveFailed') continue
        if (ts.isShorthandPropertyAssignment(p)) local = p.name.getText(sf)
        else if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.initializer)) {
          local = p.initializer.getText(sf)
        }
      }
    }
    ts.forEachChild(n, findLocal)
  }
  findLocal(scope)
  if (!local) return undefined

  let setter: string | undefined
  const findSetter = (n: ts.Node): void => {
    if (
      ts.isVariableDeclaration(n) &&
      n.initializer &&
      ts.isCallExpression(n.initializer) &&
      n.initializer.expression.getText(sf) === 'useState' &&
      ts.isArrayBindingPattern(n.name) &&
      n.name.elements.length === 2 &&
      ts.isBindingElement(n.name.elements[0]) &&
      ts.isBindingElement(n.name.elements[1]) &&
      n.name.elements[0].name.getText(sf) === local
    ) {
      setter = (n.name.elements[1] as ts.BindingElement).name.getText(sf)
    }
    ts.forEachChild(n, findSetter)
  }
  findSetter(scope)
  return setter
}

/** Does this element have visible TEXT children (so it already has a name)? */
function hasTextChildren(el: ts.JsxOpeningLikeElement): boolean {
  const parent = el.parent
  if (!parent || !ts.isJsxElement(parent)) return false
  return parent.children.some(
    c =>
      (ts.isJsxText(c) && c.getText().trim().length > 0) ||
      (ts.isJsxExpression(c) && !!c.expression),
  )
}

/**
 * Is the classifier's argument built from LIVE signals rather than pinned?
 *
 * FIX_ROUND-16: `isBlockedReasonBinding` checked the classifier's CALLEE and
 * never its arguments, so `elicitationBlockedReason({ hasTransport: false, … })`
 * passed — `blocked` pins at `'no-transport'`, both controls are permanently
 * disabled, and the card can never be answered. That is the exact failure mode
 * this guard family exists for, one token away from the binding it did verify.
 */
function isLiveClassifierArg(sf: ts.SourceFile, scope: ts.Node, call: ts.CallExpression): boolean {
  if (call.arguments.length !== 1) return false
  const arg = call.arguments[0]
  if (!ts.isObjectLiteralExpression(arg)) return false
  const want = ['hasTransport', 'entryExists', 'resolveFailed']
  const got = arg.properties.map(p => p.name?.getText(sf) ?? '')
  if (want.length !== got.length || !want.every(w => got.includes(w))) return false
  for (const p of arg.properties) {
    // Shorthand (`hasTransport`) is live by definition; an explicit initializer
    // must not be a literal.
    if (ts.isShorthandPropertyAssignment(p)) continue
    if (!ts.isPropertyAssignment(p)) return false
    const v = p.initializer
    if (
      ts.isLiteralExpression(v) ||
      v.kind === ts.SyntaxKind.TrueKeyword ||
      v.kind === ts.SyntaxKind.FalseKeyword ||
      v.kind === ts.SyntaxKind.NullKeyword ||
      (ts.isPrefixUnaryExpression(v) && ts.isLiteralExpression(v.operand))
    ) {
      return false
    }
  }
  // …and the one signal supplied by shorthand must itself be live, not pinned:
  // `const hasTransport = true` defeats the check above by moving the literal
  // one statement up.
  for (const d of declarationsOf(sf, scope, 'hasTransport')) {
    if (!ts.isVariableDeclaration(d)) return false
    const init = d.initializer
    if (!init || !ts.isCallExpression(init)) return false
    if (init.expression.getText(sf) !== 'hasElicitationTransport') return false
  }
  return true
}

/**
 * Is `name` a `const` inside `scope`, initialised from a LIVE
 * `elicitationBlockedReason(...)` call, and declared exactly once?
 *
 * FIX_ROUND-15 removed a `|| name === fallback` escape that made this vacuous.
 * FIX_ROUND-16 removed the file-wide reassignment scan it added in its place:
 * that branch could not fire for a `const` (the declaration check already
 * rejects a `let`), so it protected nothing, while REDding on any unrelated
 * local named `blocked` anywhere in the file.
 */
function isBlockedReasonBinding(sf: ts.SourceFile, scope: ts.Node, name: string): boolean {
  const decls = declarationsOf(sf, scope, name)
  if (decls.length !== 1) return false
  const d = decls[0]
  if (!ts.isVariableDeclaration(d)) return false
  const isConst =
    ts.isVariableDeclarationList(d.parent) && (d.parent.flags & ts.NodeFlags.Const) !== 0
  if (!isConst) return false
  const init = d.initializer
  if (!init || !ts.isCallExpression(init)) return false
  if (init.expression.getText(sf) !== 'elicitationBlockedReason') return false
  return isLiveClassifierArg(sf, scope, init)
}

/**
 * Does `name` resolve to the seam export of the SAME name — no alias, no shadow?
 *
 * FIX_ROUND-16: this proved only that an import binding existed, and matched on
 * `e.name` (the LOCAL binding) while ignoring `e.propertyName` (what was actually
 * imported). Two tsc-clean evasions followed, each reinstating FIX_ROUND-4
 * verbatim:
 *   `elicitationIsError as elicitationIsUnactionable`  — a different predicate,
 *      identical signature, so `resolve-failed` disables both controls and the
 *      disable gates its own reset: the card is dead for the life of the mount.
 *   a component-local `const elicitationIsUnactionable = () => true` shadowing
 *      the import — the card is permanently unanswerable in every state.
 * The guard's own comment already claimed to stop both; now it does.
 */
function importedFromSeam(sf: ts.SourceFile, name: string): boolean {
  let ok = false
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st)) continue
    const from = (st.moduleSpecifier as ts.StringLiteral).text
    if (!from.endsWith('core/elicitation/transport')) continue
    const named = st.importClause?.namedBindings
    if (named && ts.isNamedImports(named)) {
      // `propertyName` is set ONLY for `x as y`; requiring it absent is what
      // rejects an alias that re-points the name at a different export.
      if (named.elements.some(e => e.propertyName === undefined && e.name.getText(sf) === name)) {
        ok = true
      }
    }
  }
  // A local binding of the same name shadows the import at every call site.
  return ok && declarationsOf(sf, sf, name).length === 0
}

function isExactCall(
  sf: ts.SourceFile,
  scope: ts.Node,
  expr: ts.Expression | undefined,
  predicate: string,
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
    isBlockedReasonBinding(sf, scope, e.arguments[0].getText(sf))
  if (callOf(expr)) return true
  // One local hop: a `const` in THIS scope whose sole initializer is that call.
  // (A `const` cannot be reassigned, so the file-wide assignment scan this used
  // to run protected nothing and false-RED on unrelated locals — FIX_ROUND-16.)
  if (!ts.isIdentifier(expr)) return false
  const decls = declarationsOf(sf, scope, expr.getText(sf))
  if (decls.length !== 1) return false
  const d = decls[0]
  if (!ts.isVariableDeclaration(d)) return false
  const isConst =
    ts.isVariableDeclarationList(d.parent) && (d.parent.flags & ts.NodeFlags.Const) !== 0
  return isConst && !!d.initializer && callOf(d.initializer)
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
      if (attr(el, 'tooltip') === undefined) continue
      const canDisable = attr(el, 'disabled') !== undefined || hasSpread(el)
      if (canDisable) {
        violations.push(`${rel}: a <Button> takes BOTH \`disabled\` and \`tooltip\``)
        continue
      }
      // FIX_ROUND-16: hazard (a) needs no `disabled` at all. A string tooltip
      // REPLACES the accessible name of a button that already has one from its
      // visible text — which is exactly the FIX_ROUND-5 regression — so the
      // conjunction with `canDisable` left the larger half of the hazard
      // unguarded on BOTH surfaces.
      if (hasTextChildren(el) && attr(el, 'aria-label') === undefined) {
        violations.push(
          `${rel}: a <Button> with visible text takes a \`tooltip\` and no explicit ` +
            `\`aria-label\` — a string tooltip becomes the accessible name and ` +
            `overwrites the visible one`,
        )
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
  const scope = componentBody(sf, APPROVAL_COMPONENT)
  // BOTH the predicate and the classifier that feeds it. FIX_ROUND-16: only the
  // predicate was checked, so replacing `elicitationBlockedReason` with a local
  // function of the same name — which can answer anything — was tsc-clean and
  // green.
  for (const seamFn of ['elicitationIsUnactionable', 'elicitationBlockedReason']) {
    assert.ok(
      importedFromSeam(sf, seamFn),
      `${seamFn} must resolve to the core elicitation seam export of the SAME name — ` +
        'an import alias, a same-named local, or a sibling-module function satisfies a ' +
        'text match and is tsc-clean, while deciding something else entirely',
    )
  }
  const buttons = elements(sf, 'Button')
  const disabling = buttons.filter(el => attr(el, 'disabled') !== undefined)
  assert.ok(disabling.length >= 2, `expected the approve/deny controls, found ${disabling.length}`)
  // Also asserts the `loading` channel and the render gate are well-shaped.
  const { loadingName, resolvedName } = approvalControlNames(sf, scope)

  for (const el of buttons) {
    assert.ok(
      !hasSpread(el),
      'an approval control must not take props through a spread — a spread can ' +
        'supply or override `disabled` and the guard cannot see through it',
    )
    if (attr(el, 'disabled') === undefined) continue
    const expr = attrExpr(el, 'disabled')
    assert.ok(
      isExactCall(sf, scope, expr, 'elicitationIsUnactionable'),
      `an approval control's \`disabled\` must BE elicitationIsUnactionable(blocked) ` +
        `(or a const whose sole initializer is that call), got ` +
        `\`${expr?.getText(sf) ?? '<boolean shorthand>'}\`. Anything combined with it — ` +
        `\`|| blocked !== null\`, a negation, a different argument — changes which ` +
        `states disable, and every time a state the user could still act through was ` +
        `disabled, the card became unanswerable (FIX_ROUND-4, -6, -7).`,
    )

    // `disabled` is not the only disabling channel. The kit computes
    // `isDisabled = surfaceDisabled || loading` and, when loading, applies
    // `pointer-events-none` and swaps `onClick` for a preventDefault — so
    // `loading={submitting || blocked !== null}` makes the card inert in exactly
    // the states the status text says are answerable, and FIX_ROUND-9 could not
    // see it (FIX_ROUND-16). `approvalControlNames` pins the shape by BINDING
    // (a bare useState flag), so a rename stays green.
    const loading = attrExpr(el, 'loading')
    assert.ok(
      loading && ts.isIdentifier(loading) && loading.getText(sf) === loadingName,
      `every approval control must pass the SAME in-flight flag to \`loading\`, ` +
        `expected \`${loadingName}\`, got \`${loading?.getText(sf) ?? '<absent>'}\``,
    )
  }

  // Which ACTION each control dispatches. Nothing pinned this, so swapping Deny's
  // handler to `resolve('accept')` — clicking Deny APPROVES the tool call — was
  // green (FIX_ROUND-16).
  for (const [kind, action] of [
    ['approve', 'accept'],
    ['deny', 'decline'],
  ]) {
    const el = buttons.find(b =>
      attrExpr(b, 'data-testid')?.getText(sf).includes(`run-js-approval-${kind}-`),
    )
    assert.ok(el, `the ${kind} control must be identifiable by its data-testid`)
    const onClick = attrExpr(el, 'onClick')?.getText(sf).replace(/\s+/g, ' ')
    assert.equal(
      onClick,
      `() => resolve('${action}')`,
      `the ${kind} control must dispatch resolve('${action}'), got \`${onClick}\``,
    )
  }

  // Every control must sit under the SAME single render gate — the one
  // `approvalControlNames` already shape-checked. Vanishing is strictly worse
  // than disabling (no affordance at all), and the JSX ancestor conditions were
  // unguarded, so `resolved === null && blocked !== 'not-registered'` silently
  // removed both controls in a state the card's own copy calls answerable
  // (FIX_ROUND-16).
  for (const el of disabling) {
    const conds = renderConditions(scope, el).map(c => c.getText(sf).replace(/\s+/g, ' '))
    assert.deepEqual(
      conds,
      [`${resolvedName} === null`],
      `an approval control may be gated on \`${resolvedName} === null\` and nothing ` +
        `else, got [${conds.join(', ')}]`,
    )
  }
})

test('FIX_ROUND-14: the click handler gates on the SAME predicate as the control', () => {
  // The re-entrancy early-return in `resolve()` decides whether the POST actually
  // happens, and it was unguarded — latching it there reintroduces the
  // FIX_ROUND-4 bug in a WORSE form: the control still RENDERS enabled, so the
  // user clicks, and the click silently no-ops with no signal at all.
  //
  // FIX_ROUND-15: this check now runs the gate's OPERANDS through `isExactCall`,
  // the same AST predicate the JSX attribute uses. Its first cut was a regex over
  // `getText()` — the very anti-pattern this file's FIX_ROUND-13 block says the
  // rewrite exists to stop — and it fell to a one-token inversion
  // (`!elicitationIsUnactionable(blocked)`, which makes every actionable decision
  // return early and never POST) and to three latch operands (`|| resolveFailed`,
  // `|| Boolean(blocked)`, `|| healExhausted`). Operands are also why the guard no
  // longer cares HOW the clauses are split across `if`s.
  //
  // FIX_ROUND-16: the operand check is now an ALLOWLIST. FIX_ROUND-15's version
  // pre-selected the seam operand by SUBSTRING and screened the rest with
  // `assert.doesNotMatch(/\bblocked\b|\bresolveFailed\b|\bhealExhausted\b/)` — a
  // `getText()` regex over three identifier spellings, which is the unbounded
  // enumeration FIX_ROUND-13 exists to stop. Five latches walked past it, each
  // leaving the control ENABLED while the click silently no-ops:
  //   `const alreadyTried = resolveFailed; … || alreadyTried`   (one alias)
  //   `if (!elicitationExists(data.elicitation_id)) return`     (outside the vocab)
  //   `if (healAttempts.n >= HEAL_BUDGET) return`               (outside the vocab)
  //   a pure rename of `blocked`, which retires the whole vocabulary at once
  // Enumerating what is FORBIDDEN can never terminate; enumerating what is
  // PERMITTED terminates immediately, and any new operand at all now fails.
  const sf = parse(APPROVAL_SURFACE_WITH_CONTROLS)
  const scope = componentBody(sf, APPROVAL_COMPONENT)
  const { loadingName, resolvedName } = approvalControlNames(sf, scope)

  // `resolve` must be declared exactly ONCE inside the component. A decoy in a
  // dead scope elsewhere in the file used to relocate this entire guard onto
  // itself, so the real, latched handler passed (FIX_ROUND-16).
  const decls = declarationsOf(sf, scope, 'resolve')
  assert.equal(
    decls.length,
    1,
    `the card must declare exactly ONE \`resolve\` handler inside ${APPROVAL_COMPONENT}, ` +
      `found ${decls.length} — a second declaration makes it ambiguous which one this ` +
      `guard is reading`,
  )
  const body = decls[0]

  // Only `||` is flattened. Conjoining the clauses instead — `(submitting ||
  // resolved !== null) && elicitationIsUnactionable(blocked)` — yields the SAME
  // operand set while making the re-entrancy guard dead, so a double-click POSTs
  // twice to a single-use elicitation (FIX_ROUND-16).
  const flatten = (e: ts.Expression): ts.Expression[] => {
    if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
      return [...flatten(e.left), ...flatten(e.right)]
    }
    if (ts.isParenthesizedExpression(e)) return flatten(e.expression)
    return [e]
  }
  /** Does this statement unconditionally leave the handler? */
  const returns = (s: ts.Statement | undefined): boolean =>
    !!s &&
    (ts.isReturnStatement(s) ||
      (ts.isBlock(s) && s.statements.length === 1 && ts.isReturnStatement(s.statements[0])))

  const guards: ts.IfStatement[] = []
  const collect = (n: ts.Node): void => {
    if (ts.isIfStatement(n)) guards.push(n)
    ts.forEachChild(n, collect)
  }
  collect(body)
  const earlyReturns = guards.filter(g => returns(g.thenStatement))
  assert.ok(earlyReturns.length > 0, 'resolve() must keep an early-return guard')

  // The seam predicate must appear in an `if` that actually RETURNS. Nothing
  // checked the then-branch before, so `if (elicitationIsUnactionable(blocked) &&
  // never) { setSubmitting(false) }` reduced the guard's whole subject to a no-op
  // while reporting green (FIX_ROUND-16 — a regression this round introduced).
  // Selected by `isExactCall` — the same AST predicate the JSX attribute uses, so
  // hoisting the call into a `const` used by BOTH the control and the gate (a
  // behaviour-preserving refactor that removes a duplicated call) stays green.
  // FIX_ROUND-15 selected by substring here and by `isExactCall` there, so the
  // two halves disagreed and the documented one-local-hop was accepted for the
  // control and rejected for the gate.
  const carriesSeam = (g: ts.IfStatement): boolean =>
    flatten(g.expression).some(o => isExactCall(sf, scope, o, 'elicitationIsUnactionable'))
  const seamGuards = earlyReturns.filter(carriesSeam)
  assert.equal(
    seamGuards.length,
    1,
    `exactly ONE early-RETURN guard in resolve() must gate on ` +
      `elicitationIsUnactionable, found ${seamGuards.length}. An \`if\` that mentions ` +
      `the predicate but does not return gates nothing at all.`,
  )
  for (const g of guards) {
    if (earlyReturns.includes(g)) continue
    assert.ok(
      !carriesSeam(g) && !g.expression.getText(sf).includes('elicitationIsUnactionable'),
      `resolve() has an \`if\` on elicitationIsUnactionable whose body does NOT ` +
        `return: \`${g.getText(sf).replace(/\s+/g, ' ').slice(0, 120)}\``,
    )
  }

  // EVERY operand of EVERY early return must be one of exactly three permitted
  // forms. Anything else — an alias, another seam call, a heal-budget check — is
  // a latch, and latching here is worse than disabling: the control still renders
  // ENABLED, the status text still invites the click, and the click no-ops.
  let seamOperandCount = 0
  for (const g of earlyReturns) {
    assert.ok(
      !g.getText(sf).includes('&&'),
      `resolve()'s early-return guards must combine with \`||\` only, got ` +
        `\`${g.expression.getText(sf).replace(/\s+/g, ' ')}\` — an \`&&\` keeps the same ` +
        `operands while making the re-entrancy clauses dead, so a double-click POSTs twice`,
    )
    for (const o of flatten(g.expression)) {
      const text = o.getText(sf).replace(/\s+/g, ' ')
      if (isExactCall(sf, scope, o, 'elicitationIsUnactionable')) {
        seamOperandCount += 1
        continue
      }
      // The re-entrancy pair — identified by the names the CONTROLS themselves
      // use, so a rename of either stays green while a new operand does not.
      if (ts.isIdentifier(o) && text === loadingName) continue
      if (
        ts.isBinaryExpression(o) &&
        o.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken &&
        o.left.getText(sf) === resolvedName &&
        o.right.kind === ts.SyntaxKind.NullKeyword
      ) {
        continue
      }
      assert.fail(
        `resolve()'s early-return guard has an operand that is neither the seam ` +
          `predicate nor the re-entrancy pair: \`${text}\`. Permitted operands are ` +
          `exactly \`${loadingName}\`, \`${resolvedName} !== null\`, and ` +
          `\`elicitationIsUnactionable(<blocked reason>)\` — anything else latches the ` +
          `handler while the control still renders ENABLED, so the click silently no-ops.`,
      )
    }
  }
  assert.equal(
    seamOperandCount,
    1,
    `the seam predicate must appear exactly once across resolve()'s early returns, ` +
      `found ${seamOperandCount} — a negation or a wrapper returns early exactly when ` +
      `the card IS actionable, so no decision ever POSTs`,
  )
})

test('FIX_ROUND-11: the two extracted DECISIONS decide at their call sites', () => {
  const sf = parse(APPROVAL_SURFACE_WITH_CONTROLS)
  const scope = componentBody(sf, APPROVAL_COMPONENT)
  const { resolvedName } = approvalControlNames(sf, scope)
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
      tone.condition.left.getText(sf) === `!${resolvedName}`,
    `the tone condition must read \`!${resolvedName} && <predicate>\`, got ` +
      `\`${tone.condition.getText(sf)}\``,
  )
  assert.ok(
    isExactCall(sf, scope, (tone.condition as ts.BinaryExpression).right, 'elicitationIsError'),
    `the status tone must be decided by elicitationIsError(blocked), got ` +
      `\`${(tone.condition as ts.BinaryExpression).right.getText(sf)}\` — otherwise a ` +
      `transient, answerable state gets painted in the destructive red ` +
      `DESIGN_SYSTEM.md reserves for errors`,
  )

  // ── the failure judgement ──────────────────────────────────────────────────
  // Every JUDGING call (anything but the `(false)` reset) must be the consequent
  // of an `if (resolveDidFail(...))`. Counting the literal `(true)` missed
  // `setResolveFailed(hadEntry === false)` sitting beside the conforming one.
  const setter = resolveFailedSetter(sf, scope)
  assert.ok(
    setter,
    'could not locate the useState setter paired with the classifier’s ' +
      '`resolveFailed` signal — the card must still hold that state locally',
  )
  const judging: ts.CallExpression[] = []
  const walk = (n: ts.Node): void => {
    if (
      ts.isCallExpression(n) &&
      n.expression.getText(sf) === setter &&
      n.arguments[0]?.getText(sf) !== 'false'
    ) {
      judging.push(n)
    }
    ts.forEachChild(n, walk)
  }
  walk(scope)
  assert.equal(
    judging.length,
    1,
    `${setter} must judge in exactly one place, found ${judging.length} ` +
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
