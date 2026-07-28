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
  const text = readFileSync(file, 'utf8')

  assert.ok(
    importsOf(file).some(spec => spec.endsWith('rail/railSegmentation')),
    'ChatMessage must import the segmentation module',
  )
  assert.match(
    text,
    /withSegmentationShape\s*\(/,
    'ChatMessage must call withSegmentationShape — segmentation owns key/consumed/blocking',
  )
  // The revert this guards: handing the registry's step back untouched.
  assert.doesNotMatch(
    text,
    /resolveRailStep\([^)]*\)\?\.step\s*\?\?\s*placed\.step/,
    'resolveStep must not return the contribution step directly — that discards ' +
      'segmentation’s disambiguated key and its consumed clamp',
  )
})
