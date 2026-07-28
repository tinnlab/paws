import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Alert, Button, Space, Text } from '@ziee/kit'
import { Check, Clock, X } from 'lucide-react'
import type { ContentRendererProps } from '@/modules/chat/core/extensions/types'
import { serverParenLabel } from '@/modules/chat/core/utils/serverLabel'
import { runJsElicitationInit, type RunJsApprovalIdentity } from '../elicitationInit'
import {
  elicitationStatus,
  elicitationVersion,
  hasElicitationTransport,
  elicitationBlockedReason,
  elicitationIsUnactionable,
  elicitationExists,
  registerElicitation,
  resolveElicitationVia,
  subscribeElicitation,
} from '@/modules/chat/core/elicitation/transport'

/**
 * Renders the approve/deny prompt for a gated sub-tool call a `run_js` script
 * wants to make while it is SUSPENDED in-process. Unlike the turn-boundary MCP
 * approval flow, this resolves via the side-channel elicitation `/respond`
 * endpoint (the same in-process oneshot `ask_user` uses) so the live script
 * resumes — `accept` runs the sub-tool, `decline` throws `ToolApprovalDenied`
 * into the script. Injected as a `run_js_approval` content block by the
 * `runJsApprovalRequired` SSE handler.
 */
/**
 * FIX_ROUND-7: EXTENDS the shared identity rather than restating it. The three
 * identity fields were declared in three places (here, the factory, and the SSE
 * frame type), so the card and the handler could drift on the very fields the
 * card reconciles against.
 */
interface JsToolApprovalData extends RunJsApprovalIdentity {
  input?: Record<string, unknown>
}

