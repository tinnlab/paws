import type {
  MessageContent,
  MessageContentDataToolUse,
  MessageContentDataToolResult,
} from '@/api-client/types'
import { toolStatusKey, type ToolStatusKey } from '@/modules/chat/core/tool-status'
import { getRailLiveStep, railLiveVersion } from '@/modules/chat/core/rail/liveSteps'
import type { RailActivityContext, RailArtifact, RailStepDescriptor } from '@/modules/chat/components/rail/railTypes'

/**
 * Core-owned helpers over the CORE wire vocabulary (`tool_use` / `tool_result`
 * are `MessageContent` discriminants generated from the backend, not extension
 * concepts). Exported to contributions so each one is ~20 lines of DOMAIN
 * language instead of 100 lines of re-derived block plumbing.
 *
 * This is the inversion the design asks for: core supplies the mechanism, each
 * extension supplies the meaning. The predecessor supplied the MEANING centrally
 * (`workflow/.../activityDescriptors.ts` held nine modules' tool names) — that
 * map is deleted by this feature.
 */

/** The `tool_use` payload of a block, if it is one. */
export function toolUseOf(block: MessageContent | undefined): MessageContentDataToolUse | null {
  if (!block || block.content_type !== 'tool_use') return null
  return (block.content as MessageContentDataToolUse | undefined) ?? null
}

/** The `tool_result` payload of a block, if it is one. */
export function toolResultOf(
  block: MessageContent | undefined,
): MessageContentDataToolResult | null {
  if (!block || block.content_type !== 'tool_result') return null
  return (block.content as MessageContentDataToolResult | undefined) ?? null
}

/** The tool NAME a block is about, from either side of the pair. */
export function toolNameOf(block: MessageContent | undefined): string | null {
  const use = toolUseOf(block)
  if (use?.name) return use.name
  const res = toolResultOf(block)
  return res?.name ?? null
}

/**
 * `structured_content` of the `tool_result` paired with the `tool_use` at
 * `index`, or of the block itself when it IS a result.
 *
 * Returns `null` whenever it is absent — which is NOT an edge case (ITEM-6):
 * `cap_structured_content` DROPS an oversized payload rather than truncating it,
 * and `ask_user` / `delegate` / `schedule_next` / image+binary file reads emit
 * none at all. Every contribution must therefore tolerate `null` and degrade to
 * a name-only row.
 */
export function structuredOf(ctx: RailActivityContext): Record<string, unknown> | null {
  const res = resultBlockFor(ctx)
  const sc = res ? toolResultOf(res)?.structured_content : undefined
  return sc && typeof sc === 'object' && !Array.isArray(sc)
    ? (sc as Record<string, unknown>)
    : null
}

/** The `tool_result` block paired with the step at `ctx.index`, if present. */
export function resultBlockFor(ctx: RailActivityContext): MessageContent | null {
  const use = toolUseOf(ctx.content)
  if (!use) return ctx.content.content_type === 'tool_result' ? ctx.content : null
  if (!use.id) return null
  // Stops at the first non-`tool_result`, exactly as `toolStepSpan` does. The
  // two MUST agree: a step that read its status and artifacts from a block it
  // does not consume would leave that block free to be claimed as a step in its
  // own right, producing a duplicate row with double-attributed artifacts. That
  // is currently masked by `normalizeToolResultOrder` running first, but this
  // module is pure and reusable (the workflow timeline already calls into the
  // registry with a hand-built block list), so it must not depend on a caller's
  // pre-pass.
  for (let i = ctx.index + 1; i < ctx.blocks.length; i++) {
    const b = ctx.blocks[i]
    if (b.content_type !== 'tool_result') break
    if (toolResultOf(b)?.tool_use_id === use.id) return b
  }
  return null
}

/**
 * How many blocks this step owns: the `tool_use` plus every immediately
 * following `tool_result` that references it. Stops at the first block of any
 * other type, so a narration `text` block always breaks the run — which the
 * grouping simulation measured as the real run-breaker (78 occurrences).
 */
export function toolStepSpan(ctx: RailActivityContext): number {
  const use = toolUseOf(ctx.content)
  if (!use?.id) return 1
  let n = 1
  for (let i = ctx.index + 1; i < ctx.blocks.length; i++) {
    const b = ctx.blocks[i]
    if (b.content_type !== 'tool_result') break
    if (toolResultOf(b)?.tool_use_id !== use.id) break
    n += 1
  }
  return n
}

/** Artifact chips from a step's result `resource_links`. */
export function artifactsFor(ctx: RailActivityContext): RailArtifact[] {
  const res = resultBlockFor(ctx)
  const links = toolResultOf(res ?? undefined)?.resource_links ?? []
  const out: RailArtifact[] = []
  for (const l of links) {
    const uri = l.uri ?? ''
    // A blanked URI is a REJECTED `ziee://` host-path link (the strip-before-
    // client guard). Showing a nameless chip for it would advertise an artifact
    // the user can never open, so skip it.
    const name = (l.name ?? '').trim() || uri.split('/').pop() || ''
    if (!name) continue
    out.push({ key: uri || `${ctx.index}:${out.length}:${name}`, name })
  }
  return out
}

