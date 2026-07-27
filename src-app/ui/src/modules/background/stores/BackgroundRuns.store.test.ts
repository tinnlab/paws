/**
 * TEST-6..9 — the conversation-KEYED background-runs slice.
 *
 * The defect these pin: `GET /api/background/runs` scopes DISJOINTLY (no
 * `conversation_id` ⇒ conversation-LESS runs only). The store's `sync:workflow_run`
 * handler must therefore refetch each open conversation scope WITH its id — an
 * unscoped refetch returns a different scope entirely and blanks every open panel
 * on the first run state change, i.e. exactly while the user is watching.
 *
 *   - TEST-6  loadConversationRuns sends conversation_id + keys the slice;
 *             a second conversation does not clobber the first (split panes)
 *   - TEST-7  sync:workflow_run / sync:reconnect refetch EVERY tracked scope,
 *             each with its own id, and never issue an unscoped request
 *   - TEST-8  the permission self-gate (no request at all) + a failed refetch
 *             records the error WITHOUT clearing an already-loaded slice
 *   - TEST-9  page > 1 APPENDS (Load-more) rather than replacing
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BackgroundRunSummary } from '@/api-client/types'

const apiMock = vi.hoisted(() => ({
  Background: {
    listRuns: vi.fn(),
    getRun: vi.fn(),
    listRunNotes: vi.fn(() => Promise.resolve([])),
    postRunNote: vi.fn(),
    cancelRun: vi.fn(() => Promise.resolve({ status: 'cancelled', run_id: 'r1' })),
  },
}))

const perm = vi.hoisted(() => ({ allow: true }))

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
    removeGroupListeners: () => {},
    emit: (event: string, payload?: unknown) => map.get(event)?.forEach(fn => fn(payload)),
    clear: () => map.clear(),
  }
})

vi.mock('@/api-client', () => ({ ApiClient: apiMock }))
vi.mock('@/core/permissions', () => ({
  hasPermissionNow: () => perm.allow,
  Permissions: { BackgroundUse: 'background::use' },
}))
vi.mock('@ziee/framework/stores', () => ({
  Stores: { EventBus: { emit: vi.fn(() => Promise.resolve()) } },
  createStoreProxy: () => ({}),
  registerLazyStore: () => ({}),
}))
vi.mock('@ziee/framework/events', () => ({
  useEventBusStore: {
    getState: () => ({ on: bus.on, removeGroupListeners: bus.removeGroupListeners }),
  },
}))

import { useBackgroundRunsStore, PANEL_PAGE_SIZE } from '@/modules/background/stores/BackgroundRuns.store'

const store = () => useBackgroundRunsStore.getState()

const CONV_A = 'aaaaaaaa-0000-0000-0000-000000000001'
const CONV_B = 'bbbbbbbb-0000-0000-0000-000000000002'

function run(id: string, conversationId: string): BackgroundRunSummary {
  return {
    id,
    job_kind: 'subagent',
    status: 'running',
    conversation_id: conversationId,
    has_result: false,
    total_tokens: 0,
    created_at: '2026-07-20T00:00:00Z',
    updated_at: '2026-07-20T00:00:00Z',
  }
}

/** A `Background.listRuns` response for one conversation scope. */
function listResponse(runs: BackgroundRunSummary[], total = runs.length, page = 1) {
  return { runs, total, page, per_page: PANEL_PAGE_SIZE, total_pages: 1 }
}

/** The `conversation_id` of every `listRuns` call made so far, in order. */
function scopesRequested(): (string | undefined)[] {
  return apiMock.Background.listRuns.mock.calls.map(
    ([args]) => (args as { conversation_id?: string }).conversation_id,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  perm.allow = true
  bus.clear()
  useBackgroundRunsStore.setState({
    activeScopes: {},
    runsByConversation: {},
    totalByConversation: {},
    pageByConversation: {},
    loadingByConversation: {},
    errorByConversation: {},
    notesByRun: {},
    detailsByRun: {},
    runDetailLoading: new Set<string>(),
    detailErrorByRun: {},
  })
})

