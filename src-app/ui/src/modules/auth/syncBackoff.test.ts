import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CAPACITY_BACKOFF_MS,
  MAX_BACKOFF_MS,
  reconnectDelayMs,
} from '@ziee/framework/sync/backoff'

/**
 * TEST-8 (ITEM-9) — the SSE reconnect backoff must distinguish a CAPACITY
 * refusal from a transient drop.
 *
 * `/api/sync/subscribe` answers 429 when the per-user connection cap is
 * exhausted. Retrying that at the 1 s transient floor just burns requests
 * against an endpoint that has already said "no room" — the audit sees 2–3
 * duplicate subscribes per page. A transient drop must keep its fast recovery.
 */

test('TEST-8: a 429 backs off an order of magnitude beyond the transient floor', () => {
  // rand() = 0 → the pure floor, no jitter.
  assert.equal(reconnectDelayMs(429, 1_000, () => 0), CAPACITY_BACKOFF_MS)
  assert.ok(reconnectDelayMs(429, 1_000, () => 0) > 1_000)
})

test('TEST-8: a 429 RAISES the floor — it never shortens an escalated backoff', () => {
  // After several transient failures the loop's backoff has escalated. A 429 at
  // that point must NOT drop the wait back to ~12s (which would mean retrying
  // FASTER against an endpoint that just said "no room").
  assert.equal(reconnectDelayMs(429, 30_000, () => 0), MAX_BACKOFF_MS)
  assert.equal(reconnectDelayMs(429, 20_000, () => 0), 20_000)
  // …and repeated 429s still escalate, because the loop's own backoff keeps
  // doubling underneath: 10s → 16s → 30s as `currentBackoffMs` grows.
  assert.ok(reconnectDelayMs(429, 16_000, () => 0) >= 16_000)
})

test('TEST-8: the 429 delay is jittered, so refused clients do not re-collide in lockstep', () => {
  const lo = reconnectDelayMs(429, 1_000, () => 0)
  const hi = reconnectDelayMs(429, 1_000, () => 0.999)
  assert.ok(hi > lo, 'jitter must actually vary the delay')
  assert.ok(hi - lo >= 4_000, 'the jitter window must be wide enough to spread clients')
})

test('TEST-8: a non-429 failure keeps the existing transient recovery', () => {
  assert.equal(reconnectDelayMs(null, 1_000, () => 0.5), 1_000)
  assert.equal(reconnectDelayMs(500, 2_000, () => 0.5), 2_000)
  assert.equal(reconnectDelayMs(401, 4_000, () => 0.5), 4_000)
})

test('TEST-8: neither path ever exceeds MAX_BACKOFF_MS', () => {
  assert.ok(reconnectDelayMs(429, 1_000, () => 1) <= MAX_BACKOFF_MS)
  assert.equal(reconnectDelayMs(null, 999_999, () => 0), MAX_BACKOFF_MS)
})