export function JsToolApprovalContent({ content }: ContentRendererProps) {
  const data = content.content as unknown as JsToolApprovalData
  const [submitting, setSubmitting] = useState(false)
  /**
   * FIX_ROUND-3: the decision could not be carried anywhere.
   *
   * Before AP-4 this card called `McpComposer.resolveElicitation` directly, so
   * the POST happened whether or not mcp's CHAT EXTENSION had initialized. Going
   * through the core seam made it conditional on that `initialize` having run —
   * and `resolveElicitationVia`'s `false` return (documented as existing "so a
   * caller can surface 'not resolvable' rather than silently claiming success")
   * was discarded, so a click on Approve/Deny flipped a spinner and did nothing,
   * with no message, no error and no state change. Surface it instead.
   */
  const [resolveFailed, setResolveFailed] = useState(false)
  const statusRef = useRef<HTMLElement>(null)
  /**
   * How many times the self-heal has tried. Bounded (FIX_ROUND-9) so a provider
   * that violates the register→`has()` contract cannot spin this effect: the seam
   * contract now states the requirement, and this is the consumer-side belt.
   */
  const healAttempts = useRef(0)
  const statusId = `run-js-approval-status-${data.elicitation_id}`

  // Derive the resolved state from the CORE-owned elicitation seam (the live
  // source of truth), NOT local state: the provider flips the entry
  // optimistically and ROLLS IT BACK to 'pending' on a failed POST, so a failed
  // approve re-enables the buttons (no false "Approved") and the resolved state
  // survives a component remount (virtualized list / streaming→final swap).
  //
  // FIX_ROUND-2 #3: this used to read `McpComposer.elicitationRequests` — a
  // cross-module store read (coding-guidelines §9) that AP-4 created while
  // moving this card out of mcp. `useSyncExternalStore` over the core seam keeps
  // the same reactivity (the provider forwards its store's changes) with no
  // import of the providing module. Same pattern as `ActivityRail`'s live-step
  // subscription.
  const seamVersion = useSyncExternalStore(
    subscribeElicitation,
    elicitationVersion,
    elicitationVersion,
  )
  const status = elicitationStatus(data.elicitation_id)
  const resolved: 'approved' | 'denied' | null =
    status === 'accepted' ? 'approved' : status === 'declined' || status === 'cancelled' ? 'denied' : null

  /**
   * FIX_ROUND-5: TWO distinct states, not one boolean.
   *
   * `no-transport` disables the controls (clicking would silently no-op) and is
   * LIVE — it clears by itself when an extension installs a transport, because
   * this re-reads on every seam bump. `resolve-failed` keeps them ENABLED,
   * because a rejected POST is transient and retrying is the whole point;
   * FIX_ROUND-4 folded the two together and thereby gated its own reset, which
   * disabled the card permanently after a single failure.
   */
  const hasTransport = hasElicitationTransport()
  // `entryExists` is read from the seam on every bump, so `not-registered` clears
  // itself the moment the self-heal below succeeds — nothing latches.
  const blocked = elicitationBlockedReason({
    hasTransport,
    entryExists: elicitationExists(data.elicitation_id),
    resolveFailed,
  })

  /**
   * SELF-HEAL. mcp's `initialize` awaits a dynamic import before installing the
   * transport, so a `runJsApprovalRequired` frame landing in that window is
   * dropped — the entry is never opened and the script can never be resumed.
   * Reconcile against the live seam instead of recording that failure into the
   * message block (which could never be corrected): once a transport exists and
   * the entry is missing, open it. Idempotent by contract, and the guard means a
   * card whose entry is already present does nothing.
   */
  useEffect(() => {
    if (!hasTransport || resolved !== null) return
    if (elicitationExists(data.elicitation_id)) return
    if (healAttempts.current >= 3) return
    healAttempts.current += 1
    // No need to consume the boolean here (FIX_ROUND-7): whether it succeeded is
    // observable from the seam itself — `entryExists` above derives the
    // `not-registered` state, which DISABLES the controls and clears itself when
    // a later attempt lands. FIX_ROUND-6 routed the failure through
    // `resolveFailed` instead, which keeps the buttons enabled and reports a
    // resolve the user never attempted, and latched.
    registerElicitation(runJsElicitationInit(data))
    // `seamVersion` is a dep so a FAILED register is retried on the next seam
    // change (FIX_ROUND-8). A failed register bumps nothing itself, so without a
    // trigger tied to the seam the effect never re-ran and the state it produced
    // could not clear — the latch this card has now grown three times.
  }, [hasTransport, resolved, data, seamVersion])

  /**
   * Focus the outcome when the buttons unmount. Without this, resolving destroys
   * the focused element and focus falls to `<body>` — a keyboard or
   * screen-reader user loses their place in a long transcript. Focusing a
   * `tabIndex={-1}` live region both restores position AND makes the outcome
   * announced reliably, which a region mounted together with its own text is
   * not (the region must pre-exist the text change — see the always-mounted
   * container below).
   */
  //
  // FIX_ROUND-5: SEEDED with the first-render value, not `null`. Seeded from
  // null, a card that mounts ALREADY resolved satisfies `resolved &&
  // !wasResolved.current` and steals focus — and the transcript is virtualized,
  // with this card's resolved state deliberately designed to survive a remount,
  // so merely scrolling an answered approval back into view yanked focus out of
  // the composer and scroll-jumped the viewport. Only a genuine null→resolved
  // TRANSITION may move focus.
  const wasResolved = useRef<'approved' | 'denied' | null>(resolved)
  useEffect(() => {
    if (resolved && !wasResolved.current) statusRef.current?.focus()
    wasResolved.current = resolved
  }, [resolved])

  const resolve = async (action: 'accept' | 'decline') => {
    // Re-entrancy guard: never POST twice to a single-use elicitation.
    // Only `no-transport` blocks a retry; a failed resolve stays actionable.
    // Only the UNACTIONABLE state blocks; everything else stays clickable, which
    // is what keeps a degraded card recoverable rather than latched.
    if (submitting || resolved !== null || elicitationIsUnactionable(blocked)) return
    setSubmitting(true)
    setResolveFailed(false)
    try {
      // The transport reflects success/failure in its own entry; the derived
      // `resolved` above reacts (rollback → buttons return for retry). A `false`
      // return means the decision never left the browser at all — a different
      // failure from "the POST was rejected", and the only one the transport can
      // report, so it gets its own user-visible message.
      const carried = await resolveElicitationVia(data.elicitation_id, action)
      // FIX_ROUND-6: `carried === false` only covers a transport that is absent or
      // THROWS. The shipped provider swallows its own errors and signals a
      // rejected POST by ROLLING THE ENTRY BACK to 'pending' — so the failure a
      // user actually hits produced no message at all, which is the original
      // silent-failure symptom this whole thread started from. Treat a settled
      // resolve that left the entry pending as the same failure.
      // FIX_ROUND-6: `carried === false` covers only an absent or THROWING
      // transport. The shipped provider swallows its own errors and signals a
      // rejected POST by ROLLING THE ENTRY BACK — so the failure a user actually
      // hits produced no message at all.
      // FIX_ROUND-7: `undefined` counts too — with no entry the provider's
      // optimistic set is a no-op and its catch returns early, so the status stays
      // undefined. Defensive rather than observed (FIX_ROUND-8): the shipped
      // provider never deletes an entry, and the `not-registered` state already
      // describes the no-entry case at higher precedence. Kept because the seam's
      // contract permits `status()` to return undefined, so a conforming provider
      // that DOES delete on resolve must not read as success here.
      // Only judge the outcome when the provider HELD an entry to judge it by
      // (FIX_ROUND-9). With no entry, its optimistic update is a no-op and the
      // status stays `undefined` — but the POST still went out and the suspended
      // script still resumed, so recording that as a failure marks a SUCCESSFUL
      // approve as failed. `not-registered` already describes that card, and the
      // self-heal is what resolves it.
      const after = elicitationStatus(data.elicitation_id)
      const hadEntry = elicitationExists(data.elicitation_id)
      if (!carried || (hadEntry && after === 'pending')) setResolveFailed(true)
    } finally {
      setSubmitting(false)
    }
  }

  const icon =
    resolved === 'approved' ? <Check /> : resolved === 'denied' ? <X /> : <Clock />

  return (
    <div className="my-2" data-testid={`run-js-approval-${data.elicitation_id}`}>
      <Alert
        tone={resolved === 'approved' ? 'success' : resolved === 'denied' ? 'neutral' : 'warning'}
        data-testid={`run-js-approval-alert-${data.elicitation_id}`}
        icon={icon}
        title={
          <div>
            <Text strong>run_js wants to call: {data.tool_name}</Text>
            {serverParenLabel(data.server) && (
              <Text type="secondary" className="ms-2 text-xs whitespace-nowrap">
                {serverParenLabel(data.server)}
              </Text>
            )}
          </div>
        }
        description={
          <div className="mt-2">
            <Text className="text-sm">
              A running script wants to call this tool. Approve to let the script continue.
            </Text>
            {data.input !== undefined && (
              <div className="mt-2">
                <Text strong className="text-xs">
                  Arguments:
                </Text>
                <pre className="p-2 rounded mt-1 overflow-auto max-h-40 text-xs bg-muted">
                  {JSON.stringify(data.input, null, 2)}
                </pre>
              </div>
            )}
            {/*
              ONE live region, mounted for the whole life of the card, whose
              CONTENTS change (FIX_ROUND-4). A `role=status` element that enters
              the accessibility tree already carrying its text is announced
              unreliably by NVDA/JAWS/VoiceOver — the region has to pre-exist the
              change. It is also the focus target when the buttons unmount, hence
              `tabIndex={-1}` and a focus-visible ring (FIX_ROUND-5: `outline-none`
              alone left the programmatic focus move invisible to a sighted
              keyboard user, reading as an unexplained viewport jump).
            */}
            <Text
              ref={statusRef}
              id={statusId}
              tabIndex={-1}
              role="status"
              // `danger` only for the states that genuinely stop the user
              // (FIX_ROUND-9). `not-registered` is transient, self-healing and
              // explicitly answerable — painting it in the destructive red
              // DESIGN_SYSTEM.md reserves for errors contradicted its own copy.
              type={
                !resolved && (blocked === 'no-transport' || blocked === 'resolve-failed')
                  ? 'danger'
                  : 'secondary'
              }
              className="mt-2 block text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm"
              data-testid={statusId}
              data-status={resolved ?? blocked ?? 'pending'}
            >
              {resolved === 'approved'
                ? 'Approved — script resumed.'
                : resolved === 'denied'
                  ? 'Denied.'
                  : blocked === 'no-transport'
                    ? 'This request cannot be answered right now — the approval channel is unavailable. It will become answerable on its own once the connection is back, or reload the conversation.'
                    : blocked === 'not-registered'
                      ? 'Reopening this request — you can still answer it.'
                      : blocked === 'resolve-failed'
                        ? "That didn't go through — try again."
                        : ''}
            </Text>
            {resolved === null && (
              <div className="mt-3">
                <Space>
                  {/*
                    Disabled ONLY when there is no transport, and explained by
                    `aria-describedby` -> the status region above.
                    FIX_ROUND-6: the tooltip FIX_ROUND-5 added is REMOVED, for two
                    reasons the kit made unavoidable. (a) kit Button derives
                    `aria-label` from a string `tooltip` UNCONDITIONALLY, so both
                    controls announced as "The approval channel is unavailable
                    right now" and became indistinguishable to a screen reader —
                    the a11y "fix" was an a11y REGRESSION (WCAG 2.5.3 / 4.1.2).
                    (b) it could never render anyway: `disabled` becomes the native
                    attribute and the base class carries
                    `disabled:pointer-events-none`, so the trigger gets neither
                    hover nor focus. (The repo's own `SettingsFormActions`
                    documents the focusable-wrapper pattern for when a tooltip on
                    a disabled control is genuinely required; it is not here,
                    because the reason is already on screen in the status region
                    this points at.) `aria-describedby` is set only when there IS
                    something to describe.
                  */}
                  <Button
                    icon={<Check />}
                    onClick={() => resolve('accept')}
                    loading={submitting}
                    disabled={elicitationIsUnactionable(blocked)}
                    aria-describedby={blocked ? statusId : undefined}
                    size="default"
                    data-testid={`run-js-approval-approve-${data.elicitation_id}`}
                  >
                    Approve
                  </Button>
                  <Button
                    variant="destructive"
                    icon={<X />}
                    onClick={() => resolve('decline')}
                    loading={submitting}
                    disabled={elicitationIsUnactionable(blocked)}
                    aria-describedby={blocked ? statusId : undefined}
                    size="default"
                    data-testid={`run-js-approval-deny-${data.elicitation_id}`}
                  >
                    Deny
                  </Button>
                </Space>
              </div>
            )}
          </div>
        }
      />
    </div>
  )
}