describe('BackgroundRuns — conversation-keyed slice (TEST-6..9)', () => {
  it('TEST-6: scopes the request by conversation and keys the slice per conversation', async () => {
    apiMock.Background.listRuns.mockResolvedValueOnce(
      listResponse([run('a1', CONV_A), run('a2', CONV_A)]),
    )
    await store().loadConversationRuns(CONV_A)

    expect(apiMock.Background.listRuns).toHaveBeenCalledWith({
      page: 1,
      per_page: PANEL_PAGE_SIZE,
      conversation_id: CONV_A,
    })
    expect(store().runsByConversation[CONV_A].map(r => r.id)).toEqual(['a1', 'a2'])
    expect(store().totalByConversation[CONV_A]).toBe(2)

    // A second conversation (the split-pane case) must not clobber the first.
    apiMock.Background.listRuns.mockResolvedValueOnce(listResponse([run('b1', CONV_B)]))
    await store().loadConversationRuns(CONV_B)

    expect(store().runsByConversation[CONV_B].map(r => r.id)).toEqual(['b1'])
    expect(store().runsByConversation[CONV_A].map(r => r.id)).toEqual(['a1', 'a2'])
  })

  it('TEST-7: a sync event refetches EVERY tracked scope with its own id, never unscoped', async () => {
    // Run the store's init so the sync subscriptions are live.
    useBackgroundRunsStore.getState().__init__.__store__()

    // Two mounted consumers (a footer/panel each) — the refresh set is the
    // MOUNT refcount, not the data map.
    store().retainConversationScope(CONV_A)
    store().retainConversationScope(CONV_B)
    apiMock.Background.listRuns.mockResolvedValue(listResponse([run('a1', CONV_A)]))
    await store().loadConversationRuns(CONV_A)
    apiMock.Background.listRuns.mockResolvedValue(listResponse([run('b1', CONV_B)]))
    await store().loadConversationRuns(CONV_B)
    apiMock.Background.listRuns.mockClear()

    bus.emit('sync:workflow_run', { data: { action: 'update', id: 'a1' } })
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    const scopes = scopesRequested()
    expect(scopes).toHaveLength(2)
    expect(scopes).toEqual(expect.arrayContaining([CONV_A, CONV_B]))
    // The regression guard: an unscoped refetch would return the DIFFERENT,
    // conversation-less scope and blank both open panels.
    expect(scopes).not.toContain(undefined)

    apiMock.Background.listRuns.mockClear()
    bus.emit('sync:reconnect')
    await Promise.resolve()
    await Promise.resolve()
    expect(scopesRequested()).toEqual(expect.arrayContaining([CONV_A, CONV_B]))
    expect(scopesRequested()).not.toContain(undefined)
  })

  it('TEST-8: self-gates on the permission and keeps a loaded slice on a failed refetch', async () => {
    // No `background::use` → no request at all (the no-403-on-reconnect rule).
    perm.allow = false
    await store().loadConversationRuns(CONV_A)
    expect(apiMock.Background.listRuns).not.toHaveBeenCalled()
    expect(store().runsByConversation[CONV_A]).toBeUndefined()

    // With the grant, load once...
    perm.allow = true
    apiMock.Background.listRuns.mockResolvedValueOnce(listResponse([run('a1', CONV_A)]))
    await store().loadConversationRuns(CONV_A)
    expect(store().runsByConversation[CONV_A]).toHaveLength(1)

    // ...then fail a refetch: the error is recorded, the good list survives.
    apiMock.Background.listRuns.mockRejectedValueOnce(new Error('network down'))
    await store().loadConversationRuns(CONV_A)
    expect(store().errorByConversation[CONV_A]).toBe('network down')
    expect(store().runsByConversation[CONV_A].map(r => r.id)).toEqual(['a1'])
    expect(store().loadingByConversation[CONV_A]).toBe(false)
  })

  it('TEST-9: page 1 replaces and later pages append (Load more)', async () => {
    apiMock.Background.listRuns.mockResolvedValueOnce(
      listResponse([run('a1', CONV_A), run('a2', CONV_A)], 4, 1),
    )
    await store().loadConversationRuns(CONV_A, 1)
    expect(store().runsByConversation[CONV_A].map(r => r.id)).toEqual(['a1', 'a2'])
    expect(store().totalByConversation[CONV_A]).toBe(4)

    apiMock.Background.listRuns.mockResolvedValueOnce(
      listResponse([run('a3', CONV_A), run('a4', CONV_A)], 4, 2),
    )
    await store().loadMoreConversationRuns(CONV_A)

    expect(apiMock.Background.listRuns).toHaveBeenLastCalledWith({
      page: 2,
      per_page: PANEL_PAGE_SIZE,
      conversation_id: CONV_A,
    })
    // APPENDED, not replaced — a replace would drop page 1 and make Load-more
    // look like it did nothing.
    expect(store().runsByConversation[CONV_A].map(r => r.id)).toEqual([
      'a1',
      'a2',
      'a3',
      'a4',
    ])

    // A fresh page-1 read (what the sync handler issues) replaces again.
    apiMock.Background.listRuns.mockResolvedValueOnce(
      listResponse([run('a1', CONV_A)], 1, 1),
    )
    await store().loadConversationRuns(CONV_A, 1)
    expect(store().runsByConversation[CONV_A].map(r => r.id)).toEqual(['a1'])
  })
})

