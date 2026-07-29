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
 *     (`content` / `model_id` / `branch_id`) — nothing checked before the POST.
 *
 * Either way the user saw a raw `422 missing field \`model_id\`` and had no idea
 * what to do about it. This module is the single place that turns both into ONE
 * actionable message, and it is pure (no React, no store, no JSX) so the message
 * text is unit-testable on its own — the same shape as this directory's
 * `beforeSendCancel.ts` and the send path's `sendFailureState.ts`.
 *
 * ── The advice must MATCH the cause ─────────────────────────────────────────
 * The first draft appended "Reload the page and try again." to every failure.
 * That is wrong for the single most likely real trigger: the model extension
 * throws `No model selected` whenever the picker has no selection and there is
 * no default (a fresh install, or an admin unassigning the provider group), and
 * reloading cannot fix it — the user needs to pick a model. So the reload advice
 * is emitted ONLY when a cause actually looks like a failed code-split load
 * (`isLoadFailureCause`) or the page is already known to be running against a
 * stale build. Otherwise the cause speaks for itself and no remediation is
 * invented.
 */

/** Shown when a thrown contributor error carries no usable message. */
export const UNKNOWN_CAUSE = 'an unknown error'

/** The recovery step — appended ONLY for a load-failure cause (see above). */
export const RECOVERY_HINT = 'Reload the page and try again.'

/**
 * Added when this page is running against a build the server no longer fully
 * serves — what a deploy-while-a-tab-is-open produces. Also gated on the cause
 * actually being a load failure, so a stale mark from one blip earlier in the
 * session cannot attach itself to an unrelated failure hours later.
 */
export const STALE_BUILD_HINT =
  'The app may have been updated since this tab was opened.'

/**
 * A cause message longer than this is truncated before it reaches the UI.
 *
 * Causes are arbitrary thrown values from any layer: a contributor may await a
 * lazy store action that hits the API, and the api-client formats a failure as
 * `HTTP error! status: <n> - <raw response body>`. An unbounded server body
 * would otherwise become an unbounded toast.
 */
export const MAX_CAUSE_CHARS = 160

/** One contributor's failure. */
export interface RequestFieldFailure {
  /** The extension whose `composeRequestFields` threw. */
  extension: string
  /** Whatever it threw (any shape — this comes from a catch block). */
  cause: unknown
}

/** Extract a human-usable, length-capped message from an arbitrary thrown value. */
function causeText(cause: unknown): string {
  const raw =
    cause instanceof Error && cause.message.trim()
      ? cause.message.trim()
      : typeof (cause as { message?: unknown } | null | undefined)?.message === 'string' &&
          (cause as { message: string }).message.trim()
        ? (cause as { message: string }).message.trim()
        : typeof cause === 'string' && cause.trim()
          ? cause.trim()
          : UNKNOWN_CAUSE
  return raw.length > MAX_CAUSE_CHARS ? `${raw.slice(0, MAX_CAUSE_CHARS - 1)}…` : raw
}

/**
 * True when a thrown value looks like a failed dynamic import / code-split load
 * — the ONLY class of failure a page reload actually fixes.
 *
 * Matched on the message text because the browsers and bundlers involved throw
 * plain `TypeError`s with no structured discriminator: Chromium/WebKit say
 * "Failed to fetch dynamically imported module", Firefox "error loading
 * dynamically imported module", older Safari "Importing a module script
 * failed", and Vite's own preload helper "Unable to preload CSS for …". The
 * dispatcher's own give-up message is matched too.
 */
export function isLoadFailureCause(cause: unknown): boolean {
  const text =
    cause instanceof Error
      ? cause.message
      : typeof cause === 'string'
        ? cause
        : typeof (cause as { message?: unknown } | null | undefined)?.message === 'string'
          ? (cause as { message: string }).message
          : ''
  // Every alternative is a SPECIFIC phrase. A bare `chunk` was tried and removed:
  // this app surfaces the word in ordinary domain errors (file/RAG chunking,
  // `file_chunks`), and an API error body reaches this function verbatim — so a
  // server-side chunking failure would have been handed "reload the page", the
  // exact mis-advice this predicate exists to prevent.
  return /dynamically imported module|Importing a module script failed|Unable to preload|resolved with no module|loading chunk .* failed|chunk load failed/i.test(
    text,
  )
}

