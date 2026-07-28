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
// `WorkflowBuilder.store.ts`. A local store also auto-unsubscribes on unmount.
//
// The CACHE, however, cannot live in that store instance alone. `StepConfigPanel`
// mounts each step form with `key={step.id}`, and `defineLocalStore.use()` builds
// a fresh store per mount — so a store-local cache is thrown away every time the
// author clicks a different step, and `GET /tools` fires again (re-handshaking a
// stdio server each time). The cache is therefore held in a module-level
// `WeakMap` keyed by an opaque SCOPE object — the builder store, which lives
// exactly as long as the editing session. That is what DEC-8 actually wanted:
// one fetch per server per BUILDER SESSION, and a genuinely fresh list for the
// next session (a new builder mount ⇒ a new scope ⇒ an empty cache). Within a
// session the author can force a refetch with `invalidate` ("Try again").
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
  /** Reached, answered, and served ZERO tools — a real state that used to render
   *  as an unexplained free-text box. */
  | { kind: 'no-tools'; serverName: string }

export interface CatalogEntry {
  tools: Tool[]
  loading: boolean
  failure: CatalogFailure | null
}

const EMPTY: CatalogEntry = { tools: [], loading: false, failure: null }

// ---------------------------------------------------------------------------
// Session-scoped cache (see the header note)
// ---------------------------------------------------------------------------

/** Opaque per-editing-session key. The caller passes its builder store. */
export type CatalogScope = object

const sessionCatalogs = new WeakMap<CatalogScope, Map<string, CatalogEntry>>()

function sessionCatalog(scope: CatalogScope): Map<string, CatalogEntry> {
  let cache = sessionCatalogs.get(scope)
  if (!cache) {
    cache = new Map()
    sessionCatalogs.set(scope, cache)
  }
  return cache
}

/**
 * Human reason for a failed tools fetch.
 *
 * NEVER the raw `Error.message`: the api-client builds that from the wire
 * (`HTTP error! status: 502 - <html>…the whole error page…`), so interpolating
 * it into an Alert leaks a machine string of unbounded length into copy a person
 * is meant to read. A status maps to a sentence; anything else is stripped of
 * markup and clipped to one clause.
 */
export function describeFetchError(error: unknown): string {
  const status =
    typeof (error as { status?: unknown } | null)?.status === 'number'
      ? (error as { status: number }).status
      : null
  if (status === 401) return 'the session is no longer signed in'
  if (status === 404) return 'the server is no longer registered'
  if (status === 408 || status === 504) return 'it timed out'
  if (status === 429) return 'it is rate-limiting requests'
  if (status !== null && status >= 500) return 'it reported an internal error'
  if (status !== null && status >= 400) return 'it rejected the request'
  const raw = error instanceof Error ? error.message : ''
  if (!raw || raw.startsWith('HTTP error!')) return 'it did not respond'
  const oneLine = raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  if (!oneLine) return 'it did not respond'
  return oneLine.length > 120 ? `${oneLine.slice(0, 119)}…` : oneLine
}

/**
 * Which failure a rejected `listTools` really is.
 *
 * A 403 is NOT unreachability: the caller holds `mcp_servers::read` (or the
 * request would never have been made) but lacks access to THIS server
 * (`USER_NO_ACCESS`). Reporting that as `Couldn't reach "X" (You do not have
 * access to this server)` sent the author looking at the network for a
 * permissions problem — and the `no-permission` variant existed all along.
 */
export function classifyFetchFailure(error: unknown, serverName: string): CatalogFailure {
  const status = (error as { status?: unknown } | null)?.status
  if (status === 403) return { kind: 'no-permission' }
  return { kind: 'unreachable', serverName, detail: describeFetchError(error) }
}

/**
 * The failure implied by a SUCCESSFUL `tools/list` that served nothing.
 *
 * Without it the picker silently became a free-text box with no reason given —
 * the silent degradation §2.5 forbids.
 */
