import type {
  RailActivityContext,
  RailContribution,
  RailStepDescriptor,
} from '@/modules/chat/components/rail/railTypes'
import {
  railToolStepBase,
  resultBlockFor,
  stringOf,
  structuredOf,
  titleCaseToolId,
  toolNameOf,
} from '@/modules/chat/components/rail/railBlocks'

/**
 * The `scheduler` module's activity-rail contribution (ITEM-22) — the two
 * SKIPPED-TOOL markers.
 *
 * When a tool call is refused by POLICY rather than executed, the backend keeps
 * the turn protocol-valid by pushing a denial `tool_result` carrying a structured
 * marker (`server/src/modules/mcp/chat_extension/mcp.rs`):
 *
 * | marker | stamped at | meaning |
 * |---|---|---|
 * | `{admin_disabled: true, tool_name}`     | `mcp.rs:3175-3178` | an admin set this tool to `disabled` |
 * | `{unattended_denied: true, tool_name}`  | `mcp.rs:3202-3205` | the tool needs approval, and this run is unattended (a scheduled task) |
 *
 * Both are pushed with `is_error: Some(true)` so the MODEL treats them as a
 * failure and moves on — but for the USER they are neither a crash nor an error:
 * nothing ran. So the rail shows them as **`cancelled`**, the existing NEUTRAL
 * member of the one status vocabulary (INV-9). `cancelled` is a slashed circle in
 * muted gray; `failed` owns the red X exclusively
 * (`chat/core/tool-status.ts:20-25`). Painting a policy skip red would be the
 * round-1 bug this vocabulary was written to prevent.
 *
 * The `cancelled` status is set HERE, by the module that owns these markers.
 * It briefly lived in core's `railToolStepBase` — which was convenient and wrong:
 * INV-1 says the rail never SPECIAL-CASES an extension, not merely that it never
 * imports one, and core encoding `unattended_denied` / `admin_disabled` is core
 * encoding one backend surface's payload vocabulary. This contribution is at
 * order 20, ahead of every tool family, so it is guaranteed to be the one that
 * decides — the status still has exactly one decision point, it is just in the
 * module that owns the meaning.
 *
 * These were UNOWNED steps before this contribution: `mcp`'s generic fallback
 * would render a bare title-cased tool name with a neutral icon and no
 * explanation of WHY nothing happened.
 */

/** Which marker, if any, a step's `tool_result` carries. */
export type SkipMarker = 'admin_disabled' | 'unattended_denied'

export function skipMarkerOf(
  ctx: RailActivityContext,
): SkipMarker | null {
  const sc = structuredOf(ctx)
  if (!sc) return null
  if (sc.unattended_denied === true) return 'unattended_denied'
  if (sc.admin_disabled === true) return 'admin_disabled'
  return null
}

const MARKER_LABELS: Record<SkipMarker, string> = {
  unattended_denied: 'Skipped: needs approval, and this run is unattended',
  admin_disabled: 'Skipped: disabled by the administrator',
}

export function describeSchedulerSkip(
  ctx: RailActivityContext,
): RailStepDescriptor | null {
  const marker = skipMarkerOf(ctx)
  if (!marker) return null
  const base = railToolStepBase(ctx)
  if (!base) return null

  // The marker carries the tool name explicitly; fall back to the block's own
  // name (either side of the pair) when the payload was dropped or malformed.
  const name =
    stringOf(structuredOf(ctx), 'tool_name') ??
    toolNameOf(ctx.content) ??
    toolNameOf(resultBlockFor(ctx) ?? undefined)

  return {
    ...base,
    label: MARKER_LABELS[marker],
    // Neutral, never `failed`. The backend stamps these with `is_error: true` so
    // the MODEL treats them as a failure and moves on, which would otherwise
    // paint a policy skip with the red X that `failed` owns exclusively.
    status: 'cancelled',
    // The tool that did NOT run — the single most useful thing to name here.
    ...(name ? { detail: titleCaseToolId(name) } : {}),
    // A skip is terminal and needs nothing from the user: it is a row, never a
    // breakout (INV-3 is about REQUESTS for input; this is a refusal).
    blocking: false,
  }
}

/**
 * Order 20 — deliberately the LOWEST of the tool-family contributions, so a
 * skipped call is described as a skip rather than by whatever family owns the
 * tool. "Searching the web" would be a lie about a search that never ran.
 *
 * Registered for BOTH sides of the pair: the step is normally anchored at the
 * `tool_use` (whose span swallows the following `tool_result`), but a denial
 * result that reaches the transcript without its `tool_use` still gets a row
 * instead of falling through to prose.
 */
export const schedulerRailContributions: RailContribution[] = [
  {
    contentTypes: ['tool_use', 'tool_result'],
    order: 20,
    describeActivity: describeSchedulerSkip,
    // `renderDetail` omitted → delegates to the registered renderer, so the raw
    // denial text stays reachable on expand (INV-2).
  },
]
