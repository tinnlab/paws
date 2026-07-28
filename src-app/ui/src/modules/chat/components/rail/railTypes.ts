import type { MessageContent } from '@/api-client/types'
import type { ToolStatusKey } from '@/modules/chat/core/tool-status'

/**
 * The CORE-owned vocabulary of the chat activity rail.
 *
 * The rail is a contribution surface, not a collector: core owns the registry,
 * the row primitive and the segmentation; **each extension contributes its own
 * step descriptor and detail body** (`DESIGN.md` § Non-negotiables, INV-1).
 * Nothing in `chat/components/rail/` may import, name, or special-case an
 * extension — `railIsolation.test.ts` walks the real import graph and fails the
 * build if it ever does.
 *
 * The predecessor this replaces is the opposite shape:
 * `workflow/components/run/activityDescriptors.ts` hardcoded NINE other
 * modules' tool names in one central map. That map is deleted by this feature.
 */

/** What a contribution is handed to describe one step. Read-only by contract. */
export interface RailActivityContext {
  /** The block that anchors the step (usually a `tool_use`). */
  content: MessageContent
  /** The message's full ordered block list. Never mutate. */
  blocks: readonly MessageContent[]
  /** Index of {@link content} within {@link blocks}. */
  index: number
}

/** One artifact chip on a step row (a file the step produced). */
export interface RailArtifact {
  /** Stable key — the resource-link URI, or a synthesized fallback. */
  key: string
  /** Display name (file name), already trimmed by the contributor. */
  name: string
}

/**
 * What an extension returns from `describeActivity`. Everything the rail knows
 * about a step comes from here — the rail derives nothing from the block's
 * `content_type` or its tool name.
 */
export interface RailStepDescriptor {
  /**
   * Stable step identity (DEC-8: `tool_use_id` wherever one exists). Used as the
   * per-message view-state key and the detail-panel tab id, so re-opening
   * focuses the existing tab instead of stacking duplicates.
   */
  key: string
  /** One-line label. Truncates, never wraps (INV-8). */
  label: string
  /** Optional secondary text rendered after the label, muted. */
  detail?: string
  /**
   * Status, drawn from the ONE existing vocabulary (INV-9). The rail declares no
   * status string of its own — `railStatus.test.ts` pins that.
   */
  status: ToolStatusKey
  /**
   * How many blocks (starting at {@link RailActivityContext.index}) this step
   * owns. Must be ≥ 1. The segmenter records this ONCE and the renderer reads
   * the same value, which is what makes a span/render desync structurally
   * impossible (ITEM-5).
   */
  consumed: number
  /**
   * `true` when the step is a request for input (an approval, an elicitation, an
   * `ask_user` prompt). A blocking step is NEVER folded into a collapsible rail
   * span — it breaks out full-width and non-collapsible (INV-3). The rail does
   * not know WHICH content types block; the contributor declares it.
   */
  blocking?: boolean
  /** Files this step produced, rendered as chips (capped by {@link RAIL_LIMITS}). */
  artifacts?: RailArtifact[]
  /** Final wall time in ms, when known. */
  durationMs?: number
  /** ISO start timestamp — drives the ticking elapsed time of a running step (DEC-9). */
  startedAt?: string
  /**
   * The MCP `tool_use_id`, when this step is an MCP tool call. Present ⇒ the row
   * offers the full-record detail panel (which joins `mcp_tool_calls`).
   */
  toolUseId?: string
}

/**
 * An extension's rail contribution. Registered beside `contentTypes` on the
 * extension object; the registry stores it in a SEPARATE map so this whole
 * feature is additive to renderer resolution (BASE.md: `registry.tsx` is one of
 * the hottest files on the branch — a rewrite would not merge cleanly).
 */
export interface RailContribution {
  /** Content types this contribution can describe. */
  contentTypes: string[]
  /**
   * Resolution order among contributions for the same content type — LOWER runs
   * first, first non-null wins (the same first-wins discipline the content-type
   * registry already uses). Defaults to the owning extension's `priority`.
   *
   * A GENERIC fallback contribution (one that claims any tool) must declare a
   * high order so every tool-family contribution gets to claim its own steps
   * first; that is the mechanism by which a family's domain language wins over
   * the raw tool name without core knowing either.
   */
  order?: number
  /**
   * Describe the step anchored at `ctx.index`, or return `null` to decline (the
   * block then falls through to the next contribution, and finally to prose).
   * Must never throw: a block whose `structured_content` was dropped by the
   * backend cap, or which never had one, still has to yield a name-only row
   * (ITEM-6).
   */
  describeActivity: (ctx: RailActivityContext) => RailStepDescriptor | null
  /**
   * OPTIONAL inline detail body. When omitted the rail delegates to
   * `renderContent({ content })` — the extension's ALREADY-REGISTERED content
   * renderer, resolved through the existing first-wins registry with no
   * neighbour list (the documented non-recursion guard). Omitting it is the
   * normal case and is what proves delegation rather than re-implementation.
   */
  renderDetail?: (ctx: RailActivityContext) => React.ReactNode
}

/**
 * Fixed presentation constants (DEC-6). Gathered in ONE object rather than
 * scattered magic numbers so promoting them to an admin settings row later is a
 * rename, not a rewrite. They are deliberately NOT admin-configurable: they are
 * pure client-side presentation with no operator-visible effect and no resource
 * cost. The one genuine operational tunable this feature touches — retention of
 * `mcp_tool_calls` — is already admin-configurable
 * (`mcp_user_policy.tool_call_retention_days`) and is reused, not duplicated.
 */
export const RAIL_LIMITS = {
  /** Artifact chips rendered on a row before collapsing to "+N". */
  artifactChips: 4,
  /** Hard cap on a step label before the contributor's text is ellipsised. */
  labelMaxChars: 120,
  /** Characters of a result body the detail panel renders per page. */
  panelResultPageChars: 20_000,
} as const
