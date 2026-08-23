import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_MODEL_MIN_MEMORY_BYTES } from '../../../defaultModel.ts'
import { shouldWarnLowMemory } from './memoryAdvisory.ts'

// TEST-12 (default-model-onboarding) — the hardware advisory warns, and only
// warns.
//
// DEC-4 resolved the design's open hardware question as "warn, never gate": INV-3
// makes the download offerable and never mandatory, so the step must not decide
// on the user's behalf that their machine is unsuitable. The other half is the
// undetectable case — a warning derived from no evidence is worse than none.

test('warns below the working-set threshold', () => {
  assert.equal(shouldWarnLowMemory(DEFAULT_MODEL_MIN_MEMORY_BYTES - 1), true)
  assert.equal(shouldWarnLowMemory(4 * 1024 ** 3), true)
})

test('stays silent at or above the threshold', () => {
  assert.equal(shouldWarnLowMemory(DEFAULT_MODEL_MIN_MEMORY_BYTES), false)
  assert.equal(shouldWarnLowMemory(64 * 1024 ** 3), false)
})

test('an UNDETECTED memory figure renders nothing at all', () => {
  // The hardware store holds `null` until (and unless) `/hardware/info`
  // resolves, and a user without `hardware::read` never loads it. None of those
  // is evidence of a small machine.
  assert.equal(shouldWarnLowMemory(null), false)
  assert.equal(shouldWarnLowMemory(undefined), false)
  assert.equal(shouldWarnLowMemory(0), false)
  assert.equal(shouldWarnLowMemory(-1), false)
  assert.equal(shouldWarnLowMemory(Number.NaN), false)
  assert.equal(shouldWarnLowMemory(Number.POSITIVE_INFINITY), false)
})
