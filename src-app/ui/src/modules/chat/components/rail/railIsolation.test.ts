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

/** Module specifiers imported (statically or dynamically) by a file. */
function importsOf(file: string): string[] {
  const text = readFileSync(file, 'utf8')
  const specs: string[] = []
  const re = /(?:from\s+|import\s*\(\s*)['"]([^'"]+)['"]/g
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
