import type {
  RailActivityContext,
  RailContribution,
  RailStepDescriptor,
} from '@/modules/chat/components/rail/railTypes'
import {
  countOf,
  railToolStepBase,
  stringOf,
  structuredOf,
} from '@/modules/chat/components/rail/railBlocks'

/**
 * The `background` module's activity-rail contribution (ITEM-20).
 *
 * Describes the three tools of the built-in `background_mcp` server in the
 * module's own domain language, so the rail never has to know them:
 *
 * | tool | server source |
 * |---|---|
 * | `spawn_background` | `server/src/modules/background_mcp/tools.rs:47` |
 * | `check_status`     | `server/src/modules/background_mcp/tools.rs:87` |
 * | `collect_result`   | `server/src/modules/background_mcp/tools.rs:98` |
 *
 * The `structuredContent` fields quoted below are the exact JSON keys the
 * server returns (`background_mcp/handlers.rs:169` wraps the tool value from
 * `tools.rs::call_tool` as `structuredContent`):
 *
 * - `spawn_background` → `{run_id, kind, status, note}` (`tools.rs:251-256`)
 * - `check_status`     → `{run_id, kind, status, terminal, current_step,
 *                          error_message, progress, updated_at}` (`tools.rs:764-773`)
 * - `collect_result`   → `{run_id, status, complete, final_output_chunk, offset,
 *                          next_offset, total_chars, truncated}` (`tools.rs:828-837`),
 *                        or the short `{run_id, status, complete:false, note}` /
 *                        `{run_id, status, complete:true, final_output:null,
 *                          error_message}` shapes (`tools.rs:789-806`)
 *
 * ITEM-6: every branch below yields a usable, NAME-ONLY row when
 * `structuredOf(ctx)` is `null` — which is not an edge case, since
 * `cap_structured_content` DROPS an oversized payload outright.
 */

/** Domain labels, keyed by the RAW tool name `railToolStepBase` reports. */
const LABELS: Record<string, string> = {
  spawn_background: 'Starting background work',
  check_status: 'Checking on background work',
  collect_result: 'Collecting the background result',
}

export function describeBackgroundActivity(
  ctx: RailActivityContext,
): RailStepDescriptor | null {
  const base = railToolStepBase(ctx)
  if (!base) return null
  const label = LABELS[base.label]
  if (!label) return null

  // A tool awaiting approval NEEDS the user, so it must break out of the rail
  // rather than collapse into a row (INV-3). `spawn_background` is deliberately
  // NOT approval-bypassed (`background_mcp/tools.rs::background_call_needs_approval`),
  // so this branch is live for it.
  const blocking = base.status === 'pending-approval'
  const sc = structuredOf(ctx)
  // `sc === null` from here on is fully supported: `detail` simply stays unset
  // and the row renders name-only.
  const detail = detailFor(base.label, sc)

  return { ...base, label, blocking, ...(detail ? { detail } : {}) }
}

function detailFor(
  tool: string,
  sc: Record<string, unknown> | null,
): string | null {
  if (!sc) return null
  switch (tool) {
    case 'spawn_background': {
      // `kind` ∈ {subagent, sandbox_exec} — the two `JobKind`s the tool accepts.
      const kind = stringOf(sc, 'kind')
      return kind === 'sandbox_exec'
        ? 'sandbox command'
        : kind === 'subagent'
          ? 'sub-agent'
          : kind
    }
    case 'check_status': {
      const status = stringOf(sc, 'status')
      const step = stringOf(sc, 'current_step')
      if (status && step) return `${status} · ${step}`
      return status ?? step
    }
    case 'collect_result': {
      if (sc.complete === false) return 'still running'
      const total = countOf(sc, 'total_chars')
      if (total !== null) {
        return sc.truncated === true
          ? `${total.toLocaleString()} chars (paged)`
          : `${total.toLocaleString()} chars`
      }
      return stringOf(sc, 'error_message') ?? stringOf(sc, 'status')
    }
    default:
      return null
  }
}

/**
 * Registered at order 40 — comfortably ahead of `mcp`'s generic fallback (1000),
 * which is what lets this module's domain language win without core knowing
 * either the module or the tool names.
 */
export const backgroundRailContributions: RailContribution[] = [
  {
    contentTypes: ['tool_use'],
    order: 40,
    describeActivity: describeBackgroundActivity,
    // `renderDetail` OMITTED on purpose: expanding a step delegates to
    // `renderContent({ content })`, i.e. the already-registered tool renderer.
  },
]
