import { useEffect, useRef, useState } from 'react'
import { Braces, Undo2 } from 'lucide-react'
import {
  Button,
  Input,
  InputNumber,
  MultiSelect,
  Select,
  Switch,
  Text,
  Textarea,
} from '@ziee/kit'
import type { WorkflowBuilderStore } from '../../stores/WorkflowBuilder.store'
import { LabeledControl } from './builderFields'
import { RefInsertMenu } from './RefInsertMenu'
import {
  type ToolField,
  type ToolFormSpec,
  coerceToDeclared,
  isTemplateValue,
  optionKeyForValue,
  optionKeysForValues,
  optionValueForKey,
  optionValuesForKeys,
  valueToText,
} from './toolSchemaForm'

// ---------------------------------------------------------------------------
// The arguments form GENERATED from the chosen tool's declared input schema
// (ITEM-7, INV-4). One typed control per declared property, carrying its
// requiredness, type, description and default — the author never invents an
// argument key.
//
// INV-5 (templating survives) is the subtle half. A typed control physically
// cannot hold `{{ inputs.limit }}` — an InputNumber would reject it — so a field
// holding a reference renders as TEMPLATE TEXT with a visible marker and a
// one-click way BACK to the typed control (DEC-5). Every field can therefore
// take a reference wherever it would take a literal, without the author being
// trapped in template mode.
// ---------------------------------------------------------------------------

interface Props {
  store: WorkflowBuilderStore
  stepId: string
  spec: ToolFormSpec
  /** Current values for the declared properties. */
  values: Record<string, unknown>
  /** Commit one property. `undefined` removes it. */
  onChange: (name: string, value: unknown) => void
}

function testidFor(name: string) {
  return `wf-builder-tool-arg-field-${name}`
}

/** Nothing has been supplied for this field (an empty multi-select included). */
function isBlank(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true
  return Array.isArray(value) && value.length === 0
}

/** Would committing `next` actually change anything? Used to keep a plain blur
 *  from patching the definition (and marking the workflow dirty) for free. */
