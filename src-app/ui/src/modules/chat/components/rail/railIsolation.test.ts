import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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
    let text: string
    try {
      text = readFileSync(join(SRC, rel), 'utf8')
    } catch {
      continue // the file may legitimately have been removed
    }
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
  const nextDecl = after.search(/\n {2}(?:const|function|return|\/\*\*) /)
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
 *  1. `Button` derives `aria-label` from a STRING `tooltip` unconditionally, so a
 *     tooltip silently REPLACES the visible label in the accessibility tree —
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

/** The files whose approve/deny controls this guards. A rename must FAIL. */
const APPROVAL_SURFACES = [
  'modules/js-tool/chat-extension/components/JsToolApprovalContent.tsx',
  'modules/mcp/chat-extension/components/ToolCallPendingApprovalContent.tsx',
]

/** Source with comments stripped. */
function codeOf(rel: string): string {
  return readFileSync(join(SRC, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .map(l => l.replace(/\/\/.*$/, ''))
    .join('\n')
}

/**
 * Every `<Button …>` opening tag's props.
 *
 * The tag ends at the first `>` that is outside BOTH braces and quotes. A lazy
 * `/<Button[\s\S]*?>/` stops at the `>` of a nested element in a prop
 * (`icon={<Check />}`); tracking only braces still stops at a `>` inside a quoted
 * attribute value. Both were verified to blind the guard.
 */
function buttonProps(code: string): string[] {
  const out: string[] = []
  let from = 0
  for (;;) {
    const open = code.indexOf('<Button', from)
    if (open === -1) break
    let depth = 0
    let quote: string | null = null
    let i = open + '<Button'.length
    for (; i < code.length; i++) {
      const ch = code[i]
      if (quote) {
        if (ch === quote) quote = null
        continue
      }
      if (ch === '"' || ch === "'" || ch === '`') quote = ch
      else if (ch === '{') depth++
      else if (ch === '}') depth--
      else if (ch === '>' && depth === 0) break
    }
    out.push(code.slice(open + '<Button'.length, i))
    from = i + 1
  }
  return out
}

test('FIX_ROUND-8: no `tooltip` on a Button that can be disabled (kit clobbers aria-label)', () => {
  const violations: string[] = []
  for (const rel of APPROVAL_SURFACES) {
    // No `catch { continue }` — a renamed file must fail, not silently pass.
    for (const props of buttonProps(codeOf(rel))) {
      // `disabled` as an assignment, as BOOLEAN SHORTHAND, or via a spread —
      // all three reach `nativeDisabled`, and the first cut only saw the first.
      const canDisable =
        /\bdisabled\s*=/.test(props) ||
        /(^|[\s{])disabled(\s|$|\/)/.test(props) ||
        /\{\s*\.\.\..*\bdisabled\b/.test(props)
      if (canDisable && /\btooltip\s*=/.test(props)) {
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
  // The rule "only the impossible state disables" was pinned as a pure predicate
  // (`elicitationIsUnactionable`) but NOT at the two JSX call sites that render
  // it — so re-introducing the FIX_ROUND-7 latch (`disabled={blocked !== null}`)
  // left everything green. This pins the call sites.
  const rel = 'modules/js-tool/chat-extension/components/JsToolApprovalContent.tsx'
  const props = buttonProps(codeOf(rel))
  const disabling = props.filter(p => /\bdisabled\s*=/.test(p))
  assert.ok(disabling.length >= 2, `expected the approve/deny controls, found ${disabling.length}`)
  for (const p of disabling) {
    const expr = /\bdisabled\s*=\s*\{([^}]*)\}/.exec(p)?.[1]?.trim()
    assert.equal(
      expr,
      'elicitationIsUnactionable(blocked)',
      'an approval control must derive `disabled` from the seam predicate — every ' +
        'time a state the user could still act through was disabled, the card ' +
        'became unanswerable (three times: FIX_ROUND-4, -6, -7)',
    )
  }
})
