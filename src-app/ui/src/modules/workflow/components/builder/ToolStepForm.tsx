import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Alert, Button, Combobox, Input } from '@ziee/kit'
import { McpServer } from '@/modules/mcp/stores/mcpServer'
import type { WorkflowBuilderStore } from '../../stores/WorkflowBuilder.store'
import {
  ToolCatalogStoreDef,
  entryForServerName,
  failureMessage,
} from '../../stores/ToolCatalog.store'
import { type BuilderStep, configErrors } from './stepForms'
import { LabeledControl } from './builderFields'
import { CapabilitySelect } from './capabilities'
import { ToolArgumentsForm } from './ToolArgumentsForm'
import { describeToolSchema, splitArguments } from './toolSchemaForm'

type ToolStep = Extract<BuilderStep, { kind: 'tool' }>

interface Props {
  store: WorkflowBuilderStore
  step: ToolStep
}

interface ArgRow {
  rowId: number
  key: string
  /** The editable text shown in the value input. */
  text: string
  /** The typed value this row commits. Authoritative (emitted UNCHANGED)
   *  while `text === baseText` — i.e. the row hasn't been edited since it was
   *  loaded or last re-derived. This is what preserves an untouched string
   *  arg's exact type (`"1234"` stays the string, not the number 1234). */
  value: unknown
  /** The `text` that `value` was derived from, captured on load. A row is
   *  "edited" (and its value re-derived from `text`) iff `text !== baseText`. */
  baseText: string
}

/** Does JSON-parsing `s` give the same string back? True when `s` isn't valid
 *  JSON at all (plain text, `{{ refs }}`) or parses to a string. When FALSE,
 *  `s` looks like a number/bool/null/object (`"1234"`, `"true"`, `{"a":1}`) and
 *  must be quoted so it survives a `parseValue` round-trip AS a string. */
function reparsesToString(s: string): boolean {
  try {
    return typeof JSON.parse(s.trim()) === 'string'
  } catch {
    return true
  }
}

/** Render a loaded argument value as round-trip-STABLE editor text: `parseValue`
 *  of the result reproduces the exact same typed value. A bare number/boolean/
 *  object/array and a `{{ ref }}` template render as-is; a STRING that would
 *  otherwise be reinterpreted (`"1234"`→number, `"true"`→bool) is JSON-quoted so
 *  it parses back to that same string. */
function toText(v: unknown): string {
  if (v === undefined) return ''
  if (typeof v === 'string') {
    // Bare string is fine only when `parseValue` would return it verbatim;
    // otherwise quote it (`"1234"`) so the round-trip preserves the string type.
    return reparsesToString(v) ? v : JSON.stringify(v)
  }
  // `null`→"null", number→"10", boolean→"true", object/array→JSON — each
  // re-parses back to the same typed value in `parseValue`.
  return JSON.stringify(v)
}

/** Turn a text field back into a typed value: parse it as JSON (so `10`→number,
 *  `true`→boolean, `null`, `[…]`, `{…}` round-trip as themselves); fall back to
 *  the raw string when it isn't valid JSON (covers plain text + `{{ refs }}`). */
function parseValue(raw: string): unknown {
  const trimmed = raw.trim()
  if (trimmed === '') return ''
  try {
    return JSON.parse(trimmed)
  } catch {
    return raw
  }
}

function argsToRows(args: unknown, nextRowId: () => number): ArgRow[] {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return []
  return Object.entries(args as Record<string, unknown>).map(([key, value]) => {
    const text = toText(value)
    // Load-time value is authoritative: baseText === text, so an untouched row
    // re-emits `value` unchanged (never re-parsed) on subsequent commits.
    return { rowId: nextRowId(), key, text, value, baseText: text }
  })
}

/** Serialize rows to an arguments object. A row whose `text` is unchanged since
 *  load re-emits its EXACT loaded value (no re-parse — so editing row A can't
 *  coerce an untouched string row B); only a genuinely-edited row (`text !==
 *  baseText`) is re-derived from its text via `parseValue`. */