function sameValue(a: unknown, b: unknown): boolean {
  if (isBlank(a) && isBlank(b)) return true
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

/** One generated control. Split out so each field owns its template/typed mode. */
function GeneratedField({
  store,
  stepId,
  field,
  value,
  onChange,
}: {
  store: WorkflowBuilderStore
  stepId: string
  field: ToolField
  value: unknown
  onChange: (value: unknown) => void
}) {
  const testid = testidFor(field.name)

  // A control that is ALREADY free text can hold `{{ … }}` natively, so it never
  // switches modes. DEC-5's mode switch exists only for the controls that
  // physically cannot hold a reference (number / switch / select / multi-select)
  // — and applying it to a text control was actively harmful: authoring
  // `{"userId": "{{ inputs.user }}"}` in a JSON textarea made the value "contain
  // a reference", which collapsed the 4-row textarea into a one-line Input
  // mid-keystroke.
  const canHoldTemplate =
    field.kind === 'text' || field.kind === 'textarea' || field.kind === 'json'

  // For the rest, template mode is STICKY rather than re-derived from the value
  // on every keystroke. Deriving it made a partial edit self-destruct:
  // backspacing the closing `}}` of `{{ inputs.limit }}` turned the value into a
  // non-reference, which flipped the control back to the typed one — whose value
  // guard rejects the corrupt string — so the field rendered EMPTY while the
  // corrupt value stayed in the definition and the "use a value instead" undo
  // disappeared. A reference now LATCHES the mode (on mount for a loaded
  // reference, on insert for a new one) and only the explicit button leaves it.
  const [templateMode, setTemplateMode] = useState(
    () => !canHoldTemplate && isTemplateValue(value),
  )
  useEffect(() => {
    if (!canHoldTemplate && isTemplateValue(value)) setTemplateMode(true)
  }, [value, canHoldTemplate])
  const templated = !canHoldTemplate && (templateMode || isTemplateValue(value))

  // A required field only complains once the author has actually touched it —
  // a freshly chosen tool should not paint every required row red — but after
  // that the `*` is real rather than decorative.
  const [touched, setTouched] = useState(false)
  const commit = (next: unknown) => {
    setTouched(true)
    onChange(next)
  }
  const error =
    field.required && touched && isBlank(value)
      ? 'This argument is required.'
      : null

  const description = [
    field.description,
    field.default !== undefined ? `Defaults to ${valueToText(field.default)}.` : null,
  ]
    .filter(Boolean)
    .join(' ')

  // Label-row actions: insert a reference into this field, and — once it holds
  // one — get BACK to the typed control. The switch to template mode must be
  // reversible or the author is trapped in a text box (DEC-5).
  // `shrink-0` so a long schema `title` shrinks the LABEL rather than squeezing
  // these buttons out of the row at 390px.
  const refAction = (
    <div className="flex items-center gap-1 shrink-0">
      {templated && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          icon={<Undo2 />}
          aria-label="Use a value instead of a reference"
          tooltip="Use a value instead"
          data-testid={`${testid}-clear-ref`}
          onClick={() => {
            setTemplateMode(false)
            commit('')
          }}
        />
      )}
      <RefInsertMenu
        store={store}
        stepId={stepId}
        // A TYPED field replaces: half a number plus a reference is not a value
        // the backend could resolve, and the replacement is undoable through the
        // button above. A text/JSON field APPENDS instead (the `PromptField`
        // behaviour) — it has no such undo, so replacing would silently destroy
        // a body the author had already written.
        onInsert={token => {
          if (canHoldTemplate) {
            const current = valueToText(value)
            commit(current ? `${current}${token}` : token)
            return
          }
          setTemplateMode(true)
          commit(token)
        }}
        testid={`${testid}-ref`}
        // Icon-only: this menu repeats once per generated field, and a labelled
        // trigger on every row overflows the label row at 390px.
        compact
      />
    </div>
  )

  // The kit's InputNumber emits `undefined` for BOTH "the field was cleared" and
  // "this is a partial number I'm still typing" (`-`, `1e`, `1.`). Committing
  // that as a key DELETE fed a changed `value` back into the control, which
  // wiped its buffer mid-keystroke — so a negative number could never be typed
  // over an existing one. The delete is therefore deferred to blur, where the
  // two cases have collapsed into one.
  const pendingNumberClear = useRef(false)

  const control = () => {
    // A reference is always edited as text, whatever the declared type.
    if (templated) {
      return (
        <Input
          data-testid={testid}
          value={valueToText(value)}
          onChange={e => commit(e.target.value)}
          placeholder="{{ inputs.query }}"
        />
      )
    }
    switch (field.kind) {
      case 'switch':
        return (
          <Switch
            data-testid={testid}
            aria-label={field.label}
            // An absent key means the tool applies its DECLARED default, so the
            // control must show that default rather than a flat "off" while the
            // description says "Defaults to true."
            checked={typeof value === 'boolean' ? value : field.default === true}
            onChange={v => commit(v)}
          />
        )
      case 'number':
      case 'integer':
        return (
          <InputNumber
            data-testid={testid}
            value={typeof value === 'number' ? value : null}
            step={field.kind === 'integer' ? 1 : undefined}
            min={field.schema.minimum}
            max={field.schema.maximum}
            onChange={v => {
              if (v === undefined) {
                pendingNumberClear.current = true
                return
              }
              pendingNumberClear.current = false
              commit(v)
            }}
            onBlur={() => {
              if (!pendingNumberClear.current) return
              pendingNumberClear.current = false
              commit(undefined)
            }}
            placeholder={valueToText(field.default)}
          />
        )
      case 'select':
        return (
          <Select
            data-testid={testid}
            aria-label={field.label}
            options={field.options ?? []}
            // The control speaks strings; the DECLARED type is what gets stored,
            // so an integer enum round-trips as `2`, not `"2"`.
            value={optionKeyForValue(field, value)}
            onChange={v => commit(optionValueForKey(field, v))}
            placeholder="Choose a value"
            popupMatchSelectWidth={false}
          />
        )
      case 'multiselect':
        return (
          <MultiSelect
            data-testid={testid}
            aria-label={field.label}
            options={field.options ?? []}
            value={optionKeysForValues(field, value)}
            onChange={v => commit(optionValuesForKeys(field, v))}
            placeholder="Choose values"
            searchPlaceholder="Search…"
            emptyText="No choices declared"
            removeLabel={v => `Remove ${v}`}
          />
        )
      case 'textarea':
      case 'json':
        return (
          <Textarea
            data-testid={testid}
            rows={field.kind === 'json' ? 4 : 3}
            value={valueToText(value)}
            // Hold the author's EXACT text while they type; coerce to the
            // declared type only on commit. Coercing per keystroke re-serialized
            // `{ "a": 1 }` to `{"a":1}` under the caret.
            onChange={e => commit(e.target.value)}
            onBlur={e => {
              const next = coerceToDeclared(e.target.value, field)
              if (!sameValue(next, value)) commit(next)
            }}
            placeholder={
              field.kind === 'json'
                ? valueToText(field.default) || '{ "key": "value" }'
                : valueToText(field.default)
            }
          />
        )
      default:
        return (
          <Input
            data-testid={testid}
            value={valueToText(value)}
            onChange={e => commit(e.target.value)}
            placeholder={valueToText(field.default)}
          />
        )
    }
  }

  return (
    <LabeledControl
      // `wrap-anywhere` + `min-w-0`: a long declared `title` wraps inside the
      // label instead of pushing the row past the viewport at 390px.
      label={<span className="block min-w-0 wrap-anywhere">{field.label}</span>}
      required={field.required}
      action={refAction}
      error={error}
      description={
        templated ? (
          // `items-start` + a nudge keeps the marker on the FIRST line when the
          // text wraps (with `items-center` it floats to the vertical middle of
          // a 2-3 line block, which reads as a stray glyph).
          <span className="flex items-start gap-1">
            <Braces className="mt-0.5 size-3 shrink-0" aria-hidden />
            <span>
              Using a reference — resolved when the workflow runs.
              {description ? ` ${description}` : ''}
            </span>
          </span>
        ) : (
          description || undefined
        )
      }
    >
      {control()}
    </LabeledControl>
  )
}

/**
 * The generated section. Rendered only when the tool declared a usable schema;
 * the caller owns the fallback (INV-6).
 */
export function ToolArgumentsForm({
  store,
  stepId,
  spec,
  values,
  onChange,
}: Props) {
  return (
    <div className="flex flex-col gap-4" data-testid="wf-builder-tool-args-generated">
      {spec.fields.map(field => (
        <GeneratedField
          key={field.name}
          store={store}
          stepId={stepId}
          field={field}
          value={values[field.name]}
          onChange={v => onChange(field.name, v)}
        />
      ))}
      {spec.overflowNames.length > 0 && (
        <Text type="secondary" className="text-xs" data-testid="wf-builder-tool-args-overflow">
          {/* The spilled property NAMES are listed, not just counted: the free
              rows below only pre-fill keys that already carry a value, so
              without this the author would have to know the hidden names. */}
          Showing {spec.fields.length} of {spec.declaredCount} arguments this tool
          accepts. Add any of the rest below, by name: {spec.overflowNames.join(', ')}.
        </Text>
      )}
    </div>
  )
}
