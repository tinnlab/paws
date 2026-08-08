import type {
  MessageContent,
  MessageContentDataText,
  MessageWithContent,
} from '@/api-client/types'

// Does a single content block count as a **user-visible answer**?
//
// Mirrors the backend `is_visible_answer` (server `streaming.rs`): a `thinking`
// block and an empty/whitespace `text` block do NOT count — they are what make a
// turn *appear* to hang with nothing shown. Every other content type
// (`tool_use` / `tool_result` / `image` / `file_attachment` /
// `elicitation_request` / …) is a visible answer.
export function isVisibleAnswerBlock(block: MessageContent): boolean {
  switch (block.content_type) {
    case 'thinking':
      return false
    case 'text':
      return ((block.content as MessageContentDataText).text ?? '').trim().length > 0
    default:
      return true
  }
}

// True when an assistant message produced a user-visible answer. A finalised
// assistant turn for which this is false is the "empty completion" case (only
// reasoning, or nothing) — the caller surfaces an inline notice instead of
// rendering nothing.
export function hasVisibleAnswer(message: MessageWithContent): boolean {
  return (message.contents ?? []).some(isVisibleAnswerBlock)
}

// Whether to render the inline "empty completion" notice for a message.
//
// Only for a FINALISED assistant turn (`!isStreaming`, so a live turn that
// momentarily has only a thinking block never flashes the notice) that produced
// no visible answer — AND was not `interrupted` (a user-cancelled / stream-
// errored / aborted turn is a partial, not a genuine empty completion, so the
// notice would misattribute the cause; the caller passes the store's
// per-turn interruption signal) — AND is not `finalizing` (the sub-second
// streaming→persisted handoff window: `isStreaming` has flipped false but the
// persisted tail may not be swapped in yet, so a transient empty assistant frame
// must not flash the notice; the caller passes the store's `finalizingTurn`).
export function shouldShowEmptyCompletionNotice(opts: {
  isUser: boolean
  isStreaming: boolean
  interrupted: boolean
  finalizing: boolean
  message: MessageWithContent
}): boolean {
  const { isUser, isStreaming, interrupted, finalizing, message } = opts
  return (
    !isUser &&
    !isStreaming &&
    !interrupted &&
    !finalizing &&
    !hasVisibleAnswer(message)
  )
}

// WHY an answerless turn produced no answer. Mirrors the server-written closed
// vocabulary persisted on `messages.completion_state` (see the Rust
// `CompletionState`): the server classifies at finalize time and persists, so
// this survives a reload — which is the whole point, because the notice is
// derived at render time from persisted state.
//
// `unknown` is the honest fallback for a row written before the column existed
// (deliberately NOT backfilled — the cause was unrecoverable for historical
// rows) or for a value a newer server added that this client doesn't know yet.
// It degrades to the original generic copy rather than guessing a cause.
export type EmptyCompletionCause = 'budget_truncated' | 'aborted' | 'empty' | 'unknown'

export function emptyCompletionCause(message: MessageWithContent): EmptyCompletionCause {
  // Raw column text, parsed permissively: an unrecognized value must degrade,
  // never throw and never be presented as a confident diagnosis.
  const state = (message as { completion_state?: string }).completion_state
  switch (state) {
    case 'budget_truncated':
    case 'aborted':
    case 'empty':
      return state
    default:
      return 'unknown'
  }
}

// The user-facing copy for each cause, and the Alert tone it carries.
//
// The rule this encodes (INV-3): NEVER advise a retry for a cause that an
// identical retry reproduces. A budget-truncated turn is deterministic — the
// same request re-runs into the same cap — so telling the user to "try again"
// sends them into a loop. It names the two settings that actually resolve it
// instead. A genuinely-empty turn IS worth retrying, so there the retry advice
// stays.
export function emptyCompletionNotice(cause: EmptyCompletionCause): {
  tone: 'warning' | 'info'
  description: string
} {
  switch (cause) {
    case 'budget_truncated':
      return {
        tone: 'warning',
        description:
          'The model spent its entire token budget on reasoning and stopped before it produced an answer. ' +
          "Raise this model's max tokens, or lower its reasoning effort, to give the answer room.",
      }
    case 'aborted':
      return {
        tone: 'info',
        description: 'This turn was stopped before the model produced an answer.',
      }
    case 'empty':
      return {
        tone: 'warning',
        description:
          'The model returned an empty response and made no tool call. Please try again.',
      }
    default:
      // Pre-existing rows (no recorded cause) keep the original wording.
      return {
        tone: 'warning',
        description:
          'The model returned an empty response and made no tool call. Please try again.',
      }
  }
}
