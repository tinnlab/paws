/**
 * The chat transcript's ELICITATION seam — core-owned, extension-fed.
 *
 * ## Why this exists (FIX_ROUND-2 #3 / AP-4)
 *
 * ITEM-25 (AP-4) moved the `run_js_approval` content type and its approve/deny
 * card out of the **mcp** extension and into **js-tool**, because one module
 * owning another module's user-facing surface is the anti-pattern the activity
 * rail was built to retire. But the moved code kept reaching back into mcp's
 * store (`McpComposer.elicitationRequests` / `addElicitationRequest` /
 * `resolveElicitation`), so `mcp → js-tool` simply became `js-tool → mcp`. The
 * direction changed; the coupling did not. That is a cross-module store read
 * plus a deep import past a module's public surface — both forbidden by
 * coding-guidelines §9.
 *
 * The dependency is real: a suspended `run_js` script resumes through the
 * side-channel elicitation `/respond` endpoint (the same in-process oneshot
 * `ask_user` uses), because a live script stack cannot survive a turn boundary.
 * So the fix is not to re-move the code — it is to INVERT the dependency, the
 * same way `chat/core/rail/liveSteps.ts` inverts the live-step dependency:
 *
 *   core declares the shape → the extension that owns the SSE frames and the
 *   REST call PUSHES an implementation in → any other extension consumes it
 *   through core, naming nobody.
 *
 * After this, `js-tool` imports only `@/modules/chat/**` (its host) and mcp
 * imports nothing of js-tool's. The extension graph stays a DAG rooted at chat.
 *
 * It degrades cleanly when no transport is registered (a unit test, a gallery
 * render, mcp disabled): reads report "unknown", `register` is a no-op and
 * `resolve` rejects nothing — the card renders its pending state and the
 * buttons simply do not resolve, which is strictly better than throwing inside
 * a transcript render.
 */

/** Terminal + in-flight states an elicitation can be in. */
export type ElicitationStatus = 'pending' | 'accepted' | 'declined' | 'cancelled'

/** What the resolver may be asked to do. */
export type ElicitationAction = 'accept' | 'decline' | 'cancel'

/**
 * The minimum a consumer must supply to open a request. Deliberately NOT the
 * `SSEChatStreamMcpElicitationRequiredData` wire type: a consumer registering a
 * request should not have to fabricate (or cast through) another module's SSE
 * payload shape. The provider adapts this to whatever it stores.
 */
export interface ElicitationRequestInit {
  elicitation_id: string
  /** Human-readable prompt shown if the provider surfaces one. */
  message: string
  /** Originating server id/name, when known. */
  server?: string | null
  /** Assistant message the request belongs to, when known. */
  message_id?: string | null
}

export interface ElicitationTransport {
  /** Is a request already open under this id? */
  has(elicitationId: string): boolean
  /** Current status, or `undefined` when the provider knows nothing about it. */
  status(elicitationId: string): ElicitationStatus | undefined
  /** Open a request. Providers MUST be idempotent on a repeated id. */
  register(init: ElicitationRequestInit): void
  /**
   * Resolve a request. The provider owns the optimistic update AND the
   * rollback-on-failure, so a failed POST returns the entry to `pending` and the
   * consumer's derived state re-enables its buttons.
   */
  resolve(
    elicitationId: string,
    action: ElicitationAction,
    content?: Record<string, unknown>,
  ): Promise<void>
  /** Notify on any change. Returns an unsubscribe. */
  subscribe(onChange: () => void): () => void
}

let transport: ElicitationTransport | null = null
/** Which extension installed the current transport, so teardown is owner-scoped. */
let transportOwner: string | null = null
let unsubscribeTransport: (() => void) | null = null
let version = 0
const listeners = new Set<() => void>()

function bump(): void {
  version += 1
  for (const l of listeners) l()
}

/**
 * Register (or clear with `null`) the elicitation transport. Idempotent and
 * re-registration-safe: registering a second transport detaches the first, so an
 * HMR reload or a re-mounted pane cannot leak subscriptions. Mirrors
 * `setRailLiveSource`.
 */
export function setElicitationTransport(
  next: ElicitationTransport | null,
  owner?: string,
): void {
  if (transport === next) return
  try {
    unsubscribeTransport?.()
  } catch (e) {
    console.error('[elicitation] transport unsubscribe threw', e)
  }
  unsubscribeTransport = null
  transport = next
  transportOwner = next ? (owner ?? null) : null
  if (transport) {
    // FIX_ROUND-3: a throwing `subscribe` used to leave an INSTALLED transport
    // with no change subscription — every card frozen at the status it first
    // read — and the exception escaped into the registering extension's
    // `initialize`, where the registry only logs it, silently skipping the rest
    // of that extension's wiring. Refuse the install instead: that is the
    // "degrades cleanly when nothing is registered" contract this file promises.
    try {
      unsubscribeTransport = transport.subscribe(bump)
    } catch (e) {
      console.error('[elicitation] transport subscribe threw; refusing the install', e)
      transport = null
      transportOwner = null
      unsubscribeTransport = null
    }
  }
  bump()
}

