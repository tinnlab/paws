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
 * e2e can observe it: the divergence only shows on a message that REPLAYS a
 * `tool_use_id`.
 *
 * So this is a source-level guard, and it is labelled as one. It does not assert
 * behaviour; it asserts that the single production consumer still goes through
 * the seam, which is the property the extraction exists to keep.
 *
 * NOTE (harness round): this file used to add "and the workspace's unit runner
 * cannot mount JSX" as the reason. That is no longer true — `vitest.config.ts`
 * now runs `src/**\/*.test.tsx` under jsdom, and
 * `js-tool/chat-extension/components/JsToolApprovalContent.test.tsx` mounts a
 * real component. Mounting `ChatMessage` is a much larger fixture (the whole
 * chat pane context and a message stream) than mounting a leaf card, so this
 * guard stays static for now — but the reason is COST, not impossibility, and it
 * should not be cited as impossibility again.
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
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT USED TO LIVE BELOW THIS LINE, AND WHY IT DOES NOT ANY MORE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Four SOURCE-SCANNING guards over
 * `modules/js-tool/chat-extension/components/JsToolApprovalContent.tsx`
 * (FIX_ROUND-8's disable channel, FIX_ROUND-9's control contract, FIX_ROUND-14's
 * click gate, FIX_ROUND-11's notice wiring) plus ~700 lines of AST machinery
 * feeding them. They are DELETED, replaced by a component harness:
 *
 *   src/modules/js-tool/chat-extension/components/JsToolApprovalContent.test.tsx
 *
 * The reason is recorded in `FIX_ROUND-19.md` §6, which ABORTED the fix loop:
 * twenty rounds, a finding profile that never fell, and two blind audits run in
 * OPPOSITE directions (round 18 deleted these guards, round 19 restored them)
 * each finding five more spellings the other missed. `FIX_ROUND-18.md` §8 named
 * the replacement, and `LEDGER.jsonl` FR19-10 and FR19-12 name it as their own
 * fix: *"closed BY CONSTRUCTION by the component harness"*.
 *
 * The diagnosis, stated once: these guards proved a BEHAVIOURAL property (*the
 * handler POSTs, with the user's own answer, in exactly the states the control
 * renders actionable*) by pattern-matching SOURCE. The space of source spellings
 * is unbounded, so each round closed the ones the last audit found and the next
 * audit found more. The harness observes the EFFECT instead — it mounts the card
 * against a scripted transport, constructs the states no browser session can
 * reach (`no-transport`, and a not-open entry the self-heal cannot close), clicks,
 * and reads the recorded POST. That space is bounded, so the two HIGH findings
 * are closed by construction rather than by a predicate.
 *
 * The exchange, honestly: the harness cannot observe CSS inerting
 * (`pointer-events-none`), because jsdom applies no stylesheet — the deleted
 * `className` sweep could see that one channel, at the price of enumerating
 * channels forever (round 19's FR19-11 lists five more it could not see).
 * Playwright's actionability check covers it for the two spec-reachable states in
 * `tests/e2e/chat/run-js-inner-approval.spec.ts`, and the harness's
 * `assertReachable()` covers the DOM-attribute channels. That is stated in the
 * harness header rather than papered over.
 *
 * `scripts/mutate-approval-card.mjs` is the evidence: it applies each historical
 * defect verbatim to the shipped component and asserts the harness goes RED (and
 * that behaviour-preserving refactors stay GREEN).
 *
 * WHAT IS KEPT, above and below:
 *  - the IMPORT-GRAPH guards (INV-1 / TEST-36 / the js-tool↔mcp decoupling).
 *    A module graph is a static property of source; there is no runtime moment at
 *    which "the rail imports an extension" is observable. Static is the RIGHT
 *    tool there, and INV-1 is the invariant the whole feature exists to hold.
 *  - `FIX_ROUND-5`'s `withSegmentationShape` routing check — a rail concern the
 *    approval-card harness does not touch.
 *  - `FIX_ROUND-8`'s tooltip/accessible-name guard, RETARGETED to the mcp
 *    approval card ONLY. The js-tool card's half is now behavioural (the harness
 *    asserts the two controls announce DISTINCT names, which is the actual
 *    regression); the mcp card is not mounted by any harness, so its half stays
 *    static until one exists.
 */

/** The approval surface with no component harness of its own. */
const APPROVAL_SURFACES = ['modules/mcp/chat-extension/components/ToolCallPendingApprovalContent.tsx']

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


/** Does this element have visible TEXT children (so it already has a name)? */
function hasTextChildren(el: ts.JsxOpeningLikeElement): boolean {
  // A SELF-CLOSING element has no children at all — and its `.parent` is the
  // element that CONTAINS it, whose children are somebody else's. Reading them
  // made an icon-only `<Button tooltip=… />` (the kit's blessed way to give an
  // icon button its accessible name) inherit the surrounding text and go RED.
  if (!ts.isJsxOpeningElement(el)) return false
  const parent = el.parent
  if (!parent || !ts.isJsxElement(parent)) return false
  // FIX_ROUND-17: recurse. Looking only at DIRECT children missed
  // `<Button tooltip="…"><Text>Deny</Text></Button>`, where the kit clobbers the
  // accessible name identically. An icon-only Button is self-closing (no
  // JsxElement parent), so it still correctly reports false.
  const hasText = (n: ts.Node): boolean => {
    if (ts.isJsxText(n)) return n.getText().trim().length > 0
    if (ts.isJsxExpression(n)) return !!n.expression
    if (ts.isJsxElement(n)) return n.children.some(hasText)
    return false
  }
  return parent.children.some(hasText)
}


test('FIX_ROUND-8: no `tooltip` on a Button that can be disabled (kit clobbers aria-label)', () => {
  // Two mechanical facts about the kit make this a defect, not a style choice:
  // `Button` derives `aria-label` from a STRING `tooltip` WHEN NO EXPLICIT
  // `aria-label` IS GIVEN (`ariaLabelProp ?? (typeof tooltip === 'string' ? …)`)
  // — and these controls give none, so a tooltip silently REPLACES the visible
  // label, which is what FIX_ROUND-5 shipped and made Approve and Deny announce
  // identically (WCAG 2.5.3 / 4.1.2). And `disabled` becomes the native attribute
  // under `disabled:pointer-events-none`, so the trigger can never fire anyway.
  //
  // SCOPE (this round): the mcp approval card only. The js-tool card's copy of
  // this property is asserted BEHAVIOURALLY by
  // `JsToolApprovalContent.test.tsx` — it mounts the card and requires the two
  // controls to announce DISTINCT accessible names, which is the regression
  // itself rather than one syntax that causes it. Mount the mcp card and this
  // guard can go too.
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
