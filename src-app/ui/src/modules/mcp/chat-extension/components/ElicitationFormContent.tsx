import { useState, type ReactNode } from 'react'
import {
  Button,
  Card,
  CardActions,
  Descriptions,
  Form,
  FormField,
  MultiSelect,
  Select,
  Text,
  useForm,
  zodResolver,
} from '@ziee/kit'
import {
  CircleCheck,
  CircleX,
  SquarePen,
  Ban,
} from 'lucide-react'
import type { ContentRendererProps } from '@/modules/chat/core/extensions'
import {
  buildFormSchema,
  getOptions,
  normalizeElicitationSchema,
  type FieldSchema,
} from './elicitationOptions'
import { renderInputField } from './elicitationFields'
import { AskUserWizardContent } from './AskUserWizardContent'
import { McpComposer } from '@/modules/mcp/stores/mcpComposer'

interface ElicitationData {
  type: 'elicitation_request'
  elicitation_id: string
  message_id?: string
  message: string
  requested_schema: {
    type: 'object'
    properties: Record<string, FieldSchema>
    required?: string[]
  }
  server: string
  /** "pending" | "accepted" | "declined" | "cancelled" — persisted in DB */
  status?: string
  /** Submitted field values (only present when status = "accepted") */
  response_content?: Record<string, unknown>
}

function renderField(
  name: string,
  fieldSchema: FieldSchema,
  required: boolean,
): React.ReactNode {
  const label = fieldSchema.title || name
  const testId = `elicitation-field-${name}`

  // Select fields (single or multi)
  const isMultiSelect =
    fieldSchema.type === 'array' &&
    !!(
      fieldSchema.items?.enum ||
      fieldSchema.items?.anyOf ||
      fieldSchema.items?.oneOf
    )
  const isSelectField =
    isMultiSelect ||
    (fieldSchema.type === 'string' &&
      !!(fieldSchema.enum || fieldSchema.anyOf || fieldSchema.oneOf))

  if (isSelectField) {
    const options = getOptions(fieldSchema)
    if (isMultiSelect) {
      return (
        <FormField
          key={name}
          name={name}
          label={label}
          required={required}
          description={fieldSchema.description}
        >
          <MultiSelect
            options={options}
            placeholder={`Select ${label.toLowerCase()}`}
            searchPlaceholder="Search…"
            emptyText="No options"
            removeLabel={v => `Remove ${v}`}
            aria-label={label}
            data-testid={testId}
          />
        </FormField>
      )
    }
    return (
      <FormField
        key={name}
        name={name}
        label={label}
        required={required}
        description={fieldSchema.description}
      >
        <Select
          options={options}
          placeholder={`Select ${label.toLowerCase()}`}
          data-testid={testId}
        />
      </FormField>
    )
  }

  // Non-choice fields (boolean / number / date / password / text) render
  // identically to the wizard path via the shared helper.
  return renderInputField(name, fieldSchema, required)
}

/**
 * ElicitationFormContent
 *
 * Renders a dynamic form for MCP server elicitation requests.
 * Supports all SEP-1330 field types: primitives, single-select, multi-select enums.
 *
 * Four states:
 * - pending: interactive form (submittable)
 * - accepted: read-only display of submitted values
 * - declined: declined notice
 * - cancelled: session expired notice
 */
