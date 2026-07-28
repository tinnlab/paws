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
import { createElement } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const listTools = vi.hoisted(() => vi.fn())

vi.mock('@/api-client', () => ({
  ApiClient: { McpServerRuntime: { listTools } },
}))
vi.mock('@/core/permissions', () => ({ hasPermissionNow: () => true }))

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
    const { serverId, entry } = entryForServerName('ghost_server', servers, {})
    expect(serverId).toBeNull()
    expect(entry.failure).toEqual({ kind: 'unknown-server', serverName: 'ghost_server' })
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
    expect(isRetryableFailure({ kind: 'unknown-server', serverName: 'a' })).toBe(false)
    expect(isRetryableFailure({ kind: 'no-server' })).toBe(false)
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

describe('the catalog store’s fetch behaviour', () => {
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    listTools.mockReset()
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
})