export function failureForToolList(
  tools: Tool[],
  serverName: string,
): CatalogFailure | null {
  return tools.length === 0 ? { kind: 'no-tools', serverName } : null
}

export const ToolCatalogStoreDef = defineLocalStore({
  immer: true,
  state: {
    /** Keyed by SERVER ID. A step stores the server NAME, so the caller resolves
     *  name → id first; keying by id means two names for one server share a
     *  fetch and a rename does not orphan the cache. */
    byServerId: {} as Record<string, CatalogEntry>,
  },

  actions: (set, get) => {
    // In-flight guard: several fields (the picker + the arguments form) read the
    // same server in one render pass, and each would otherwise start a fetch.
    const inflight = new Set<string>()
    // Bumped by `invalidate`, so a response that is already in flight when the
    // author hits "Try again" is DISCARDED instead of overwriting the retry.
    const generation = new Map<string, number>()

    const publish = (serverId: string, scope: CatalogScope, entry: CatalogEntry) => {
      sessionCatalog(scope).set(serverId, entry)
      set(d => {
        d.byServerId[serverId] = entry
      })
    }

    const load = async (
      serverId: string,
      serverName: string,
      scope: CatalogScope,
    ) => {
      if (inflight.has(serverId)) return
      const existing = get().byServerId[serverId]
      // A COMPLETED fetch is terminal until `invalidate` — including one that
      // failed, so a server that is down is asked once per session rather than
      // re-probed on every step switch.
      if (existing && !existing.loading) return

      const cached = sessionCatalog(scope).get(serverId)
      if (cached) {
        set(d => {
          d.byServerId[serverId] = cached
        })
        return
      }

      if (!hasPermissionNow(Permissions.McpServersRead)) {
        publish(serverId, scope, {
          tools: [],
          loading: false,
          failure: { kind: 'no-permission' },
        })
        return
      }

      const gen = generation.get(serverId) ?? 0
      inflight.add(serverId)
      set(d => {
        d.byServerId[serverId] = { tools: [], loading: true, failure: null }
      })
      try {
        const res = await ApiClient.McpServerRuntime.listTools({ id: serverId })
        if ((generation.get(serverId) ?? 0) !== gen) return
        const tools = res.tools ?? []
        publish(serverId, scope, {
          tools,
          loading: false,
          failure: failureForToolList(tools, serverName),
        })
      } catch (error) {
        if ((generation.get(serverId) ?? 0) !== gen) return
        // An MCP server that cannot be reached is the COMMON case (a stdio
        // server not installed, an http server down). It must produce a stated
        // reason, never an empty tool list that reads as "this server has no
        // tools".
        publish(serverId, scope, {
          tools: [],
          loading: false,
          failure: classifyFetchFailure(error, serverName),
        })
      } finally {
        if ((generation.get(serverId) ?? 0) === gen) inflight.delete(serverId)
      }
    }

    return {
      load,

      /** Drop a cached entry — session cache included — so the next read
       *  refetches. Wired to the "Try again" action on the failure Alert. */
      invalidate: (serverId: string, scope: CatalogScope) => {
        generation.set(serverId, (generation.get(serverId) ?? 0) + 1)
        inflight.delete(serverId)
        sessionCatalog(scope).delete(serverId)
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

/** Alert heading for a catalog failure — "unavailable" would misdescribe a
 *  server that answered perfectly well and simply has no tools. */
export function failureTitle(failure: CatalogFailure): string {
  return failure.kind === 'no-tools'
    ? 'This server offers no tools'
    : 'Tool list unavailable'
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
    case 'no-tools':
      return `"${failure.serverName}" answered, but it currently publishes no tools — enter the tool name and arguments by hand, or pick a different server.`
  }
}

/** Whether asking again could plausibly change the answer (drives "Try again"). */
export function isRetryableFailure(failure: CatalogFailure): boolean {
  return failure.kind === 'unreachable' || failure.kind === 'no-tools'
}
