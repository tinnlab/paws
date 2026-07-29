/**
 * Unit tests for vite-plugin-eager-render-graph (fix #1 of e2e-render-serving).
 * Pure Node — runs under `node --test`, no vite build required.
 *
 * Proves the plugin (a) emits a virtual module that statically imports the whole
 * chat render graph (streamdown + both plugin modules + the streamdown-internal
 * highlighted-body chunk) and references them tree-shake-proof, and (b) injects
 * the eager import into the app ENTRY only.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  isEntryId,
  buildEagerModuleSource,
  resolveStreamdownInternalChunks,
  eagerRenderGraphPlugin,
} from './vite-plugin-eager-render-graph.js'

test('isEntryId (suffix fallback) matches only src/main.tsx', () => {
  assert.equal(isEntryId('/repo/src-app/ui/src/main.tsx'), true)
  assert.equal(isEntryId('/repo/src-app/ui/src/main.tsx?v=1'), true)
  assert.equal(isEntryId('C:\\repo\\src\\main.tsx'), true)
  assert.equal(isEntryId('/repo/src-app/ui/src/App.tsx'), false)
  assert.equal(isEntryId('/repo/src-app/ui/src/modules/chat/main.tsx.helper.ts'), false)
})

test('isEntryId (explicit entry) matches ONLY that exact module, not a dep src/main.tsx', () => {
  const entry = '/repo/src-app/ui/src/main.tsx'
  assert.equal(isEntryId('/repo/src-app/ui/src/main.tsx', entry), true)
  assert.equal(isEntryId('/repo/src-app/ui/src/main.tsx?v=2', entry), true)
  // A transitive dependency that also ships a src/main.tsx must NOT match.
  assert.equal(isEntryId('/repo/node_modules/somepkg/src/main.tsx', entry), false)
})

test('buildEagerModuleSource statically imports the whole render graph + is tree-shake-proof', () => {
  const src = buildEagerModuleSource([
    '/abs/node_modules/streamdown/dist/highlighted-body-XXXX.js',
    '/abs/node_modules/streamdown/dist/mermaid-YYYY.js',
  ])
  assert.match(src, /import \* as __streamdown from 'streamdown'/)
  assert.match(src, /from '@\/components\/common\/streamdownPlugins'/)
  assert.match(src, /from '@\/modules\/chat\/core\/utils\/chatMarkdownPlugins'/)
  assert.match(src, /highlighted-body-XXXX\.js/)
  assert.match(src, /mermaid-YYYY\.js/)
  // Every namespace is referenced through the globalThis sink so nothing is
  // dropped by tree-shaking (streamdown internals export side-effect-free symbols).
  assert.match(src, /__ZIEE_E2E_EAGER_RENDER__ = \[__streamdown, __basePlugins, __chatPlugins, __ic0, __ic1\]/)
})

test('buildEagerModuleSource works with zero internal chunks (defensive)', () => {
  const src = buildEagerModuleSource([])
  assert.match(src, /import \* as __streamdown from 'streamdown'/)
  assert.match(src, /__ZIEE_E2E_EAGER_RENDER__ = \[__streamdown, __basePlugins, __chatPlugins, \]/)
})

test('resolveStreamdownInternalChunks is data-driven: globs every async chunk, excludes index.js + chunk-*', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sd-'))
  const dist = join(dir, 'streamdown', 'dist')
  mkdirSync(dist, { recursive: true })
  writeFileSync(join(dist, 'index.js'), 'export {}')
  writeFileSync(join(dist, 'highlighted-body-ABCD1234.js'), 'export const HighlightedCodeBlockBody = 1')
  writeFileSync(join(dist, 'mermaid-EFGH5678.js'), 'export const Mermaid = 1')
  // A FUTURE streamdown internal async chunk (new prefix) must be auto-included.
  writeFileSync(join(dist, 'future-widget-QQQ9.js'), 'export const Widget = 1')
  writeFileSync(join(dist, 'chunk-ZZZZ.js'), 'export {}')
  writeFileSync(join(dist, 'index.d.ts'), '')
  try {
    const fakeResolve = spec => {
      assert.equal(spec, 'streamdown')
      return join(dist, 'index.js')
    }
    const chunks = resolveStreamdownInternalChunks(fakeResolve)
    assert.equal(chunks.length, 3, 'highlighted-body + mermaid + the future async chunk')
    assert.ok(chunks.some(c => /highlighted-body-ABCD1234\.js$/.test(c)))
    assert.ok(chunks.some(c => /mermaid-EFGH5678\.js$/.test(c)))
    assert.ok(chunks.some(c => /future-widget-QQQ9\.js$/.test(c)), 'a new async chunk is auto-folded')
    // never the shared chunk-*, never index.js, never .d.ts
    assert.ok(!chunks.some(c => /chunk-ZZZZ/.test(c)))
    assert.ok(!chunks.some(c => /index\.js$/.test(c)))
    assert.ok(chunks.every(c => !c.includes('\\')), 'paths are POSIX')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('resolveStreamdownInternalChunks throws when highlighted-body is absent (empty AND mixed cases)', () => {
  const mk = (files) => {
    const dir = mkdtempSync(join(tmpdir(), 'sd-'))
    const dist = join(dir, 'streamdown', 'dist')
    mkdirSync(dist, { recursive: true })
    for (const [n, c] of Object.entries(files)) writeFileSync(join(dist, n), c)
    return { dir, resolve: () => join(dist, 'index.js') }
  }
  // Empty case: only index.js.
  const a = mk({ 'index.js': 'export {}' })
  try { assert.throws(() => resolveStreamdownInternalChunks(a.resolve), /highlighted-body/) }
  finally { rmSync(a.dir, { recursive: true, force: true }) }
  // Mixed case (the realistic "streamdown renamed one chunk"): mermaid present,
  // matched is NON-empty, but highlighted-body absent -> must STILL throw.
  const b = mk({ 'index.js': 'export {}', 'mermaid-EFGH5678.js': 'export const Mermaid = 1' })
  try { assert.throws(() => resolveStreamdownInternalChunks(b.resolve), /highlighted-body/) }
  finally { rmSync(b.dir, { recursive: true, force: true }) }
})

test('the eager import list points at app plugin modules that ACTUALLY EXIST on disk', () => {
  // Guards the hardcoded '@/...' specifiers in buildEagerModuleSource against a
  // silent rename that string-match assertions alone would miss.
  const uiRoot = new URL('..', import.meta.url).pathname
  for (const rel of [
    'src/components/common/streamdownPlugins.ts',
    'src/modules/chat/core/utils/chatMarkdownPlugins.ts',
  ]) {
    assert.ok(existsSync(join(uiRoot, rel)), `${rel} must exist (eager module imports it)`)
  }
})

test('plugin.transform injects the eager import into the entry ONLY; resolveId/load wire the virtual module', () => {
  const plugin = eagerRenderGraphPlugin()
  // resolveId maps the public id to the \0-prefixed resolved id.
  assert.equal(plugin.resolveId('virtual:ziee-e2e-eager-render'), '\0virtual:ziee-e2e-eager-render')
  assert.equal(plugin.resolveId('something-else'), undefined)

  // transform prepends the import for the entry, no-ops elsewhere.
  const entry = plugin.transform('const x = 1', '/repo/src-app/ui/src/main.tsx')
  assert.ok(entry && entry.code.startsWith("import 'virtual:ziee-e2e-eager-render'\n"))
  assert.match(entry.code, /const x = 1/)
  assert.equal(plugin.transform('const y = 2', '/repo/src-app/ui/src/App.tsx'), undefined)

  // load() builds real source against the installed streamdown (resolves this repo's copy).
  const loaded = plugin.load('\0virtual:ziee-e2e-eager-render')
  assert.match(loaded, /import \* as __streamdown from 'streamdown'/)
  assert.match(loaded, /highlighted-body-.*\.js/)
})
