import type { MessageContentDataToolUse } from '@/api-client/types'
import {
  countLabel,
  countOf,
  railToolStepBase,
  stringOf,
  structuredOf,
} from '@/modules/chat/components/rail/railBlocks'
import type {
  RailActivityContext,
  RailContribution,
  RailStepDescriptor,
} from '@/modules/chat/components/rail/railTypes'

/**
 * The `code_sandbox` module's rail step descriptors (ITEM-19).
 *
 * Wire contract, read out of the server (not invented) — tool names are
 * registered in `code_sandbox/handlers.rs` and dispatched by `invoke_tool`
 * (`handlers.rs:332-400`):
 *
 * | tool | registered | `structuredContent` |
 * |---|---|---|
 * | `execute_command` | `handlers.rs:1207` | `{stdout, stderr, exit_code, timed_out, duration_ms, stdout_truncated, stderr_truncated, flavor}` (+ optional `fetch_info` / `system_note` / `mounts` / `mount_notes`) — `sdk/crates/ziee-sandbox/src/tools/execute.rs:174-208` |
 * | `read_file` | `handlers.rs:1271` | `{text, total_lines}` — `tools/files.rs:190,197` |
 * | `write_file` | `handlers.rs:1299` | `{success, bytes_written}` — `tools/files.rs:373` |
 * | `edit_file` | `handlers.rs:1320` | `{success}` — `tools/files.rs:431` |
 * | `list_files` | `handlers.rs:1355` | `{files:[{name,size,is_file}]}` — `tools/files.rs:471,503,517` |
 * | `get_resource_link` | `handlers.rs:1363` | an MCP `resource_link` block `{type,uri,name,mimeType,description,is_saved,…}` — `tools/files.rs:565,608` |
 * | `list_sandbox_environments` | `handlers.rs:1411` | `{available:[…]}` — `handlers.rs:424,514-516` |
 *
 * The whole result object IS the `structuredContent` for this server
 * (`code_sandbox/handlers.rs:311`), so every number below is read from typed
 * fields, never parsed out of the text channel. A dropped payload
 * (`cap_structured_content`) still yields the base name-only row (ITEM-6).
 */

/** Human-scale wall time. `1200` → `1.2s`, `950` → `950ms`, `65_000` → `1m 5s`. */
export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return ''
  if (ms < 1000) return `${Math.round(ms)}ms`
  const secs = ms / 1000
  if (secs < 60) return `${secs.toFixed(1)}s`
  const m = Math.floor(secs / 60)
  const s = Math.round(secs - m * 60)
  return `${m}m ${s}s`
}

/**
 * The file name a file tool acted on, from the `tool_use`'s TYPED arguments.
 *
 * `tool_use.input` is structured JSON on the wire
 * (`api-client/types.ts` `MessageContentDataToolUse.input`), not the free-text
 * result channel — the rule this feature enforces is "never scrape the text
 * rendering", and this does not. It is the only place the file name exists at
 * all: the sandbox's file-tool results deliberately return only the payload
 * (`{text,total_lines}` / `{success,bytes_written}`), never an echo of the name.
 */
function filenameOf(ctx: RailActivityContext): string | null {
  const use = ctx.content.content as MessageContentDataToolUse | undefined
  const input = use?.input
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const v = (input as Record<string, unknown>).filename
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/** `a · b · c`, skipping blanks. */
function joinDetail(bits: (string | null | undefined)[]): string | undefined {
  const kept = bits.filter(
    (b): b is string => typeof b === 'string' && b.length > 0,
  )
  return kept.length ? kept.join(' · ') : undefined
}

export function describeActivity(
  ctx: RailActivityContext,
): RailStepDescriptor | null {
  const base = railToolStepBase(ctx)
  if (!base) return null
  const sc = structuredOf(ctx)

  switch (base.label) {
    case 'execute_command': {
      const exit = typeof sc?.exit_code === 'number' ? sc.exit_code : null
      const durationMs =
        typeof sc?.duration_ms === 'number' ? sc.duration_ms : null
      const timedOut = sc?.timed_out === true
      // `timed_out` is the ONE in-tree producer of `ToolStatusKey.timeout`
      // (ITEM-9). The base status is derived from the result block, which
      // carries `isError:false` for a timed-out run — so without this override a
      // timeout would render as a plain success, and with a naive `is_error`
      // reading it would render as `failed` (red, reserved for a real error).
      // Amber `timeout` is the correct, distinct vocabulary entry (INV-9).
      const status = timedOut ? ('timeout' as const) : base.status
      // A non-zero exit is NOT mapped to `failed`: a command exiting 1 is a
      // routine, expected outcome in an agentic loop (`grep` with no match), and
      // `failed` force-opens the rail (ITEM-9). The code is reported instead.
      return {
        ...base,
        label: 'Running a command',
        status,
        detail: joinDetail([
          timedOut ? 'timed out' : exit != null ? `exit ${exit}` : null,
          durationMs != null ? formatDurationMs(durationMs) : null,
          stringOf(sc, 'flavor'),
        ]),
        durationMs: durationMs ?? base.durationMs,
      }
    }
    case 'read_file': {
      const lines = countOf(sc, 'total_lines')
      return {
        ...base,
        label: 'Reading a file',
        detail: joinDetail([
          filenameOf(ctx),
          lines != null ? countLabel(lines, 'line') : null,
        ]),
      }
    }
    case 'write_file': {
      const bytes = countOf(sc, 'bytes_written')
      return {
        ...base,
        label: 'Writing a file',
        detail: joinDetail([
          filenameOf(ctx),
          bytes != null ? countLabel(bytes, 'byte') : null,
        ]),
      }
    }
    case 'edit_file': {
      return {
        ...base,
        label: 'Editing a file',
        detail: joinDetail([
          filenameOf(ctx),
          sc?.success === true ? 'saved' : null,
        ]),
      }
    }
    case 'list_files': {
      const n = countOf(sc, 'files')
      return {
        ...base,
        label: 'Listing workspace files',
        detail: n != null ? countLabel(n, 'file') : undefined,
      }
    }
    case 'get_resource_link': {
      return {
        ...base,
        label: 'Attaching a workspace file',
        detail: stringOf(sc, 'name') ?? filenameOf(ctx) ?? undefined,
      }
    }
    case 'list_sandbox_environments': {
      const n = countOf(sc, 'available')
      return {
        ...base,
        label: 'Listing sandbox environments',
        detail: n != null ? countLabel(n, 'environment') : undefined,
      }
    }
    default:
      return null
  }
}

/** Steps for the code_sandbox tool family. Order 40 — below mcp's generic
 *  fallback at 1000, so this module's language wins over the title-cased id. */
export const codeSandboxRailContributions: RailContribution[] = [
  {
    contentTypes: ['tool_use'],
    order: 40,
    describeActivity,
  },
]
