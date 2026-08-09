/**
 * COMPONENT HARNESS for the Document-RAG admin page's load → loaded → save-error
 * transition (the `seeded-file-rag-error` gallery surface).
 *
 * Reproduces, in a mounted React tree, the crash the gallery runtime pass
 * reports on that surface:
 *
 *     Rendered more hooks than during the previous render
 *
 * In this codebase a reactive store-proxy field read IS a hook (path 4 of
 * `createStoreProxy` calls `useEffect` + `useStore(useShallow(...))`), so a
 * component's hook COUNT equals the number of distinct proxy fields it reads on
 * that render. Any read reached only on some renders is a conditional hook with
 * no literal `use*` call to lint.
 *
 * Runner: Vitest + jsdom (`npm run test:component`). `npm run test:unit` is
 * `node --test "src/**\/*.test.ts"`, which cannot load `.tsx` at all — so this
 * spec MUST keep the `.tsx` extension or it runs NOTHING and reads like a pass.
 *
 *   npx vitest run src/modules/file-rag/pages/FileRagAdminPage.test.tsx
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

// React 19 wants this set before `act` is used outside a framework adapter.
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true

if (!('ResizeObserver' in globalThis)) {
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {
      return undefined
    }
    unobserve() {
      return undefined
    }
    disconnect() {
      return undefined
    }
  }
}
if (!globalThis.matchMedia) {
  globalThis.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof globalThis.matchMedia
}

const SETTINGS = {
  chunk_chars: 1200,
  chunk_overlap_chars: 150,
  cosine_threshold: 0.6,
  default_top_k: 8,
  embedding_dimensions: 768,
  embedding_model_id: undefined,
  enabled: true,
  fts_candidate_multiplier: 4,
  fts_dictionary: 'simple',
  fts_enabled: true,
  fts_min_rank: 0.01,
  fts_rrf_k: 60,
  id: 1,
  kb_max_documents: 2000,
  max_chunks_per_file: 5000,
  rerank_candidate_k: 40,
  rerank_enabled: false,
  reranker_model_id: undefined,
  search_max_hit_chars: 4000,
  search_max_top_k: 50,
  search_snippet_chars: 400,
  semantic_enabled: false,
  updated_at: new Date().toISOString(),
}

// The page's own network surface, stubbed at the module boundary so the REAL
// store, the REAL proxy and the REAL components all run.
vi.mock('@/api-client', () => ({
  ApiClient: {
    FileRagAdmin: {
      get: async () => SETTINGS,
      update: async () => SETTINGS,
      backfill: async () => ({}),
      reembed: async () => ({}),
    },
  },
  getAuthToken: () => null,
}))
vi.mock('@/core/llmModelCatalog', () => ({
  loadLlmModelCatalog: async () => [],
  filterByCapability: () => [],
}))

/** Collects React's console.error output (that's where the invariant lands). */
const consoleErrors: string[] = []
let restoreConsole: (() => void) | null = null

function captureConsole() {
  const orig = console.error
  console.error = (...args: unknown[]) => {
    consoleErrors.push(args.map(a => (a instanceof Error ? a.message : String(a))).join(' '))
  }
  restoreConsole = () => {
    console.error = orig
  }
}

interface BoundaryState {
  caught: Error | null
}
class Boundary extends React.Component<
  { children: React.ReactNode; onError: (e: Error) => void },
  BoundaryState
> {
  state: BoundaryState = { caught: null }
  static getDerivedStateFromError(error: Error): BoundaryState {
    return { caught: error }
  }
  componentDidCatch(error: Error) {
    this.props.onError(error)
  }
  render() {
    if (this.state.caught) {
      return <div data-testid="boundary-crash">{this.state.caught.message}</div>
    }
    return this.props.children as React.ReactElement
  }
}

let root: Root | null = null
let host: HTMLElement | null = null

beforeEach(() => {
  consoleErrors.length = 0
  captureConsole()
})

afterEach(async () => {
  if (root) {
    const r = root
    await act(async () => {
      r.unmount()
    })
    root = null
  }
  host?.remove()
  host = null
  restoreConsole?.()
  restoreConsole = null
})

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await new Promise(r => setTimeout(r, 0))
    await new Promise(r => setTimeout(r, 0))
  })
}

const HOOK_INVARIANT =
  /Rendered more hooks|Rendered fewer hooks|change in the order of Hooks|Should have a queue|Invalid hook call/i

function hookErrors(): string[] {
  return consoleErrors.filter(m => HOOK_INVARIANT.test(m))
}

