import test from 'node:test'
import assert from 'node:assert/strict'
import { createBatchLoader } from '@/modules/projects/chat-extension/projectLookupBatch'

/**
 * Guards the ITEM-3 batching loader that replaced the per-conversation
 * `GET /api/projects/by-conversation/{id}` burst (the live-ui-audit `n+1`
 * finding). The contract the sidebar depends on:
 *   - many ids asked for in one window ⇒ ONE fetch;
 *   - every id settles exactly once — including on a rejected fetch AND on a
 *     fetcher that throws synchronously (a pending promise leaves a membership
 *     badge spinning forever);
 *   - ids the server omits resolve as a real "unfiled" answer, while ids whose
 *     request FAILED are flagged so the caller does not cache a non-answer.
 */

test('N concurrent loads coalesce into ONE fetch carrying every id', async () => {
  const calls: string[][] = []
  const loader = createBatchLoader<string>({
    windowMs: 1,
    fetchChunk: async ids => {
      calls.push(ids)
      return new Map(ids.map(id => [id, 'proj-' + id]))
    },
  })

  const ids = Array.from({ length: 40 }, (_, i) => 'c' + i)
  const results = await Promise.all(ids.map(id => loader.load(id)))

  assert.equal(calls.length, 1, 'expected exactly one batched request')
  assert.deepEqual(calls[0], ids)
  assert.deepEqual(
    results,
    ids.map(id => ({ value: 'proj-' + id, failed: false })),
  )
})

test('ids the server omits resolve as unfiled (value null, NOT failed)', async () => {
  const loader = createBatchLoader<string>({
    windowMs: 1,
    // Only "a" is attached; "b" and "c" are unfiled and therefore absent.
    fetchChunk: async () => new Map([['a', 'proj-a']]),
  })
  const [a, b, c] = await Promise.all([loader.load('a'), loader.load('b'), loader.load('c')])
  assert.deepEqual(a, { value: 'proj-a', failed: false })
  assert.deepEqual(b, { value: null, failed: false })
  assert.deepEqual(c, { value: null, failed: false })
})

test('a rejected fetch settles EVERY id as FAILED (no hung promise, not a fake answer)', async () => {
  const loader = createBatchLoader<string>({
    windowMs: 1,
    fetchChunk: async () => {
      throw new Error('boom')
    },
  })
  const results = await Promise.all(['a', 'b', 'c'].map(id => loader.load(id)))
  assert.deepEqual(results, [
    { value: null, failed: true },
    { value: null, failed: true },
    { value: null, failed: true },
  ])
})

test('a fetcher that throws SYNCHRONOUSLY still settles every id', async () => {
  const loader = createBatchLoader<string>({
    windowMs: 1,
    // NOT an async fn: the throw escapes before any promise exists. Without the
    // Promise.resolve().then() wrapper this would abort flush() inside the
    // timer callback and strand every resolver.
    fetchChunk: (() => {
      throw new Error('sync boom')
    }) as unknown as (ids: string[]) => Promise<Map<string, string>>,
  })
  const results = await Promise.all(['a', 'b'].map(id => loader.load(id)))
  assert.deepEqual(results, [
    { value: null, failed: true },
    { value: null, failed: true },
  ])
})

test('a throwing resolver does not strand its siblings', async () => {
  const loader = createBatchLoader<string>({
    windowMs: 1,
    fetchChunk: async ids => new Map(ids.map(id => [id, 'proj-' + id])),
  })
  // A resolver that throws (a consumer bug) must not prevent later ids from
  // settling — every badge in the window depends on the same flush.
  const hostile = loader.load('a').then(r => {
    throw new Error('consumer bug: ' + r.value)
  })
  const ok = loader.load('b')
  await assert.rejects(() => hostile)
  assert.deepEqual(await ok, { value: 'proj-b', failed: false })
})

test('the same id requested twice in one window shares one entry and both callers resolve', async () => {
  const calls: string[][] = []
  const loader = createBatchLoader<string>({
    windowMs: 1,
    fetchChunk: async ids => {
      calls.push(ids)
      return new Map(ids.map(id => [id, 'proj-' + id]))
    },
  })
  const [x, y] = await Promise.all([loader.load('dup'), loader.load('dup')])
  assert.deepEqual(calls, [['dup']], 'the id must appear once in the request')
  assert.equal(x.value, 'proj-dup')
  assert.equal(y.value, 'proj-dup')
})

test('a batch larger than the cap is chunked, and every chunk contributes', async () => {
  const calls: string[][] = []
  const loader = createBatchLoader<string>({
    windowMs: 1,
    maxIds: 10,
    fetchChunk: async ids => {
      calls.push(ids)
      return new Map(ids.map(id => [id, 'proj-' + id]))
    },
  })
  const ids = Array.from({ length: 25 }, (_, i) => 'c' + i)
  const results = await Promise.all(ids.map(id => loader.load(id)))

  assert.equal(calls.length, 3, 'expected 25 ids to chunk into 10 + 10 + 5')
  assert.deepEqual(calls.map(c => c.length), [10, 10, 5])
  assert.deepEqual(
    results.map(r => r.value),
    ids.map(id => 'proj-' + id),
  )
})

test('one failing chunk marks ONLY its own ids failed', async () => {
  const loader = createBatchLoader<string>({
    windowMs: 1,
    maxIds: 2,
    fetchChunk: async ids => {
      if (ids.includes('c2')) throw new Error('chunk down')
      return new Map(ids.map(id => [id, 'proj-' + id]))
    },
  })
  const results = await Promise.all(['c0', 'c1', 'c2', 'c3'].map(id => loader.load(id)))
  assert.deepEqual(results, [
    { value: 'proj-c0', failed: false },
    { value: 'proj-c1', failed: false },
    { value: null, failed: true },
    { value: null, failed: true },
  ])
})

test('a later window opens a NEW request (the loader is not a permanent cache)', async () => {
  let n = 0
  const loader = createBatchLoader<string>({
    windowMs: 1,
    fetchChunk: async ids => {
      n += 1
      return new Map(ids.map(id => [id, 'proj-' + id]))
    },
  })
  await loader.load('a')
  await loader.load('a')
  assert.equal(n, 2)
})
