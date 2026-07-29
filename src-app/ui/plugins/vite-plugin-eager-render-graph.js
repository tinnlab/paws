/**
 * vite-plugin-eager-render-graph — E2E-BUILD-ONLY render robustness.
 *
 * PROBLEM. The chat markdown/HTML render pipeline is code-split behind a chain
 * of on-demand dynamic imports:
 *   - app-level (src/modules/chat/core/utils/LazyStreamdown.tsx):
 *       `import('streamdown')` + `import('.../chatMarkdownPlugins')` /
 *       `import('@/components/common/streamdownPlugins')`
 *   - streamdown-internal (inside the `streamdown` dist):
 *       `lazy(() => import('./highlighted-body-*.js'))` and
 *       `lazy(() => import('./mermaid-*.js'))`
 * Under CPU saturation the single-threaded `vite preview` e2e server can cut one
 * of those responses mid-flight (`net::ERR_INCOMPLETE_CHUNKED_ENCODING`), so the
 * React.lazy boundary never resolves and the assistant bubble / html-block /
 * code-block never mounts within the `toBeVisible` timeout — the deterministic
 * render specs (html-iframe-render, markdown-rendering, …) flake under load.
 *
 * FIX (#1 of the two-part e2e-render-serving fix). This plugin folds that whole
 * render graph into the ENTRY's STATIC import graph for the e2e build, so those
 * chunks are modulepreloaded at BOOT and every render-time `import()` resolves
 * from the module cache with NO network fetch. The markdown/HTML block then
 * mounts self-contained — no render-time server-delivery dependency. (The
 * residual shiki per-language grammar chunks are handled graph-agnostically by
 * the in-memory static middleware — fix #2 — so they are intentionally NOT
 * enumerated here.)
 *
 * It does this WITHOUT changing any app behavior: `LazyStreamdown` still calls
 * `import()`; the module is simply already loaded. The Suspense fallback path is
 * unchanged.
 *
 * SCOPE. Used ONLY by the e2e static build wired in tests/global-setup.ts. The
 * production build (vite.config.ts) and the desktop build never load this
 * plugin, so prod chunking / the smart-loading manifest are untouched.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const VIRTUAL_ID = 'virtual:ziee-e2e-eager-render'
const RESOLVED_ID = '\0' + VIRTUAL_ID

/**
 * True for the app entry module. Prefers an exact match against an explicit
 * entry absolute path (passed by the build config); falls back to a
 * `src/main.tsx` suffix match. The explicit form avoids over-matching a
 * transitive dependency that happens to ship a `src/main.tsx`.
 *
 * @param {string} id            the module id vite is transforming
 * @param {string} [entryAbs]    absolute path to the real entry (src/main.tsx)
 */
export function isEntryId(id, entryAbs) {
  if (entryAbs) {
    const norm = s => s.replace(/\\/g, '/').replace(/\?.*$/, '')
    return norm(id) === norm(entryAbs)
  }
  return /[\\/]src[\\/]main\.tsx($|\?)/.test(id)
}

/**
 * Resolve the streamdown package's internal dist chunks that are reached ONLY
 * via streamdown's own `import('./…')` (highlighted-body, mermaid, and any
 * FUTURE internal async chunk). DATA-DRIVEN: globs every `dist/*.js` EXCEPT the
 * package entry (`index.js`) and the shared static chunk (`chunk-*.js`, which is
 * already pulled in by the static `import 'streamdown'`) — so a new streamdown
 * internal async chunk is folded in automatically, with no code change. Returns
 * absolute POSIX paths. Throws if streamdown can't be resolved OR its
 * highlighted-body chunk is absent (the layout-changed sanity guard) — a silent
 * empty set would reintroduce the very flake this plugin exists to remove.
 *
 * @param {(spec: string) => string} resolveSpec  resolves a package specifier to
 *   an absolute file path (defaults to ESM `import.meta.resolve`; streamdown's
 *   `exports` map defines only an `import` condition, so CJS `require.resolve`
 *   fails on it — hence ESM resolution).
 */