/**
 * The BASE descriptor for a tool step, derived purely from core vocabulary plus
 * the core-owned live-step seam. A contribution spreads this and overrides only
 * `label` / `detail` — so status, timing, identity, span and artifacts are
 * consistent across every extension by construction, and ITEM-6's name-only
 * degradation IS the base.
 *
 * Returns `null` when the block is not a tool step at all.
 */
/**
 * Per-render memo for {@link railToolStepBase}, keyed by the blocks ARRAY
 * IDENTITY then by block index.
 *
 * Resolution tries every registered contribution in `order` until one claims the
 * block, and each DECLINING contribution calls `railToolStepBase` first — which
 * performs several forward scans over the block list. With ~17 contributions
 * registered for `tool_use`, and `ChatMessage` re-rendering on every streamed
 * token, memoising this is the difference between linear and quadratic-ish work
 * over a turn. A `WeakMap` on the array means an entry dies with the block list
 * that produced it; nothing is retained across messages.
 *
 * `epoch` invalidates everything when the LIVE seam changes, because the base
 * reads live status/timing that move without the blocks moving.
 */
const baseCache = new WeakMap<object, { epoch: number; byIndex: Map<number, RailStepDescriptor | null> }>()
let cacheEpoch = -1

export function railToolStepBase(ctx: RailActivityContext): RailStepDescriptor | null {
  cacheEpoch = railLiveVersion()
  const key = ctx.blocks as unknown as object
  let entry = baseCache.get(key)
  if (!entry || entry.epoch !== cacheEpoch) {
    entry = { epoch: cacheEpoch, byIndex: new Map() }
    baseCache.set(key, entry)
  }
  const hit = entry.byIndex.get(ctx.index)
  if (hit !== undefined || entry.byIndex.has(ctx.index)) return hit ?? null
  const computed = computeToolStepBase(ctx)
  entry.byIndex.set(ctx.index, computed)
  return computed
}

function computeToolStepBase(ctx: RailActivityContext): RailStepDescriptor | null {
  const use = toolUseOf(ctx.content)
  const selfResult = toolResultOf(ctx.content)
  const toolUseId = use?.id ?? selfResult?.tool_use_id ?? null
  const name = toolNameOf(ctx.content)
  if (!use && !selfResult) return null

  const res = resultBlockFor(ctx)
  const resData = toolResultOf(res ?? undefined)
  const live = toolUseId ? getRailLiveStep(toolUseId) : null

  // Status precedence: an in-flight LIVE status (pending approval / running)
  // wins while it exists, because a persisted block cannot express it; once a
  // result block exists it is authoritative. One vocabulary throughout (INV-9) —
  // `toolStatusKey` normalises every producer's spelling.
  let status: ToolStatusKey
  if (resData) {
    // A result block exists ⇒ the call is terminal. Only CANONICAL members are
    // named here (INV-9); any raw producer spelling arrives via `live.status` and
    // is normalised by the single existing normaliser, never re-spelled.
    status = live?.status
      ? toolStatusKey(live.status, resData.is_error === true)
      : resData.is_error === true
        ? 'failed'
        : 'success'
    // A scheduler skip marker is a neutral CANCEL, never a failure (ITEM-22).
    const sc = resData.structured_content as Record<string, unknown> | undefined
    if (sc && (sc.unattended_denied === true || sc.admin_disabled === true)) {
      status = 'cancelled'
    }
  } else if (live?.status) {
    status = toolStatusKey(live.status)
  } else {
    status = 'running'
  }

  return {
    key: toolUseId || `${ctx.index}:${name ?? 'step'}`,
    label: name ?? 'Tool call',
    status,
    // INV-3 is set HERE, not in each contribution. A tool awaiting approval needs
    // the user, so it must break out of the rail rather than become a collapsible
    // row — and a domain contribution (order 40) pre-empts the generic one (order
    // 1000), so if the flag lived only in the generic contribution, EVERY
    // tool-family contribution would silently lose the guarantee the moment it
    // claimed its own tools. Putting it in the base makes it unforgettable.
    // A contribution may still override it; none needs to.
    blocking: status === 'pending-approval',
    consumed: toolStepSpan(ctx),
    artifacts: artifactsFor(ctx),
    startedAt: live?.startedAt,
    durationMs: live?.durationMs,
    toolUseId: toolUseId ?? undefined,
  }
}

/**
 * Title-case a raw tool id (`fetch_paper_fulltext` → `Fetch Paper Fulltext`) as
 * a last-resort, still-readable label. Moved here from
 * `workflow/components/run/activityDescriptors.ts` — the MECHANISM survives, the
 * central nine-module tool MAP does not.
 */
export function titleCaseToolId(tool: string): string {
  return tool
    .split(/[_\-.]+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/** Read a positive integer out of an unknown structured-content field. */
export function countOf(sc: Record<string, unknown> | null, ...keys: string[]): number | null {
  if (!sc) return null
  for (const k of keys) {
    const v = sc[k]
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (Array.isArray(v)) return v.length
  }
  return null
}

/** Read a non-empty string out of an unknown structured-content field. */
export function stringOf(sc: Record<string, unknown> | null, ...keys: string[]): string | null {
  if (!sc) return null
  for (const k of keys) {
    const v = sc[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return null
}

/** Pluralising counter helper: `countLabel(3,'result') === '3 results'`. */
export function countLabel(n: number, singular: string, plural?: string): string {
  return `${n} ${n === 1 ? singular : plural ?? `${singular}s`}`
}
