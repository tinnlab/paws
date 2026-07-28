/**
 * The rail's LIVE-step seam — core-owned, extension-fed.
 *
 * A persisted `tool_use` / `tool_result` pair cannot express three things the
 * rail needs while a turn is in flight: `pending-approval`, a start timestamp to
 * tick an elapsed timer from (DEC-9), and the moment a call finishes before its
 * result block lands. That information lives in whichever extension owns the
 * tool-lifecycle SSE frames.
 *
 * So the dependency is INVERTED rather than reversed: core declares the shape
 * and the extension PUSHES a source in. Core never imports, names or
 * special-cases the extension that provides it, and the rail degrades cleanly to
 * block-derived status when no source is registered (which is exactly what a
 * unit test, a reload, or a gallery render sees).
 *
 * This is the same shape as `setPrimaryChatStateAccessor` in the extension
 * registry — an inversion so a lower layer can read a higher layer's state
 * without a circular import.
 */

/** What a live source can say about one in-flight step. */
export interface RailLiveStep {
  /** Any producer's spelling; normalised through `toolStatusKey`. */
  status?: string
  /** ISO timestamp the call started — drives the ticking elapsed time. */
  startedAt?: string
  /** Final wall time in ms, once known. */
  durationMs?: number
}

export interface RailLiveSource {
  /** Live state for a `tool_use_id`, or `null` when it knows nothing about it. */
  get(toolUseId: string): RailLiveStep | null
  /** Notify on any change. Returns an unsubscribe. */
  subscribe(onChange: () => void): () => void
}

let source: RailLiveSource | null = null
/** Which extension installed the current source, so teardown can be owner-scoped. */
let sourceOwner: string | null = null
let unsubscribeSource: (() => void) | null = null
let version = 0
const listeners = new Set<() => void>()

function bump(): void {
  version += 1
  for (const l of listeners) l()
}

/**
 * Register (or clear with `null`) the live-step source. Idempotent and
 * re-registration-safe: registering a second source detaches the first, so an
 * HMR reload or a re-mounted pane cannot leak subscriptions.
 */
export function setRailLiveSource(next: RailLiveSource | null, owner?: string): void {
  if (source === next) return
  try {
    unsubscribeSource?.()
  } catch (e) {
    console.error('[rail] live-source unsubscribe threw', e)
  }
  unsubscribeSource = null
  source = next
  sourceOwner = next ? owner ?? null : null
  if (source) {
    // FIX_ROUND-4: hardened in step with its twin, `elicitation/transport.ts`.
    // Both are registered from the SAME `mcp` extension's `initialize`, two
    // statements apart, so a throwing `subscribe` here left an INSTALLED source
    // with no change subscription (every rail step frozen at the status it first
    // read) AND aborted the rest of mcp's wiring — including the elicitation
    // transport registered immediately after. Refusing the install is what
    // "core declares the shape, the extension pushes one in" has to mean when
    // the pushed implementation is broken.
    try {
      unsubscribeSource = source.subscribe(bump)
    } catch (e) {
      console.error('[rail] live-source subscribe threw; refusing the install', e)
      source = null
      sourceOwner = null
      unsubscribeSource = null
    }
  }
  bump()
}

/**
 * Detach the source IFF `owner` installed it. Called by the extension registry
 * on unregister, so teardown is symmetric with the `initialize`-time
 * registration — without it a disabled or HMR-torn-down extension leaves a live
 * store subscription bound to a module the host believes it has disposed.
 * Owner-scoped so unregistering a DIFFERENT extension cannot detach it.
 */
export function clearRailLiveSourceIfOwnedBy(owner: string): void {
  if (sourceOwner !== owner) return
  setRailLiveSource(null)
}

/** Live state for a step, or `null`. Safe to call anywhere (no hook). */
export function getRailLiveStep(toolUseId: string): RailLiveStep | null {
  if (!source) return null
  try {
    return source.get(toolUseId)
  } catch {
    return null
  }
}

/** Monotonic version — bumped on every source change. */
export function railLiveVersion(): number {
  return version
}

/** Subscribe to live-step changes (for `useSyncExternalStore`). */
export function subscribeRailLive(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

/** Test-only reset so specs don't leak a source across files. */
export function __resetRailLiveSourceForTests(): void {
  unsubscribeSource?.()
  unsubscribeSource = null
  source = null
  sourceOwner = null
  version = 0
  listeners.clear()
}
