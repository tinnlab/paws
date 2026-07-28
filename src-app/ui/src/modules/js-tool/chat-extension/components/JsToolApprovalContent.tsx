import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Alert, Button, Space, Text } from '@ziee/kit'
import { Check, Clock, X } from 'lucide-react'
import type { ContentRendererProps } from '@/modules/chat/core/extensions/types'
import { serverParenLabel } from '@/modules/chat/core/utils/serverLabel'
import {
  elicitationStatus,
  elicitationVersion,
  hasElicitationTransport,
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
interface JsToolApprovalData {
  elicitation_id: string
  tool_name: string
  server: string
  input?: Record<string, unknown>
  /** Set by the SSE handler when the elicitation could not be REGISTERED at all
   *  (no transport, or the provider's `register` threw). The card is injected
   *  unconditionally, so without this it would render live buttons over an
   *  elicitation the provider has no entry for. */
  unresolvable?: boolean
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
  useSyncExternalStore(subscribeElicitation, elicitationVersion, elicitationVersion)
  const status = elicitationStatus(data.elicitation_id)
  const resolved: 'approved' | 'denied' | null =
    status === 'accepted' ? 'approved' : status === 'declined' || status === 'cancelled' ? 'denied' : null

  /**
   * FIX_ROUND-4: the decision genuinely cannot be carried — either the SSE
   * handler could not register it at all, or the transport is gone now, or a
   * resolve attempt came back `false`. Derived (not latched) from
   * `hasElicitationTransport()`, which re-reads on every seam bump, so the
   * banner CLEARS by itself the moment mcp installs a transport rather than
   * stranding the card behind a message that is no longer true.
   */
  const unresolvable = data.unresolvable === true || resolveFailed || !hasElicitationTransport()

  /**
   * Focus the outcome when the buttons unmount. Without this, resolving destroys
   * the focused element and focus falls to `<body>` — a keyboard or
   * screen-reader user loses their place in a long transcript. Focusing a
   * `tabIndex={-1}` live region both restores position AND makes the outcome
   * announced reliably, which a region mounted together with its own text is
   * not (the region must pre-exist the text change — see the always-mounted
   * container below).
   */
  const wasResolved = useRef<'approved' | 'denied' | null>(null)
  useEffect(() => {
    if (resolved && !wasResolved.current) statusRef.current?.focus()
    wasResolved.current = resolved
  }, [resolved])

  const resolve = async (action: 'accept' | 'decline') => {
    // Re-entrancy guard: never POST twice to a single-use elicitation.
    if (submitting || resolved !== null || unresolvable) return
    setSubmitting(true)
    setResolveFailed(false)
    try {
      // The transport reflects success/failure in its own entry; the derived
      // `resolved` above reacts (rollback → buttons return for retry). A `false`
      // return means the decision never left the browser at all — a different
      // failure from "the POST was rejected", and the only one the transport can
      // report, so it gets its own user-visible message.
      const carried = await resolveElicitationVia(data.elicitation_id, action)
      if (!carried) setResolveFailed(true)
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
              `tabIndex={-1}` and `outline-none`.
            */}
            <Text
              ref={statusRef}
              tabIndex={-1}
              role="status"
              type={unresolvable && !resolved ? 'danger' : 'secondary'}
              className="mt-2 block text-xs outline-none"
              data-testid={`run-js-approval-status-${data.elicitation_id}`}
              data-status={resolved ?? (unresolvable ? 'unresolvable' : 'pending')}
            >
              {resolved === 'approved'
                ? 'Approved — script resumed.'
                : resolved === 'denied'
                  ? 'Denied.'
                  : unresolvable
                    ? 'This request cannot be answered right now — the approval channel is unavailable. Reload the conversation and try again.'
                    : ''}
            </Text>
            {resolved === null && (
              <div className="mt-3">
                <Space>
                  {/*
                    DISABLED, not merely explained (FIX_ROUND-4). The first cut
                    rendered the notice above live, still-clickable buttons —
                    contradicting this seam's own docstring ("disable + explain")
                    and leaving the user clicking a control that spins and does
                    nothing, which is the exact symptom being fixed.
                  */}
                  <Button
                    icon={<Check />}
                    onClick={() => resolve('accept')}
                    loading={submitting}
                    disabled={unresolvable}
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
                    disabled={unresolvable}
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