async function setupHarness() {
  // Register a real Auth-shaped store proxy for the permission primitives.
  const { defineStore, registerLazyStore } = await import('@ziee/framework/store-kit')
  const { setAuthView } = await import('@ziee/framework/permissions')
  const AuthDef = defineStore<
    { user: { id: string; is_admin: boolean } | null; permissions: string[] },
    Record<string, never>
  >('TestAuth', {
    state: { user: null, permissions: [] },
    actions: () => ({}),
  })
  const AuthStore = AuthDef.store
  setAuthView(registerLazyStore(AuthDef) as never)

  const { FileRagAdminStore } = await import('@/modules/file-rag/stores/fileRagAdmin')
  const { FileRagAdminPage } = await import('./FileRagAdminPage')

  const crashes: Error[] = []
  const onError = (e: Error) => {
    crashes.push(e)
  }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)

  await act(async () => {
    root!.render(
      <Boundary onError={onError}>
        <FileRagAdminPage />
      </Boundary>,
    )
  })
  await flush()
  return { AuthStore, FileRagAdminStore, crashes }
}

describe('FileRagAdminPage — hook-count stability across its state transitions', () => {
  test('unauthorized -> authorized -> settings loaded -> save error (seeded-file-rag-error)', async () => {
    const { AuthStore, FileRagAdminStore, crashes } = await setupHarness()

    // 1. Permission arrives (canRead false -> true): the noperm card is replaced
    //    by the load/status card.
    await act(async () => {
      AuthStore.setState({ user: { id: 'u1', is_admin: true }, permissions: ['*'] } as never)
    })
    await flush()

    // 2. Settings arrive (null -> loaded): status card -> full form.
    await act(async () => {
      FileRagAdminStore.setState({ settings: SETTINGS, loading: false } as never)
    })
    await flush()
    expect(FileRagAdminStore.getState().settings, 'settings should have loaded').not.toBeNull()

    // 3. The gallery seed: flip `error` with settings already loaded.
    await act(async () => {
      FileRagAdminStore.setState({ error: 'Failed to save Document RAG settings.' } as never)
    })
    await flush()

    expect(
      { crashes: crashes.map(c => c.message), hookErrors: hookErrors() },
      'no React hook-order invariant violation',
    ).toEqual({ crashes: [], hookErrors: [] })
    expect(host!.querySelector('[data-testid="boundary-crash"]')).toBeNull()
  })

  test('load failure with no settings, then a late load succeeds', async () => {
    const { AuthStore, FileRagAdminStore, crashes } = await setupHarness()
    await act(async () => {
      AuthStore.setState({ user: { id: 'u1', is_admin: true }, permissions: ['*'] } as never)
    })
    await flush()
    await act(async () => {
      FileRagAdminStore.setState({ error: 'boom', loading: false } as never)
    })
    await flush()
    await act(async () => {
      FileRagAdminStore.setState({ settings: SETTINGS, error: null } as never)
    })
    await flush()
    await act(async () => {
      FileRagAdminStore.setState({
        embeddingModels: [
          { id: 'm1', name: 'nomic', display_name: 'Nomic', provider_id: 'p', capabilities: {} },
        ],
        rerankerModels: [
          { id: 'r1', name: 'bge', display_name: 'BGE', provider_id: 'p', capabilities: {} },
        ],
      } as never)
    })
    await flush()

    expect(
      { crashes: crashes.map(c => c.message), hookErrors: hookErrors() },
      'no React hook-order invariant violation',
    ).toEqual({ crashes: [], hookErrors: [] })
  })

  test('permission is revoked while settings are loaded (manage -> read-only -> none)', async () => {
    const { AuthStore, FileRagAdminStore, crashes } = await setupHarness()
    await act(async () => {
      AuthStore.setState({ user: { id: 'u1', is_admin: true }, permissions: ['*'] } as never)
    })
    await flush()
    await act(async () => {
      FileRagAdminStore.setState({ settings: SETTINGS } as never)
    })
    await flush()
    // read-only (read perm only), then nothing at all
    await act(async () => {
      AuthStore.setState({
        user: { id: 'u1', is_admin: false },
        permissions: ['file_rag_admin::read'],
      } as never)
    })
    await flush()
    await act(async () => {
      AuthStore.setState({ user: { id: 'u1', is_admin: false }, permissions: [] } as never)
    })
    await flush()

    expect(
      { crashes: crashes.map(c => c.message), hookErrors: hookErrors() },
      'no React hook-order invariant violation',
    ).toEqual({ crashes: [], hookErrors: [] })
  })
})
