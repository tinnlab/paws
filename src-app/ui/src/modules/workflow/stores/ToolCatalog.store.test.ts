/**
 * TEST-16 — the tool catalog: its PURE resolution + failure copy, and (since the
 * fix round) the ACTION closure itself.
 *
 * SCOPE NOTE: `ToolCatalogStoreDef` is a `defineLocalStore`, whose only entry
 * point is `.use()` — a React hook — so this file mounts a throwaway probe
 * component with `react-dom/client` + `act` under the jsdom environment this
 * config already provides. That is what makes the fetch-once cache, the
 * invalidate/retry path and the failure classification testable HERE rather than
 * only through the tool-picker E2E.
 */
import { createElement, useState } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Build a data-testid attribute-selector WITHOUT ever writing that literal.
 *
 * The shared cross-repo testid registry generator
 * (sdk/packages/gallery/scripts/gen-testid-registry.mjs) scrapes every
 * static testid attribute literal out of every `.ts` under `src/` — including a unit
 * test's query selectors. Writing them inline minted this file's fixture ids
 * ("wf-builder-tool-arg-field-days", and even the raw "${name}") into
 * @ziee/kit's PRODUCTION testId union. Concatenating keeps the registry honest.
 */
const sel = (id: string) => `[data-testid=${JSON.stringify(id)}]`

const listTools = vi.hoisted(() => vi.fn())
const listAccessible = vi.hoisted(() => vi.fn())

vi.mock('@/api-client', () => ({
  ApiClient: {
    McpServerRuntime: { listTools },
    McpServer: { listAccessible },
  },
}))
vi.mock('@/core/permissions', () => ({ hasPermissionNow: () => true }))
// The accessible-server list is a cross-module lazy store; the step form only
// reads three fields off it, so it is stubbed at the boundary rather than booted.
vi.mock('@/modules/mcp/stores/mcpServer', () => ({
  McpServer: {
    servers: [{ id: 'srv-1', name: 'lit', display_name: 'Lit', enabled: true }],
    isInitialized: true,
    error: null,
  },
}))

import {
  type CatalogEntry,
  type CatalogScope,
  type ToolCatalogStore,
  ToolCatalogStoreDef,
  classifyFetchFailure,
  describeFetchError,
  entryForServerName,
  failureForToolList,
  failureMessage,
  failureTitle,
  isRetryableFailure,
} from './ToolCatalog.store'

const servers = [
  { id: 'srv-1', name: 'literature_search' },
  { id: 'srv-2', name: 'web_search' },
]

const loaded: CatalogEntry = {
  tools: [{ name: 'search', input_schema: {} }],
  loading: false,
  failure: null,
}

