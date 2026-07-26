import test from 'node:test'
import assert from 'node:assert/strict'
import { createCoalescedLoader } from '@/core/coalescedLoader'
import { filterByCapability } from '@/core/llmModelCapabilities'
import type { LlmModel } from '@/api-client/types'

/**
 * Guards the ITEM-4 client-side capability filter. It replaced the server's
 * `?capability=` query param at three call sites, so it must reproduce the
 * server rule EXACTLY — `llm_model/handlers/models.rs` does
 * `capabilities.<cap>` → `as_bool()` → `unwrap_or(false)`, i.e. only an
 * explicit `true` keeps the model. A looser filter would silently widen a
 * picker (e.g. show a chat model in the embedding-model dropdown).
 */

const model = (name: string, capabilities: unknown): LlmModel =>
  ({ id: name, name, display_name: name, capabilities }) as unknown as LlmModel

test('only an explicit true keeps a model (absent / false / null / truthy-string do not)', () => {
  const models = [
    model('yes', { text_embedding: true }),
    model('false', { text_embedding: false }),
    model('null', { text_embedding: null }),
    model('absent', { chat: true }),
    model('truthy-string', { text_embedding: 'true' }),
    model('no-capabilities', undefined),
  ]
  assert.deepEqual(
    filterByCapability(models, 'text_embedding').map(m => m.name),
    ['yes'],
  )
})

test('filtering is per-capability, not "has any capability"', () => {
  const models = [
    model('chatty', { chat: true, tools: true }),
    model('embedder', { text_embedding: true }),
    model('reranker', { rerank: true }),
  ]
  assert.deepEqual(filterByCapability(models, 'chat').map(m => m.name), ['chatty'])
  assert.deepEqual(filterByCapability(models, 'rerank').map(m => m.name), ['reranker'])
  assert.deepEqual(filterByCapability(models, 'text_embedding').map(m => m.name), ['embedder'])
})

test('an empty catalog filters to an empty list rather than throwing', () => {
  assert.deepEqual(filterByCapability([], 'chat'), [])
})

/**
 * The coalescing contract IS the fix for the audit's
 * `duplicate request: GET /api/llm-models fired 3×` finding: three independent
 * store inits on one app load must produce ONE request.
 */

test('overlapping callers share ONE request (in-flight coalescing)', async () => {
  let n = 0
  let release!: (v: string[]) => void
  const load = createCoalescedLoader<string[]>(() => {
    n += 1
    return new Promise(r => {
      release = r
    })
  }, 2000)

  const a = load()
  const b = load()
  const c = load()
  release(['m1'])
  assert.deepEqual(await Promise.all([a, b, c]), [['m1'], ['m1'], ['m1']])
  assert.equal(n, 1, 'three overlapping callers must issue exactly one request')
})

test('a caller landing just AFTER the first resolves still shares it (TTL)', async () => {
  let n = 0
  let clock = 1000
  const load = createCoalescedLoader<number>(async () => ++n, 2000, () => clock)

  assert.equal(await load(), 1)
  clock += 1999 // still inside the freshness window
  assert.equal(await load(), 1)
  assert.equal(n, 1, 'the second, non-overlapping caller must reuse the cached value')
})

test('past the TTL the value is re-fetched (no permanently stale picker)', async () => {
  let n = 0
  let clock = 1000
  const load = createCoalescedLoader<number>(async () => ++n, 2000, () => clock)

  assert.equal(await load(), 1)
  clock += 2001
  assert.equal(await load(), 2)
  assert.equal(n, 2)
})

test('force bypasses the cache, and invalidate() drops it', async () => {
  let n = 0
  let clock = 1000
  const load = createCoalescedLoader<number>(async () => ++n, 2000, () => clock)

  assert.equal(await load(), 1)
  assert.equal(await load({ force: true }), 2, 'force must re-fetch inside the TTL')
  load.invalidate()
  assert.equal(await load(), 3, 'invalidate must drop the cached value')
})

test('invalidate() ALSO abandons the in-flight request (it does not resurrect the value)', async () => {
  let n = 0
  const releases: ((v: number) => void)[] = []
  const load = createCoalescedLoader<number>(() => {
    n += 1
    return new Promise(r => releases.push(r))
  }, 2000)

  const first = load() // R1 in flight
  load.invalidate() // a mutation landed — R1's answer is stale by definition
  const second = load() // must start a NEW request, not reuse R1
  assert.equal(n, 2, 'invalidate must not hand the next reader the pre-invalidation promise')

  releases[1](99) // R2 (fresh) resolves
  assert.equal(await second, 99)
  releases[0](11) // R1 (stale) resolves LATE
  await first
  // The stale late arrival must not have become the cached answer.
  assert.equal(await load(), 99)
  assert.equal(n, 2, 'the cached value must still be the fresh one, no refetch needed')
})

test('a slow pre-force request cannot overwrite the forced fresh value', async () => {
  let n = 0
  const releases: ((v: number) => void)[] = []
  const load = createCoalescedLoader<number>(() => {
    n += 1
    return new Promise(r => releases.push(r))
  }, 60_000)

  const slow = load() // R1
  const forced = load({ force: true }) // R2
  releases[1](2) // R2 resolves first → cache = 2
  assert.equal(await forced, 2)
  releases[0](1) // R1 (superseded) resolves LATE
  assert.equal(await slow, 1, 'its own caller still gets its own result')
  assert.equal(await load(), 2, 'but the cache must still hold the fresher value')
  assert.equal(n, 2)
})

test('a rejection is NOT cached — the next caller retries', async () => {
  let n = 0
  const load = createCoalescedLoader<number>(async () => {
    n += 1
    if (n === 1) throw new Error('boom')
    return n
  }, 2000)

  await assert.rejects(() => load(), /boom/)
  assert.equal(await load(), 2)
})
