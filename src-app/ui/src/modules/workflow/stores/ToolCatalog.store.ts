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
  /** We do not KNOW yet whether this server exists — the accessible-server list
   *  has not answered, or a by-name lookup is in flight. Never an accusation. */
  | { kind: 'resolving-server'; serverName: string }
  | { kind: 'unknown-server'; serverName: string }
  /** Registered and reachable in principle, but switched off. Not "unknown". */
  | { kind: 'disabled-server'; serverName: string }
  /** We could not even establish whether the server exists. Retryable. */
  | { kind: 'server-lookup-failed'; serverName: string; detail: string }
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

/**
 * What an authoritative by-NAME lookup found.
 *
 * `McpServer.servers` is a paginated SLICE (page size 10), so "not in that list"
 * is not evidence of anything — the server may simply be on page 3, or the list
 * may not have loaded yet. This is the verdict that IS evidence.
 */
export type ServerLookup =
  | { status: 'pending' }
  | { status: 'found'; id: string; enabled: boolean }
  | { status: 'missing' }
  | { status: 'failed'; detail: string }
  | { status: 'no-permission' }

// ---------------------------------------------------------------------------
// Session-scoped cache (see the header note)
// ---------------------------------------------------------------------------

/** Opaque per-editing-session key. The caller passes its builder store. */
export type CatalogScope = object

/**
 * Everything that must be shared by every store INSTANCE of one editing session.
 *
 * The in-flight guard and the invalidation generation used to live in the
 * action closure, which is rebuilt per component MOUNT while the cache is
 * per-session — so two step forms mounted in the same session (or one step
 * switched to and back mid-fetch) each saw an empty guard and each fired
 * `tools/list`, which is precisely the stdio re-handshake the cache exists to
 * prevent. `pending` holds the promise itself so a late joiner AWAITS the
 * request already running instead of starting a second one.
 */
interface SessionState {
  tools: Map<string, CatalogEntry>
  toolsPending: Map<string, Promise<CatalogEntry>>
  toolsGeneration: Map<string, number>
  servers: Map<string, ServerLookup>
  serversPending: Map<string, Promise<ServerLookup>>
  serversGeneration: Map<string, number>
}

const sessions = new WeakMap<CatalogScope, SessionState>()

