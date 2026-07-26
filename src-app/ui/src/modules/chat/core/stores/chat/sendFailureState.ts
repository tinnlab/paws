/**
 * The ONE recovery shape a failed send resets the chat store to.
 *
 * Extracted as a pure function because the same reset is now reached from more
 * than one failure site, and a second, subtly-different reset vocabulary is
 * exactly how a store ends up half-recovered — `sending` cleared but
 * `isStreaming` left true, so the composer re-enables while the spinner runs
 * forever.
 *
 * A wedged `isStreaming` is worse than a stuck spinner: the reconnect resync in
 * `chat/index.ts` bails while `isStreaming` is true (`reloadOpen`), so the view
 * cannot self-heal even once the stream comes back. Every field below is
 * therefore cleared together, deliberately.
 */
export interface SendFailureState {
  error: string | null
  sending: boolean
  isStreaming: boolean
  streamingMessage: null
  streamingAbortController: null
  streamingMessageId: null
  finalizingTurn: boolean
  lastTurnInterrupted: boolean
}

/** Default surfaced text when a thrown value carries no usable message. */
export const SEND_FAILED_FALLBACK_MESSAGE = 'Failed to send message'

/** True for a user-initiated cancel (stop button / navigation abort). */
export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

/**
 * Build the reset.
 *
 * @param error    the thrown value (any shape — this is a catch block).
 * @returns the full recovery patch. An abort carries `error: null` (the user
 *          asked for it; it is not an incident to report), everything else
 *          carries a non-empty message so the error Alert has something to
 *          render — never an empty string, which would render a blank alert.
 */
export function buildSendFailureState(error: unknown): SendFailureState {
  const aborted = isAbortError(error)
  const raw =
    error instanceof Error
      ? error.message
      : typeof (error as { message?: unknown })?.message === 'string'
        ? (error as { message: string }).message
        : ''
  return {
    error: aborted ? null : raw.trim() || SEND_FAILED_FALLBACK_MESSAGE,
    sending: false,
    isStreaming: false,
    streamingMessage: null,
    streamingAbortController: null,
    streamingMessageId: null,
    finalizingTurn: false,
    // Aborted (user cancel) or a transport error — either way the turn's
    // partial is not a genuine empty completion.
    lastTurnInterrupted: true,
  }
}