describe('entryForServerName', () => {
  it('resolves a step’s server NAME to the id the tools endpoint needs', () => {
    // A tool step stores the server name (run-time resolution is by name), but
    // GET /api/mcp/servers/{id}/tools is keyed by id — this is that hop.
    const { serverId, entry } = entryForServerName('web_search', servers, {
      'srv-2': loaded,
    })
    expect(serverId).toBe('srv-2')
    expect(entry).toBe(loaded)
  })

  it('reports "no server yet" as an ordinary state, not a failure to explain', () => {
    for (const empty of [null, undefined, '']) {
      const { serverId, entry } = entryForServerName(empty, servers, {})
      expect(serverId).toBeNull()
      expect(entry.failure?.kind).toBe('no-server')
      expect(entry.tools).toEqual([])
    }
  })

  it('reports a name no accessible server matches, instead of an empty picker', () => {
    // The silent-degradation trap: returning `tools: []` here would read as
    // "this server offers no tools" when the truth is "we could not find it".
    //
    // CHANGED (round-2 fix, finding 10): the verdict now has to COME from
    // somewhere. `servers` is a paginated slice of a lazily-loaded store, so
    // this assertion used to be reachable with an empty/partial list and told
    // the author their server "isn't one of the servers available to you" when
    // no such thing had been established. The assertion itself is unchanged —
    // it is now made against an authoritative by-name lookup that came back
    // empty, which is the only evidence of absence there is.
    const { serverId, entry, needsLookup } = entryForServerName(
      'ghost_server',
      servers,
      {},
      { lookups: { ghost_server: { status: 'missing' } } },
    )
    expect(serverId).toBeNull()
    expect(needsLookup).toBe(false)
    expect(entry.failure).toEqual({ kind: 'unknown-server', serverName: 'ghost_server' })
  })

  it('never calls a name it has not looked up "not available to you"', () => {
    // The regression this closes: `McpServer.servers` is EMPTY for the first
    // frames after a cold load (lazy store) and is only ever a 10-row page
    // afterwards, so every open of a saved tool step flashed — or, past page 1,
    // permanently showed — a warning whose stated reason was false. INV-6 wants
    // a stated reason; a stated FALSE reason is worse than none.
    const stillLoading = entryForServerName('literature_search', [], {}, {
      listReady: false,
    })
    expect(stillLoading.entry.failure).toEqual({
      kind: 'resolving-server',
      serverName: 'literature_search',
    })
    expect(stillLoading.needsLookup).toBe(false) // the shared list may still answer

    // The list has settled and does not contain it — that is when we ask.
    const settled = entryForServerName('literature_search', [], {}, { listReady: true })
    expect(settled.entry.failure?.kind).toBe('resolving-server')
    expect(settled.needsLookup).toBe(true)

    // …and while that lookup is in flight it is still not an accusation.
    const inFlight = entryForServerName('literature_search', [], {}, {
      lookups: { literature_search: { status: 'pending' } },
    })
    expect(inFlight.entry.failure?.kind).toBe('resolving-server')
    expect(inFlight.needsLookup).toBe(false)
  })

  it('resolves a server the loaded PAGE does not contain, via the by-name lookup', () => {
    // Page size is 10; a workflow may point at the 40th server.
    const { serverId, entry, needsLookup } = entryForServerName('page_3_server', [], {}, {
      lookups: { page_3_server: { status: 'found', id: 'srv-40', enabled: true } },
    })
    expect(serverId).toBe('srv-40')
    expect(entry.failure).toBeNull()
    expect(needsLookup).toBe(false)
  })

  it('calls a DISABLED server disabled, not unknown — from either source', () => {
    // Round 1 filtered the candidate list to `enabled` servers, which turned a
    // registered-but-switched-off server into "isn't one of the servers
    // available to you" — a false reason with no way back.
    const fromPage = entryForServerName(
      'literature_search',
      [{ id: 'srv-1', name: 'literature_search', enabled: false }],
      {},
    )
    expect(fromPage.serverId).toBeNull()
    expect(fromPage.entry.failure).toEqual({
      kind: 'disabled-server',
      serverName: 'literature_search',
    })

    const fromLookup = entryForServerName('later_page', [], {}, {
      lookups: { later_page: { status: 'found', id: 'srv-9', enabled: false } },
    })
    expect(fromLookup.entry.failure).toEqual({
      kind: 'disabled-server',
      serverName: 'later_page',
    })
  })

  it('surfaces a FAILED lookup as its own, recoverable state', () => {
    const { entry } = entryForServerName('literature_search', [], {}, {
      lookups: { literature_search: { status: 'failed', detail: 'it timed out' } },
    })
    expect(entry.failure).toEqual({
      kind: 'server-lookup-failed',
      serverName: 'literature_search',
      detail: 'it timed out',
    })
    expect(isRetryableFailure(entry.failure!)).toBe(true)

    const denied = entryForServerName('literature_search', [], {}, {
      lookups: { literature_search: { status: 'no-permission' } },
    })
    expect(denied.entry.failure).toEqual({ kind: 'no-permission' })
  })

  it('returns a not-yet-loaded entry (not a failure) for a known but unfetched server', () => {
    const { serverId, entry } = entryForServerName('literature_search', servers, {})
    expect(serverId).toBe('srv-1')
    expect(entry.failure).toBeNull()
    expect(entry.loading).toBe(false)
    expect(entry.tools).toEqual([])
  })
})

