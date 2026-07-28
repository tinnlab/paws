import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  claimSubscription,
  percentOf,
  progressByteLabel,
} from './downloadProgress.helpers.ts'

/** The real `formatBytes` behaviour we depend on, incl. its `0 → '0 Bytes'`. */
const fmt = (n: number) => {
  if (n === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(n) / Math.log(k))
  return `${parseFloat((n / k ** i).toFixed(2))} ${sizes[i]}`
}

// ── SSE subscribe dedupe: the synchronous placeholder prevents a double-sub ────

test('claimSubscription grants the first claim and dedupes the second (same key)', () => {
  const aborts = new Map<string, AbortController>()
  // First caller claims the key…
  assert.equal(claimSubscription(aborts, 'whisper@v1@cpu'), true)
  // …and the slot is written SYNCHRONOUSLY (before any async controller arrives),
  // so a rapid second caller is deduped rather than opening a second stream.
  assert.equal(aborts.has('whisper@v1@cpu'), true)
  assert.equal(claimSubscription(aborts, 'whisper@v1@cpu'), false)
  // Only one entry exists for the key.
  assert.equal(aborts.size, 1)
})

test('claimSubscription treats distinct keys independently', () => {
  const aborts = new Map<string, AbortController>()
  assert.equal(claimSubscription(aborts, 'whisper@v1@cpu'), true)
  assert.equal(claimSubscription(aborts, 'whisper@v1@cuda'), true)
  assert.equal(aborts.size, 2)
})

test('claimSubscription re-grants after the entry is torn down', () => {
  const aborts = new Map<string, AbortController>()
  assert.equal(claimSubscription(aborts, 'k'), true)
  aborts.delete('k') // complete/failed handler removes the entry
  assert.equal(claimSubscription(aborts, 'k'), true, 're-subscribe allowed after teardown')
})

// ── progress percent clamp ────────────────────────────────────────────────────

test('percentOf returns undefined when total is unknown or zero', () => {
  assert.equal(percentOf(10, undefined), undefined)
  assert.equal(percentOf(10, 0), undefined)
})

test('percentOf computes and clamps into 0..100', () => {
  assert.equal(percentOf(0, 100), 0)
  assert.equal(percentOf(50, 100), 50)
  assert.equal(percentOf(100, 100), 100)
  // A received count exceeding total (retry/overcount) clamps to 100, not >100.
  assert.equal(percentOf(150, 100), 100)
})

// ── TEST-6 [acceptance][INV-6] — the byte line: 0 / partial / complete ────────
//
// The shipped defect: a download that failed before transferring anything
// rendered a bare `formatBytes(0)` === "0 Bytes" directly beneath a catalog row
// advertising 56.94 MB, which read as "the installed file is empty".

test('progressByteLabel renders NOTHING for a failure that transferred nothing', () => {
  // This is the exact case from the owner's screenshot.
  assert.equal(progressByteLabel(0, undefined, 'failed', fmt), null)
  assert.equal(progressByteLabel(0, 59_700_000, 'failed', fmt), null)
  // Guard the regression directly: whatever it returns must never be the bare
  // zero string that caused the report.
  assert.notEqual(progressByteLabel(0, 59_700_000, 'failed', fmt), '0 Bytes')
})

test('progressByteLabel keeps the partial count for a failure that DID transfer', () => {
  // A partial transfer is real information — keep it, and keep it labelled.
  assert.equal(progressByteLabel(1024, undefined, 'failed', fmt), '1 KB downloaded')
  assert.equal(progressByteLabel(1024, 2048, 'failed', fmt), '1 KB / 2 KB')
})

test('progressByteLabel renders received/total while downloading', () => {
  assert.equal(progressByteLabel(1024, 4096, 'downloading', fmt), '1 KB / 4 KB')
  // Zero received but still running: no meaningless bare zero either.
  assert.equal(progressByteLabel(0, undefined, 'downloading', fmt), null)
})

test('progressByteLabel labels an unknown total so a number is never mistaken for the size', () => {
  const label = progressByteLabel(1_048_576, undefined, 'downloading', fmt)
  assert.equal(label, '1 MB downloaded')
  // The bare, unlabelled form is exactly what made "0 Bytes" ambiguous.
  assert.notEqual(label, '1 MB')
})

test('progressByteLabel marks a completed download', () => {
  assert.equal(
    progressByteLabel(4096, 4096, 'completed', fmt),
    '4 KB / 4 KB — Completed',
  )
  assert.equal(
    progressByteLabel(4096, undefined, 'completed', fmt),
    '4 KB downloaded — Completed',
  )
})
