import { ApiClient } from '@/api-client'
import { Permissions } from '@/api-client/permissions'
import type { Tool } from '@/api-client/types'
import { hasPermissionNow } from '@/core/permissions'
import { defineLocalStore } from '@ziee/framework/store-kit'

// ---------------------------------------------------------------------------
// PRIVATE, per-builder catalog of the tools a chosen MCP server actually offers
// (ITEM-6). It backs the tool step's PICKER and the schema-generated arguments
// form, so the author never types a tool name or an argument key from memory.
//
// Local, not global (DEC-8): a builder is an editing session, mirroring
// `WorkflowBuilder.store.ts`. A local store also auto-unsubscribes on unmount,
// and refetching once per builder mount is CORRECT — a server's tool list can
// change between sessions.
//
// Everything the endpoint needs already exists: `GET /api/mcp/servers/{id}/tools`
// (`McpServerRuntime.listTools`), gated on `mcp_servers::read` + per-server
// access. No new endpoint was added for this feature.
// ---------------------------------------------------------------------------

/** Why a server's tools are unavailable — each maps to VISIBLE author-facing
 *  copy (INV-6: the fallback is never silent). */
export type CatalogFailure =
  | { kind: 'no-server' }
  | { kind: 'unknown-server'; serverName: string }
  | { kind: 'no-permission' }
  | { kind: 'unreachable'; serverName: string; detail: string }

export interface CatalogEntry {
  tools: Tool[]
  loading: boolean
  failure: CatalogFailure | null
}

const EMPTY: CatalogEntry = { tools: [], loading: false, failure: null }

export const ToolCatalogStoreDef = defineLocalStore({
  immer: true,
  state: {
    /** Keyed by SERVER ID. A step stores the server NAME, so the caller resolves
     *  name → id first; keying by id means two names for one server share a
     *  fetch and a rename does not orphan the cache. */
    byServerId: {} as Record<string, CatalogEntry>,
    /** Names looked up that no accessible server matched — surfaced as the
     *  `unknown-server` failure rather than an empty picker. */
    unknownNames: [] as string[],
  },

  actions: (set, get) => {
    // In-flight guard: several fields (the picker + the arguments form) read the
    // same server in one render pass, and each would otherwise start a fetch.
    const inflight = new Set<string>()

    const load = async (serverId: string, serverName: string) => {
      if (inflight.has(serverId)) return
      const existing = get().byServerId[serverId]
      // Cache hit: a successful previous fetch is reused for the session.
      if (existing && !existing.loading && existing.failure == null) return

      if (!hasPermissionNow(Permissions.McpServersRead)) {
        set(d => {
          d.byServerId[serverId] = {
            tools: [],
            loading: false,
            failure: { kind: 'no-permission' },
          }
        })
        return
      }

      inflight.add(serverId)
      set(d => {
        d.byServerId[serverId] = { tools: [], loading: true, failure: null }
      })
      try {
        const res = await ApiClient.McpServerRuntime.listTools({ id: serverId })
        set(d => {
          d.byServerId[serverId] = {
            tools: res.tools ?? [],
            loading: false,
            failure: null,
          }
        })
      } catch (error) {
        // An MCP server that cannot be reached is the COMMON case (a stdio
        // server not installed, an http server down). It must produce a stated
        // reason, never an empty tool list that reads as "this server has no
        // tools" — that is the silent-degradation the design forbids.
        set(d => {
          d.byServerId[serverId] = {
            tools: [],
            loading: false,
            failure: {
              kind: 'unreachable',
              serverName,
              detail:
                error instanceof Error ? error.message : 'the server did not respond',
            },
          }
        })
      } finally {
        inflight.delete(serverId)
      }
    }

    return {
      load,

      /** Record a step-referenced server name that no accessible server matches. */
      markUnknown: (serverName: string) => {
        set(d => {
          if (!d.unknownNames.includes(serverName)) d.unknownNames.push(serverName)
        })
      },

      /** Drop a cached entry so the next read refetches (used by "try again"). */
      invalidate: (serverId: string) => {
        set(d => {
          delete d.byServerId[serverId]
        })
      },
    }
  },
})

export type ToolCatalogStore = ReturnType<typeof ToolCatalogStoreDef.use>

/**
 * The catalog entry for a server NAME, given the accessible-server list.
 *
 * Pure so the resolution rule is unit-testable without React. Note the known
 * limitation it inherits: `McpServer.servers` is a PAGINATED slice, so a server
 * beyond the loaded page resolves to `unknown-server` — which surfaces the
 * visible fallback rather than an empty picker. (The same limitation already
 * affects the Server picker itself; fixing pagination there is a separate
 * change in the mcp module.)
 */
export function entryForServerName(
  serverName: string | null | undefined,
  servers: { id: string; name: string }[],
  byServerId: Record<string, CatalogEntry>,
): { entry: CatalogEntry; serverId: string | null } {
  if (!serverName) {
    return { entry: { ...EMPTY, failure: { kind: 'no-server' } }, serverId: null }
  }
  const match = servers.find(s => s.name === serverName)
  if (!match) {
    return {
      entry: { ...EMPTY, failure: { kind: 'unknown-server', serverName } },
      serverId: null,
    }
  }
  return { entry: byServerId[match.id] ?? EMPTY, serverId: match.id }
}

/** Author-facing sentence for a catalog failure (INV-6 — always a stated reason). */
export function failureMessage(failure: CatalogFailure): string {
  switch (failure.kind) {
    case 'no-server':
      return 'Pick a server first to see the tools it offers.'
    case 'unknown-server':
      return `This step points at a server called "${failure.serverName}", which isn't one of the servers available to you — enter the tool name and arguments by hand, or pick a different server.`
    case 'no-permission':
      return "You don't have permission to list this server's tools — enter the tool name and arguments by hand."
    case 'unreachable':
      return `Couldn't reach "${failure.serverName}" (${failure.detail}) — enter the tool name and arguments by hand.`
  }
}
