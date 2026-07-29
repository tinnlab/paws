import type {
  RailActivityContext,
  RailContribution,
  RailStepDescriptor,
} from '@/modules/chat/components/rail/railTypes'
import {
  countOf,
  countLabel,
  railToolStepBase,
  stringOf,
  structuredOf,
  toolUseOf,
} from '@/modules/chat/components/rail/railBlocks'

/**
 * Activity-rail contributions for the three built-in MCP servers that have NO
 * frontend module of their own (ITEM-20 + ITEM-28):
 *
 * - **`control_mcp`** — ziee operating itself.
 * - **`tool_result_mcp`** — exact recall of an earlier tool result.
 * - **`bio_mcp`** — the BioMCP biomedical sidecar.
 *
 * Each is a pure backend surface (a JSON-RPC route + a supervisor), so there is
 * no `modules/control/`, `modules/tool-result/` or `modules/bio/` to hang the
 * contribution off. They share this one module rather than being pushed into an
 * unrelated module's folder or — the thing this whole feature exists to delete —
 * back into a central tool map. If any of the three ever grows a real frontend
 * module, its block below moves there verbatim.
 *
 * ITEM-6 throughout: `structuredOf(ctx)` is `null` for `bio_mcp` ALWAYS (verified
 * by live probe, below) and for any oversized payload the backend's
 * `cap_structured_content` dropped, so every branch here degrades to a
 * name-only row.
 */

// ── control_mcp ──────────────────────────────────────────────────────────────
//
// Tool names: `sdk/crates/ziee-control-mcp/src/tools.rs:5-7`
//   LIST_CAPABILITIES = "list_capabilities"
//   DESCRIBE_CAPABILITY = "describe_capability"
//   INVOKE_CAPABILITY = "invoke_capability"
//
// structuredContent (built in `server/src/modules/control_mcp/handlers.rs`,
// attached by `text_result` at `handlers.rs:862`):
//   list_capabilities   → {operations, returned, total, truncated}      (handlers.rs:562-567)
//   describe_capability → {operation_id, method, path_template,
//                          required_permission, mutating, requires_approval,
//                          path_params, parameters, request_schema, summary}
//                                                                        (handlers.rs:614-625)
//   invoke_capability   → {operation_id, status, ok, truncated, response} (handlers.rs:723-729)

const CONTROL_LABELS: Record<string, string> = {
  list_capabilities: 'Looking up what it can do in ziee',
  describe_capability: 'Reading a ziee operation',
  invoke_capability: 'Running a ziee operation',
}

export function describeControlActivity(
  ctx: RailActivityContext,
): RailStepDescriptor | null {
  const base = railToolStepBase(ctx)
  if (!base) return null
  const label = CONTROL_LABELS[base.label]
  if (!label) return null

  // A mutating `invoke_capability` is ALWAYS forced through approval — even under
  // AutoApprove (`control_mcp/handlers.rs::control_call_needs_approval`). That is
  // a request for the user, so it must break out of the rail (INV-3).
  const blocking = base.status === 'pending-approval'
  const sc = structuredOf(ctx)
  let detail: string | null = null

  if (base.label === 'list_capabilities') {
    const total = countOf(sc, 'total', 'returned', 'operations')
    detail = total === null ? null : countLabel(total, 'operation')
  } else {
    // Both `describe_capability` and `invoke_capability` name the operation.
    const op = stringOf(sc, 'operation_id')
    const httpStatus = countOf(sc, 'status')
    if (base.label === 'invoke_capability' && op && httpStatus !== null) {
      detail = `${op} → HTTP ${httpStatus}`
    } else {
      detail = op
    }
  }

  return { ...base, label, blocking, ...(detail ? { detail } : {}) }
}

// ── tool_result_mcp ──────────────────────────────────────────────────────────
//
// Tool name: `server/src/modules/tool_result_mcp/tools.rs:8` → "get_tool_result"
// structuredContent: `{tool_use_id, total_chars, offset, returned_chars, has_more}`
//   (`server/src/modules/tool_result_mcp/handlers.rs:235-243`)

export function describeToolResultActivity(
  ctx: RailActivityContext,
): RailStepDescriptor | null {
  const base = railToolStepBase(ctx)
  if (!base || base.label !== 'get_tool_result') return null

  const sc = structuredOf(ctx)
  const returned = countOf(sc, 'returned_chars')
  const total = countOf(sc, 'total_chars')
  let detail: string | null = null
  if (returned !== null && total !== null && total > returned) {
    detail = `${returned.toLocaleString()} of ${total.toLocaleString()} chars`
  } else if (total !== null) {
    detail = `${total.toLocaleString()} chars`
  }

  return {
    ...base,
    label: 'Re-reading an earlier tool result',
    blocking: base.status === 'pending-approval',
    ...(detail ? { detail } : {}),
  }
}

// ── bio_mcp ──────────────────────────────────────────────────────────────────
//
// DEC-10 / ITEM-28. `bio_mcp/handlers.rs` is a PURE reverse proxy, so no tool
// name is knowable in-tree. The names below come from a LIVE sidecar probe
// (`biomcp serve-http` → MCP `initialize` + `tools/list`, biomcp 0.8.23), whose
// output is committed at `server/tests/bio_mcp/tool_names_fixture.json` and
// contract-tested by TEST-34. The probe returned exactly ONE tool:
//
//   name: "biomcp", inputSchema: {command: string} (required)
//
// and TWO live `tools/call` probes returned `structuredContent: null`, so the
// detail here is derived from the tool_use INPUT, never from structured content.
// Any bio tool NOT in the fixture falls through to `mcp`'s generic step and
// degrades to a name-only row (ITEM-6) — exactly the pre-fixture behaviour.

/** The observed BioMCP tool surface — kept in lockstep with the fixture. */
export const BIO_TOOL_NAMES = ['biomcp'] as const

/** Longest `command` echoed onto a rail row before it is ellipsised. */
const BIO_COMMAND_MAX = 64

export function describeBioActivity(
  ctx: RailActivityContext,
): RailStepDescriptor | null {
  const base = railToolStepBase(ctx)
  if (!base) return null
  if (!(BIO_TOOL_NAMES as readonly string[]).includes(base.label)) return null

  // The whole ~45-database surface rides one CLI-shaped `command` string, so it
  // IS the only meaningful thing to show. `input` is `unknown` on the wire type,
  // so every access is guarded — a missing/oddly-shaped input degrades the row to
  // name-only rather than throwing (`describeActivity` must never throw).
  const input = toolUseOf(ctx.content)?.input
  let command: string | null = null
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const raw = (input as Record<string, unknown>).command
    if (typeof raw === 'string' && raw.trim()) command = raw.trim()
  }
  const detail =
    command && command.length > BIO_COMMAND_MAX
      ? `${command.slice(0, BIO_COMMAND_MAX - 1)}…`
      : command

  return {
    ...base,
    label: 'Searching biomedical databases',
    blocking: base.status === 'pending-approval',
    ...(detail ? { detail } : {}),
  }
}

/**
 * All three registered at order 40 — ahead of `mcp`'s generic fallback (1000).
 * They match on disjoint tool names, so their relative order is irrelevant.
 */
export const mcpBuiltinsRailContributions: RailContribution[] = [
  { contentTypes: ['tool_use'], order: 40, describeActivity: describeControlActivity },
  { contentTypes: ['tool_use'], order: 40, describeActivity: describeToolResultActivity },
  { contentTypes: ['tool_use'], order: 40, describeActivity: describeBioActivity },
]
