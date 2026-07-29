import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { composeRequestFieldsFrom } from './composeRequestFields.ts'

/**
 * TEST-1 / TEST-2 / TEST-3 — request-field composition is FAIL-CLOSED.
 *
 * The defect these pin (live-UI-rig triage §4 Rank 1): a contributor's failure
 * was caught, `console.error`'d, and composition RETURNED the surviving
 * contributors' fields. That is indistinguishable from success at the call site,
 * so `sendMessage` POSTed a body missing `model_id` and the server answered a
 * raw `422 missing field \`model_id\``. No throw, no flag, no signal.
 *
 * Pure, so it runs under `node --test` with no DOM and no registry — the same
 * split as this directory's `beforeSendCancel.ts` / `beforeSendCancel.test.ts`.
 * That the REGISTRY actually delegates here is proven separately, by the
 * store-level TEST-9 (real registry) and the e2e TEST-13 (real everything).
 */

/** Silence the (deliberate, retained) console.error for one call. */
async function quiet<T>(fn: () => Promise<T>): Promise<T> {
  const original = console.error
  console.error = () => {}
  try {
    return await fn()
  } finally {
    console.error = original
  }
}

test('TEST-1: a contributor failure REJECTS instead of returning partial fields', async () => {
  const outcome = await quiet(() =>
    composeRequestFieldsFrom([
      { name: 'text', compose: async () => ({ content: 'hello' }) },
      {
        name: 'model',
        compose: async () => {
          throw new Error('Failed to fetch dynamically imported module')
        },
      },
    ]).then(
      fields => ({ resolved: true, fields }) as const,
      error => ({ resolved: false, error: error as Error }) as const,
    ),
  )

  assert.equal(
    outcome.resolved,
    false,
    'composition must not resolve when a contributor failed — resolving IS the silent invalid send',
  )
  if (outcome.resolved) return
  // The message must name the failing extension and carry the cause, so the user
  // (and the log) can tell WHICH capability broke.
  assert.match(outcome.error.message, /model/)
  assert.match(outcome.error.message, /Failed to fetch dynamically imported module/)
  assert.match(outcome.error.message, /Reload the page/)
  // The structured failures ride along for the caller/log.
  assert.equal((outcome.error as any).failures.length, 1)
  assert.equal((outcome.error as any).failures[0].extension, 'model')
})

test('TEST-2: EVERY contributor still runs, and all failures are named', async () => {
  const ran: string[] = []
  const error = await quiet(() =>
    composeRequestFieldsFrom([
      {
        name: 'model',
        compose: async () => {
          ran.push('model')
          throw new Error('model chunk missing')
        },
      },
      {
        name: 'text',
        compose: async () => {
          ran.push('text')
          return { content: 'hi' }
        },
      },
      {
        name: 'file',
        compose: async () => {
          ran.push('file')
          throw new Error('file chunk missing')
        },
      },
    ]).then(
      () => null,
      e => e as Error,
    ),
  )

  assert.ok(error, 'two failing contributors must still reject')
  // No short-circuit: an early failure must not hide a later one, and must not
  // skip a healthy contributor in between.
  assert.deepEqual(ran, ['model', 'text', 'file'])
  assert.match(error!.message, /model/)
  assert.match(error!.message, /file/)
  assert.equal((error as any).failures.length, 2)
})

test('TEST-2b: the failure is still logged with its stack (the log did not regress)', async () => {
  const original = console.error
  const calls: unknown[][] = []
  console.error = (...args: unknown[]) => {
    calls.push(args)
  }
  const thrown = new Error('boom')
  try {
    await composeRequestFieldsFrom([
      { name: 'model', compose: async () => { throw thrown } },
    ]).catch(() => {})
  } finally {
    console.error = original
  }
  assert.equal(calls.length, 1)
  assert.match(String(calls[0][0]), /\[ChatExtensions\] Error in model\.composeRequestFields/)
  // The ERROR OBJECT itself must be passed, not a pre-stringified message —
  // that is what puts the stack in the console. Capturing `String(arg)` would
  // have kept this green with the stack thrown away, which is exactly the
  // hollow-assertion trap.
  assert.equal(
    calls[0][1],
    thrown,
    'the raw Error must reach console.error so its stack survives',
  )
})

test('TEST-3: the all-succeed path is unchanged (merge, later contributor wins)', async () => {
  const fields = await composeRequestFieldsFrom([
    { name: 'early', compose: async () => ({ content: 'first', keep: 1 }) },
    { name: 'late', compose: async () => ({ content: 'second' }) },
  ])
  assert.deepEqual(fields, { content: 'second', keep: 1 })
})

test('TEST-3b: a synchronous (non-promise) contributor is supported', async () => {
  const fields = await composeRequestFieldsFrom([
    { name: 'sync', compose: () => ({ model_id: 'm-1' }) },
  ])
  assert.deepEqual(fields, { model_id: 'm-1' })
})

test('TEST-3c: no contributors → an empty object, no throw', async () => {
  assert.deepEqual(await composeRequestFieldsFrom([]), {})
})

test('TEST-2c: an OPTIONAL contributor\'s failure BLOCKS the send (the accepted cost)', async () => {
  // Fail-closed is uniform, so a contributor that would have contributed NOTHING
  // still blocks. This is DEC-1's deliberate tradeoff and it is asserted here so
  // it can never become accidental: the alternative for `mcp` (catch and return
  // {}) would silently drop a user's tool approval and let the turn proceed as
  // if it had never been given.
  const outcome = await quiet(() =>
    composeRequestFieldsFrom([
      { name: 'text', compose: async () => ({ content: 'hi' }) },
      { name: 'model', compose: async () => ({ model_id: 'm-1' }) },
      {
        name: 'mcp',
        compose: async () => {
          // What the real contributor does first: `await import('…/mcpComposer')`.
          throw new Error('Failed to fetch dynamically imported module')
        },
      },
    ]).then(
      () => 'resolved',
      () => 'rejected',
    ),
  )
  assert.equal(outcome, 'rejected')
})

test('TEST-2d: the REAL model contributor\'s "No model selected" flows through unchanged', async () => {
  // The one production contributor that throws in normal operation. Its message
  // must reach the user verbatim — and, per TEST-5, WITHOUT reload advice.
  //
  // The extension itself is a `.tsx` module and cannot be imported by this
  // runner, so the COUPLING is asserted against its source: if that throw is
  // renamed or removed, the synthetic case below stops representing anything and
  // this fails loudly instead of silently going hollow. The end-to-end proof
  // that the real extension reaches this code path is the e2e (TEST-13).
  const source = readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../../user-llm-providers/chat-extension/extension.tsx',
    ),
    'utf8',
  )
  assert.match(
    source,
    /composeRequestFields[\s\S]*throw new Error\('No model selected'\)/,
    "the model extension must still throw 'No model selected' from composeRequestFields — otherwise the case below represents nothing",
  )

  const error = await quiet(() =>
    composeRequestFieldsFrom([
      {
        name: 'model',
        // The picker is empty and there is no default: exactly what a fresh
        // install (or an admin unassigning the provider group) produces.
        compose: async () => {
          throw new Error('No model selected')
        },
      },
    ]).then(
      () => null,
      e => e as Error,
    ),
  )
  assert.ok(error)
  assert.match(error!.message, /No model selected/)
  assert.doesNotMatch(
    error!.message,
    /Reload the page/,
    'reloading cannot fix an unconfigured model — the advice must not send the user into a loop',
  )
})
