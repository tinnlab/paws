import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  assertRequiredRequestFields,
  buildCompositionFailureMessage,
  buildMissingFieldMessage,
  isLoadFailureCause,
  MAX_CAUSE_CHARS,
  RECOVERY_HINT,
  RequestFieldCompositionError,
  STALE_BUILD_HINT,
  UNKNOWN_CAUSE,
} from './requestFieldFailure.ts'

/**
 * TEST-4 / TEST-5 — the user-facing message for a broken request composition,
 * and the required-field guard that renders through it.
 *
 * The whole point of the fix is that the user stops seeing
 * `422 missing field \`model_id\`` and starts seeing something they can ACT on,
 * so the message text itself is the deliverable and is asserted directly —
 * including the negative case that the advice must NOT be reload when reloading
 * cannot help.
 */

const CHUNK_ERROR = new Error(
  'Failed to fetch dynamically imported module: /assets/getModelId-abc.js',
)

test('TEST-4: names the failing extension, its cause, and reads as a sentence', () => {
  const msg = buildCompositionFailureMessage([{ extension: 'model', cause: CHUNK_ERROR }], false)
  assert.match(msg, /the "model" chat extension failed: Failed to fetch dynamically imported module/)
  // It must NOT read like the server's validation output.
  assert.doesNotMatch(msg, /missing field/)
  // The cause is NOT wedged between the article and the noun ("the model (…)
  // chat extension failed"), which the first draft produced and which is
  // unreadable.
  assert.doesNotMatch(msg, /the model \(/)
})

test('TEST-4b: every failing extension is named when more than one fails', () => {
  const msg = buildCompositionFailureMessage(
    [
      { extension: 'model', cause: new Error('a') },
      { extension: 'file', cause: new Error('b') },
    ],
    false,
  )
  assert.match(msg, /"model": a/)
  assert.match(msg, /"file": b/)
  assert.match(msg, /2 chat extensions failed/)
})

test('TEST-4c: an unusable cause falls back rather than rendering empty parens', () => {
  for (const cause of [new Error('   '), {}, null, undefined, 42]) {
    const msg = buildCompositionFailureMessage([{ extension: 'x', cause }], false)
    assert.ok(
      msg.includes(UNKNOWN_CAUSE),
      `expected the unknown-cause fallback for ${String(cause)}, got: ${msg}`,
    )
  }
})

test('TEST-4d: a non-Error thrown value still contributes its message text', () => {
  assert.match(
    buildCompositionFailureMessage([{ extension: 'x', cause: { message: 'plain object' } }], false),
    /plain object/,
  )
  assert.match(
    buildCompositionFailureMessage([{ extension: 'x', cause: 'string failure' }], false),
    /string failure/,
  )
})

test('TEST-4f: a huge cause is TRUNCATED before it can become an unbounded toast', () => {
  // Causes are arbitrary values from any layer — a contributor may await a lazy
  // action that hits the API, and the api-client formats failures as
  // `HTTP error! status: n - <raw response body>`. An unbounded server body must
  // not become an unbounded toast.
  const huge = 'x'.repeat(5000)
  const msg = buildCompositionFailureMessage([{ extension: 'x', cause: new Error(huge) }], false)
  assert.ok(msg.length < MAX_CAUSE_CHARS + 200, `message was not capped: ${msg.length} chars`)
  assert.match(msg, /…/)
})

test('TEST-4e: the error carries its structured failures + missing fields', () => {
  const withFailures = new RequestFieldCompositionError('m', {
    failures: [{ extension: 'model', cause: new Error('x') }],
  })
  assert.equal(withFailures.name, 'RequestFieldCompositionError')
  assert.ok(withFailures instanceof Error)
  assert.equal(withFailures.failures.length, 1)
  assert.deepEqual(withFailures.missingFields, [])
})

// ── TEST-5: the ADVICE must match the CAUSE ─────────────────────────────────

test('TEST-5: reload advice appears ONLY for a cause a reload could fix', () => {
  // A chunk-load failure: reloading genuinely fixes it.
  const load = buildCompositionFailureMessage([{ extension: 'model', cause: CHUNK_ERROR }], false)
  assert.ok(load.includes(RECOVERY_HINT), `expected the recovery hint in: ${load}`)

  // "No model selected" is the single most likely REAL trigger (the model
  // extension throws it whenever the picker has no selection and there is no
  // default). Reloading cannot fix it — telling the user to reload sends them
  // into a loop and hides the real fix.
  const config = buildCompositionFailureMessage(
    [{ extension: 'model', cause: new Error('No model selected') }],
    false,
  )
  assert.ok(
    !config.includes(RECOVERY_HINT),
    `a non-load failure must not prescribe a reload: ${config}`,
  )
  assert.match(config, /No model selected/)
})

test('TEST-5a: the stale-build hint needs BOTH a stale build and a load-failure cause', () => {
  const staleAndLoad = buildCompositionFailureMessage(
    [{ extension: 'model', cause: CHUNK_ERROR }],
    true,
  )
  assert.ok(staleAndLoad.includes(STALE_BUILD_HINT))
  assert.ok(staleAndLoad.includes(RECOVERY_HINT))

  // A stale mark from a blip earlier in the session must NOT attach itself to an
  // unrelated failure hours later ("the app may have been updated" would then be
  // simply false, stacked on equally-false reload advice).
  const staleButUnrelated = buildCompositionFailureMessage(
    [{ extension: 'model', cause: new Error('No model selected') }],
    true,
  )
  assert.ok(!staleButUnrelated.includes(STALE_BUILD_HINT))
  assert.ok(!staleButUnrelated.includes(RECOVERY_HINT))
})

test('TEST-5c: isLoadFailureCause recognises every browser + bundler dialect', () => {
  for (const text of [
    'Failed to fetch dynamically imported module: /assets/x.js', // Chromium/WebKit
    'error loading dynamically imported module', // Firefox
    'Importing a module script failed.', // older Safari
    'Unable to preload CSS for /assets/x.css', // Vite's own helper
    'lazy chunk import resolved with no module', // the dispatcher's give-up
  ]) {
    assert.ok(isLoadFailureCause(new Error(text)), `should be a load failure: ${text}`)
  }
  for (const text of ['No model selected', 'HTTP error! status: 500', 'boom']) {
    assert.ok(!isLoadFailureCause(new Error(text)), `should NOT be a load failure: ${text}`)
  }
})

test('TEST-5b: the missing-required-field message is stale-gated too', () => {
  const msg = buildMissingFieldMessage(['a model selection'], false)
  assert.match(msg, /model/)
  assert.doesNotMatch(msg, /missing field `/)
  // No reload advice when the build is not known to be stale: `branch_id` can be
  // genuinely absent (the server declares active_branch_id optional), and
  // reloading just refetches the same row and loops the user.
  assert.ok(
    !msg.includes(RECOVERY_HINT),
    `a non-stale missing-field message must not prescribe a reload: ${msg}`,
  )

  const stale = buildMissingFieldMessage(['a model selection'], true)
  assert.ok(stale.includes(STALE_BUILD_HINT))
  assert.ok(stale.includes(RECOVERY_HINT))
})

test('TEST-5d: a domain error merely CONTAINING "chunk" is not a load failure', () => {
  // An API error body reaches these builders verbatim, and this app surfaces the
  // word in ordinary domain errors (file/RAG chunking). A bare `chunk` alternative
  // would hand those users "reload the page" — the mis-advice this predicate
  // exists to prevent.
  for (const text of [
    'HTTP error! status: 500 - failed to embed chunk 12 of document',
    'chunking failed for file_chunks',
  ]) {
    assert.ok(!isLoadFailureCause(new Error(text)), `should NOT be a load failure: ${text}`)
  }
  // …while the real bundler dialects still are.
  assert.ok(isLoadFailureCause(new Error('Loading chunk 42 failed.')))
})

// ── The required-field guard (the table + the assertion together) ────────────

test('TEST-10c: assertRequiredRequestFields accepts a complete body', () => {
  assertRequiredRequestFields({ content: '', model_id: 'm-1', branch_id: 'b-1' })
})

test('TEST-10d: it rejects each missing/blank required field, naming it', () => {
  const cases: Array<[Record<string, unknown>, RegExp]> = [
    [{ model_id: 'm-1', branch_id: 'b-1' }, /the message text/],
    [{ content: 'hi', branch_id: 'b-1' }, /a model selection/],
    [{ content: 'hi', model_id: '  ', branch_id: 'b-1' }, /a model selection/],
    [{ content: 'hi', model_id: 'm-1' }, /a conversation branch/],
    // `branch_id: ''` is exactly what `conversation.active_branch_id || ''`
    // produced: the generated client type makes it optional while the server
    // declares it a Uuid, so this used to POST and come back a raw 422.
    [{ content: 'hi', model_id: 'm-1', branch_id: '' }, /a conversation branch/],
  ]
  for (const [body, expected] of cases) {
    assert.throws(
      () => assertRequiredRequestFields(body),
      (err: unknown) => {
        assert.ok(err instanceof RequestFieldCompositionError)
        assert.match((err as Error).message, expected)
        return true
      },
      `expected a rejection for ${JSON.stringify(body)}`,
    )
  }
})

test('TEST-10e: an EMPTY content is legitimate (attachment-only / approval resume)', () => {
  // "the composer is empty" is `beforeSendMessage`'s veto, not this guard's —
  // a tool-approval resume and an attachment-only turn both send empty text.
  assertRequiredRequestFields({ content: '', model_id: 'm-1', branch_id: 'b-1' })
})

test('TEST-10f: the checked subset is selectable (branch_id is not known pre-flight)', () => {
  // The send path checks content+model_id BEFORE any side effect, then the whole
  // body once the conversation exists.
  assertRequiredRequestFields({ content: 'hi', model_id: 'm-1' }, ['content', 'model_id'])
  assert.throws(
    () => assertRequiredRequestFields({ content: 'hi' }, ['content', 'model_id']),
    /a model selection/,
  )
})
