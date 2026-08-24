/**
 * The hardware advisory (DEC-4) — a WARNING, never a gate.
 *
 * A 9B at Q4_K_M wants roughly `DEFAULT_MODEL_MIN_MEMORY_GB` of memory to run
 * comfortably. Below that the step says so, and does nothing else: the install
 * control stays enabled and Next stays unblocked, because INV-3 makes the
 * download offerable and never mandatory — and because a machine the user is
 * about to free up, or is happy to run slowly, is their call rather than ours.
 *
 * A figure we could not detect renders NOTHING. A scary warning derived from no
 * evidence is worse than no warning.
 */

import {
  DEFAULT_MODEL_MIN_MEMORY_BYTES,
  DEFAULT_MODEL_MIN_MEMORY_GB,
} from '@/modules/onboarding/guides/getting-started/defaultModel'

export { DEFAULT_MODEL_MIN_MEMORY_GB }

/**
 * Should the low-memory advisory be shown for this total-RAM figure?
 *
 * `null` / `undefined` / non-finite / non-positive all mean "not detected".
 */
export function shouldWarnLowMemory(
  totalMemoryBytes: number | null | undefined,
): boolean {
  if (typeof totalMemoryBytes !== 'number') return false
  if (!Number.isFinite(totalMemoryBytes) || totalMemoryBytes <= 0) return false
  return totalMemoryBytes < DEFAULT_MODEL_MIN_MEMORY_BYTES
}
