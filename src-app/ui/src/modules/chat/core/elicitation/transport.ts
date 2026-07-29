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
 * The answers a USER can give an approval card.
 *
 * Deliberately narrower than `ElicitationAction` (FIX_ROUND-20). `cancel` is the
 * PROVIDER's business — it owns its entries and cancels them when a conversation
 * closes — and is never something a card may substitute for the answer the user
 * actually gave. Narrowing the consumer-facing `resolveElicitationVia` to this
 * type makes `resolveElicitationVia(id, <anything> ? 'cancel' : action)` a type
 * error for EVERY condition, not just the one spelling a guard happens to know:
 * a blind auditor proved that shape (clicking **Approve** silently CANCELS the
 * tool call) was tsc-clean, green under every source guard, and invisible to the
 * behavioural matrix. Nothing in-tree ever asked this helper to cancel.
 */
export type ElicitationDecision = Exclude<ElicitationAction, 'cancel'>

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
  /**
   * Open a request. Providers MUST be idempotent on a repeated id, and MUST make
   * `has(id)` true SYNCHRONOUSLY before any change notification for it.
   *
   * That second clause is a real requirement, not pedantry (FIX_ROUND-9): a
   * consumer that re-registers a missing entry keys its retry off the seam's
   * change notification, so a provider that notifies while leaving `has()` false
   * spins it — measured at ~54 registrations before React's update-depth bail-out,
   * with the resulting error swallowed and mislabelled by this module's own
   * catch. Consumers additionally bound their own retries, but the contract is
   * where this belongs.
   */
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
 * the provider threw).
 *
 * The return value is a DIAGNOSTIC, not the mechanism (FIX_ROUND-8). A consumer
 * that needs to know whether the entry exists asks the seam — `elicitationExists`
 * — because that answer is LIVE and this one is a snapshot of one attempt.
 * Routing the failure through caller state is what produced a latch twice: a
 * failed `register` bumps nothing, so nothing re-renders to clear whatever the
 * caller recorded.
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
 * Carry a USER'S DECISION to the provider. Resolves to `false` when there is no
 * transport to carry it (so a caller can surface "not resolvable" rather than
 * silently claiming success), `true` once the provider's resolve settles.
 *
 * `action` is `ElicitationDecision`, not `ElicitationAction` — see that type for
 * why. A provider that needs to CANCEL an entry does so through its own store;
 * it does not route a cancellation through the consumer seam.
 */