/** Compose the trailing advice for a set of causes. */
function advice(causes: unknown[], stale: boolean): string {
  if (!causes.some(isLoadFailureCause)) return ''
  return stale ? ` ${STALE_BUILD_HINT} ${RECOVERY_HINT}` : ` ${RECOVERY_HINT}`
}

/**
 * Build the user-facing message for a set of contributor failures.
 *
 * Pure apart from the stale-build read, which is injectable so tests do not
 * depend on module-scope state.
 */
export function buildCompositionFailureMessage(
  failures: RequestFieldFailure[],
  stale: boolean = isStaleBuild(),
): string {
  const head =
    failures.length === 1
      ? `Couldn't prepare your message: the "${failures[0].extension}" chat extension failed: ${causeText(failures[0].cause)}`
      : `Couldn't prepare your message: ${failures.length} chat extensions failed — ${failures
          .map(f => `"${f.extension}": ${causeText(f.cause)}`)
          .join('; ')}`
  return `${head}.${advice(failures.map(f => f.cause), stale)}`
}

/**
 * Build the user-facing message for a composed body that is missing a field the
 * server declares required.
 *
 * The reload advice is gated on the stale mark, for the same reason it is gated
 * on the cause above: a missing field is USUALLY a contributor that failed to
 * load, but not always. `branch_id` in particular can be genuinely absent — the
 * server declares `Conversation.active_branch_id` optional — and telling that
 * user to reload just refetches the same row and loops them. When the page is
 * NOT known to be running against a stale build, the message states what is
 * missing and stops there.
 */
export function buildMissingFieldMessage(
  missing: string[],
  stale: boolean = isStaleBuild(),
): string {
  const head = `Couldn't send your message: it is missing ${missing.join(' and ')}.`
  return stale ? `${head} ${STALE_BUILD_HINT} ${RECOVERY_HINT}` : head
}

/**
 * Thrown by `composeRequestFields` when ANY contributor failed, and by
 * `assertRequiredRequestFields` below.
 *
 * `message` is already the string the user should see — the composers'
 * `message.error(...)` and the conversation error Alert both render it verbatim.
 * `failures` / `missingFields` carry the STRUCTURED detail for the log (the send
 * path logs them; the user-facing string deliberately does not carry a stack).
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

/**
 * The fields the server declares REQUIRED on `SendMessageRequest`, paired with
 * the label the user sees when one is absent.
 *
 * Kept HERE, next to the sentence that renders them, so adding a required field
 * is one edit in one table rather than a change split across the action body and
 * this module. `branch_id` is included: the generated client type makes
 * `Conversation.active_branch_id` optional while the server declares it a
 * `Uuid`, so an absent one used to POST `branch_id: ""` and come back as exactly
 * the raw 422 this whole change removes.
 */
const REQUIRED_SEND_FIELDS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'content', label: 'the message text' },
  { key: 'model_id', label: 'a model selection' },
  { key: 'branch_id', label: 'a conversation branch' },
]

/**
 * Throw unless the composed body carries every server-required field.
 *
 * PRESENCE + type only. An empty `content` is legitimate at this layer (an
 * attachment-only turn, a tool-approval resume); "the composer is empty" is
 * `beforeSendMessage`'s veto, not this guard's. `model_id` / `branch_id` are
 * ids, so an empty/blank string is treated as absent — the server would reject
 * it as an invalid Uuid.
 */
export function assertRequiredRequestFields(
  body: Record<string, unknown>,
  keys: ReadonlyArray<string> = REQUIRED_SEND_FIELDS.map(f => f.key),
): void {
  const missing = REQUIRED_SEND_FIELDS.filter(({ key }) => {
    if (!keys.includes(key)) return false
    const value = body[key]
    if (typeof value !== 'string') return true
    return key === 'content' ? false : !value.trim()
  }).map(({ label }) => label)

  if (missing.length > 0) {
    throw new RequestFieldCompositionError(buildMissingFieldMessage(missing), {
      missingFields: missing,
    })
  }
}
