import type { BeforeSendResult } from '@/modules/chat/core/extensions/types'

/**
 * Cancel-severity resolution for the `beforeSendMessage` aggregation.
 *
 * An extension can veto a send by returning `{ cancel: true }`. There are two
 * KINDS of veto and they must not be conflated:
 *
 *  - **loud** (the default, and what every pre-existing extension returns) — the
 *    send was blocked by something the user needs to know about (an upload still
 *    in flight, an unmet precondition). `sendMessage` throws so the caller can
 *    surface it. Losing this would be the "silently swallow" failure
 *    CODING_GUIDELINES §6 forbids.
 *  - **silent** (`{ cancel: true, silent: true }`) — the submit was a NO-OP, not
 *    a failure. The only case today is an empty composer: the user pressed Enter
 *    with nothing typed, so there is no outcome to report. `sendMessage` returns
 *    without throwing and without touching state.
 *
 * The whole point of keeping `silent` opt-in PER CANCEL REASON is that the quiet
 * path can never widen to cover a real error. Hence the resolution rule below:
 *
 *   **fail-loud wins** — if ANY surviving veto is loud, the aggregate is loud,
 *   regardless of how many silent vetoes accompany it.
 *
 * Pure + side-effect free so the severity algebra is unit-testable without a
 * store, a registry, or a rendered component.
 */

/** The aggregate verdict of every extension's `beforeSendMessage`. */
export interface CancelDecision {
  /** True when at least one surviving (non-discarded) extension vetoed. */
  cancel: boolean
  /**
   * True only when EVERY surviving veto was silent. A silent decision means
   * "nothing happened" — no throw, no toast, no state change.
   */
  silent: boolean
  /** The loud veto's message when there is one; else the silent veto's (if any). */
  errorMessage?: string
  /** Name of the extension whose veto won — for logging/diagnostics only. */
  cancelledBy?: string
}

const NO_CANCEL: CancelDecision = { cancel: false, silent: false }

/**
 * Resolve the surviving vetoes into one decision.
 *
 * @param results  `[extensionName, result]` pairs in extension order.
 * @param discarded  Names whose veto another extension explicitly overrode via
 *                   `discardCancel` — these are skipped entirely.
 */
export function resolveCancel(
  results: Iterable<readonly [string, BeforeSendResult]>,
  discarded: ReadonlySet<string> = new Set(),
): CancelDecision {
  let firstSilent: CancelDecision | null = null

  for (const [name, result] of results) {
    if (!result?.cancel || discarded.has(name)) continue

    if (!result.silent) {
      // Loud veto — wins immediately, no need to look further.
      return {
        cancel: true,
        silent: false,
        errorMessage: result.errorMessage,
        cancelledBy: name,
      }
    }

    // Silent veto — remember the first, but keep scanning: a later loud veto
    // must still win (this is the fail-loud-wins rule).
    firstSilent ??= {
      cancel: true,
      silent: true,
      errorMessage: result.errorMessage,
      cancelledBy: name,
    }
  }

  return firstSilent ?? NO_CANCEL
}

/**
 * Merge a flat list of results (no per-extension names, no `discardCancel`) —
 * the shape `mergeBeforeSendResults` works with. Same severity rule.
 */
export function mergeCancelDecision(
  results: readonly BeforeSendResult[],
): CancelDecision {
  return resolveCancel(results.map((r, i) => [String(i), r] as const))
}
