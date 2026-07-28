import type { FieldSchema, TitledChoice } from '../workflowElicitSchema'

// ---------------------------------------------------------------------------
// Turn an MCP tool's declared `input_schema` into a list of TYPED FIELDS the
// builder can render (ITEM-7, INV-4).
//
// The house rule is "never make the user type what the system can supply or
// pick". An MCP tool already declares its inputs, so the arguments editor is
// GENERATED from that declaration — one typed control per property, carrying
// requiredness, type, description and default — instead of asking the author to
// invent key/value strings from memory.
//
// This is the same defect, one layer up, as `control_mcp::schema_inline`: there,
// `describe_capability` handed the MODEL a `#/components/schemas/…` pointer it
// could not dereference, so it guessed the body. Here the BUILDER would hand the
// AUTHOR nothing at all. Two properties are borrowed from that module directly:
//
//   1. **Self-contained.** A `$ref` into the schema's own `$defs`/`definitions`
//      is RESOLVED, so a property declared by reference renders as its real
//      type rather than as an opaque JSON box.
//   2. **Terminating.** Recursion is cut by an explicit resolution STACK, not a
//      depth heuristic — a self-referential schema degrades to a JSON field
//      instead of looping.
//
// It is deliberately a thin, dependency-free subset (mirroring
// `workflowElicitSchema.ts`, whose `FieldSchema` vocabulary it reuses rather
// than inventing a second one). The BACKEND remains the source of truth: the
// tool itself rejects a bad payload at run time.
// ---------------------------------------------------------------------------

/**
 * Bounds on schema interpretation.
 *
 * Grouped in a named struct (rather than inline magic numbers) so each value is
 * documented and promotable without a rewrite — the same shape as
 * `schema_inline::Budget`. Deliberately NOT admin-configurable: these bound one
 * client-side rendering pass over a schema the operator does not author, cost
 * the server nothing, and enforce no security boundary. There is no deployment
 * for which a different value is right; a wrong one either hides fields from the
 * author or renders hundreds of inputs.
 */
export const SCHEMA_BUDGET = {
  /**
   * Most typed controls rendered for one tool. A tool declaring more spills the
   * remainder into the free key/value section with a "Showing N of M" note, so a
   * pathological schema cannot render an unbounded form.
   */
  maxFields: 24,
  /** Deepest `$ref` chain followed before a property degrades to a JSON field. */
  maxRefDepth: 8,
} as const

/** How a declared property is edited. */
export type ToolFieldKind =
  | 'text'
  | 'textarea'
  | 'number'
  | 'integer'
  | 'switch'
  | 'select'
  | 'multiselect'
  | 'json'

export interface ToolField {
  /** The argument key this field writes. */
  name: string
  /** Author-facing label: the schema `title`, else the key. */
  label: string
  kind: ToolFieldKind
  required: boolean
  description?: string
  /** The schema's declared default, shown as the placeholder. */
  default?: unknown
  /** Options for `select` / `multiselect`. */
  options?: { value: string; label: string }[]
  /** The resolved property schema, for callers that need more detail. */
  schema: FieldSchema
}

export interface ToolFormSpec {
  fields: ToolField[]
  /** Declared properties beyond `SCHEMA_BUDGET.maxFields`, edited as raw pairs. */
  overflowNames: string[]
  /** Total declared property count, for the "Showing N of M" note. */
  declaredCount: number
}

// ---------------------------------------------------------------------------
// $ref resolution (bounded + cycle-safe)
// ---------------------------------------------------------------------------

const DEFS_PREFIXES = ['#/$defs/', '#/definitions/'] as const

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/**
 * Resolve a local `#/$defs/<name>` or `#/definitions/<name>` pointer against the
 * root schema. A pointer into anything else (an external document, an OpenAPI
 * `#/components/…` we have no access to) is UNRESOLVABLE and returns null — the
 * caller then renders a JSON field, which is honest, rather than pretending the
 * property is a string.
 */
