import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildSendFailureState,
  isAbortError,
  SEND_FAILED_FALLBACK_MESSAGE,
} from './sendFailureState.ts'

/**
 * TEST-4 — the ONE recovery shape.
 *
 * A half-reset (e.g. `sending` cleared but `isStreaming` left true) is the exact
 * failure mode this helper exists to make impossible: the composer re-enables
 * while the spinner runs forever, and the reconnect resync stays suppressed.
 */

const STREAMING_FIELDS = [
  'sending',
  'isStreaming',
  'streamingMessage',
  'streamingAbortController',
  'streamingMessageId',
  'finalizingTurn',
] as const

test('a real failure clears EVERY streaming field together', () => {
  const s = buildSendFailureState(new Error('boom')) as unknown as Record<string, unknown>
  for (const f of STREAMING_FIELDS) {
    assert.ok(
      s[f] === false || s[f] === null,
      `${f} must be cleared (was ${String(s[f])}) — a partial reset wedges the UI`,
    )
  }
  assert.equal(s.lastTurnInterrupted, true)
})

test('a real failure surfaces its message', () => {
  assert.equal(buildSendFailureState(new Error('provider exploded')).error, 'provider exploded')
})

test('a failure with no usable message still surfaces SOMETHING (never a blank alert)', () => {
  assert.equal(buildSendFailureState(new Error('')).error, SEND_FAILED_FALLBACK_MESSAGE)
  assert.equal(buildSendFailureState(new Error('   ')).error, SEND_FAILED_FALLBACK_MESSAGE)
  assert.equal(buildSendFailureState(undefined).error, SEND_FAILED_FALLBACK_MESSAGE)
  assert.equal(buildSendFailureState('a thrown string').error, SEND_FAILED_FALLBACK_MESSAGE)
})

test('a non-Error object carrying a message string is honoured', () => {
  assert.equal(buildSendFailureState({ message: 'http 500' }).error, 'http 500')
})

test('a user abort reports NO error but still clears the streaming fields', () => {
  const abort = new Error('aborted')
  abort.name = 'AbortError'
  const s = buildSendFailureState(abort) as unknown as Record<string, unknown>
  assert.equal(s.error, null, 'the user asked for it — not an incident to report')
  for (const f of STREAMING_FIELDS) {
    assert.ok(s[f] === false || s[f] === null, `${f} must be cleared on abort too`)
  }
})

test('isAbortError only matches a genuine AbortError', () => {
  const abort = new Error('x')
  abort.name = 'AbortError'
  assert.equal(isAbortError(abort), true)
  assert.equal(isAbortError(new Error('AbortError')), false, 'message text is not the name')
  assert.equal(isAbortError({ name: 'AbortError' }), false, 'must be a real Error')
  assert.equal(isAbortError(null), false)
})