function sessionState(scope: CatalogScope): SessionState {
  let state = sessions.get(scope)
  if (!state) {
    state = {
      tools: new Map(),
      toolsPending: new Map(),
      toolsGeneration: new Map(),
      servers: new Map(),
      serversPending: new Map(),
      serversGeneration: new Map(),
    }
    sessions.set(scope, state)
  }
  return state
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

/**
 * How many accessible servers one by-name lookup asks for.
 *
 * `search` is a server-side ILIKE over name / display_name / description, so an
 * exact name is expected within the first page of matches; the caller still
 * requires an EXACT name equality on the result, so a broad substring hit can
 * never be mistaken for the server.
 */
const SERVER_LOOKUP_PAGE_SIZE = 100

export const ToolCatalogStoreDef = defineLocalStore({
  immer: true,
  state: {
    /** Keyed by SERVER ID. A step stores the server NAME, so the caller resolves
     *  name → id first; keying by id means two names for one server share a
     *  fetch and a rename does not orphan the cache. */
    byServerId: {} as Record<string, CatalogEntry>,
    /** Authoritative name → server verdicts, for names the loaded (paginated)
     *  accessible-server list cannot answer. */
    serverByName: {} as Record<string, ServerLookup>,
  },

  actions: (set, get) => {
    const fetchTools = async (
      serverId: string,
      serverName: string,
    ): Promise<CatalogEntry> => {
      try {
        const res = await ApiClient.McpServerRuntime.listTools({ id: serverId })
        const tools = res.tools ?? []
        return { tools, loading: false, failure: failureForToolList(tools, serverName) }
      } catch (error) {
        // An MCP server that cannot be reached is the COMMON case (a stdio
        // server not installed, an http server down). It must produce a stated
        // reason, never an empty tool list that reads as "this server has no
        // tools".
        return {
          tools: [],
          loading: false,
          failure: classifyFetchFailure(error, serverName),
        }
      }
    }

    const load = async (
      serverId: string,
      serverName: string,
      scope: CatalogScope,
    ) => {
      const session = sessionState(scope)
      const existing = get().byServerId[serverId]
      // A COMPLETED fetch is terminal until `invalidate` — including one that
      // failed, so a server that is down is asked once per session rather than
      // re-probed on every step switch.
      if (existing && !existing.loading) return

      const cached = session.tools.get(serverId)
      if (cached) {
        set(d => {
          d.byServerId[serverId] = cached
        })
        return
      }

      if (!hasPermissionNow(Permissions.McpServersRead)) {
        const denied: CatalogEntry = {
          tools: [],
          loading: false,
          failure: { kind: 'no-permission' },
        }
        session.tools.set(serverId, denied)
        set(d => {
          d.byServerId[serverId] = denied
        })
        return
      }

      const gen = session.toolsGeneration.get(serverId) ?? 0
      let pending = session.toolsPending.get(serverId)
      if (!pending) {
        pending = fetchTools(serverId, serverName)
        session.toolsPending.set(serverId, pending)
      }
      set(d => {
        d.byServerId[serverId] = { tools: [], loading: true, failure: null }
      })
      const entry = await pending
      // Bumped by `invalidate`, so a response already in flight when the author
      // hits "Try again" is DISCARDED instead of overwriting the retry.
      if ((session.toolsGeneration.get(serverId) ?? 0) !== gen) return
      session.toolsPending.delete(serverId)
      session.tools.set(serverId, entry)
      set(d => {
        d.byServerId[serverId] = entry
      })
    }

    const lookupServer = async (serverName: string): Promise<ServerLookup> => {
      try {
        const res = await ApiClient.McpServer.listAccessible({
          page: 1,
          per_page: SERVER_LOOKUP_PAGE_SIZE,
          search: serverName,
        })
        const match = (res.servers ?? []).find(s => s.name === serverName)
        return match
          ? { status: 'found', id: match.id, enabled: match.enabled }
          : { status: 'missing' }
      } catch (error) {
        return { status: 'failed', detail: describeFetchError(error) }
      }
    }

    /**
     * Establish, authoritatively, whether a server NAME is one this user can
     * reach — for the names the loaded page cannot answer.
     */
    const resolveServer = async (serverName: string, scope: CatalogScope) => {
      if (!serverName) return
      const session = sessionState(scope)
      const local = get().serverByName[serverName]
      if (local && local.status !== 'pending') return

      const cached = session.servers.get(serverName)
      if (cached) {
        set(d => {
          d.serverByName[serverName] = cached
        })
        return
      }

      if (!hasPermissionNow(Permissions.McpServersRead)) {
        const denied: ServerLookup = { status: 'no-permission' }
        session.servers.set(serverName, denied)
        set(d => {
          d.serverByName[serverName] = denied
        })
        return
      }

      const gen = session.serversGeneration.get(serverName) ?? 0
      let pending = session.serversPending.get(serverName)
      if (!pending) {
        pending = lookupServer(serverName)
        session.serversPending.set(serverName, pending)
      }
      set(d => {
        d.serverByName[serverName] = { status: 'pending' }
      })
      const result = await pending
      if ((session.serversGeneration.get(serverName) ?? 0) !== gen) return
      session.serversPending.delete(serverName)
      session.servers.set(serverName, result)
      set(d => {
        d.serverByName[serverName] = result
      })
    }

    return {
      load,
      resolveServer,

      /** Drop a cached entry — session cache included — so the next read
       *  refetches. Wired to the "Try again" action on the failure Alert. */
      invalidate: (serverId: string, scope: CatalogScope) => {
        const session = sessionState(scope)
        session.toolsGeneration.set(
          serverId,
          (session.toolsGeneration.get(serverId) ?? 0) + 1,
        )
        session.toolsPending.delete(serverId)
        session.tools.delete(serverId)
        set(d => {
          delete d.byServerId[serverId]
        })
      },

      /** The same, for a by-name verdict — so a lookup that failed (or found
       *  nothing) can be asked again rather than standing for the session. */
      invalidateServer: (serverName: string, scope: CatalogScope) => {
        const session = sessionState(scope)
        session.serversGeneration.set(
          serverName,
          (session.serversGeneration.get(serverName) ?? 0) + 1,
        )
        session.serversPending.delete(serverName)
        session.servers.delete(serverName)
        set(d => {
          delete d.serverByName[serverName]
        })
      },
    }
  },
})

export type ToolCatalogStore = ReturnType<typeof ToolCatalogStoreDef.use>

/** What `entryForServerName` needs beyond the loaded page, to tell "we do not
 *  know yet" apart from "no such server". */
export interface ServerResolutionContext {
  /** Has the shared accessible-server list answered at least once (or failed)?
   *  While it has not, its emptiness means nothing. */
  listReady?: boolean
  /** Authoritative by-name verdicts already obtained (`resolveServer`). */
  lookups?: Record<string, ServerLookup>
  /**
   * May this user enumerate MCP servers at all (`mcp_servers::read`)?
   *
   * Load-bearing, not defensive. `loadMcpServers` returns at its own permission
   * gate WITHOUT setting `isInitialized` or `error`, so for a user who holds
   * `workflows::manage` but not `mcp_servers::read` the shared list never
   * settles — `listReady` is false forever, no by-name lookup is ever asked
   * for, and the resolution sticks at `resolving-server`: a permanently
   * DISABLED Tool field whose one stated reason ("Still looking up…") is false.
   * Nothing is enumerable for this user, so the answer is known immediately and
   * the documented hand-entry escape hatch opens at once (INV-6).
   */
  canList?: boolean
}

/**
 * The catalog entry for a server NAME.
 *
 * Pure so the resolution rule is unit-testable without React.
 *
 * The loaded `servers` list is only ever EVIDENCE OF PRESENCE, never of absence:
 * it is a paginated slice (page size 10) of a lazily-loaded store, so "not in
 * it" covers three different situations — the list has not loaded yet, the
 * server is on a later page, and the server genuinely is not available. Calling
 * all three `unknown-server` told the author, in the very first frame of every
 * saved tool step, that their server "isn't one of the servers available to
 * you". That reason was FALSE, which INV-6 forbids more strongly than it
 * forbids silence. Absence is now only ever asserted from an authoritative
 * by-name lookup; until one exists the state is `resolving-server` and
 * `needsLookup` asks the caller to run one.
 */
export function entryForServerName(
  serverName: string | null | undefined,
  servers: { id: string; name: string; enabled?: boolean }[],
  byServerId: Record<string, CatalogEntry>,
  context: ServerResolutionContext = {},
): { entry: CatalogEntry; serverId: string | null; needsLookup: boolean } {
  const { listReady = true, lookups = {}, canList = true } = context
  const unresolved = (failure: CatalogFailure, needsLookup = false) => ({
    entry: { ...EMPTY, failure },
    serverId: null,
    needsLookup,
  })

  if (!serverName) return unresolved({ kind: 'no-server' })
  // Nothing here is enumerable for this user — neither the accessible-server
  // list nor `tools/list` — so say so NOW rather than waiting on a list that
  // will never answer. See `ServerResolutionContext.canList`.
  if (!canList) return unresolved({ kind: 'no-permission' })

  const match = servers.find(s => s.name === serverName)
  if (match) {
    // A registered server that is switched OFF is not an unknown one, and
    // hiding it behind an `enabled` filter (so it resolved as "no such server")
    // accused the author of pointing at something that does not exist.
    if (match.enabled === false) {
      return unresolved({ kind: 'disabled-server', serverName })
    }
    return {
      entry: byServerId[match.id] ?? EMPTY,
      serverId: match.id,
      needsLookup: false,
    }
  }

  const lookup = lookups[serverName]
  if (!lookup) {
    // Ask for a lookup only once the shared list has settled — while it is
    // still loading it may yet answer for free.
    return unresolved({ kind: 'resolving-server', serverName }, listReady)
  }
  switch (lookup.status) {
    case 'pending':
      return unresolved({ kind: 'resolving-server', serverName })
    case 'no-permission':
      return unresolved({ kind: 'no-permission' })
    case 'failed':
      return unresolved({
        kind: 'server-lookup-failed',
        serverName,
        detail: lookup.detail,
      })
    case 'missing':
      return unresolved({ kind: 'unknown-server', serverName })
    case 'found':
      return lookup.enabled
        ? {
            entry: byServerId[lookup.id] ?? EMPTY,
            serverId: lookup.id,
            needsLookup: false,
          }
        : unresolved({ kind: 'disabled-server', serverName })
  }
}

/** Alert heading for a catalog failure — "unavailable" would misdescribe a
 *  server that answered perfectly well and simply has no tools. */
export function failureTitle(failure: CatalogFailure): string {
  switch (failure.kind) {
    case 'no-tools':
      return 'This server offers no tools'
    case 'disabled-server':
      return 'This server is turned off'
    default:
      return 'Tool list unavailable'
  }
}

/** Author-facing sentence for a catalog failure (INV-6 — always a stated reason). */
export function failureMessage(failure: CatalogFailure): string {
  switch (failure.kind) {
    case 'no-server':
      return 'Pick a server first to see the tools it offers.'
    case 'resolving-server':
      return `Still looking up "${failure.serverName}" among the servers available to you — the tool list will appear as soon as it answers.`
    case 'unknown-server':
      return `This step points at a server called "${failure.serverName}", which isn't one of the servers available to you — enter the tool name and arguments by hand, or pick a different server.`
    case 'disabled-server':
      return `"${failure.serverName}" is one of your servers but it is currently disabled, so its tools can't be listed — enable it, pick a different server, or enter the tool name and arguments by hand.`
    case 'server-lookup-failed':
      return `Couldn't check whether "${failure.serverName}" is available to you (${failure.detail}) — try again, or enter the tool name and arguments by hand.`
    case 'no-permission':
      return "You don't have permission to list this server's tools — enter the tool name and arguments by hand."
    case 'unreachable':
      return `Couldn't reach "${failure.serverName}" (${failure.detail}) — enter the tool name and arguments by hand.`
    case 'no-tools':
      return `"${failure.serverName}" answered, but it currently publishes no tools — enter the tool name and arguments by hand, or pick a different server.`
  }
}

/**
 * Whether asking again could plausibly change the answer (drives "Try again").
 *
 * `unknown-server` is retryable BECAUSE the verdict now comes from a lookup we
 * ran: a server registered (or shared with this user) since then would resolve
 * on the next ask, and without the button that verdict — right or wrong — stood
 * for the whole editing session with no way out.
 */
export function isRetryableFailure(failure: CatalogFailure): boolean {
  return (
    failure.kind === 'unreachable' ||
    failure.kind === 'no-tools' ||
    failure.kind === 'server-lookup-failed' ||
    failure.kind === 'unknown-server'
  )
}