function lookupRef(root: Record<string, unknown>, ref: string): unknown {
  for (const prefix of DEFS_PREFIXES) {
    if (!ref.startsWith(prefix)) continue
    const name = ref.slice(prefix.length)
    const bucket = root[prefix === '#/$defs/' ? '$defs' : 'definitions']
    if (isRecord(bucket) && name in bucket) return bucket[name]
  }
  return null
}

/**
 * Follow `$ref` chains to the concrete schema. `stack` carries the refs already
 * being resolved on THIS path, so a self-referential or mutually recursive
 * schema is cut rather than looped — the explicit-stack approach borrowed from
 * `schema_inline`, not a blind depth counter.
 */
function resolveSchema(
  node: unknown,
  root: Record<string, unknown>,
  stack: string[] = [],
): FieldSchema | null {
  if (!isRecord(node)) return null
  const ref = node['$ref']
  if (typeof ref === 'string') {
    if (stack.includes(ref) || stack.length >= SCHEMA_BUDGET.maxRefDepth) return null
    const target = lookupRef(root, ref)
    if (target == null) return null
    return resolveSchema(target, root, [...stack, ref])
  }
  return node as FieldSchema
}

// ---------------------------------------------------------------------------
// Field derivation
// ---------------------------------------------------------------------------

function choiceOptions(choices: TitledChoice[]): { value: string; label: string }[] {
  return choices.map(c => ({ value: String(c.const), label: c.title ?? String(c.const) }))
}

function enumOptions(values: unknown[], names?: string[]): { value: string; label: string }[] {
  return values.map((v, i) => ({ value: String(v), label: names?.[i] ?? String(v) }))
}

/** Longest single-line string before the field becomes a textarea. */
const TEXTAREA_HINT_LENGTH = 120

function fieldKind(field: FieldSchema): {
  kind: ToolFieldKind
  options?: { value: string; label: string }[]
} {
  // Enumerations first — a closed value set is ALWAYS a picker, never typed.
  if (Array.isArray(field.enum) && field.enum.length > 0) {
    return { kind: 'select', options: enumOptions(field.enum, field.enumNames) }
  }
  const choices = field.anyOf ?? field.oneOf
  if (Array.isArray(choices) && choices.length > 0 && choices.every(c => 'const' in c)) {
    return { kind: 'select', options: choiceOptions(choices) }
  }
  if (field.type === 'array') {
    const items = field.items
    const itemChoices = items?.anyOf ?? items?.oneOf
    if (Array.isArray(items?.enum) && items.enum.length > 0) {
      return { kind: 'multiselect', options: enumOptions(items.enum) }
    }
    if (Array.isArray(itemChoices) && itemChoices.length > 0) {
      return { kind: 'multiselect', options: choiceOptions(itemChoices) }
    }
    return { kind: 'json' }
  }
  switch (field.type) {
    case 'boolean':
      return { kind: 'switch' }
    case 'integer':
      return { kind: 'integer' }
    case 'number':
      return { kind: 'number' }
    case 'string': {
      const long =
        (field.maxLength ?? 0) > TEXTAREA_HINT_LENGTH ||
        (field.description?.length ?? 0) > 160
      return { kind: long ? 'textarea' : 'text' }
    }
    case 'object':
      return { kind: 'json' }
    default:
      // No declared type (or an unknown one) — a JSON field is the honest
      // rendering; guessing "string" would silently coerce a structured value.
      return { kind: 'json' }
  }
}

/**
 * Interpret a tool's `input_schema`.
 *
 * Returns `null` — meaning "render the free key/value fallback" — when the
 * schema is absent, is not an object schema, or declares no properties. The
 * wire type is `unknown` (`Tool.input_schema` is `serde_json::Value` on the
 * Rust side), so every narrowing here is defensive: a malformed schema must
 * degrade to the documented escape hatch, never throw.
 */
