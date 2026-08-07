/**
 * Citations — the project reference-list membership actions + the CSL style cache.
 *
 * The gap these close: `POST /api/projects/{}/citations` and
 * `DELETE /api/projects/{}/citations/{}` had ZERO frontend call sites, so a
 * project's bibliography was writable only by the agent through the citations
 * MCP tools. `GET /api/citations/styles` was likewise unused while the export
 * dialog advertised a "Formatted (CSL style)" format and never sent a style.
 *
 * `Citations.delete` is stubbed on the mock client precisely so it CAN be
 * called: the detach assertions only mean something because the destructive
 * library-wide path is reachable and simply must not be taken. That is the same
 * defect shape the sibling project-FILES panel actually shipped.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => ({
  Citations: {
    list: vi.fn(() => Promise.resolve({ entries: [] })),
    listStyles: vi.fn(() => Promise.resolve({ styles: ['apa', 'nature'] })),
    attachToProject: vi.fn(
      (_a: { project_id: string; entry_ids: string[] }) =>
        Promise.resolve({ ok: true, count: _a.entry_ids.length }),
    ),
    detachFromProject: vi.fn((_a: { project_id: string; entry_id: string }) =>
      Promise.resolve({ ok: true }),
    ),
    // The destructive endpoint. Present, callable — and never expected.
    delete: vi.fn((_a: { id: string }) => Promise.resolve({ ok: true })),
  },
}))

const bus = vi.hoisted(() => {
  const map = new Map<string, Set<(p?: unknown) => void>>()
  return {
    on: (event: string, handler: (p?: unknown) => void) => {
      let s = map.get(event)
      if (!s) {
        s = new Set()
        map.set(event, s)
      }
      s.add(handler)
      return () => s?.delete(handler)
    },
    removeGroupListeners: () => {
      /* noop */
    },
    clear: () => map.clear(),
  }
})

vi.mock('@/api-client', () => ({ ApiClient: apiMock }))
vi.mock('@ziee/framework/stores', () => ({
  Stores: {},
  createStoreProxy: () => ({}),
  // store-kit re-exports this from `stores`, so mocking the module without it
  // makes `registerLazyStore` undefined at import time and the whole suite
  // fails to load with zero tests — which reads as a pass in CI output.
  registerLazyStore: () => ({}),
}))
vi.mock('@ziee/framework/events', () => ({
  useEventBusStore: {
    getState: () => ({
      on: bus.on,
      removeGroupListeners: bus.removeGroupListeners,
    }),
  },
}))

import { useCitationsStore } from './citations'

const store = () => useCitationsStore.getState()
const PROJECT = 'p-1'

beforeEach(() => {
  vi.clearAllMocks()
  bus.clear()
  useCitationsStore.setState({
    entries: [],
    loading: false,
    importing: false,
    verifying: false,
    error: null,
    projectId: null,
    styles: [],
    stylesLoading: false,
    attaching: false,
    detaching: false,
  })
})

describe('Citations — detaching from a project is never a library delete', () => {
  // Standalone negative control. The `not.toHaveBeenCalled()` guard inside the
  // behavioural spec below sits AFTER a positive assertion, so on a source that
  // called the wrong endpoint it would never be reached — this one fails.
  it('detachFromProject does not call Citations.delete', async () => {
    await store().detachFromProject(PROJECT, 'e-1')
    expect(apiMock.Citations.delete).not.toHaveBeenCalled()
  })

  it('detachFromProject calls the membership endpoint with both ids', async () => {
    await store().detachFromProject(PROJECT, 'e-1')
    expect(apiMock.Citations.detachFromProject).toHaveBeenCalledWith({
      project_id: PROJECT,
      entry_id: 'e-1',
    })
    expect(store().detaching).toBe(false)
  })

  it('detachFromProject surfaces the error and clears the in-flight flag', async () => {
    apiMock.Citations.detachFromProject.mockRejectedValueOnce(
      new Error('detach boom'),
    )
    await expect(store().detachFromProject(PROJECT, 'e-1')).rejects.toThrow(
      'detach boom',
    )
    expect(store().error).toBe('detach boom')
    expect(store().detaching).toBe(false)
  })
})

describe('Citations.attachToProject', () => {
  it('posts every selected id in ONE request', async () => {
    const n = await store().attachToProject(PROJECT, ['e-1', 'e-2', 'e-3'])
    expect(apiMock.Citations.attachToProject).toHaveBeenCalledTimes(1)
    expect(apiMock.Citations.attachToProject).toHaveBeenCalledWith({
      project_id: PROJECT,
      entry_ids: ['e-1', 'e-2', 'e-3'],
    })
    expect(n).toBe(3)
  })

  it('reports the SERVER count, not the requested count', async () => {
    // Already-linked ids are skipped server-side, so "Added 2" must come from
    // the response — echoing entry_ids.length would over-report every time a
    // user re-picks something the agent already attached.
    apiMock.Citations.attachToProject.mockResolvedValueOnce({
      ok: true,
      count: 1,
    })
    expect(await store().attachToProject(PROJECT, ['e-1', 'e-2'])).toBe(1)
  })

  it('is a no-op on an empty selection (no request at all)', async () => {
    expect(await store().attachToProject(PROJECT, [])).toBe(0)
    expect(apiMock.Citations.attachToProject).not.toHaveBeenCalled()
  })

  it('surfaces the error and clears the in-flight flag', async () => {
    apiMock.Citations.attachToProject.mockRejectedValueOnce(
      new Error('attach boom'),
    )
    await expect(store().attachToProject(PROJECT, ['e-1'])).rejects.toThrow(
      'attach boom',
    )
    expect(store().error).toBe('attach boom')
    expect(store().attaching).toBe(false)
  })
})

describe('Citations.loadStyles', () => {
  it('fetches the bundled style names once and caches them', async () => {
    expect(await store().loadStyles()).toEqual(['apa', 'nature'])
    expect(store().styles).toEqual(['apa', 'nature'])

    await store().loadStyles()
    expect(apiMock.Citations.listStyles).toHaveBeenCalledTimes(1)
  })

  it('degrades to an empty list on failure instead of throwing', async () => {
    // Export must still work with pandoc's built-in default style — a styles
    // fetch that throws would take the whole export dialog down with it.
    apiMock.Citations.listStyles.mockRejectedValueOnce(new Error('nope'))
    expect(await store().loadStyles()).toEqual([])
    expect(store().error).toBe('nope')
    expect(store().stylesLoading).toBe(false)
  })
})