export function ElicitationFormContent({
  content: data,
}: ContentRendererProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)

  const elicitation = data.content as unknown as ElicitationData

  // McpStore holds the live entry while THIS device is streaming the turn; when
  // present its status is freshest. But generation now runs as a detached
  // server-side task, so an elicitation stays alive (blocked, awaiting input)
  // across a reload or on another device that has no live entry. Trust the
  // persisted DB status in that case — a `pending` block is still answerable
  // (the form submits by `elicitation_id`); only show cancelled/declined/accepted
  // when the DB itself records that terminal state.
  const mcpEntry = McpComposer.elicitationRequests.get(
    elicitation.elicitation_id,
  )
  const status = mcpEntry?.status ?? elicitation.status ?? 'pending'
  const responseContent =
    mcpEntry?.response_content ?? elicitation.response_content

  // Every degenerate `requested_schema` shape — a JSON-encoded string, null, a
  // missing/empty/non-object `properties`, a non-iterable `required` — is
  // resolved here rather than by a chain of `?.`/`|| {}` fallthroughs, which is
  // what used to render a card with a Submit button and zero fields.
  const {
    properties,
    requiredFields,
    isRich: isRichAskUser,
    notice: schemaNotice,
  } = normalizeElicitationSchema(elicitation.requested_schema)

  // Build a dynamic zod schema from the elicitation field specs.
  const formSchema = buildFormSchema(properties, requiredFields)

  // Date/date-time defaults come from the server as ISO strings; the kit
  // DatePicker accepts ISO strings directly — no dayjs conversion needed.
  const defaultValues = Object.fromEntries(
    Object.entries(properties).map(([key, field]) => {
      const fs = field as FieldSchema
      return [key, fs.default ?? undefined]
    }),
  )

  const form = useForm<Record<string, unknown>>({
    resolver: zodResolver(formSchema),
    defaultValues,
  })

  const handleDecline = async () => {
    setIsSubmitting(true)
    try {
      await McpComposer.resolveElicitation(elicitation.elicitation_id, 'decline')
    } finally {
      setIsSubmitting(false)
    }
  }

  // Accept handler — extracted so the Card FOOTER's Submit button (which sits
  // OUTSIDE the <Form>) can trigger the in-body form via form.handleSubmit.
  const onValid = async (values: Record<string, unknown>) => {
    setIsSubmitting(true)
    try {
      await McpComposer.resolveElicitation(
        elicitation.elicitation_id,
        'accept',
        values,
      )
    } catch (e) {
      // The store rolls status back to 'pending' on POST failure so the user can
      // retry; swallow here so it doesn't bubble to the chat error boundary.
      console.warn('mcp.elicitation resolve failed', e)
    } finally {
      setIsSubmitting(false)
    }
  }

  // Shared card header — a status icon + server name + short state label, matching
  // the tool-call Card's header row (both are chat "status cards").
  const cardHeader = (icon: ReactNode, label: string) => (
    // `flex-wrap` + `min-w-0`: the trailing label is `whitespace-nowrap`, so on
    // one line it starves the server name to a rendered width of 0 in a narrow
    // card (the measured failure on the sibling approval card). Same class as
    // the footer row — wrap instead of clip.
    <div className="flex flex-wrap items-center gap-2 min-w-0">
      {icon}
      <Text strong className="truncate min-w-0">{elicitation.server}</Text>
      <Text type="secondary" className="text-xs whitespace-nowrap">{label}</Text>
    </div>
  )

  // --- Resolved states ---

  if (status === 'accepted') {
    const items = responseContent
      ? Object.entries(responseContent).map(([key, value]) => {
          const fieldSchema = properties[key] as FieldSchema | undefined
          const label = fieldSchema?.title || key
          return {
            key,
            label,
            children: Array.isArray(value)
              ? value.join(', ')
              : String(value ?? ''),
          }
        })
      : []

    return (
      <div
        className="my-2"
        data-testid={`elicitation-accepted-${elicitation.elicitation_id}`}
      >
        <Card
          size="sm"
          className="mb-2"
          data-testid="mcp-elicitation-accepted-card"
        >
          {cardHeader(
            <CircleCheck className="size-4 shrink-0 text-success" />,
            '— form submitted',
          )}
          {items.length > 0 && (
            <Descriptions
              size="sm"
              column={1}
              items={items}
              className="mt-2"
              data-testid="mcp-elicitation-summary"
            />
          )}
        </Card>
      </div>
    )
  }

  if (status === 'declined') {
    return (
      <div
        className="my-2"
        data-testid={`elicitation-declined-${elicitation.elicitation_id}`}
      >
        <Card
          size="sm"
          className="mb-2 py-2.5"
          data-testid="mcp-elicitation-declined-card"
        >
          {cardHeader(
            <CircleX className="size-4 shrink-0 text-warning" />,
            '— request declined',
          )}
        </Card>
      </div>
    )
  }

  if (status === 'cancelled') {
    return (
      <div
        className="my-2"
        data-testid={`elicitation-cancelled-${elicitation.elicitation_id}`}
      >
        <Card
          size="sm"
          className="mb-2"
          data-testid="mcp-elicitation-cancelled-card"
        >
          {cardHeader(
            <Ban className="size-4 shrink-0 text-destructive" />,
            '— session expired',
          )}
          <Text type="secondary" className="text-sm mt-2 block">
            This form can no longer be submitted — the request expired or was cancelled.
          </Text>
        </Card>
      </div>
    )
  }

  // --- Pending state: interactive form ---

  // No field can be rendered. Showing the normal form here would be a card that
  // LIES: it looks answerable, and its Submit silently POSTs `content: {}` as if
  // the user had answered. Say what happened and offer the two real choices
  // instead. This runs BEFORE the rich/flat branch so it covers the ask_user
  // wizard and the external-MCP form with one guard.
  if (schemaNotice) {
    return (
      <div
        className="my-2"
        data-testid={`elicitation-pending-${elicitation.elicitation_id}`}
      >
        <Card
          size="sm"
          className="mb-2"
          data-testid="mcp-elicitation-no-fields-card"
          footer={
            // `CardActions`, not a hand-rolled `flex justify-end` row: "Accept
            // without values" is a long label, and Decline + it exceed one line
            // in a narrow card — where a non-wrapping `justify-end` row pushes
            // the overflow out the unreachable inline-START edge.
            <CardActions>
              <Button
                type="button"
                variant="outline"
                onClick={handleDecline}
                loading={isSubmitting}
                size="default"
                data-testid="elicitation-decline"
              >
                Decline
              </Button>
              <Button
                type="button"
                loading={isSubmitting}
                size="default"
                onClick={() => onValid({})}
                data-testid="elicitation-accept-no-values"
              >
                Accept without values
              </Button>
            </CardActions>
          }
        >
          {cardHeader(
            <SquarePen className="size-4 shrink-0 text-primary" />,
            'is requesting input',
          )}
          {elicitation.message ? (
            <Text className="text-sm mt-2 block">{elicitation.message}</Text>
          ) : null}
          <Text
            type="secondary"
            className="text-sm mt-2 block"
            data-testid="mcp-elicitation-no-fields-notice"
          >
            {schemaNotice}
          </Text>
        </Card>
      </div>
    )
  }

  // Rich decision UX (per-option cards + 1–4 question wizard + Other-escape) is
  // enabled ONLY for the ziee-internal `ask_user` path, which the backend marks
  // with ASK_USER_MARKER (read by `normalizeElicitationSchema`). External
  // MCP-server elicitation is never marked and renders the flat,
  // spec-compliant form below (unchanged).
  if (isRichAskUser) {
    return (
      <div
        className="my-2"
        data-testid={`elicitation-pending-${elicitation.elicitation_id}`}
      >
        <AskUserWizardContent
          elicitationId={elicitation.elicitation_id}
          message={elicitation.message}
          server={elicitation.server}
          properties={properties}
          requiredFields={requiredFields}
        />
      </div>
    )
  }

  return (
    <div
      className="my-2"
      data-testid={`elicitation-pending-${elicitation.elicitation_id}`}
    >
      <Card
        size="sm"
        className="mb-2"
        data-testid="mcp-elicitation-pending-card"
        footer={
          // Decline + Submit fit one line today, but the row stays on the shared
          // `CardActions` primitive so a longer label (or a narrower pane) wraps
          // instead of silently pushing a control out of reach.
          <CardActions>
            <Button
              type="button"
              variant="outline"
              onClick={handleDecline}
              loading={isSubmitting}
              size="default"
              data-testid="elicitation-decline"
            >
              Decline
            </Button>
            <Button
              loading={isSubmitting}
              size="default"
              onClick={() => form.handleSubmit(onValid)()}
              data-testid="elicitation-submit"
            >
              Submit
            </Button>
          </CardActions>
        }
      >
        {cardHeader(
          <SquarePen className="size-4 shrink-0 text-primary" />,
          'is requesting input',
        )}
        <div className="mt-2">
          <Text className="text-sm">{elicitation.message}</Text>
          {/* Submit lives in the Card FOOTER (outside this form) and triggers it
              via form.handleSubmit(onValid); Enter within a field still submits
              through the form's own onSubmit. */}
          <Form
            form={form}
            layout="vertical"
            className="mt-3"
            disabled={isSubmitting}
            data-testid="mcp-elicitation-form"
            onSubmit={onValid}
          >
            {Object.entries(properties).map(([name, fieldSchema]) =>
              renderField(
                name,
                fieldSchema as FieldSchema,
                requiredFields.has(name),
              ),
            )}
          </Form>
        </div>
      </Card>
    </div>
  )
}
