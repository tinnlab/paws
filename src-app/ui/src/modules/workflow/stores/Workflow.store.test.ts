/**
 * Workflow.updateWorkflow — the metadata edit path (`PUT /api/workflows/{id}`).
 *
 * The gap it closes: the builder only ever called `Workflow.updateDefinition`
 * (which replaces the bundle), so `Workflow.update` had zero call sites and a
 * user could not rename, re-tag, or DISABLE a workflow they owned. Skills
 * shipped the equivalent store action; workflows did not.
 *
 * `updateDefinition` is stubbed on the mock client so it CAN be called — the
 * assertion that it isn't only means something because the bundle-replacing
 * path is reachable from the same store.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Workflow } from '@/api-client/types'

const apiMock = vi.hoisted(() => ({
  Workflow: {
    list: vi.fn(() => Promise.resolve([])),
    update: vi.fn((a: { id: string }) =>
      Promise.resolve({ id: a.id, name: 'wf', enabled: false } as Workflow),
    ),
    // Replaces the whole bundle. Present, callable — and never expected here.
    updateDefinition: vi.fn(() => Promise.resolve({} as Workflow)),
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

import { useWorkflowStore } from './workflow'

const store = () => useWorkflowStore.getState()

function wf(over: Partial<Workflow> = {}): Workflow {
  return {
    id: 'w-1',
    name: 'weekly-report',
    display_name: 'Weekly report',
    enabled: true,
    scope: 'user',
    tags: ['reporting'],
    ...over,
  } as Workflow
}

beforeEach(() => {
  vi.clearAllMocks()
  bus.clear()
  useWorkflowStore.setState({
    workflows: [wf(), wf({ id: 'w-2', name: 'other' })],
    isInitialized: true,
    loading: false,
    creating: false,
    error: null,
    operationsLoading: {},
  })
})

describe('Workflow.updateWorkflow', () => {
  it('never replaces the definition', async () => {
    await store().updateWorkflow('w-1', { display_name: 'Renamed' })
    expect(apiMock.Workflow.updateDefinition).not.toHaveBeenCalled()
  })

  it('sends the id plus the patch, flattened', async () => {
    await store().updateWorkflow('w-1', { display_name: 'Renamed', enabled: false })
    expect(apiMock.Workflow.update).toHaveBeenCalledWith({
      id: 'w-1',
      display_name: 'Renamed',
      enabled: false,
    })
  })

  it('swaps the returned row in place and leaves siblings alone', async () => {
    const updated = wf({ display_name: 'Renamed', enabled: false })
    apiMock.Workflow.update.mockResolvedValueOnce(updated)

    await store().updateWorkflow('w-1', { display_name: 'Renamed' })

    expect(store().workflows[0]).toEqual(updated)
    expect(store().workflows[1].id).toBe('w-2')
    expect(store().workflows).toHaveLength(2)
    expect(store().operationsLoading['w-1']).toBeUndefined()
  })

  it('clears the per-row in-flight flag and records the error on failure', async () => {
    apiMock.Workflow.update.mockRejectedValueOnce(new Error('update boom'))
    await expect(
      store().updateWorkflow('w-1', { enabled: false }),
    ).rejects.toThrow('update boom')
    // A latched `operationsLoading` entry would leave the row's Save button
    // spinning forever after one failed edit.
    expect(store().operationsLoading['w-1']).toBeUndefined()
    expect(store().error).toBe('update boom')
  })
})
