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
  // A field is in template mode iff its CURRENT value is a reference. That is
  // derived, not stored: inserting a `{{ … }}` switches it, and "use a value
  // instead" clears it back — no extra state to get out of sync with the def.
  const templated = isTemplateValue(value)

  const description = [
    field.description,
    field.default !== undefined ? `Defaults to ${valueToText(field.default)}.` : null,
  ]
    .filter(Boolean)
    .join(' ')

  // Label-row actions: insert a reference into this field, and — once it holds
  // one — get BACK to the typed control. The switch to template mode must be
  // reversible or the author is trapped in a text box (DEC-5).
  const refAction = (
    <div className="flex items-center gap-1">
      {templated && (
        <Button
          type="button"
          variant="ghost"
          icon={<Undo2 />}
          data-testid={`${testid}-clear-ref`}
          onClick={() => onChange('')}
        >
          Use a value
        </Button>
      )}
      <RefInsertMenu
        store={store}
        stepId={stepId}
        // A typed field REPLACES rather than appends: half a number plus a
        // reference is not a value the backend could resolve.
        onInsert={token => onChange(token)}
        testid={`${testid}-ref`}
      />
    </div>
  )

  const control = () => {
    // A reference is always edited as text, whatever the declared type.
    if (templated) {
      return (
        <Input
          data-testid={testid}
          value={valueToText(value)}
          onChange={e => onChange(e.target.value)}
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
            checked={value === true}
            onChange={v => onChange(v)}
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
            onChange={v => onChange(v ?? '')}
            placeholder={valueToText(field.default)}
          />
        )
      case 'select':
        return (
          <Select
            data-testid={testid}
            aria-label={field.label}
            options={field.options ?? []}
            value={typeof value === 'string' && value ? value : undefined}
            onChange={v => onChange(v)}
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
            value={Array.isArray(value) ? value.map(String) : []}
            onChange={v => onChange(v)}
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
            onChange={e => onChange(coerceToDeclared(e.target.value, field))}
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
            onChange={e => onChange(e.target.value)}
            placeholder={valueToText(field.default)}
          />
        )
    }
  }

  return (
    <LabeledControl
      label={field.label}
      required={field.required}
      action={refAction}
      description={
        templated ? (
          <span className="flex items-center gap-1">
            <Braces className="size-3 shrink-0" aria-hidden />
            Using a reference — resolved when the workflow runs.
            {description ? ` ${description}` : ''}
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
          Showing {spec.fields.length} of {spec.declaredCount} arguments this tool
          accepts — the rest can be set below.
        </Text>
      )}
    </div>
  )
}