describe('BackgroundRuns — scope refcount + eviction (TEST-10)', () => {
  it('refreshes ONLY scopes a live consumer is showing, and evicts on release', async () => {
    useBackgroundRunsStore.getState().__init__.__store__()

    // The footer mounts in EVERY conversation the user opens, so loading alone
    // must not enlist a scope in the live refresh — otherwise a long session
    // fires one request per conversation VISITED on every run state change.
    apiMock.Background.listRuns.mockResolvedValue(listResponse([run('a1', CONV_A)]))
    await store().loadConversationRuns(CONV_A)
    apiMock.Background.listRuns.mockClear()

    bus.emit('sync:workflow_run', { data: { action: 'update', id: 'a1' } })
    await Promise.resolve()
    await Promise.resolve()
    expect(apiMock.Background.listRuns).not.toHaveBeenCalled()

    // With a mounted consumer, the same event refreshes it.
    store().retainConversationScope(CONV_A)
    bus.emit('sync:workflow_run', { data: { action: 'update', id: 'a1' } })
    await Promise.resolve()
    await Promise.resolve()
    expect(scopesRequested()).toEqual([CONV_A])

    // Refcounted: two consumers (footer + panel) then one unmount keeps it live.
    store().retainConversationScope(CONV_A)
    store().releaseConversationScope(CONV_A)
    expect(store().activeScopes[CONV_A]).toBe(1)
    expect(store().runsByConversation[CONV_A]).toHaveLength(1)

    // The last release evicts the cached slice, so the maps cannot grow with
    // every conversation the session visited.
    store().releaseConversationScope(CONV_A)
    expect(store().activeScopes[CONV_A]).toBeUndefined()
    expect(store().runsByConversation[CONV_A]).toBeUndefined()
    expect(store().totalByConversation[CONV_A]).toBeUndefined()

    apiMock.Background.listRuns.mockClear()
    bus.emit('sync:workflow_run', { data: { action: 'update', id: 'a1' } })
    await Promise.resolve()
    await Promise.resolve()
    expect(apiMock.Background.listRuns).not.toHaveBeenCalled()
  })

  it('retries a scope whose FIRST load failed on sync:reconnect', async () => {
    useBackgroundRunsStore.getState().__init__.__store__()

    // A first-load failure writes an error but NO data key. Keying the refresh off
    // the data map would therefore never retry it — defeating `sync:reconnect`,
    // the mechanism that exists precisely to recover a dropped stream.
    store().retainConversationScope(CONV_A)
    apiMock.Background.listRuns.mockRejectedValueOnce(new Error('stream dropped'))
    await store().loadConversationRuns(CONV_A)
    expect(store().errorByConversation[CONV_A]).toBe('stream dropped')
    expect(store().runsByConversation[CONV_A]).toBeUndefined()

    apiMock.Background.listRuns.mockClear()
    apiMock.Background.listRuns.mockResolvedValue(listResponse([run('a1', CONV_A)]))
    bus.emit('sync:reconnect')
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(scopesRequested()).toEqual([CONV_A])
    expect(store().runsByConversation[CONV_A]?.map(r => r.id)).toEqual(['a1'])
    expect(store().errorByConversation[CONV_A]).toBeNull()
  })

  it('dedupes concurrent identical loads and de-duplicates appended rows', async () => {
    // The footer and the panel both load page 1 on mount for the same
    // conversation; only one request should go out.
    apiMock.Background.listRuns.mockResolvedValue(listResponse([run('a1', CONV_A)], 3, 1))
    await Promise.all([
      store().loadConversationRuns(CONV_A, 1),
      store().loadConversationRuns(CONV_A, 1),
    ])
    expect(apiMock.Background.listRuns).toHaveBeenCalledTimes(1)

    // OFFSET paging over a non-unique sort can repeat a row; the append must not
    // duplicate it (duplicate React keys + a wrong "Showing N of M").
    apiMock.Background.listRuns.mockClear()
    apiMock.Background.listRuns.mockResolvedValue(
      listResponse([run('a1', CONV_A), run('a2', CONV_A)], 3, 2),
    )
    await store().loadMoreConversationRuns(CONV_A)
    expect(store().runsByConversation[CONV_A]?.map(r => r.id)).toEqual(['a1', 'a2'])
  })
})
