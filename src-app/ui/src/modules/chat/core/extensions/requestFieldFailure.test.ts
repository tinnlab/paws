import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCompositionFailureMessage,
  buildMissingFieldMessage,
  RECOVERY_HINT,
  RequestFieldCompositionError,
  STALE_BUILD_HINT,
  UNKNOWN_CAUSE,
} from './requestFieldFailure.ts'

/**
 * TEST-4 / TEST-5 — the user-facing message for a broken request composition.
 *
 * The whole point of the fix is that the user stops seeing
 * `422 missing field \`model_id\`` and starts seeing something they can ACT on,
 * so the message text itself is the deliverable and is asserted directly.
 */

test('TEST-4: names the failing extension, its cause, and the recovery step', () => {
  const msg = buildCompositionFailureMessage(
    [{ extension: 'model', cause: new Error('Failed to fetch dynamically imported module') }],
    false,
  )
  assert.match(msg, /model/)
  assert.match(msg, /Failed to fetch dynamically imported module/)
  assert.ok(msg.includes(RECOVERY_HINT), `expected the recovery hint in: ${msg}`)
  // It must NOT read like the server's validation output.
  assert.doesNotMatch(msg, /missing field/)
})

test('TEST-4b: every failing extension is named when more than one fails', () => {
  const msg = buildCompositionFailureMessage(
    [
      { extension: 'model', cause: new Error('a') },
      { extension: 'file', cause: new Error('b') },
    ],
    false,
  )
  assert.match(msg, /model/)
  assert.match(msg, /file/)
  assert.match(msg, /2 chat extensions failed/)
})

test('TEST-4c: an unusable cause falls back rather than rendering empty parens', () => {
  for (const cause of [new Error('   '), {}, null, undefined, 42]) {
    const msg = buildCompositionFailureMessage([{ extension: 'x', cause }], false)
    assert.ok(
      msg.includes(UNKNOWN_CAUSE),
      `expected the unknown-cause fallback for ${String(cause)}, got: ${msg}`,
    )
    assert.doesNotMatch(msg, /\(\)/)
  }
})

test('TEST-4d: a non-Error thrown value still contributes its message text', () => {
  const msg = buildCompositionFailureMessage(
    [{ extension: 'x', cause: { message: 'plain object failure' } }],
    false,
  )
  assert.match(msg, /plain object failure/)
  const fromString = buildCompositionFailureMessage(
    [{ extension: 'x', cause: 'string failure' }],
    false,
  )
  assert.match(fromString, /string failure/)
})

test('TEST-5: the stale-build hint appears ONLY when a chunk load has failed', () => {
  const fresh = buildCompositionFailureMessage(
    [{ extension: 'model', cause: new Error('x') }],
    false,
  )
  assert.ok(!fresh.includes(STALE_BUILD_HINT), `unexpected stale hint in: ${fresh}`)

  const stale = buildCompositionFailureMessage(
    [{ extension: 'model', cause: new Error('x') }],
    true,
  )
  assert.ok(stale.includes(STALE_BUILD_HINT), `expected the stale hint in: ${stale}`)
  assert.ok(stale.includes(RECOVERY_HINT))
})

test('TEST-5b: the missing-required-field message is actionable and stale-aware', () => {
  const msg = buildMissingFieldMessage(['a model selection'], false)
  assert.match(msg, /model/)
  assert.ok(msg.includes(RECOVERY_HINT))
  assert.doesNotMatch(msg, /missing field `/)

  const stale = buildMissingFieldMessage(['a model selection'], true)
  assert.ok(stale.includes(STALE_BUILD_HINT))
})

test('TEST-4e: the error carries its structured failures + missing fields', () => {
  const withFailures = new RequestFieldCompositionError('m', {
    failures: [{ extension: 'model', cause: new Error('x') }],
  })
  assert.equal(withFailures.name, 'RequestFieldCompositionError')
  assert.ok(withFailures instanceof Error)
  assert.equal(withFailures.failures.length, 1)
  assert.deepEqual(withFailures.missingFields, [])

  const withMissing = new RequestFieldCompositionError('m', {
    missingFields: ['a model selection'],
  })
  assert.deepEqual(withMissing.missingFields, ['a model selection'])
  assert.deepEqual(withMissing.failures, [])
})