export function describeToolSchema(inputSchema: unknown): ToolFormSpec | null {
  if (!isRecord(inputSchema)) return null
  const props = inputSchema['properties']
  if (!isRecord(props)) return null

  const names = Object.keys(props)
  if (names.length === 0) return null

  const requiredRaw = inputSchema['required']
  const required = new Set(
    Array.isArray(requiredRaw) ? requiredRaw.filter((r): r is string => typeof r === 'string') : [],
  )

  // Required first, then optional; declaration order preserved WITHIN each
  // group so the author reads the tool author's intended sequence.
  const ordered = [
    ...names.filter(n => required.has(n)),
    ...names.filter(n => !required.has(n)),
  ]

  const kept = ordered.slice(0, SCHEMA_BUDGET.maxFields)
  const overflowNames = ordered.slice(SCHEMA_BUDGET.maxFields)

  const fields: ToolField[] = kept.map(name => {
    const resolved = resolveSchema(props[name], inputSchema)
    // An unresolvable property still gets a field — as JSON — rather than
    // disappearing from the form.
    const schema: FieldSchema = resolved ?? {}
    const { kind, options } = resolved ? fieldKind(resolved) : { kind: 'json' as const, options: undefined }
    return {
      name,
      label: schema.title?.trim() || name,
      kind,
      required: required.has(name),
      description: schema.description,
      default: schema.default,
      options,
      schema,
    }
  })

  return { fields, overflowNames, declaredCount: names.length }
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

const TEMPLATE_RE = /\{\{[\s\S]*?\}\}/

/**
 * True when a value carries a `{{ … }}` reference (INV-5). A typed control
 * cannot hold one — an `InputNumber` will not accept `{{ inputs.limit }}` — so
 * the form renders that ONE field as template text instead, reversibly.
 * Recognised on a value of ANY declared type, because an author may reference a
 * number, a flag or a whole object.
 */
export function isTemplateValue(value: unknown): boolean {
  return typeof value === 'string' && TEMPLATE_RE.test(value)
}

/**
 * Partition a saved `arguments` object against a form spec.
 *
 * `extra` is the load-bearing half: an argument key the current schema does not
 * declare (an upstream schema change, a hand-authored YAML, a spilled overflow
 * property) MUST survive editing. Dropping it would silently corrupt a working
 * workflow the first time someone opened it in the builder.
 */
export function splitArguments(
  args: unknown,
  spec: ToolFormSpec | null,
): { known: Record<string, unknown>; extra: Record<string, unknown> } {
  const source = isRecord(args) ? args : {}
  if (!spec) return { known: {}, extra: { ...source } }
  const declared = new Set(spec.fields.map(f => f.name))
  const known: Record<string, unknown> = {}
  const extra: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(source)) {
    if (declared.has(k)) known[k] = v
    else extra[k] = v
  }
  return { known, extra }
}

/**
 * Coerce a raw editor string to the field's DECLARED type on commit.
 *
 * A template value is passed through untouched (INV-5) — it is resolved server
 * side at run time, and coercing it here would destroy it. Anything that cannot
 * be coerced is kept as the raw string rather than silently becoming `null`, so
 * the author sees what they typed and the backend reports the real problem.
 */
export function coerceToDeclared(raw: string, field: ToolField): unknown {
  if (isTemplateValue(raw)) return raw
  const trimmed = raw.trim()
  if (trimmed === '') return ''
  switch (field.kind) {
    case 'integer': {
      const n = Number(trimmed)
      return Number.isInteger(n) ? n : raw
    }
    case 'number': {
      const n = Number(trimmed)
      return Number.isFinite(n) ? n : raw
    }
    case 'switch':
      return trimmed === 'true'
    case 'json':
    case 'multiselect':
      try {
        return JSON.parse(trimmed)
      } catch {
        return raw
      }
    default:
      return raw
  }
}

/** Render a stored value as the text a generated field shows. */
export function valueToText(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}