export async function resolveElicitationVia(
  elicitationId: string,
  action: ElicitationDecision,
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

/**
 * Why a card's approve/deny is not in its ordinary state, or `null` when it is.
 *
 * **BEHAVIOURAL states only** (FIX_ROUND-20). Every value here changes what the
 * card DOES — whether a click can reach the server, and whether the situation
 * genuinely stops the user. This is the ONLY elicitation state an action path may
 * read, which is the whole reason it is this short.
 *
 * ## Why `not-registered` is no longer a member
 *
 * "A transport exists but holds no local entry for this id" used to be a third
 * value here, and it is the root cause of nineteen non-converging fix rounds. It
 * has no behavioural effect whatsoever: it does not disable (the provider POSTs
 * unconditionally, so a click still reaches `/respond` and still resumes the
 * suspended script — FIX_ROUND-8), and it is not an error (it is transient,
 * self-healing and explicitly answerable — FIX_ROUND-9). It changed exactly one
 * thing: WHICH SENTENCE is shown during the sub-second window before the
 * self-heal lands.
 *
 * A presentational fact living in a behavioural union is a fact every action path
 * can branch on. A blind auditor proved
 * `resolveElicitationVia(id, blocked === 'not-registered' ? 'cancel' : action)`
 * — the user clicks **Approve** and the tool call is CANCELLED — was tsc-clean,
 * green under every source-scanning guard, and unreachable by any behavioural
 * test, because the state self-heals in milliseconds and cannot be held still
 * long enough to click in. Nineteen rounds of adding one more source predicate
 * per discovered spelling never converged, because the space of spellings is
 * unbounded while the space of VALUES was not.
 *
 * So the value moved to `elicitationNotice` below, which returns prose and a
 * tone — nothing an action argument can be selected with. The mutation above is
 * now a compile error rather than a passing test.
 */
export type ElicitationBlockedReason = 'no-transport' | 'resolve-failed'

/**
 * Classify a card's actionability. Two states — and, after three rounds of
 * getting this wrong, exactly ONE of them disables anything.
 *
 *  - **`no-transport`** — there is literally nothing to POST through. DISABLE:
 *    a click cannot leave the browser. LIVE — it clears itself when an extension
 *    installs a transport, because the caller re-derives on every seam bump.
 *  - **`resolve-failed`** — a resolve genuinely failed. NOT disabled: retrying is
 *    the point. FIX_ROUND-4 folded this into the disable predicate, which gated
 *    its own reset and disabled the card for the life of the mount.
 *
 * The through-line of the regressions this file has shipped: every time it
 * DISABLED a control on a state the user could still act through, the result was
 * a card that could not be answered at all. The rule is that only the impossible
 * case disables.
 *
 * `entryExists` is deliberately NOT a signal here (FIX_ROUND-20): it decided
 * nothing this function's callers act on. It feeds `elicitationNotice` instead.
 */
export function elicitationBlockedReason(args: {
  hasTransport: boolean
  resolveFailed: boolean
}): ElicitationBlockedReason | null {
  if (!args.hasTransport) return 'no-transport'
  if (args.resolveFailed) return 'resolve-failed'
  return null
}

/** Does this state mean a click cannot possibly reach the server? */
export function elicitationIsUnactionable(reason: ElicitationBlockedReason | null): boolean {
  return reason === 'no-transport'
}

/**
 * Everything the card's status region shows: the sentence, its tone, and the
 * probe token. PRESENTATIONAL — there is nothing here an action can be selected
 * with, and no consumer may feed any of it back into a decision.
 */
export interface ElicitationNotice {
  /** The sentence to show, or `''` when there is nothing to say. */
  text: string
  /**
   * The kit `Text` tone. `danger` ONLY for states that genuinely stop the user:
   * painting a transient, answerable state in the destructive red
   * DESIGN_SYSTEM.md reserves for errors contradicts its own copy (FIX_ROUND-9).
   */
  tone: 'danger' | 'secondary'
  /** Stable token for `data-status` — the e2e/gallery probe for this card. */
  status: string
}

/**
 * Decide the status region's whole contents in ONE place.
 *
 * Text and tone are returned TOGETHER, per case, because the FIX_ROUND-9 defect
 * was precisely a divergence between them: copy that read "you can still answer
 * it" painted in the destructive red reserved for errors. One function with one
 * branch per state makes that divergence unwritable rather than merely guarded —
 * which is why the separate `elicitationIsError` predicate, and the source guard
 * that pinned its call site, are gone (FIX_ROUND-20).
 *
 * `not-registered` is a case LABEL here and nothing else. It never leaves this
 * function as a behavioural value, so no resolve path can branch on it.
 *
 * Precedence note (FIX_ROUND-20): `resolve-failed` now outranks the
 * not-registered sentence, where `not-registered` used to outrank it. The cell
 * differs only when the transport is installed, holds no entry, AND a resolve
 * failed — which `resolveDidFail` only reports when nothing was carried at all,
 * i.e. the provider threw. "That didn't go through" is the accurate sentence for
 * a failure the user just caused; the old order showed them a background
 * condition they did not.
 */
export function elicitationNotice(args: {
  resolved: 'approved' | 'denied' | null
  blocked: ElicitationBlockedReason | null
  /** Does the provider hold a local entry for this id? */
  entryOpen: boolean
  /** Has the consumer's bounded self-heal budget been spent? */
  healExhausted: boolean
}): ElicitationNotice {
  if (args.resolved === 'approved') {
    return { text: 'Approved — script resumed.', tone: 'secondary', status: 'approved' }
  }
  if (args.resolved === 'denied') {
    return { text: 'Denied.', tone: 'secondary', status: 'denied' }
  }
  if (args.blocked === 'no-transport') {
    return {
      text:
        'This request cannot be answered right now — the approval channel is unavailable. ' +
        'It will become answerable on its own once the connection is back, or reload the conversation.',
      tone: 'danger',
      status: 'no-transport',
    }
  }
  if (args.blocked === 'resolve-failed') {
    return { text: "That didn't go through — try again.", tone: 'danger', status: 'resolve-failed' }
  }
  if (!args.entryOpen) {
    // Neither sentence claims work is IN FLIGHT (FIX_ROUND-14): a retry only
    // happens on a seam change and a failed register bumps nothing, so between
    // attempts there is genuinely nothing scheduled. Both state the CONDITION and
    // the thing the user can actually do; the exhausted one adds the reload hint,
    // because after the budget there is no local path back.
    return {
      text: args.healExhausted
        ? 'This request could not be reopened locally — you can still answer it, or reload the conversation.'
        : 'This request is not open locally — you can still answer it.',
      // NOT danger: this is progress the user can act through, not a stop.
      tone: 'secondary',
      status: 'not-registered',
    }
  }
  return { text: '', tone: 'secondary', status: 'pending' }
}

/**
 * Did a resolve attempt genuinely FAIL?
 *
 * Judged only when the provider HELD an entry to judge it by. With no entry its
 * optimistic update is a no-op and the status stays `undefined` — but the POST
 * still went out and the suspended script still resumed, so recording that as a
 * failure marks a SUCCESSFUL approve as failed (FIX_ROUND-9). `not-registered`
 * already describes that card, and the self-heal is what resolves it.
 *
 * Extracted (FIX_ROUND-10) for the same reason as above: reverting the fix left
 * the whole suite green, and the only e2e never reaches a blocked state.
 */
export function resolveDidFail(args: {
  carried: boolean
  hadEntry: boolean
  after: ElicitationStatus | undefined
}): boolean {
  if (!args.carried) return true
  return args.hadEntry && args.after === 'pending'
}
