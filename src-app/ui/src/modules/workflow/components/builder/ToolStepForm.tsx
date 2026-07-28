import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, RefreshCw, Trash2 } from 'lucide-react'
import { Alert, Button, Combobox, Input } from '@ziee/kit'
import { Permissions } from '@/api-client/permissions'
import { usePermission } from '@/core/permissions'
import { McpServer } from '@/modules/mcp/stores/mcpServer'
import type { WorkflowBuilderStore } from '../../stores/WorkflowBuilder.store'
import {
  ToolCatalogStoreDef,
  entryForServerName,
  failureMessage,
  failureTitle,
  isRetryableFailure,
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
  // The accessible-server list is LAZY: it is empty on the first frames after a
  // cold load. Until it has answered once (or failed trying), its emptiness is
  // not evidence that a step's server does not exist.
  //
  // BOTH reads are hoisted and unconditional. A store-proxy read IS a hook
  // (useEffect + useStore), so putting `McpServer.error` on the right of a `||`
  // makes the hook count vary with `isInitialized` — React then crashes the
  // frame that flips it. Read first, combine second.
  const serversInitialized = McpServer.isInitialized
  const serversError = McpServer.error
  const serversSettled = serversInitialized || !!serversError
  const byServerId = catalog.byServerId
  const serverByName = catalog.serverByName
  // `loadMcpServers` returns at its own permission gate without setting EITHER
  // flag, so for a user without `mcp_servers::read` the list above never
  // settles and never explains itself. Reactive (`usePermission`, not
  // `hasPermissionNow`) so a grant arriving mid-session opens the picker.
  const canListServers = usePermission(Permissions.McpServersRead)

  // A step stores the server NAME (`resolve_tool_server` resolves by name at run
  // time); the tools endpoint is keyed by id, so resolve name → id here.
  // A DISABLED server is passed through rather than filtered out: dropping it
  // made the step read as pointing at a server that does not exist, which is a
  // different — and false — thing to tell the author.
  const { entry, serverId, needsLookup } = useMemo(
    () =>
      entryForServerName(
        step.server,
        (servers ?? []).map(s => ({ id: s.id, name: s.name, enabled: s.enabled })),
        byServerId,
        { listReady: serversSettled, lookups: serverByName, canList: canListServers },
      ),
    [step.server, servers, serversSettled, byServerId, serverByName, canListServers],
  )

  useEffect(() => {
    // The loaded page can't answer for this name — ask the API about this ONE
    // server rather than guessing from a paginated slice.
    if (needsLookup && step.server) void catalog.resolveServer(step.server, store)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsLookup, step.server])

  useEffect(() => {
    // `store` is the SCOPE: the tool list is cached for this editing session, so
    // clicking between steps doesn't refetch (and re-handshake a stdio server).
    if (serverId && step.server) void catalog.load(serverId, step.server, store)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId, step.server])

  const serverToolOptions = useMemo(
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
  // `no-server` and `resolving-server` are NOT failures to report in the Alert —
  // one is the ordinary initial state, the other is a transient lookup — but
  // both still get said, on the Tool field itself (below).
  const transientKind =
    entry.failure?.kind === 'no-server' || entry.failure?.kind === 'resolving-server'
  const blockingFailure = entry.failure && !transientKind ? entry.failure : null
  /**
   * A server id we have resolved but never ASKED about. `catalog.load` runs in a
   * passive effect, so the frame that first resolves `serverId` is committed —
   * and paintable — while `byServerId` still has no entry for it. `entry` is
   * `EMPTY` there (no failure, `loading:false`), which is indistinguishable from
   * a settled empty answer: the field rendered as the ENABLED hand-entry box,
   * under the generic "the exact name of the tool" blurb, before anything had
   * been asked of the server. An author typing in that frame was silently in the
   * fallback, which INV-6 forbids. "Not asked yet" is busy, not settled.
   */
  const awaitingCatalog = !!serverId && !byServerId[serverId]
  /** Nothing can be decided about the tool list yet. */
  const busy =
    entry.loading || awaitingCatalog || entry.failure?.kind === 'resolving-server'
  const usePicker = !blockingFailure && !busy && serverToolOptions.length > 0
  // The generated form applies only when the chosen tool actually declared one.
  const useGenerated = !!spec

  // A saved tool the server no longer offers would render as an EMPTY picker
  // (the kit Combobox maps an unknown value to null), so a renamed upstream tool
  // vanished from view while the definition still carried it — and the required
  // check can't catch it, because the value is present. Keep it in the list, and
  // say why it is there.
  const storedTool = step.tool ?? ''
  const storedToolMissing =
    usePicker && !!storedTool && !entry.tools.some(t => t.name === storedTool)
  // Memoized: the kit Combobox rebuilds its item index from `options` identity.
  const toolOptions = useMemo(
    () =>
      storedToolMissing
        ? [
            {
              value: storedTool,
              label: `${storedTool} — not offered by this server any more`,
            },
            ...serverToolOptions,
          ]
        : serverToolOptions,
    [storedToolMissing, storedTool, serverToolOptions],
  )

  const toolDescription = storedToolMissing
    ? `"${storedTool}" is no longer in this server's tool list. Pick one of the tools it offers now, or choose a different server.`
    : usePicker
      ? 'Pick the tool this step should call.'
      : transientKind && entry.failure
        ? failureMessage(entry.failure)
        : 'The exact name of the tool to call on that server.'

  /** Ask again — for whichever of the two questions we failed to answer: which
   *  server this name is, or which tools that server offers. */
  const retryCatalog = () => {
    if (!step.server) return
    if (serverId) {
      catalog.invalidate(serverId, store)
      void catalog.load(serverId, step.server, store)
      return
    }
    catalog.invalidateServer(step.server, store)
    void catalog.resolveServer(step.server, store)
  }

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
  /** The snapshot of what the ROW BUFFER will read back after a commit. It must
   *  be taken through the same `splitArguments` filter the effect below reads
   *  through, or the two are not comparable: recording the whole row object
   *  while the effect compared only the UNDECLARED half meant that the moment a
   *  row's key finished spelling a declared property name, our own commit looked
   *  like somebody else's edit and the row was rebuilt out from under the caret
   *  — the row simply vanished mid-keystroke. */
  const rowsPushedSnapshot = (rowObj: Record<string, unknown>) =>
    argsSnapshot(useGenerated ? splitArguments(rowObj, spec).extra : rowObj)
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
    lastPushed.current = rowsPushedSnapshot(rowObj)
    patch({ arguments: useGenerated ? { ...known, ...rowObj } : rowObj })
  }

  /**
   * A free row whose key has become a DECLARED property name is absorbed into
   * that typed field — on BLUR, never mid-keystroke. Its value is already in
   * `arguments` (and `known` therefore already carries it), so dropping the row
   * hands the value to the generated control instead of leaving two editors
   * writing the same key, where the row's copy would silently overwrite
   * whatever the author typed into the typed field.
   */
  const absorbDeclaredRow = (row: ArgRow) => {
    if (!useGenerated || !spec) return
    const key = row.key.trim()
    if (!key || !spec.fields.some(f => f.name === key)) return
    commitRows(rows.filter(r => r.rowId !== row.rowId))
  }

  /** Commit one generated field, preserving every schema-undeclared key. */
  const commitField = (name: string, value: unknown) => {
    const nextKnown = { ...known }
    if (value === undefined || value === '') delete nextKnown[name]
    else nextKnown[name] = value
    const rowObj = rowsToArgs(rows)
    // In the brief window where a free row's key spells THIS field's name (until
    // the row is left and absorbed), the row must not win: the rows are merged
    // last, so without this the author's edit to the typed control was silently
    // overwritten by the row's stale copy.
    delete rowObj[name]
    patch({ arguments: { ...nextKnown, ...rowObj } })
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
          // A server that answered and simply has no tools is not a warning.
          tone={blockingFailure.kind === 'no-tools' ? 'info' : 'warning'}
          title={failureTitle(blockingFailure)}
          description={failureMessage(blockingFailure)}
        >
          {/* No `serverId &&` guard: the retryable failures now include the
              ones where the server id is exactly what we could not establish. */}
          {isRetryableFailure(blockingFailure) && (
            <div className="mt-2">
              <Button
                type="button"
                variant="outline"
                icon={<RefreshCw />}
                data-testid="wf-builder-tool-catalog-retry"
                onClick={retryCatalog}
              >
                Try again
              </Button>
            </div>
          )}
        </Alert>
      )}

      <LabeledControl
        label="Tool"
        description={toolDescription}
        required
        error={errors.tool}
      >
        {usePicker ? (
          <Combobox
            data-testid="wf-builder-tool-name"
            aria-label="Tool"
            options={toolOptions}
            value={step.tool ?? ''}
            // Base UI fires `onChange` on EVERY item press, including a re-select
            // of the row that is already highlighted. Without this guard, opening
            // the picker to re-read a description and clicking the selected row
            // wiped every argument the author had filled in.
            onChange={v => {
              if (v === (step.tool ?? '')) return
              patch({ tool: v, arguments: {} })
            }}
            loading={busy}
            placeholder="Search this server's tools…"
            emptyText="No tool matches"
          />
        ) : (
          <Input
            data-testid="wf-builder-tool-name"
            value={step.tool ?? ''}
            onChange={e => patch({ tool: e.target.value })}
            placeholder={
              entry.failure?.kind === 'resolving-server'
                ? 'Looking up this server…'
                : // `busy` — not `entry.loading` — so the frame BEFORE the fetch
                  // starts says what it is doing rather than inviting entry.
                  busy
                  ? 'Loading this server’s tools…'
                  : 'e.g. search'
            }
            disabled={busy}
          />
        )}
      </LabeledControl>

      {useGenerated && spec && (
        <ToolArgumentsForm
          store={store}
          stepId={step.id}
          spec={spec}
          toolKey={selectedTool?.name ?? storedTool}
          values={known}
          onChange={commitField}
        />
      )}

      <LabeledControl
        label={useGenerated ? 'Additional arguments' : 'Arguments'}
        description={
          useGenerated
            ? 'Extra values this tool did not declare. Usually empty.'
            : selectedTool
              ? // §2.5 — the tool WAS found, it just publishes no input schema.
                // Falling back to key/value rows with the generic blurb left the
                // author guessing why no typed fields appeared.
                `"${selectedTool.name}" doesn't publish a list of the arguments it accepts, so enter them as key/value pairs. A value may reference an input or prior step, e.g. {{ inputs.query }}.`
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
                onBlur={() => absorbDeclaredRow(row)}
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