describe('failureMessage', () => {
  it('gives every failure a reason a person can act on', () => {
    const cases = [
      { kind: 'no-server' } as const,
      { kind: 'unknown-server', serverName: 'ghost' } as const,
      { kind: 'no-permission' } as const,
      { kind: 'unreachable', serverName: 'lit', detail: 'timed out' } as const,
      { kind: 'no-tools', serverName: 'lit' } as const,
    ]
    for (const failure of cases) {
      const msg = failureMessage(failure)
      expect(msg.length).toBeGreaterThan(20)
      // Never a bare error dump: the author is told what to DO.
      expect(msg).toMatch(/pick|enter|permission/i)
    }
  })

  it('names the server and the reason when it cannot be reached', () => {
    const msg = failureMessage({
      kind: 'unreachable',
      serverName: 'literature_search',
      detail: 'connection refused',
    })
    expect(msg).toContain('literature_search')
    expect(msg).toContain('connection refused')
    expect(msg).toMatch(/by hand/i)
  })

  it('says a server that answered with NOTHING has no tools, not that it is unavailable', () => {
    // A reached-but-empty server used to produce no failure at all: the picker
    // silently became a free-text box with no explanation (INV-6 violation).
    const failure = { kind: 'no-tools', serverName: 'quiet_srv' } as const
    expect(failureTitle(failure)).toBe('This server offers no tools')
    expect(failureTitle({ kind: 'unreachable', serverName: 'x', detail: 'y' })).toBe(
      'Tool list unavailable',
    )
    expect(failureMessage(failure)).toContain('quiet_srv')
    expect(failureMessage(failure)).toMatch(/no tools/i)
  })

  it('offers "try again" only where asking again could change the answer', () => {
    expect(isRetryableFailure({ kind: 'unreachable', serverName: 'a', detail: 'b' })).toBe(true)
    expect(isRetryableFailure({ kind: 'no-tools', serverName: 'a' })).toBe(true)
    expect(isRetryableFailure({ kind: 'no-permission' })).toBe(false)
    expect(isRetryableFailure({ kind: 'no-server' })).toBe(false)
    // CHANGED (round-2 fix, finding 2): `unknown-server` was `false`, so the
    // verdict — reached, before this round, without ever asking anyone — stood
    // for the entire editing session with no way out. It is now a verdict WE
    // obtained, and one an admin can change under us, so it gets the button.
    expect(isRetryableFailure({ kind: 'unknown-server', serverName: 'a' })).toBe(true)
    expect(
      isRetryableFailure({ kind: 'server-lookup-failed', serverName: 'a', detail: 'b' }),
    ).toBe(true)
    // Transient states are not failures to retry — they are already in motion.
    expect(isRetryableFailure({ kind: 'resolving-server', serverName: 'a' })).toBe(false)
    expect(isRetryableFailure({ kind: 'disabled-server', serverName: 'a' })).toBe(false)
  })

  it('gives the three new states a true, actionable reason', () => {
    const resolving = failureMessage({ kind: 'resolving-server', serverName: 'lit' })
    expect(resolving).toContain('lit')
    expect(resolving).toMatch(/looking up/i)
    // Crucially it does NOT claim the server is unavailable.
    expect(resolving).not.toMatch(/isn't one of the servers/i)

    const disabled = failureMessage({ kind: 'disabled-server', serverName: 'lit' })
    expect(failureTitle({ kind: 'disabled-server', serverName: 'lit' })).toMatch(/turned off/i)
    expect(disabled).toMatch(/disabled/i)
    expect(disabled).toMatch(/enable it/i)
    expect(disabled).not.toMatch(/isn't one of the servers/i)

    const failed = failureMessage({
      kind: 'server-lookup-failed',
      serverName: 'lit',
      detail: 'it timed out',
    })
    expect(failed).toContain('it timed out')
    expect(failed).toMatch(/try again/i)
  })
})

describe('describeFetchError', () => {
  it('never leaks the api-client’s machine string or an unbounded body', () => {
    // `core.ts` builds `HTTP error! status: 502 - <the whole error page>` and
    // that used to be interpolated verbatim into an author-facing Alert.
    const err = Object.assign(
      new Error(`HTTP error! status: 502 - <html><body>${'x'.repeat(5000)}</body></html>`),
      { status: 502 },
    )
    const detail = describeFetchError(err)
    expect(detail).not.toContain('HTTP error!')
    expect(detail).not.toContain('<html>')
    expect(detail.length).toBeLessThanOrEqual(120)
    expect(detail).toBe('it reported an internal error')
  })

  it('maps the statuses an author can act on to a sentence', () => {
    const at = (status: number) =>
      describeFetchError(Object.assign(new Error('x'), { status }))
    expect(at(401)).toMatch(/signed in/)
    expect(at(404)).toMatch(/no longer registered/)
    expect(at(504)).toMatch(/timed out/)
    expect(at(429)).toMatch(/rate-limiting/)
    expect(at(400)).toMatch(/rejected/)
  })

  it('clips a long status-less message and strips markup', () => {
    const long = describeFetchError(new Error(`<b>boom</b> ${'y'.repeat(500)}`))
    expect(long.length).toBeLessThanOrEqual(120)
    expect(long).not.toContain('<b>')
    expect(describeFetchError(new Error('Failed to fetch'))).toBe('Failed to fetch')
    expect(describeFetchError(undefined)).toBe('it did not respond')
  })
})

describe('classifyFetchFailure', () => {
  it('calls a 403 a PERMISSION problem, not an unreachable server', () => {
    // USER_NO_ACCESS: the caller has `mcp_servers::read` but not access to this
    // server. It used to render as `Couldn't reach "X" (You do not have access
    // to this server)`, which points the author at the wrong thing entirely.
    const forbidden = Object.assign(new Error('You do not have access to this server'), {
      status: 403,
      error_code: 'USER_NO_ACCESS',
    })
    expect(classifyFetchFailure(forbidden, 'lit')).toEqual({ kind: 'no-permission' })
    expect(failureMessage(classifyFetchFailure(forbidden, 'lit'))).not.toMatch(/reach/i)
  })

  it('still reports a genuine transport failure as unreachable, naming the server', () => {
    const failure = classifyFetchFailure(new Error('Failed to fetch'), 'lit')
    expect(failure).toEqual({
      kind: 'unreachable',
      serverName: 'lit',
      detail: 'Failed to fetch',
    })
  })
})

describe('failureForToolList', () => {
  it('flags an empty answer and stays quiet on a real one', () => {
    expect(failureForToolList([], 'lit')).toEqual({ kind: 'no-tools', serverName: 'lit' })
    expect(failureForToolList([{ name: 't', input_schema: {} }], 'lit')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// The action closure, mounted for real
// ---------------------------------------------------------------------------

interface Mounted {
  store: ToolCatalogStore
  unmount: () => void
}

/** Mount a throwaway component so `defineLocalStore.use()` can run its hooks. */
function mountCatalog(): Mounted {
  let captured: ToolCatalogStore | null = null
  function Probe() {
    captured = ToolCatalogStoreDef.use()
    return null
  }
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(createElement(Probe))
  })
  if (!captured) throw new Error('probe did not render')
  return {
    store: captured,
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

/** State read through the hook-free `$` snapshot. */
const entryOf = (m: Mounted, id: string): CatalogEntry | undefined =>
  m.store.$.byServerId[id]

const lookupOf = (m: Mounted, name: string) => m.store.$.serverByName[name]

describe('the catalog store’s fetch behaviour', () => {
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    listTools.mockReset()
    listAccessible.mockReset()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('turns an EMPTY tool list into a stated reason, not a silent free-text box', async () => {
    listTools.mockResolvedValue({ tools: [] })
    const m = mountCatalog()
    const scope: CatalogScope = {}
    await act(async () => {
      await m.store.load('srv-1', 'quiet_srv', scope)
    })
    expect(entryOf(m, 'srv-1')?.failure).toEqual({
      kind: 'no-tools',
      serverName: 'quiet_srv',
    })
    m.unmount()
  })

  it('records a 403 as a permission failure', async () => {
    listTools.mockRejectedValue(
      Object.assign(new Error('You do not have access to this server'), { status: 403 }),
    )
    const m = mountCatalog()
    await act(async () => {
      await m.store.load('srv-1', 'lit', {})
    })
    expect(entryOf(m, 'srv-1')?.failure).toEqual({ kind: 'no-permission' })
    m.unmount()
  })

  it('fetches ONCE per server per builder session, across step-switch remounts', async () => {
    // `StepConfigPanel` keys each step form by step id, so switching steps
    // unmounts the form and `defineLocalStore.use()` builds a brand-new store.
    // A store-local cache is therefore thrown away on every click, and the
    // documented "once per builder mount" contract was simply false — every step
    // selection re-hit GET /tools (re-handshaking a stdio server).
    listTools.mockResolvedValue({ tools: [{ name: 'search', input_schema: {} }] })
    const session: CatalogScope = {}

    const first = mountCatalog()
    await act(async () => {
      await first.store.load('srv-1', 'lit', session)
    })
    expect(listTools).toHaveBeenCalledTimes(1)
    first.unmount()

    // …the author clicks another step and back: a NEW store instance, same
    // editing session.
    const second = mountCatalog()
    await act(async () => {
      await second.store.load('srv-1', 'lit', session)
    })
    expect(listTools).toHaveBeenCalledTimes(1)
    expect(entryOf(second, 'srv-1')?.tools).toEqual([
      { name: 'search', input_schema: {} },
    ])
    second.unmount()

    // A DIFFERENT editing session must NOT inherit the list — a server's tools
    // can change between sessions (DEC-8).
    const other = mountCatalog()
    await act(async () => {
      await other.store.load('srv-1', 'lit', {})
    })
    expect(listTools).toHaveBeenCalledTimes(2)
    other.unmount()
  })

  it('does not re-probe a server that already failed, until "try again"', async () => {
    listTools.mockRejectedValue(new Error('Failed to fetch'))
    const session: CatalogScope = {}
    const m = mountCatalog()
    await act(async () => {
      await m.store.load('srv-1', 'lit', session)
    })
    await act(async () => {
      await m.store.load('srv-1', 'lit', session)
    })
    expect(listTools).toHaveBeenCalledTimes(1)

    listTools.mockResolvedValue({ tools: [{ name: 'search', input_schema: {} }] })
    act(() => {
      m.store.invalidate('srv-1', session)
    })
    await act(async () => {
      await m.store.load('srv-1', 'lit', session)
    })
    expect(listTools).toHaveBeenCalledTimes(2)
    expect(entryOf(m, 'srv-1')?.failure).toBeNull()
    m.unmount()
  })

  it('invalidating MID-FETCH lets the retry through and discards the stale answer', async () => {
    // `invalidate` used to clear only the state map: the id stayed registered in
    // the in-flight guard (so the retry returned early and never fetched) AND
    // the abandoned response still wrote itself over the retry.
    let resolveStale: (v: unknown) => void = () => {}
    listTools.mockImplementationOnce(
      () => new Promise(resolve => {
        resolveStale = resolve
      }),
    )
    const session: CatalogScope = {}
    const m = mountCatalog()

    act(() => {
      void m.store.load('srv-1', 'lit', session)
    })
    expect(entryOf(m, 'srv-1')?.loading).toBe(true)

    act(() => {
      m.store.invalidate('srv-1', session)
    })
    expect(entryOf(m, 'srv-1')).toBeUndefined()

    listTools.mockResolvedValue({ tools: [{ name: 'fresh', input_schema: {} }] })
    await act(async () => {
      await m.store.load('srv-1', 'lit', session)
    })
    expect(listTools).toHaveBeenCalledTimes(2)
    expect(entryOf(m, 'srv-1')?.tools.map(t => t.name)).toEqual(['fresh'])

    // The abandoned first request finally answers — it must be ignored.
    await act(async () => {
      resolveStale({ tools: [{ name: 'stale', input_schema: {} }] })
      await Promise.resolve()
    })
    expect(entryOf(m, 'srv-1')?.tools.map(t => t.name)).toEqual(['fresh'])
    m.unmount()
  })

  it('shares ONE in-flight request across the mounts of a session', async () => {
    // The in-flight guard and the invalidation generation used to be built in
    // the action closure — i.e. per MOUNT — while the cache is per SESSION. So
    // switching steps mid-fetch (each step form is keyed by step id, so it
    // remounts) found an empty guard and an empty cache and fired a SECOND
    // `tools/list`: exactly the stdio re-handshake the cache exists to prevent.
    let release: (v: unknown) => void = () => {}
    listTools.mockImplementation(
      () =>
        new Promise(resolve => {
          release = resolve
        }),
    )
    const session: CatalogScope = {}

    const first = mountCatalog()
    act(() => {
      void first.store.load('srv-1', 'lit', session)
    })
    // …the author clicks another step and back while the request is open.
    const second = mountCatalog()
    let joined!: Promise<void>
    act(() => {
      joined = second.store.load('srv-1', 'lit', session)
    })
    expect(listTools).toHaveBeenCalledTimes(1)

    await act(async () => {
      release({ tools: [{ name: 'search', input_schema: {} }] })
      await joined
    })
    // The late joiner must still END UP with the tools — sharing the request
    // cannot mean rendering an empty picker for the second mount.
    expect(second.store.$.byServerId['srv-1']?.tools.map(t => t.name)).toEqual(['search'])
    expect(listTools).toHaveBeenCalledTimes(1)
    first.unmount()
    second.unmount()
  })
})

// ---------------------------------------------------------------------------
// The authoritative by-name server lookup (findings 2 + 10)
// ---------------------------------------------------------------------------

describe('resolveServer', () => {
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    listTools.mockReset()
    listAccessible.mockReset()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('asks the API about ONE server by name, and requires an EXACT name match', async () => {
    // `search` is a server-side ILIKE over name/display_name/description, so a
    // near-miss must not be mistaken for the server the step points at.
    listAccessible.mockResolvedValue({
      servers: [
        { id: 'srv-9', name: 'literature_search_v2', enabled: true },
        { id: 'srv-8', name: 'literature_search', enabled: true },
      ],
    })
    const m = mountCatalog()
    await act(async () => {
      await m.store.resolveServer('literature_search', {})
    })
    expect(listAccessible).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'literature_search' }),
    )
    expect(lookupOf(m, 'literature_search')).toEqual({
      status: 'found',
      id: 'srv-8',
      enabled: true,
    })
    m.unmount()
  })

  it('reports a genuine absence as missing and a DISABLED server as disabled', async () => {
    listAccessible.mockResolvedValue({ servers: [] })
    const m = mountCatalog()
    await act(async () => {
      await m.store.resolveServer('ghost', {})
    })
    expect(lookupOf(m, 'ghost')).toEqual({ status: 'missing' })

    listAccessible.mockResolvedValue({
      servers: [{ id: 'srv-3', name: 'off', enabled: false }],
    })
    await act(async () => {
      await m.store.resolveServer('off', {})
    })
    expect(lookupOf(m, 'off')).toEqual({ status: 'found', id: 'srv-3', enabled: false })
    m.unmount()
  })

  it('makes a failed lookup RECOVERABLE instead of a permanent false verdict', async () => {
    // Before: a lookup that never happened produced `unknown-server`, which
    // `isRetryableFailure` excluded — so the author was told their server did
    // not exist, for the whole session, with no button to disagree.
    listAccessible.mockRejectedValue(Object.assign(new Error('x'), { status: 504 }))
    const session: CatalogScope = {}
    const m = mountCatalog()
    await act(async () => {
      await m.store.resolveServer('lit', session)
    })
    expect(lookupOf(m, 'lit')).toEqual({ status: 'failed', detail: 'it timed out' })

    // A terminal verdict is not re-asked…
    await act(async () => {
      await m.store.resolveServer('lit', session)
    })
    expect(listAccessible).toHaveBeenCalledTimes(1)

    // …until "Try again".
    listAccessible.mockResolvedValue({
      servers: [{ id: 'srv-1', name: 'lit', enabled: true }],
    })
    act(() => {
      m.store.invalidateServer('lit', session)
    })
    expect(lookupOf(m, 'lit')).toBeUndefined()
    await act(async () => {
      await m.store.resolveServer('lit', session)
    })
    expect(listAccessible).toHaveBeenCalledTimes(2)
    expect(lookupOf(m, 'lit')).toEqual({ status: 'found', id: 'srv-1', enabled: true })
    m.unmount()
  })

  it('looks a name up ONCE per session, across mounts and concurrently', async () => {
    let release: (v: unknown) => void = () => {}
    listAccessible.mockImplementation(
      () =>
        new Promise(resolve => {
          release = resolve
        }),
    )
    const session: CatalogScope = {}
    const first = mountCatalog()
    const second = mountCatalog()
    let a!: Promise<void>
    let b!: Promise<void>
    act(() => {
      a = first.store.resolveServer('lit', session)
      b = second.store.resolveServer('lit', session)
    })
    expect(listAccessible).toHaveBeenCalledTimes(1)
    await act(async () => {
      release({ servers: [{ id: 'srv-1', name: 'lit', enabled: true }] })
      await Promise.all([a, b])
    })
    expect(lookupOf(second, 'lit')).toEqual({ status: 'found', id: 'srv-1', enabled: true })
    first.unmount()
    second.unmount()

    // A later mount in the same session reads the cached verdict, no request.
    const third = mountCatalog()
    await act(async () => {
      await third.store.resolveServer('lit', session)
    })
    expect(listAccessible).toHaveBeenCalledTimes(1)
    third.unmount()
  })
})

// ---------------------------------------------------------------------------
// The generated arguments form, mounted for real
//
// SCOPE NOTE: these are COMPONENT probes, not store tests, and they live here
// because this is the workspace's only Vitest/jsdom project (`vitest.config.ts`
// collects `src/**/*.store.test.ts`; everything else runs under `node:test`,
// which cannot render React). They cover the interactive machinery the round-2
// audit found untested — the sticky template latch, its reversal, and the
// deferred number clear — each of which had shipped a defect that no pure test
// could have seen.
// ---------------------------------------------------------------------------

import { ToolArgumentsForm } from '../components/builder/ToolArgumentsForm'
import {
  type ToolFormSpec,
  describeToolSchema,
} from '../components/builder/toolSchemaForm'
import type { WorkflowBuilderStore } from './WorkflowBuilder.store'

/** RefInsertMenu only reads `def`; nothing else of the builder store is touched. */
const fakeBuilderStore = {
  def: { inputs: [{ name: 'horizon_days', type: 'number' }], steps: [] },
} as unknown as WorkflowBuilderStore

interface HarnessProps {
  spec: ToolFormSpec
  toolKey: string
  values: Record<string, unknown>
  onCommit: (name: string, value: unknown) => void
}

/**
 * Owns the values the way `ToolStepForm.commitField` does (an empty/undefined
 * commit REMOVES the key), so the form is driven through the same round trip
 * the page gives it.
 */
function ArgsHarness({ spec, toolKey, values, onCommit }: HarnessProps) {
  // Re-seeded when the TOOL changes, exactly as `ToolStepForm` re-derives
  // `known` from `step.arguments` after `patch({ tool, arguments: {} })`. The
  // form itself is NOT remounted — the page keys the step form by STEP id, so
  // switching tools within one step keeps this component alive. That is the
  // whole point: the per-field state has to survive or reset on its own.
  const [state, setState] = useState({ toolKey, values })
  if (state.toolKey !== toolKey) setState({ toolKey, values })
  return createElement(ToolArgumentsForm, {
    store: fakeBuilderStore,
    stepId: 'step_1',
    spec,
    toolKey,
    values: state.values,
    onChange: (name: string, value: unknown) => {
      onCommit(name, value)
      setState(prev => {
        const next = { ...prev.values }
        if (value === undefined || value === '') delete next[name]
        else next[name] = value
        return { toolKey: prev.toolKey, values: next }
      })
    },
  })
}

interface Harness {
  container: HTMLElement
  render: (props: HarnessProps) => void
  unmount: () => void
}

function mountArgs(props: HarnessProps): Harness {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const render = (next: HarnessProps) => {
    act(() => {
      root.render(createElement(ArgsHarness, next))
    })
  }
  render(props)
  return {
    container,
    render,
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

const fieldEl = (h: Harness, name: string) =>
  h.container.querySelector<HTMLInputElement>(
    sel(`wf-builder-tool-arg-field-${name}`),
  )

/** Type into a React-controlled input the way a person does. */
function typeInto(el: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setter.call(el, text)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function blur(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
  })
}

const TEMPLATE_NOTE = /Using a reference/

const specFor = (schema: unknown): ToolFormSpec => {
  const spec = describeToolSchema(schema)
  if (!spec) throw new Error('fixture schema produced no fields')
  return spec
}

describe('the generated arguments form', () => {
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })

  const daysOnly = () =>
    specFor({ type: 'object', properties: { days: { type: 'integer' } } })

  it('renders a LOADED reference as template text, and marks it as one', () => {
    const h = mountArgs({
      spec: daysOnly(),
      toolKey: 'forecast',
      values: { days: '{{ inputs.horizon_days }}' },
      onCommit: () => {},
    })
    const el = fieldEl(h, 'days')!
    expect(el.value).toBe('{{ inputs.horizon_days }}')
    expect(el.getAttribute('inputmode')).not.toBe('decimal')
    expect(h.container.textContent).toMatch(TEMPLATE_NOTE)
    h.unmount()
  })

  it('does not carry the template latch over to a DIFFERENT tool’s same-named argument', () => {
    // The round-1 regression: `GeneratedField` was keyed by property name only
    // and the latch was only ever set, never cleared. Choosing another tool
    // that also declares `days` wiped `arguments` but reused the field
    // instance, so an INTEGER argument rendered as a free-text box captioned
    // "Using a reference" over an empty value — and typing `5` there committed
    // the STRING "5".
    const commits: [string, unknown][] = []
    const h = mountArgs({
      spec: daysOnly(),
      toolKey: 'forecast',
      values: { days: '{{ inputs.horizon_days }}' },
      onCommit: (n, v) => commits.push([n, v]),
    })
    expect(h.container.textContent).toMatch(TEMPLATE_NOTE)

    // The author picks a different tool that also declares `days`; the step's
    // arguments are cleared (`patch({ tool, arguments: {} })`).
    h.render({
      spec: daysOnly(),
      toolKey: 'weather_lookup',
      values: {},
      onCommit: (n, v) => commits.push([n, v]),
    })

    const el = fieldEl(h, 'days')!
    expect(h.container.textContent).not.toMatch(TEMPLATE_NOTE)
    expect(el.getAttribute('inputmode')).toBe('decimal')

    typeInto(el, '5')
    const last = commits[commits.length - 1]
    expect(last).toEqual(['days', 5])
    expect(typeof last[1]).toBe('number')
    h.unmount()
  })

  it('drops the latch when the value is emptied from outside the field', () => {
    // Same cause, without a tool change: a sync refetch (or any external clear)
    // used to leave the field stuck in free text over an empty typed property.
    const h = mountArgs({
      spec: daysOnly(),
      toolKey: 'forecast',
      values: { days: '{{ inputs.horizon_days }}' },
      onCommit: () => {},
    })
    expect(h.container.textContent).toMatch(TEMPLATE_NOTE)

    // NOTE: same `toolKey`, so the field instance is NOT remounted.
    act(() => {
      h.container
        .querySelector<HTMLInputElement>(sel('wf-builder-tool-arg-field-days'))
        ?.focus()
    })
    const el = fieldEl(h, 'days')!
    typeInto(el, '')

    expect(h.container.textContent).not.toMatch(TEMPLATE_NOTE)
    expect(fieldEl(h, 'days')!.getAttribute('inputmode')).toBe('decimal')
    h.unmount()
  })

  it('holds template mode through a HALF-EDITED reference', () => {
    // The reason the latch exists: backspacing the closing braces must not flip
    // the control back to a typed one that refuses the half-typed string.
    const h = mountArgs({
      spec: daysOnly(),
      toolKey: 'forecast',
      values: { days: '{{ inputs.horizon_days }}' },
      onCommit: () => {},
    })
    typeInto(fieldEl(h, 'days')!, '{{ inputs.horizon_day')
    expect(h.container.textContent).toMatch(TEMPLATE_NOTE)
    expect(fieldEl(h, 'days')!.value).toBe('{{ inputs.horizon_day')
    h.unmount()
  })

  it('gives a reference a visible, working way BACK to the typed control', () => {
    const commits: [string, unknown][] = []
    const h = mountArgs({
      spec: daysOnly(),
      toolKey: 'forecast',
      values: { days: '{{ inputs.horizon_days }}' },
      onCommit: (n, v) => commits.push([n, v]),
    })
    const undo = h.container.querySelector<HTMLButtonElement>(
      sel('wf-builder-tool-arg-field-days-clear-ref'),
    )
    expect(undo).toBeTruthy()
    act(() => undo!.click())

    expect(commits).toEqual([['days', '']])
    expect(h.container.textContent).not.toMatch(TEMPLATE_NOTE)
    expect(fieldEl(h, 'days')!.getAttribute('inputmode')).toBe('decimal')
    h.unmount()
  })

  it('keeps a good number when a half-typed one is abandoned', () => {
    // The kit's InputNumber reports `undefined` for BOTH "cleared" and "still
    // typing" (`-`, `1e`, `.`), and restores the previous text on blur without
    // saying so — so deferring the delete to blur deleted an argument the
    // control was still showing.
    const commits: unknown[] = []
    const h = mountArgs({
      spec: daysOnly(),
      toolKey: 'forecast',
      values: { days: 7 },
      onCommit: (_n, v) => commits.push(v),
    })
    const el = fieldEl(h, 'days')!
    for (const partial of ['-', '1e', '.']) {
      typeInto(el, partial)
      blur(el)
      expect(commits).not.toContain(undefined)
    }
    h.unmount()
  })

  it('still removes the argument when the number field is genuinely cleared', () => {
    const commits: unknown[] = []
    const h = mountArgs({
      spec: daysOnly(),
      toolKey: 'forecast',
      values: { days: 7 },
      onCommit: (_n, v) => commits.push(v),
    })
    const el = fieldEl(h, 'days')!
    typeInto(el, '')
    blur(el)
    expect(commits).toEqual([undefined])
    h.unmount()
  })

  it('shows a saved choice the schema no longer declares, instead of nothing', () => {
    // The Tool picker got this closure in round 1; the enum arguments did not,
    // so a `select` fell back to its placeholder while `arguments` still
    // carried the value — the step read as unconfigured when it was not.
    const h = mountArgs({
      spec: specFor({
        type: 'object',
        properties: { mode: { type: 'string', enum: ['fast', 'thorough'] } },
      }),
      toolKey: 'search',
      values: { mode: 'hybrid' },
      onCommit: () => {},
    })
    expect(h.container.textContent).toContain('hybrid')
    expect(h.container.textContent).toMatch(/not one of this tool/)
    h.unmount()
  })
})

// ---------------------------------------------------------------------------
// The tool step form's free key/value rows (DEC-6)
// ---------------------------------------------------------------------------

import { ToolStepForm } from '../components/builder/ToolStepForm'

const SCHEMA_TOOL = {
  name: 'search',
  input_schema: {
    type: 'object',
    properties: { query: { type: 'string' } },
  },
}

interface StepHarness {
  container: HTMLElement
  step: () => Record<string, unknown>
  unmount: () => void
}

/** Mount a real `ToolStepForm` over a fake builder store, with the accessible
 *  server list stubbed at module level (see the `vi.mock` at the top). */
function mountToolStep(initial: Record<string, unknown>): StepHarness {
  let latest = initial
  function Probe() {
    const [step, setStep] = useState(initial)
    latest = step
    const store = {
      def: { inputs: [], steps: [step] },
      updateStep: (_id: string, patch: Record<string, unknown>) =>
        setStep(prev => ({ ...prev, ...patch })),
    } as unknown as WorkflowBuilderStore
    return createElement(ToolStepForm, {
      store,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      step: step as any,
    })
  }
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(createElement(Probe))
  })
  return {
    container,
    step: () => latest,
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

describe('the tool step’s additional-arguments rows', () => {
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    listTools.mockReset()
    listAccessible.mockReset()
    listTools.mockResolvedValue({ tools: [SCHEMA_TOOL] })
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not yank a row out from under the caret when its key becomes a declared name', async () => {
    // Typing `q`,`u`,`e`,`r`,`y` into a free row's key made the row VANISH on
    // the final keystroke: the commit moved the key into the schema-generated
    // half, and the row buffer's resync compared our own push (the whole row
    // object) against what it reads back (only the UNDECLARED half), so the
    // commit looked like somebody else's edit.
    const h = mountToolStep({
      id: 'step_1',
      kind: 'tool',
      server: 'lit',
      tool: 'search',
      arguments: { quer: 'ziee' },
    })
    await act(async () => {
      await Promise.resolve()
    })

    const keyInput = h.container.querySelector<HTMLInputElement>(
      sel('wf-builder-tool-arg-key-0'),
    )
    expect(keyInput).toBeTruthy()
    typeInto(keyInput!, 'query')

    // The row is STILL THERE, still holding what the author typed.
    const after = h.container.querySelector<HTMLInputElement>(
      sel('wf-builder-tool-arg-key-0'),
    )
    expect(after).toBeTruthy()
    expect(after!.value).toBe('query')
    expect(h.step().arguments).toEqual({ query: 'ziee' })

    // And while both editors exist, the TYPED one wins for its own name —
    // otherwise the row's stale copy silently overwrote what was typed.
    const typed = h.container.querySelector<HTMLInputElement>(
      sel('wf-builder-tool-arg-field-query'),
    )!
    typeInto(typed, 'ziee builder')
    expect(h.step().arguments).toEqual({ query: 'ziee builder' })

    // Leaving the row absorbs it into the typed field — one editor per key,
    // and the value is kept.
    blur(after!)
    expect(
      h.container.querySelector(sel('wf-builder-tool-arg-key-0')),
    ).toBeNull()
    expect(h.step().arguments).toEqual({ query: 'ziee builder' })
    expect(
      h.container.querySelector<HTMLInputElement>(
        sel('wf-builder-tool-arg-field-query'),
      )!.value,
    ).toBe('ziee builder')
    h.unmount()
  })
})