function rowsToArgs(rows: ArgRow[]): Record<string, unknown> {
  const obj: Record<string, unknown> = {}
  for (const r of rows) {
    if (r.key.trim()) {
      obj[r.key.trim()] = r.text === r.baseText ? r.value : parseValue(r.text)
    }
  }
  return obj
}

/**
 * Call one specific tool on a server.
 *
 * The Tool field is a PICKER over the chosen server's real tools, and the
 * Arguments are GENERATED from the chosen tool's declared input schema — the
 * house rule that a person never types what the system can enumerate or supply
 * (INV-3 / INV-4). Both degrade to hand entry WITH A STATED REASON when the
 * server can't be reached or the tool declares no schema (INV-6).
 *
 * Keyed by step id by the panel, so local buffers reset on step switch.
 */
export function ToolStepForm({ store, step }: Props) {
  const errors = configErrors(step)
  const patch = (p: Record<string, unknown>) => store.updateStep(step.id, p)

  const catalog = ToolCatalogStoreDef.use()
  const servers = McpServer.servers
  const byServerId = catalog.byServerId

  // A step stores the server NAME (`resolve_tool_server` resolves by name at run
  // time); the tools endpoint is keyed by id, so resolve name → id here.
  const { entry, serverId } = useMemo(
    () =>
      entryForServerName(
        step.server,
        (servers ?? []).map(s => ({ id: s.id, name: s.name })),
        byServerId,
      ),
    [step.server, servers, byServerId],
  )

  useEffect(() => {
    if (serverId && step.server) void catalog.load(serverId, step.server)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId, step.server])

  const toolOptions = useMemo(
    () =>
      entry.tools.map(t => ({
        value: t.name,
        label: t.description ? `${t.name} — ${t.description}` : t.name,
      })),
    [entry.tools],
  )

  const selectedTool = entry.tools.find(t => t.name === step.tool)
  const spec = useMemo(
    () => (selectedTool ? describeToolSchema(selectedTool.input_schema) : null),
    [selectedTool],
  )

  // A catalog we could not read at all ⇒ the documented hand-entry escape hatch.
  // `no-server` is NOT a failure to report — it is the ordinary initial state.
  const blockingFailure =
    entry.failure && entry.failure.kind !== 'no-server' ? entry.failure : null
  const usePicker = !blockingFailure && !entry.loading && toolOptions.length > 0
  // The generated form applies only when the chosen tool actually declared one.
  const useGenerated = !!spec

  // ── Free key/value rows: the fallback editor, and the "Additional arguments"
  // section that keeps schema-undeclared keys alive (DEC-6). The round-trip
  // machinery above is preserved verbatim for exactly these rows.
  const rowIdSeq = useRef(0)
  const nextRowId = () => {
    rowIdSeq.current += 1
    return rowIdSeq.current
  }

  const { known, extra } = useMemo(
    () => splitArguments(step.arguments, spec),
    [step.arguments, spec],
  )

  const [rows, setRows] = useState<ArgRow[]>(() =>
    argsToRows(useGenerated ? extra : step.arguments, nextRowId),
  )

  // Serialized snapshot of the rows' source as we last saw it, so we can tell an
  // external change (a sync refetch replacing `step.arguments`) apart from our
  // own commit and only resync the buffer for the former (FIX-F).
  const argsSnapshot = (a: unknown) =>
    JSON.stringify(a && typeof a === 'object' && !Array.isArray(a) ? a : {})
  const lastPushed = useRef<string>(
    argsSnapshot(useGenerated ? extra : step.arguments),
  )

  useEffect(() => {
    const source = useGenerated ? extra : step.arguments
    const incoming = argsSnapshot(source)
    if (incoming !== lastPushed.current) {
      lastPushed.current = incoming
      setRows(argsToRows(source, nextRowId))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.arguments, useGenerated])

  /** Commit the free rows, merging the generated values back in so neither half
   *  can clobber the other. */
  const commitRows = (next: ArgRow[]) => {
    setRows(next)
    const rowObj = rowsToArgs(next)
    lastPushed.current = JSON.stringify(rowObj)
    patch({ arguments: useGenerated ? { ...known, ...rowObj } : rowObj })
  }

  /** Commit one generated field, preserving every schema-undeclared key. */
  const commitField = (name: string, value: unknown) => {
    const nextKnown = { ...known }
    if (value === undefined || value === '') delete nextKnown[name]
    else nextKnown[name] = value
    patch({ arguments: { ...nextKnown, ...rowsToArgs(rows) } })
  }

  const addRow = () => {
    setRows([
      ...rows,
      { rowId: nextRowId(), key: '', text: '', value: '', baseText: '' },
    ])
  }

  return (
    <div className="flex flex-col gap-4">
      <LabeledControl label="Server" required error={errors.server}>
        <CapabilitySelect
          value={step.server ?? ''}
          onChange={v => {
            // Switching server invalidates the tool AND its arguments — keeping
            // them would silently send server A's arguments to server B's tool.
            patch({ server: v, tool: '', arguments: {} })
          }}
          testid="wf-builder-tool-server"
        />
      </LabeledControl>

      {blockingFailure && (
        <Alert
          data-testid="wf-builder-tool-catalog-error"
          tone="warning"
          title="Tool list unavailable"
          description={failureMessage(blockingFailure)}
        />
      )}

      <LabeledControl
        label="Tool"
        description={
          usePicker
            ? 'Pick the tool this step should call.'
            : 'The exact name of the tool to call on that server.'
        }
        required
        error={errors.tool}
      >
        {usePicker ? (
          <Combobox
            data-testid="wf-builder-tool-name"
            aria-label="Tool"
            options={toolOptions}
            value={step.tool ?? ''}
            onChange={v => patch({ tool: v, arguments: {} })}
            loading={entry.loading}
            placeholder="Search this server's tools…"
            emptyText="No tool matches"
          />
        ) : (
          <Input
            data-testid="wf-builder-tool-name"
            value={step.tool ?? ''}
            onChange={e => patch({ tool: e.target.value })}
            placeholder={
              entry.loading ? 'Loading this server’s tools…' : 'e.g. search'
            }
            disabled={entry.loading}
          />
        )}
      </LabeledControl>

      {useGenerated && spec && (
        <ToolArgumentsForm
          store={store}
          stepId={step.id}
          spec={spec}
          values={known}
          onChange={commitField}
        />
      )}

      <LabeledControl
        label={useGenerated ? 'Additional arguments' : 'Arguments'}
        description={
          useGenerated
            ? 'Extra values this tool did not declare. Usually empty.'
            : 'Key/value pairs passed to the tool. A value may reference an input or prior step, e.g. {{ inputs.query }}.'
        }
      >
        <div className="flex flex-col gap-2">
          {rows.length === 0 && (
            <span className="text-xs text-muted-foreground">No arguments</span>
          )}
          {rows.map((row, i) => (
            <div key={row.rowId} className="flex items-center gap-2">
              <Input
                data-testid={`wf-builder-tool-arg-key-${i}`}
                aria-label="Argument name"
                className="w-1/3"
                value={row.key}
                onChange={e =>
                  commitRows(
                    rows.map(r =>
                      r.rowId === row.rowId ? { ...r, key: e.target.value } : r,
                    ),
                  )
                }
                placeholder="name"
              />
              <Input
                data-testid={`wf-builder-tool-arg-value-${i}`}
                aria-label="Argument value"
                className="flex-1"
                value={row.text}
                onChange={e =>
                  commitRows(
                    rows.map(r =>
                      r.rowId === row.rowId
                        ? { ...r, text: e.target.value }
                        : r,
                    ),
                  )
                }
                placeholder="value or {{ reference }}"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                icon={<Trash2 />}
                aria-label="Remove argument"
                data-testid={`wf-builder-tool-arg-remove-${i}`}
                onClick={() => commitRows(rows.filter(r => r.rowId !== row.rowId))}
              />
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            icon={<Plus />}
            data-testid="wf-builder-tool-arg-add"
            onClick={addRow}
            className="self-start"
          >
            Add argument
          </Button>
        </div>
      </LabeledControl>
    </div>
  )
}
