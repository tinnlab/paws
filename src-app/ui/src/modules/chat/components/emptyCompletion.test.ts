import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { MessageContent, MessageWithContent } from '@/api-client/types'
import {
  emptyCompletionCause,
  emptyCompletionNotice,
  hasVisibleAnswer,
  isVisibleAnswerBlock,
  shouldShowEmptyCompletionNotice,
} from './emptyCompletion.ts'

// Minimal content-block factory (only the fields the predicate reads).
function block(content_type: string, content: unknown = {}): MessageContent {
  return {
    id: `blk-${content_type}`,
    message_id: 'm',
    content_type,
    content: content as MessageContent['content'],
    sequence_order: 0,
    created_at: '',
    updated_at: '',
  } as MessageContent
}

function assistant(contents: MessageContent[]): MessageWithContent {
  return { message: {}, contents } as unknown as MessageWithContent
}

test('isVisibleAnswerBlock: reasoning-only / empty text are NOT visible', () => {
  assert.equal(isVisibleAnswerBlock(block('thinking', { thinking: 'x' })), false)
  assert.equal(isVisibleAnswerBlock(block('text', { text: '' })), false)
  assert.equal(isVisibleAnswerBlock(block('text', { text: '   \n\t ' })), false)
})

test('isVisibleAnswerBlock: real answers ARE visible', () => {
  assert.equal(isVisibleAnswerBlock(block('text', { text: 'hi' })), true)
  assert.equal(isVisibleAnswerBlock(block('tool_use', {})), true)
  assert.equal(isVisibleAnswerBlock(block('tool_result', {})), true)
  assert.equal(isVisibleAnswerBlock(block('image', {})), true)
  assert.equal(isVisibleAnswerBlock(block('file_attachment', {})), true)
})

test('hasVisibleAnswer: false for a thinking-only or empty message', () => {
  assert.equal(hasVisibleAnswer(assistant([block('thinking', { thinking: 'reasoning' })])), false)
  assert.equal(hasVisibleAnswer(assistant([])), false)
})

test('hasVisibleAnswer: true when any visible block is present', () => {
  assert.equal(
    hasVisibleAnswer(assistant([block('thinking', { thinking: 'r' }), block('text', { text: 'answer' })])),
    true,
  )
  assert.equal(hasVisibleAnswer(assistant([block('tool_use', {})])), true)
})

const thinkingOnly = assistant([block('thinking', { thinking: 'reasoning' })])
const withAnswer = assistant([block('text', { text: 'answer' })])

test('shouldShowEmptyCompletionNotice: shows for a finalised, non-interrupted, answerless assistant turn', () => {
  assert.equal(
    shouldShowEmptyCompletionNotice({
      isUser: false,
      isStreaming: false,
      interrupted: false,
      finalizing: false,
      message: thinkingOnly,
    }),
    true,
  )
  // Fully-empty finalised assistant turn too.
  assert.equal(
    shouldShowEmptyCompletionNotice({
      isUser: false,
      isStreaming: false,
      interrupted: false,
      finalizing: false,
      message: assistant([]),
    }),
    true,
  )
})

test('shouldShowEmptyCompletionNotice: suppressed while streaming, for users, when interrupted, or when an answer exists', () => {
  // Live streaming turn (momentarily thinking-only) must not flash the notice.
  assert.equal(
    shouldShowEmptyCompletionNotice({ isUser: false, isStreaming: true, interrupted: false, finalizing: false, message: thinkingOnly }),
    false,
  )
  // User messages never show it.
  assert.equal(
    shouldShowEmptyCompletionNotice({ isUser: true, isStreaming: false, interrupted: false, finalizing: false, message: thinkingOnly }),
    false,
  )
  // Cancelled / errored / aborted turns are partials, not empty completions.
  assert.equal(
    shouldShowEmptyCompletionNotice({ isUser: false, isStreaming: false, interrupted: true, finalizing: false, message: thinkingOnly }),
    false,
  )
  // A turn that produced an answer never shows it.
  assert.equal(
    shouldShowEmptyCompletionNotice({ isUser: false, isStreaming: false, interrupted: false, finalizing: false, message: withAnswer }),
    false,
  )
})

test('shouldShowEmptyCompletionNotice: suppressed during the streaming→persisted handoff (finalizing)', () => {
  // The sub-second handoff window: isStreaming has flipped false but the
  // persisted tail may not be swapped in yet — a transient empty assistant frame
  // must NOT flash the notice.
  assert.equal(
    shouldShowEmptyCompletionNotice({ isUser: false, isStreaming: false, interrupted: false, finalizing: true, message: thinkingOnly }),
    false,
  )
  assert.equal(
    shouldShowEmptyCompletionNotice({ isUser: false, isStreaming: false, interrupted: false, finalizing: true, message: assistant([]) }),
    false,
  )
  // Once the turn is finalised (finalizing back to false) a GENUINELY-empty turn
  // still surfaces the notice — the handoff gate must not permanently hide it.
  assert.equal(
    shouldShowEmptyCompletionNotice({ isUser: false, isStreaming: false, interrupted: false, finalizing: false, message: thinkingOnly }),
    true,
  )
})

