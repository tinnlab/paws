import { TOOL_STATUS } from '@/modules/chat/core/tool-status'
import type { PlacedRailStep } from '@/modules/chat/components/rail/railSegmentation'
import { RAIL_LIMITS, type RailArtifact, type RailStepDescriptor } from '@/modules/chat/components/rail/railTypes'

/**
 * PURE view derivation for the rail row + summary.
 *
 * Kept out of the `.tsx` deliberately: this workspace's unit runner is
 * `node --test` over `src/**\/*.test.ts` with type-stripping only — it cannot
 * parse JSX, so nothing inside a `.tsx` is unit-testable here. Putting every
 * decision (label truncation, elapsed formatting, artifact overflow, the
 * summary sentence, the accessible name) in this module makes the row's
 * BEHAVIOUR unit-provable and leaves the `.tsx` as markup only.
 */

/** `12s`, `1m 04s`, `2h 03m`. Sub-second rounds up to `1s` so a row never reads `0s`. */
export function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return ''
  const total = Math.max(1, Math.round(ms / 1000))
  if (total < 60) return `${total}s`
  const m = Math.floor(total / 60)
  const s = total % 60
  if (m < 60) return `${m}m ${String(s).padStart(2, '0')}s`
  const h = Math.floor(m / 60)
  return `${h}h ${String(m % 60).padStart(2, '0')}m`
}

/**
 * The timing text for a step: its final duration, else the elapsed time since
 * `startedAt` (DEC-9 — a running step ticks). `now` is injected so the function
 * stays pure and the test is deterministic.
 */
export function stepTiming(step: RailStepDescriptor, now: number): string {
  if (typeof step.durationMs === 'number') return formatElapsed(step.durationMs)
  if (!step.startedAt) return ''
  const started = Date.parse(step.startedAt)
  if (!Number.isFinite(started)) return ''
  return formatElapsed(Math.max(0, now - started))
}

/**
 * Clamp a contributed label. CSS `truncate` is what makes it a single line at
 * any width (INV-8); this is a second bound so a pathological multi-kilobyte
 * label from a contribution can't bloat the DOM or the accessible name.
 */
export function clampLabel(label: string, max: number = RAIL_LIMITS.labelMaxChars): string {
  const t = (label ?? '').replace(/\s+/g, ' ').trim()
  if (!t) return 'Working…'
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

/** Artifact chips split into the shown head and the "+N" overflow count. */
export function splitArtifacts(
  artifacts: RailArtifact[] | undefined,
  cap: number = RAIL_LIMITS.artifactChips,
): { shown: RailArtifact[]; overflow: number } {
  const all = artifacts ?? []
  if (all.length <= cap) return { shown: all, overflow: 0 }
  return { shown: all.slice(0, cap), overflow: all.length - cap }
}

/**
 * The row's accessible name — status FIRST, because a screen-reader user must
 * hear "Failed" before the tool name, not after scrubbing to the end of a line.
 */
export function stepAccessibleName(step: RailStepDescriptor, timing: string): string {
  const parts = [TOOL_STATUS[step.status].label, clampLabel(step.label)]
  if (step.detail) parts.push(step.detail)
  if (timing) parts.push(timing)
  return parts.join(', ')
}

export interface RailSummary {
  /** The canonical status of the whole span. */
  status: RailStepDescriptor['status']
  /** e.g. `Worked for 12s · 4 tools · 3 files`. */
  text: string
}

/**
 * The one-line collapsed summary (ITEM-7). Total time is the SUM of known
 * per-step durations — never a wall-clock span, which would be wrong for
 * parallel calls and unavailable on reload.
 *
 * The span's status is the worst outcome present, in the order
 * failed > timeout > pending-approval > running > cancelled > success — so a
 * collapsed summary can never read "Completed" while it contains a failure.
 */
export function railSummary(steps: readonly PlacedRailStep[]): RailSummary {
  const order: RailStepDescriptor['status'][] = [
    'failed',
    'timeout',
    'pending-approval',
    'running',
    'cancelled',
    'success',
  ]
  let status: RailStepDescriptor['status'] = 'success'
  for (const s of order) {
    if (steps.some(p => p.step.status === s)) {
      status = s
      break
    }
  }

  let ms = 0
  let haveMs = false
  let artifacts = 0
  for (const p of steps) {
    if (typeof p.step.durationMs === 'number') {
      ms += p.step.durationMs
      haveMs = true
    }
    artifacts += p.step.artifacts?.length ?? 0
  }

  const bits: string[] = []
  const verb = status === 'running' ? 'Working' : 'Worked'
  bits.push(haveMs ? `${verb} for ${formatElapsed(ms)}` : verb === 'Working' ? 'Working' : 'Worked')
  bits.push(`${steps.length} ${steps.length === 1 ? 'step' : 'steps'}`)
  if (artifacts > 0) bits.push(`${artifacts} ${artifacts === 1 ? 'file' : 'files'}`)

  return { status, text: bits.join(' · ') }
}

/**
 * Per-message view-state key for a rail span (survives virtualiser unmount).
 *
 * Keyed on the span's FIRST STEP, not its ordinal position in the message. A
 * turn streams steps in, and an ordinal would shift the moment a span appeared
 * earlier in the message — silently re-collapsing a rail the user had opened,
 * which is the exact failure INV-7 exists to prevent. The first step's key is
 * its `tool_use_id`, which is stable for the life of the call.
 */
export function railStateKey(messageId: string, spanKey: string): string {
  return `${messageId}#${spanKey}`
}

/** Per-message view-state key for one expanded step. */
export function stepStateKey(messageId: string, stepKey: string): string {
  return `${messageId}#step#${stepKey}`
}

/** Stable right-panel tab id for a step's full record (DEC-8). */
export function toolCallTabId(toolUseId: string): string {
  return `tool:${toolUseId}`
}