/**
 * Detach the transport IFF `owner` installed it. Called by the extension
 * registry on unregister so teardown is symmetric with the `initialize`-time
 * registration. Owner-scoped so unregistering a DIFFERENT extension cannot
 * detach it.
 */
export function clearElicitationTransportIfOwnedBy(owner: string): void {
  if (transportOwner !== owner) return
  setElicitationTransport(null)
}

/**
 * True when some extension has installed a transport — i.e. whether a card's
 * approve/deny can actually be carried anywhere. Consumed by
 * `JsToolApprovalContent` to disable + explain instead of rendering live buttons
 * that would silently no-op.
 */
export function hasElicitationTransport(): boolean {
  return transport !== null
}

/** Is a request open under this id? `false` when no transport is installed. */
export function elicitationExists(elicitationId: string): boolean {
  if (!transport) return false
  try {
    return transport.has(elicitationId)
  } catch (e) {
    console.error('[elicitation] transport.has threw', e)
    return false
  }
}

/** Current status, or `undefined` (unknown / no transport). Never throws. */
export function elicitationStatus(elicitationId: string): ElicitationStatus | undefined {
  if (!transport) return undefined
  try {
    return transport.status(elicitationId)
  } catch (e) {
    console.error('[elicitation] transport.status threw', e)
    return undefined
  }
}

/**
 * Open a request. Returns `false` when it could NOT be opened (no transport, or
 * the provider threw) so the caller can tell "registered" from "dropped on the
 * floor" — the consumer injects a card unconditionally after this call, and a
 * silently-failed registration leaves that card pending forever.
 *
 * Never throws: a provider must not break a transcript render.
 */
export function registerElicitation(init: ElicitationRequestInit): boolean {
  if (!transport) {
    // FIX_ROUND-4: `warn`, not `error`. "No transport installed" is the module's
    // DOCUMENTED degraded state (a gallery render, a unit test, mcp disabled) and
    // has a designed UI for it — `runtime-health.mjs` classifies a console ERROR
    // as a HIGH GATING finding, so logging it at error level would fail
    // `gate:ui` on the very gallery state that exists to show the degradation.
    // A provider that THROWS is a different thing and stays at error level.
    console.warn(
      '[elicitation] no transport installed; dropping request',
      init.elicitation_id,
    )
    return false
  }
  try {
    transport.register(init)
    return true
  } catch (e) {
    console.error('[elicitation] transport.register threw', init.elicitation_id, e)
    return false
  }
}

/**
 * Resolve a request. Resolves to `false` when there is no transport to carry it
 * (so a caller can surface "not resolvable" rather than silently claiming
 * success), `true` once the provider's resolve settles.
 */
export async function resolveElicitationVia(
  elicitationId: string,
  action: ElicitationAction,
  content?: Record<string, unknown>,
): Promise<boolean> {
  if (!transport) {
    // warn, not error — see registerElicitation: this is the documented
    // degraded state with a designed UI, not a fault (gate:ui gates on error).
    console.warn('[elicitation] no transport installed; cannot resolve', elicitationId)
    return false
  }
  // FIX_ROUND-3: this was the one seam call with no guard. The current provider
  // happens to swallow its own errors, but the published `resolve` contract only
  // promises optimistic-update-plus-rollback — a provider that REJECTS would
  // propagate into a floated `onClick` promise (an unhandled rejection, i.e. a
  // gating HIGH page-error under `gallery:runtime`). Report it as unresolved.
  try {
    await transport.resolve(elicitationId, action, content)
    return true
  } catch (e) {
    console.error('[elicitation] transport.resolve threw', elicitationId, action, e)
    return false
  }
}

/** Monotonic version — bumped on every transport change (for `useSyncExternalStore`). */
export function elicitationVersion(): number {
  return version
}

/** Subscribe to elicitation changes (for `useSyncExternalStore`). */
export function subscribeElicitation(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

/** Test-only reset so specs don't leak a transport across files. */
export function __resetElicitationTransportForTests(): void {
  // Guarded like the production path (FIX_ROUND-4): an unguarded throw here
  // would abort the reset with `transport` still set and leak an installed
  // transport into the next spec in the file.
  try {
    unsubscribeTransport?.()
  } catch {
    /* the reset must always complete */
  }
  unsubscribeTransport = null
  transport = null
  transportOwner = null
  version = 0
  listeners.clear()
}
