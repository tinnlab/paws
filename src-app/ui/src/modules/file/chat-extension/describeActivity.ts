import type {
  RailActivityContext,
  RailStepDescriptor,
} from '@/modules/chat/components/rail/railTypes'
import {
  countLabel,
  countOf,
  railToolStepBase,
  stringOf,
  structuredOf,
} from '@/modules/chat/components/rail/railBlocks'

/**
 * The file module's ACTIVITY-RAIL step descriptors (ITEM-18/19).
 *
 * Pure — no React, no store, no JSX — so the domain language is unit-testable
 * (TEST-30) and the `.tsx` sibling only wires a detail body.
 *
 * Every tool name below is read from the module's own MCP server
 * (`server/src/modules/files_mcp/tools.rs`) and every `structuredContent` field
 * from the handler that emits it (`files_mcp/handlers.rs`) — nothing is guessed.
 */

// ── read / search tools ────────────────────────────────────────────────────
/** Manifest of the files available in this conversation. */
export const LIST_FILES = 'list_files'
/** Paged read of a file's text (by page for documents, by line for text). */
export const READ_FILE = 'read_file'
/** Regex scan across the conversation's files. */
export const GREP_FILES = 'grep_files'
/** Document-RAG retrieval over the conversation's files. */
export const SEMANTIC_SEARCH = 'semantic_search'

// ── write tools (each appends a version / creates a file) ──────────────────
export const CREATE_FILE = 'create_file'
export const EDIT_FILE = 'edit_file'
export const EDIT_FILE_LINES = 'edit_file_lines'
export const REWRITE_FILE = 'rewrite_file'
export const CONVERT_DOCUMENT = 'convert_document'

/** The read/search half of the `files_mcp` surface. */
export const FILE_READ_TOOLS = [
  LIST_FILES,
  READ_FILE,
  GREP_FILES,
  SEMANTIC_SEARCH,
] as const

/** The write half — the tools that produce a file artifact. */
export const FILE_WRITE_TOOLS = [
  CREATE_FILE,
  EDIT_FILE,
  EDIT_FILE_LINES,
  REWRITE_FILE,
  CONVERT_DOCUMENT,
] as const

/**
 * INV-3: a step waiting on the user's approval NEEDS the user, so it must never
 * be folded into a collapsible rail row. Core does not know WHICH steps block —
 * each contribution declares it for its own tools.
 */
function withBlocking(step: RailStepDescriptor | null): RailStepDescriptor | null {
  if (!step) return null
  return step.status === 'pending-approval' ? { ...step, blocking: true } : step
}

/** Join the non-empty parts of a detail line. */
function detailOf(bits: (string | null | undefined)[]): string | undefined {
  const kept = bits.filter((b): b is string => !!b && b.length > 0)
  return kept.length > 0 ? kept.join(' · ') : undefined
}

/** A `start..end of total` range, from either the page or the line vocabulary. */
function rangeDetail(sc: Record<string, unknown> | null): string | null {
  const num = (k: string): number | null => {
    const v = sc?.[k]
    return typeof v === 'number' && Number.isFinite(v) ? v : null
  }
  const pageStart = num('page_start')
  if (pageStart != null) {
    const end = num('page_end')
    const total = num('total_pages')
    return `pages ${pageStart}–${end ?? pageStart}${total != null ? ` of ${total}` : ''}`
  }
  const lineStart = num('line_start')
  if (lineStart != null) {
    const end = num('line_end')
    const total = num('total_lines')
    return `lines ${lineStart}–${end ?? lineStart}${total != null ? ` of ${total}` : ''}`
  }
  return null
}

/**
 * `list_files` / `read_file` / `grep_files` / `semantic_search`.
 *
 * **ITEM-6 degradation is load-bearing here**, not theoretical: `read_file` on
 * an IMAGE returns an image content block and on a binary returns a plain note —
 * neither carries `structuredContent` at all. Those calls must still yield a
 * usable row, so every detail below is conditional and the label never depends
 * on the payload existing.
 */
export function describeFileReadStep(
  ctx: RailActivityContext,
): RailStepDescriptor | null {
  return withBlocking(describeFileReadStepInner(ctx))
}

function describeFileReadStepInner(
  ctx: RailActivityContext,
): RailStepDescriptor | null {
  const base = railToolStepBase(ctx)
  if (!base) return null
  const sc = structuredOf(ctx)

  switch (base.label) {
    case LIST_FILES: {
      const n = countOf(sc, 'files')
      return {
        ...base,
        label: 'Listing the files in this chat',
        detail: n != null ? countLabel(n, 'file') : undefined,
      }
    }
    case READ_FILE: {
      // `name` is present only on the text/document paths; an image or binary
      // read degrades to the label alone.
      const name = stringOf(sc, 'name')
      return {
        ...base,
        label: name ? `Reading ${name}` : 'Reading a file',
        detail: rangeDetail(sc) ?? undefined,
      }
    }
    case GREP_FILES: {
      const matches = countOf(sc, 'matches')
      return {
        ...base,
        label: 'Searching your files',
        detail: detailOf([
          matches != null ? countLabel(matches, 'match', 'matches') : null,
          sc?.truncated === true ? 'truncated' : null,
        ]),
      }
    }
    case SEMANTIC_SEARCH: {
      const results = countOf(sc, 'results')
      // The retrieval MODE (`hybrid` / `fts` / …) is what tells the reader
      // whether embeddings were actually used for this answer.
      const mode = stringOf(sc, 'mode')
      return {
        ...base,
        label: 'Searching your documents',
        detail: detailOf([
          results != null ? countLabel(results, 'passage') : null,
          mode ? mode.toLowerCase() : null,
          sc?.truncated === true ? 'truncated' : null,
        ]),
      }
    }
    default:
      // Not a files_mcp read tool — decline so the next contribution gets a turn.
      return null
  }
}

/**
 * The `files_mcp` write tools. Their results carry `{file_id, version}` (plus
 * `unchanged: true` when the bytes did not change), and the artifact itself
 * reaches the row as a chip through the base descriptor's `resource_links`.
 */
export function describeFileWriteStep(
  ctx: RailActivityContext,
): RailStepDescriptor | null {
  return withBlocking(describeFileWriteStepInner(ctx))
}

function describeFileWriteStepInner(
  ctx: RailActivityContext,
): RailStepDescriptor | null {
  const base = railToolStepBase(ctx)
  if (!base) return null
  const sc = structuredOf(ctx)

  const label = ((): string | null => {
    switch (base.label) {
      case CREATE_FILE:
        return 'Creating a file'
      case EDIT_FILE:
      case EDIT_FILE_LINES:
        return 'Editing a file'
      case REWRITE_FILE:
        return 'Rewriting a file'
      case CONVERT_DOCUMENT:
        return 'Converting a document to PDF'
      default:
        return null
    }
  })()
  if (!label) return null

  const version = countOf(sc, 'version')
  return {
    ...base,
    label,
    detail: detailOf([
      sc?.unchanged === true ? 'no change' : null,
      sc?.unchanged !== true && version != null ? `v${version}` : null,
    ]),
  }
}