// ---------------------------------------------------------------------------
// TEST-3 [acceptance, INV-1] — a budget-truncated turn and a genuinely-empty
// turn MUST NOT present identically.
//
// This is the whole defect. Before the fix there was ONE string for every
// answerless turn, so these two cases were indistinguishable to the user — and
// the advice it gave ("Please try again") is deterministically wrong for the
// truncated case, which was ~53% of them on the live corpus.
//
// Note the content blocks are IDENTICAL across the two cases below (a single
// thinking block). The ONLY difference is the server-persisted cause, which is
// exactly the point: the blocks cannot tell them apart, so the cause has to be
// carried and it has to survive a reload.
// ---------------------------------------------------------------------------

function answerless(completion_state?: string): MessageWithContent {
  return {
    message: {},
    contents: [block('thinking', { thinking: 'a long chain of reasoning' })],
    completion_state,
  } as unknown as MessageWithContent
}

test('TEST-3 [acceptance/INV-1]: truncated vs empty vs aborted are DISTINCT presentations', () => {
  const truncated = emptyCompletionNotice(emptyCompletionCause(answerless('budget_truncated')))
  const empty = emptyCompletionNotice(emptyCompletionCause(answerless('empty')))
  const aborted = emptyCompletionNotice(emptyCompletionCause(answerless('aborted')))

  // The invariant, asserted directly: identical blocks, different presentation.
  assert.notEqual(truncated.description, empty.description)
  assert.notEqual(truncated.description, aborted.description)
  assert.notEqual(empty.description, aborted.description)

  // …and each names its own cause rather than being generically different.
  assert.match(truncated.description, /token budget/i)
  assert.match(truncated.description, /max tokens|reasoning effort/i)
  assert.match(aborted.description, /stopped/i)
  assert.match(empty.description, /empty response/i)
})

test('TEST-3 [acceptance/INV-3]: the truncated turn does NOT advise a bare retry', () => {
  const truncated = emptyCompletionNotice(emptyCompletionCause(answerless('budget_truncated')))
  // An identical retry re-truncates against the same cap, so this advice would
  // send the user into a loop. Refusing it is the invariant.
  assert.ok(
    !/please try again/i.test(truncated.description),
    `budget-truncated copy must not tell the user to retry: ${truncated.description}`,
  )
  // A genuinely-empty turn IS worth retrying — so the retry advice must survive
  // there. This is the negative control: it proves the assertion above is about
  // the CAUSE and not just a blanket removal of the phrase.
  const empty = emptyCompletionNotice(emptyCompletionCause(answerless('empty')))
  assert.match(empty.description, /please try again/i)
})

test('emptyCompletionCause: parses the closed vocabulary and degrades safely', () => {
  assert.equal(emptyCompletionCause(answerless('budget_truncated')), 'budget_truncated')
  assert.equal(emptyCompletionCause(answerless('aborted')), 'aborted')
  assert.equal(emptyCompletionCause(answerless('empty')), 'empty')
  // A row written before the column existed (deliberately not backfilled).
  assert.equal(emptyCompletionCause(answerless(undefined)), 'unknown')
  // A value a newer server added that this client doesn't know yet — must not
  // throw and must not be presented as a confident diagnosis.
  assert.equal(emptyCompletionCause(answerless('some_future_state')), 'unknown')
  // …and an unknown cause falls back to the original generic copy.
  assert.match(
    emptyCompletionNotice('unknown').description,
    /empty response and made no tool call/i,
  )
})

// TEST-6 — the correct-behaviour cases must STAY correct. A cause-aware notice
// must not start firing on turns that were never answerless, nor override the
// three suppression gates.
test('TEST-6: cause branching does not disturb the suppression gates', () => {
  const truncatedMsg = answerless('budget_truncated')
  for (const gate of ['isStreaming', 'interrupted', 'finalizing'] as const) {
    assert.equal(
      shouldShowEmptyCompletionNotice({
        isUser: false,
        isStreaming: gate === 'isStreaming',
        interrupted: gate === 'interrupted',
        finalizing: gate === 'finalizing',
        message: truncatedMsg,
      }),
      false,
      `${gate} must still suppress the notice even for a classified cause`,
    )
  }
  // A turn WITH an answer never shows a notice, whatever the column says — a
  // stale/incorrect completion_state must not manufacture one.
  const answeredButLabelled = {
    message: {},
    contents: [block('text', { text: 'here is the answer' })],
    completion_state: 'budget_truncated',
  } as unknown as MessageWithContent
  assert.equal(
    shouldShowEmptyCompletionNotice({
      isUser: false,
      isStreaming: false,
      interrupted: false,
      finalizing: false,
      message: answeredButLabelled,
    }),
    false,
  )
})
