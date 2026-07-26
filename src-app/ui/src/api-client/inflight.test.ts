import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  __resetInflightForTests,
  bumpFetchEpoch,
  coalesce,
  inflightKey,
  inflightSize,
  // Relative + explicit `.ts` into the sdk source — the convention established
  // by `src/modules/smartLoader.test.ts` (the `@ziee/*` export map is
  // extensionless, which node's ESM resolver can't follow under `node --test`).
} from '../../../../sdk/packages/framework/src/api-client/inflight.ts'

/** A runner that counts invocations and resolves on demand. */
function makeRunner<T>(value: T) {
  let calls = 0
  let release!: (v: T) => void
  let fail!: (e: unknown) => void
  const start = () => {
    calls++
    return new Promise<T>((res, rej) => {
      release = res
      fail = rej
    })
  }
  return {
    start,
    get calls() {
      return calls
    },
    release: (v: T = value) => release(v),
    fail: (e: unknown) => fail(e),
  }
}

// ── TEST-1 — INV-3: one shared in-flight request, not N independent callers ──

test('TEST-1: concurrent callers of the same key share ONE run and one value', async () => {
  __resetInflightForTests()
  const r = makeRunner('page-1')
  const k = inflightKey('GET', '/api/conversations', 'tok')

  const a = coalesce(k, r.start)
  const b = coalesce(k, r.start)
  const c = coalesce(k, r.start)
  assert.equal(r.calls, 1, 'three callers must produce ONE underlying request')
  assert.equal(inflightSize(), 1)

  r.release()
  assert.deepEqual(await Promise.all([a, b, c]), ['page-1', 'page-1', 'page-1'])
  assert.equal(inflightSize(), 0, 'the entry is dropped as soon as it settles')
})

test('TEST-1: joiners observe the same REJECTION (one retry ladder, not N)', async () => {
  __resetInflightForTests()
  const r = makeRunner('x')
  const k = inflightKey('GET', '/api/notifications', 'tok')
  const a = coalesce(k, r.start)
  const b = coalesce(k, r.start)
  assert.equal(r.calls, 1)

  const boom = new Error('502')
  r.fail(boom)
  await assert.rejects(a, /502/)
  await assert.rejects(b, /502/)
  assert.equal(inflightSize(), 0)
})

test('TEST-1: a different key / different identity is NEVER joined', async () => {
  __resetInflightForTests()
  const r = makeRunner('v')
  const kA = inflightKey('GET', '/api/conversations|page=1', 'tok')
  const kB = inflightKey('GET', '/api/conversations|page=2', 'tok')
  const kOther = inflightKey('GET', '/api/conversations|page=1', 'OTHER-USER')

  void coalesce(kA, r.start)
  void coalesce(kB, r.start)
  void coalesce(kOther, r.start)
  assert.equal(r.calls, 3, 'distinct url or distinct identity → distinct request')

  // The identity fingerprint must not be the token itself (never in a key that
  // could reach a log).
  assert.ok(!kOther.includes('OTHER-USER'))
  r.release()
})

test('TEST-1: this is a de-duplicator, NOT a cache — a later call runs again', async () => {
  __resetInflightForTests()
  const r = makeRunner('v1')
  const k = inflightKey('GET', '/api/projects', 'tok')

  const first = coalesce(k, r.start)
  r.release()
  await first
  assert.equal(r.calls, 1)

  void coalesce(k, r.start)
  assert.equal(r.calls, 2, 'once settled, nothing is retained — a refetch refetches')
  r.release()
})

// ── TEST-2 — INV-1: a post-mutation refetch is never served pre-mutation data ─

test('TEST-2: a GET issued after a mutation does NOT join a pre-mutation in-flight GET', async () => {
  __resetInflightForTests()
  const k = inflightKey('GET', '/api/profile', 'tok')

  // A read is on the wire, started BEFORE the mutation.
  let staleRelease!: (v: string) => void
  let staleCalls = 0
  const stale = coalesce(k, () => {
    staleCalls++
    return new Promise<string>(res => {
      staleRelease = res
    })
  })

  // The user saves. `callAsync` bumps the epoch when the non-GET completes.
  bumpFetchEpoch()

  // The component refetches. It MUST get its own round-trip.
  let freshCalls = 0
  const fresh = coalesce(k, () => {
    freshCalls++
    return Promise.resolve('NEW NAME')
  })

  assert.equal(freshCalls, 1, 'the post-mutation refetch must issue its own request')
  assert.equal(await fresh, 'NEW NAME')

  staleRelease('OLD NAME')
  assert.equal(await stale, 'OLD NAME')
  assert.equal(staleCalls, 1)
})

test('TEST-2: settling a superseded entry does not evict the newer one', async () => {
  __resetInflightForTests()
  const k = inflightKey('GET', '/api/x', 'tok')
  let oldRelease!: (v: string) => void
  const old = coalesce(k, () => new Promise<string>(r => (oldRelease = r)))
  bumpFetchEpoch()
  let newCalls = 0
  const fresh = coalesce(k, () => {
    newCalls++
    return new Promise<string>(() => {}) // stays in flight
  })
  oldRelease('old')
  await old
  // The newer entry must still be joinable — the old one's cleanup must not
  // have deleted it.
  void coalesce(k, () => {
    newCalls++
    return Promise.resolve('should not run')
  })
  assert.equal(newCalls, 1, 'the surviving entry is still the joinable one')
  void fresh
})

// ── TEST-3 — INV-1: notify-and-refetch survives the coalescer ────────────────

test('TEST-3: a sync frame invalidates joinability so the refetch is real', async () => {
  __resetInflightForTests()
  const k = inflightKey('GET', '/api/conversations', 'tok')

  let firstCalls = 0
  const inFlight = coalesce(k, () => {
    firstCalls++
    return new Promise<string>(() => {})
  })

  // SyncClient.handleFrame calls bumpFetchEpoch() on every inbound `sync` frame
  // (and on the reconnect resync) BEFORE emitting `sync:<entity>`.
  bumpFetchEpoch()

  let refetchCalls = 0
  const refetch = coalesce(k, () => {
    refetchCalls++
    return Promise.resolve('post-sync list')
  })

  assert.equal(firstCalls, 1)
  assert.equal(refetchCalls, 1, 'the sync-driven refetch must hit the network')
  assert.equal(await refetch, 'post-sync list')
  void inFlight
})