export function resolveStreamdownInternalChunks(resolveSpec) {
  const indexPath = resolveSpec('streamdown')
  const distDir = path.dirname(indexPath)
  const files = fs.readdirSync(distDir)
  const matched = files.filter(
    f => f.endsWith('.js') && f !== 'index.js' && !/^chunk-/.test(f),
  )
  if (!matched.some(f => f.startsWith('highlighted-body-'))) {
    throw new Error(
      `[eager-render-graph] could not find streamdown's highlighted-body-*.js chunk in ${distDir} ` +
        `(found: ${files.join(', ')}). Streamdown's internal dist layout changed — update the glob.`,
    )
  }
  return matched.map(f => path.join(distDir, f).replace(/\\/g, '/'))
}

/**
 * Build the virtual eager module source. Every import is bound to a namespace
 * and referenced through a `globalThis` sink so tree-shaking cannot drop it
 * (streamdown's internal chunks export side-effect-free symbols, so a bare
 * side-effect import would be eligible for removal).
 *
 * @param {string[]} internalChunkAbsPaths  absolute POSIX paths (highlighted-body / mermaid)
 */
export function buildEagerModuleSource(internalChunkAbsPaths) {
  const internalImports = internalChunkAbsPaths
    .map((p, i) => `import * as __ic${i} from ${JSON.stringify(p)}`)
    .join('\n')
  const internalRefs = internalChunkAbsPaths.map((_, i) => `__ic${i}`).join(', ')
  return (
    `// AUTO-GENERATED (e2e build only) by vite-plugin-eager-render-graph.\n` +
    `// Folds the chat markdown/HTML render graph into the entry static graph so\n` +
    `// it is modulepreloaded at boot and never fetched on-demand at render time.\n` +
    `import * as __streamdown from 'streamdown'\n` +
    `import * as __basePlugins from '@/components/common/streamdownPlugins'\n` +
    `import * as __chatPlugins from '@/modules/chat/core/utils/chatMarkdownPlugins'\n` +
    internalImports +
    (internalImports ? '\n' : '') +
    `// Reference every namespace so nothing is tree-shaken away.\n` +
    `;(globalThis).__ZIEE_E2E_EAGER_RENDER__ = [__streamdown, __basePlugins, __chatPlugins, ${internalRefs}]\n`
  )
}

/**
 * @param {{ resolveSpec?: (spec: string) => string, entry?: string }} [opts]
 *   - `resolveSpec`: override the package resolver (tests inject a fake). Default
 *     uses ESM `import.meta.resolve`, resolving relative to this plugin file.
 *   - `entry`: absolute path to the app entry (`src/main.tsx`). When given, the
 *     eager import is injected ONLY into that exact module (precise); otherwise
 *     a `src/main.tsx` suffix match is used.
 */
export function eagerRenderGraphPlugin(opts = {}) {
  const resolveSpec =
    opts.resolveSpec ?? (spec => fileURLToPath(import.meta.resolve(spec)))
  const entryAbs = opts.entry
  let source = null // built lazily so a resolution error surfaces at build, with context

  return {
    name: 'ziee-e2e-eager-render-graph',
    enforce: 'pre',
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID
    },
    load(id) {
      if (id === RESOLVED_ID) {
        if (source === null) {
          const chunks = resolveStreamdownInternalChunks(resolveSpec)
          source = buildEagerModuleSource(chunks)
        }
        return source
      }
    },
    transform(code, id) {
      // Inject the eager import at the top of the app entry so the whole render
      // graph lands in the entry's static (boot-preloaded) chunk graph.
      if (isEntryId(id, entryAbs)) {
        return { code: `import '${VIRTUAL_ID}'\n` + code, map: null }
      }
    },
  }
}
