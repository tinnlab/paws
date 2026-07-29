import { isStaleBuild } from '@ziee/framework/chunk-recovery'

/**
 * The ONE failure shape for a broken outgoing-request composition.
 *
 * Two distinct things can leave the chat send request structurally invalid, and
 * both used to be silent:
 *
 *  1. a `composeRequestFields` CONTRIBUTOR threw — the registry caught it,
 *     `console.error`'d, and returned fields silently missing that
 *     contributor's keys;
 *  2. the composed body simply lacked a field the server declares required
 *     (`content` / `model_id`) — nothing checked before the POST.
 *
 * Either way the user saw a raw `422 missing field \`model_id\`` and had no idea
 * that reloading the page was the cure. This module is the single place that
 * turns both into ONE actionable message, and it is pure (no React, no store, no
 * JSX) so the message text is unit-testable on its own — the same shape as this
 * directory's `beforeSendCancel.ts` and the send path's `sendFailureState.ts`.
 */

/** Shown when a thrown contributor error carries no usable message. */
export const UNKNOWN_CAUSE = 'an unknown error'

/** The recovery step, appended to every composition-failure message. */
export const RECOVERY_HINT = 'Reload the page and try again.'

/**
 * Added when a code-split chunk has failed to load in this page's lifetime —
 * i.e. the page is running against a build the server no longer fully serves,
 * which is what a deploy-while-a-tab-is-open produces. That is the one piece of
 * WHY the user cannot infer from the failure itself.
 */
export const STALE_BUILD_HINT =
  'The app may have been updated since this tab was opened.'

/** One contributor's failure. */
export interface RequestFieldFailure {
  /** The extension whose `composeRequestFields` threw. */
  extension: string
  /** Whatever it threw (any shape — this comes from a catch block). */
  cause: unknown
}

/** Extract a human-usable message from an arbitrary thrown value. */
function causeText(cause: unknown): string {
  if (cause instanceof Error && cause.message.trim()) return cause.message.trim()
  const m = (cause as { message?: unknown } | null | undefined)?.message
  if (typeof m === 'string' && m.trim()) return m.trim()
  if (typeof cause === 'string' && cause.trim()) return cause.trim()
  return UNKNOWN_CAUSE
}

/**
 * Build the user-facing message for a set of contributor failures.
 *
 * Pure apart from the stale-build read, which is injectable so the test does not
 * depend on module-scope state.
 */
export function buildCompositionFailureMessage(
  failures: RequestFieldFailure[],
  stale: boolean = isStaleBuild(),
): string {
  const detail = failures
    .map(f => `${f.extension} (${causeText(f.cause)})`)
    .join(', ')
  const head =
    failures.length === 1
      ? `Couldn't prepare your message: the ${detail} chat extension failed.`
      : `Couldn't prepare your message: ${failures.length} chat extensions failed — ${detail}.`
  return stale ? `${head} ${STALE_BUILD_HINT} ${RECOVERY_HINT}` : `${head} ${RECOVERY_HINT}`
}

/**
 * Build the user-facing message for a composed body that is missing a field the
 * server declares required.
 */
export function buildMissingFieldMessage(
  missing: string[],
  stale: boolean = isStaleBuild(),
): string {
  const head = `Couldn't send your message: it is missing ${missing.join(', ')}.`
  return stale ? `${head} ${STALE_BUILD_HINT} ${RECOVERY_HINT}` : `${head} ${RECOVERY_HINT}`
}

/**
 * Thrown by `composeRequestFields` when ANY contributor failed, and by the send
 * path's pre-POST required-field check.
 *
 * Carries the structured failures so a caller can log them, while `message` is
 * already the string the user should see — the composers' `message.error(...)`
 * and the conversation error Alert both render it verbatim.
 */
export class RequestFieldCompositionError extends Error {
  readonly failures: RequestFieldFailure[]
  /** Field names the server requires that the composed body did not carry. */
  readonly missingFields: string[]

  constructor(
    message: string,
    opts: { failures?: RequestFieldFailure[]; missingFields?: string[] } = {},
  ) {
    super(message)
    this.name = 'RequestFieldCompositionError'
    this.failures = opts.failures ?? []
    this.missingFields = opts.missingFields ?? []
  }
}
