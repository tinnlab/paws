/**
 * Pure helpers for `voiceDownloadProgress`, extracted so they can be
 * unit-tested without the store's runtime `@/api-client/types` (enum) import.
 * The store's permission self-gating (`loadActive` returns early unless
 * `VoiceAdminRead`) and the SSE wiring are covered by the voice admin e2e specs;
 * these two pieces are the race/clamp logic worth pinning deterministically.
 */

/**
 * The byte-count line under a download progress bar.
 *
 * Returns `null` when there is nothing meaningful to say, and the caller MUST
 * then render no text at all. That case is the whole point: a download that
 * failed before transferring anything used to render a bare `formatBytes(0)` —
 * the literal string `"0 Bytes"` — directly beneath a catalog row advertising a
 * 56.94 MB download, which read as "the installed file is empty". A failed
 * transfer's byte count is not information; it is noise that contradicts the
 * size shown on the row.
 *
 * See `.lifecycle/voice-model-bad-magic/` (INV-6).
 *
 * @param received bytes transferred so far
 * @param total    the advertised total, when the server sent one
 * @param status   the download task's status
 * @param format   byte formatter (injected so this stays pure + unit-testable)
 */
export function progressByteLabel(
  received: number,
  total: number | undefined,
  status: string,
  format: (n: number) => string,
): string | null {
  // A failure that never transferred anything: say nothing. The failure message
  // itself carries the explanation.
  if (status === 'failed' && received === 0) return null

  if (total && total > 0) {
    const line = `${format(received)} / ${format(total)}`
    return status === 'completed' ? `${line} — Completed` : line
  }

  // Total unknown — label the count so a naked number can never be mistaken for
  // the file's size.
  if (status === 'completed') return `${format(received)} downloaded — Completed`
  if (received === 0) return null
  return `${format(received)} downloaded`
}

/** Percent for a progress bar, clamped to 0..100; undefined when total unknown. */
export function percentOf(received: number, total: number | undefined): number | undefined {
  if (!total || total === 0) return undefined
  return Math.min(100, Math.max(0, (received / total) * 100))
}

/**
 * Synchronously claim an SSE subscription slot for `key`. Returns true when THIS
 * call is the first to claim it (proceed to subscribe), false when the key is
 * already claimed (dedupe — do nothing). The claim is written before the caller
 * awaits the real `AbortController`, so a rapid second call is deduped even
 * though the controller arrives later — closing the two-callers-both-pass race.
 */
export function claimSubscription(
  aborts: Map<string, AbortController>,
  key: string,
): boolean {
  if (aborts.has(key)) return false
  aborts.set(key, new AbortController())
  return true
}
