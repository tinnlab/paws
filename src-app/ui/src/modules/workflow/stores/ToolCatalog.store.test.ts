/**
 * TEST-16 — the tool catalog's PURE resolution + failure copy.
 *
 * SCOPE NOTE (the same sanctioned fallback as `WorkflowBuilder.store.test.ts`,
 * and stated here so the coverage claim is not overread): `ToolCatalogStoreDef`
 * is a `defineLocalStore`, whose only entry point is `.use()` — a React hook.
 * This workspace ships no `@testing-library/react` / `renderHook`, so the
 * ACTION closure (fetch-once caching, the in-flight guard, the permission
 * short-circuit) cannot be instantiated headlessly. Those behaviours are proven
 * by the tool-picker E2E against a real MCP server, NOT here. What IS proven
 * here is the part the store delegates to pure functions: resolving a step's
 * server NAME to the id the tools endpoint needs, and the rule that every
 * failure produces a STATED reason rather than an empty picker (INV-6).
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/api-client', () => ({ ApiClient: {} }))
vi.mock('@/core/permissions', () => ({ hasPermissionNow: () => true }))

import {
  type CatalogEntry,
  entryForServerName,
  failureMessage,
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
})
