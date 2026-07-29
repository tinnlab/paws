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

/**
 * One choice of a `select` / `multiselect`.
 *
 * `value` is what the CONTROL binds to — the kit's `Select`/`MultiSelect` speak
 * strings — while `raw` is the value the schema actually DECLARED. Committing
 * `raw` is what keeps `{"level": {"type": "integer", "enum": [1, 2, 3]}}`
 * storing the number `2` rather than the string `"2"` the control handed us.
 */
export interface ToolOption {
  value: string
  label: string
  raw: unknown
}

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
  options?: ToolOption[]
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
// $ref / allOf / nullable normalisation (bounded + cycle-safe)
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
 *
 * Membership is checked with `hasOwnProperty`, NOT `in`: `in` walks the
 * prototype chain, so `#/$defs/__proto__` (or `/toString`) would "resolve"
 * against `Object.prototype` on a schema that never declared it.
 */
function lookupRef(root: Record<string, unknown>, ref: string): unknown {
  for (const prefix of DEFS_PREFIXES) {
    if (!ref.startsWith(prefix)) continue
    const name = ref.slice(prefix.length)
    const bucket = root[prefix === '#/$defs/' ? '$defs' : 'definitions']
    if (isRecord(bucket) && Object.prototype.hasOwnProperty.call(bucket, name)) {
      return bucket[name]
    }
  }
  return null
}

/** A branch that only says "this may be null" (the other half of `Optional[T]`). */
function isNullBranch(node: unknown): boolean {
  return isRecord(node) && node['type'] === 'null' && !('enum' in node)
}

/**
 * Reduce a declared property to ONE concrete schema the field derivation can
 * read, resolving the four spellings real MCP servers emit:
 *
 *   - `{"$ref": "#/$defs/X", "title": …, "default": …}` — the referencing
 *     node's OWN keywords are merged OVER the target, so a per-use title /
 *     description / default is not lost (JSON Schema 2020-12 allows siblings).
 *   - `{"allOf": [{"$ref": …}], "default": …}` — pydantic v1's wrapper.
 *   - `{"type": ["string", "null"]}` — the type-as-array nullable spelling.
 *   - `{"anyOf": [{"type": "string"}, {"type": "null"}]}` — what
 *     FastMCP/pydantic v2 emit for `Optional[str]`, and by far the most common
 *     shape in the wild. Left alone when the branches are a titled `const` set,
 *     because that IS an enum picker rather than a nullable wrapper.
 *
 * `stack` carries the refs already being resolved on THIS path, so a
 * self-referential or mutually recursive schema is cut rather than looped — the
 * explicit-stack approach borrowed from `schema_inline`, not a blind depth
 * counter. Returns null when nothing concrete can be reached, and the caller
 * renders a JSON field.
 */
function normalizeSchema(
  node: unknown,
  root: Record<string, unknown>,
  stack: string[] = [],
): FieldSchema | null {
  if (!isRecord(node)) return null
  let current: Record<string, unknown> = node

  const ref = current['$ref']
  if (typeof ref === 'string') {
    if (stack.includes(ref) || stack.length >= SCHEMA_BUDGET.maxRefDepth) return null
    const target = normalizeSchema(lookupRef(root, ref), root, [...stack, ref])
    if (!target) return null
    const { $ref: _ref, ...siblings } = current
    current = { ...(target as unknown as Record<string, unknown>), ...siblings }
  }

  const allOf = current['allOf']
  if (Array.isArray(allOf) && allOf.length > 0) {
    let merged: Record<string, unknown> = {}
    for (const branch of allOf) {
      const resolved = normalizeSchema(branch, root, stack)
      if (resolved) merged = { ...merged, ...(resolved as unknown as Record<string, unknown>) }
    }
    const { allOf: _all, ...siblings } = current
    current = { ...merged, ...siblings }
  }

  const declaredType = current['type']
  if (Array.isArray(declaredType)) {
    const concrete = declaredType.filter(
      (t): t is string => typeof t === 'string' && t !== 'null',
    )
    const { type: _t, ...rest } = current
    current = concrete.length === 1 ? { ...rest, type: concrete[0] } : rest
  }

  for (const key of ['anyOf', 'oneOf'] as const) {
    const branches = current[key]
    if (!Array.isArray(branches) || branches.length === 0) continue
    // A titled `const` set is a closed value set, not a nullable wrapper.
    if (branches.every(b => isRecord(b) && 'const' in b)) continue
    const concrete = branches.filter(b => !isNullBranch(b))
    if (concrete.length !== 1) continue
    const resolved = normalizeSchema(concrete[0], root, stack)
    if (!resolved) continue
    const siblings: Record<string, unknown> = { ...current }
    delete siblings[key]
    current = { ...(resolved as unknown as Record<string, unknown>), ...siblings }
  }

  // An array's `items` carries the multi-select choices, so it gets the same
  // treatment (a `$ref`'d or `allOf`-wrapped enum still renders as a picker).
  const items = current['items']
  if (isRecord(items)) {
    const resolvedItems = normalizeSchema(items, root, stack)
    if (resolvedItems) current = { ...current, items: resolvedItems }
  }

  return current as FieldSchema
}

// ---------------------------------------------------------------------------
// Field derivation
// ---------------------------------------------------------------------------

/**
 * Stable control key for a declared enum value (strings map to themselves, so a
 * derived option testid stays readable — `…-opt-hybrid`, not `…-opt-"hybrid"`).
 *
 * Deliberately LOSSY: the string `"1"` and the number `1` (and `"null"` and
 * `null`) collapse to the same key. That is what lets a value an older build
 * stored stringified still MATCH its declared option. It is also why it cannot
 * be used as an identity on its own — see `assignKeys`.
 */
function optionKeyOf(raw: unknown): string {
  if (typeof raw === 'string') return raw
  try {
    return JSON.stringify(raw) ?? String(raw)
  } catch {
    return String(raw)
  }
}

/**
 * Give every declared value a control key that is UNIQUE within its option list.
 *
 * `optionKeyOf` alone is not injective, so `enum: [1, "1"]` (or
 * `[null, "null"]`) produced TWO options carrying the value `"1"` — and
 * `optionValueForKey`, which resolves a key by `find`, always returned the
 * first. Picking the second choice therefore committed the wrong TYPE, silently.
 *
 * A collision is suffixed (`1`, `1#2`), and the loop keeps suffixing until the
 * key is free so a literal `"1#2"` declared in the same enum cannot take the
 * disambiguated slot either. A list with no collision — every real-world enum —
 * is byte-identical to before, which keeps the option testids stable.
 */
function assignKeys(raws: unknown[]): string[] {
  const used = new Set<string>()
  return raws.map(raw => {
    const base = optionKeyOf(raw)
    let key = base
    let n = 1
    while (used.has(key)) {
      n += 1
      key = `${base}#${n}`
    }
    used.add(key)
    return key
  })
}

function choiceOptions(choices: TitledChoice[]): ToolOption[] {
  const keys = assignKeys(choices.map(c => c.const))
  return choices.map((c, i) => ({
    value: keys[i],
    label: c.title ?? optionKeyOf(c.const),
    raw: c.const,
  }))
}

function enumOptions(values: unknown[], names?: string[]): ToolOption[] {
  const keys = assignKeys(values)
  return values.map((v, i) => ({
    value: keys[i],
    label: names?.[i] ?? optionKeyOf(v),
    raw: v,
  }))
}

/** Longest declared string length before the field becomes a textarea. */
const TEXTAREA_HINT_LENGTH = 120

function fieldKind(field: FieldSchema): {
  kind: ToolFieldKind
  options?: ToolOption[]
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
      // Promote on the declared VALUE length only. Keying off the description
      // made a 40-character `name` render as a 3-row Textarea purely because
      // its prose was long — the description says nothing about the value.
      const long =
        (field.maxLength ?? 0) > TEXTAREA_HINT_LENGTH ||
        (field.minLength ?? 0) > TEXTAREA_HINT_LENGTH
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
 *
 * The ROOT is normalised too, so a schema that is itself a `$ref`/`allOf` into
 * its own `$defs` (`{"$ref": "#/$defs/SearchArgs", "$defs": {…}}`) still yields
 * generated fields instead of collapsing to hand-typed pairs.
 */
export function describeToolSchema(inputSchema: unknown): ToolFormSpec | null {
  if (!isRecord(inputSchema)) return null
  const root = normalizeSchema(inputSchema, inputSchema) as unknown as
    | Record<string, unknown>
    | null
  if (!root) return null
  const props = root['properties']
  if (!isRecord(props)) return null

  const names = Object.keys(props)
  if (names.length === 0) return null

  const requiredRaw = root['required']
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
    const resolved = normalizeSchema(props[name], inputSchema)
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
// Option ↔ declared-value mapping
// ---------------------------------------------------------------------------

function matchOption(options: ToolOption[], value: unknown): ToolOption | undefined {
  return (
    options.find(o => o.raw === value) ??
    options.find(o => optionKeyOf(o.raw) === optionKeyOf(value))
  )
}

/**
 * The control key for a stored value — `undefined` when nothing matches, so the
 * picker shows its placeholder rather than a phantom selection.
 *
 * The lenient second pass (compare by option KEY) is deliberate: it re-selects a
 * value that an earlier build stored stringified (`"2"` where `2` is declared),
 * and the next commit writes the declared type back.
 */
export function optionKeyForValue(field: ToolField, value: unknown): string | undefined {
  if (value === undefined || value === null || !field.options) return undefined
  return matchOption(field.options, value)?.value
}

/**
 * The DECLARED value behind a control key (the key itself when unmatched).
 *
 * Written as an explicit match test rather than `?.raw ?? key`, because a
 * schema may legitimately DECLARE `null` as a choice — and `??` reads that as
 * "no such option" and hands back the key STRING, committing `"null"` for a
 * value the tool declared as `null`.
 */
export function optionValueForKey(field: ToolField, key: string): unknown {
  const match = field.options?.find(o => o.value === key)
  return match ? match.raw : key
}

/** Multi-select: stored values → control keys (unmatched entries are dropped). */
export function optionKeysForValues(field: ToolField, value: unknown): string[] {
  if (!Array.isArray(value) || !field.options) return []
  const options = field.options
  return value
    .map(v => matchOption(options, v)?.value)
    .filter((v): v is string => v !== undefined)
}

/** Multi-select: control keys → declared values. */
export function optionValuesForKeys(field: ToolField, keys: string[]): unknown[] {
  return keys.map(k => optionValueForKey(field, k))
}

/** Copy naming the synthetic option built for a value the schema dropped. */
const STALE_OPTION_SUFFIX = ' — not one of this tool’s choices'

/**
 * A synthetic option for a STORED value none of `options` declares, or null when
 * one of them already covers it. Its key is disambiguated against the list it
 * will join, so it can never shadow a declared choice.
 *
 * `undefined` is the ONLY value treated as "no value" here — it cannot be
 * expressed in JSON, so it never arrives as a stored argument. `null` CAN, and
 * whether it means "nothing chosen" or a real member depends on the CALL SITE,
 * so that reading is made in `fieldForValue`, not here: rejecting `null` at this
 * level erased a stored `null` ELEMENT of a multi-select on the next toggle —
 * the exact data loss this closure exists to prevent.
 */
function staleOption(options: ToolOption[], value: unknown): ToolOption | null {
  if (value === undefined) return null
  if (matchOption(options, value)) return null
  const base = optionKeyOf(value)
  let key = base
  let n = 1
  while (options.some(o => o.value === key)) {
    n += 1
    key = `${base}#${n}`
  }
  return { value: key, label: `${staleLabel(value)}${STALE_OPTION_SUFFIX}`, raw: value }
}

/** How a stale value NAMES itself in its option label. `valueToText` renders
 *  `null` (and `''`) as the empty string, which left the option reading as a
 *  bare " — not one of this tool's choices" with nothing to identify it. */
function staleLabel(value: unknown): string {
  const text = valueToText(value)
  if (text !== '') return text
  return optionKeyOf(value) || JSON.stringify(value) || String(value)
}

/**
 * The field a picker should actually RENDER for a stored value: the declared
 * choices, plus a synthetic entry for any stored value the schema no longer
 * declares.
 *
 * Without it a picker silently DISCARDED the saved value — a `select` fell back
 * to its placeholder while `arguments` still carried the old value (so the form
 * showed "nothing chosen" for a step that was configured), and a `multiselect`
 * went further and ERASED every undeclared entry on the next toggle, because
 * the control's value list is what the commit is rebuilt from. Both contradict
 * `splitArguments`' own rule that a value the current schema does not declare
 * must survive editing (DEC-6). It is the same closure the Tool picker already
 * has for a tool the server stopped offering: keep it in the list, and say why
 * it is there.
 */
export function fieldForValue(field: ToolField, value: unknown): ToolField {
  const declared = field.options
  if (!declared) return field

  const extras: ToolOption[] = []
  const seen = [...declared]
  const consider = (v: unknown) => {
    const stale = staleOption(seen, v)
    if (!stale) return
    extras.push(stale)
    seen.push(stale)
  }

  if (field.kind === 'multiselect') {
    if (!Array.isArray(value)) return field
    // Every ELEMENT is a real member of the stored list, `null` included — the
    // control's key list is what the commit is rebuilt from, so an element with
    // no option to bind to is erased on the next toggle.
    for (const v of value) consider(v)
  } else if (value !== null) {
    // For a SINGLE picker, `null` is "nothing chosen": inventing an option for
    // it would show a phantom selection where the placeholder belongs.
    consider(value)
  }

  return extras.length > 0 ? { ...field, options: [...extras, ...declared] } : field
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

const TEMPLATE_RE = /\{\{[\s\S]*?\}\}/
const WHOLE_TEMPLATE_RE = /^\s*\{\{[\s\S]*?\}\}\s*$/

/**
 * True when a value CARRIES a `{{ … }}` reference (INV-5). A typed control
 * cannot hold one — an `InputNumber` will not accept `{{ inputs.limit }}` — so
 * the form renders that ONE field as template text instead, reversibly.
 * Recognised on a value of ANY declared type, because an author may reference a
 * number, a flag or a whole object.
 */
export function isTemplateValue(value: unknown): boolean {
  return typeof value === 'string' && TEMPLATE_RE.test(value)
}

/**
 * True when the value is NOTHING BUT one reference.
 *
 * This is the distinction the commit path needs, and it mirrors the backend's
 * own rule exactly (`dispatch.rs::render_tool_arguments`: trimmed, starts `{{`,
 * ends `}}`, exactly one `{{`). Only a whole-value reference resolves to a
 * NATIVE JSON type at run time; a reference EMBEDDED in a larger string — or in
 * a JSON object such as `{"userId": "{{ inputs.user }}"}` — is interpolated in
 * place, and the backend recurses into objects, so that object must be stored as
 * an object rather than smuggled through as a raw string.
 */
export function isWholeTemplateValue(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    WHOLE_TEMPLATE_RE.test(value) &&
    (value.match(/\{\{/g)?.length ?? 0) === 1
  )
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
 * Coerce a TEXT-EDITED field's buffer to its declared type on commit.
 *
 * Scope note: only the `json` / `textarea` / plain-`text` kinds are edited as
 * text. Every other kind (`integer`, `number`, `switch`, `select`,
 * `multiselect`) is bound to a control that already emits its declared type, so
 * an arm here for those kinds would be unreachable — and an unreachable arm is
 * exactly what hid the enum-stringification defect behind a green unit test.
 *
 * A WHOLE-value reference is passed through untouched (INV-5): it resolves to a
 * native JSON type server side, and parsing it here would destroy it. A
 * reference merely CONTAINED in the text is not special-cased — the backend
 * recurses into objects and interpolates nested strings, so
 * `{"userId": "{{ inputs.user }}"}` must be stored as a real object. Anything
 * that cannot be parsed is kept as the raw string rather than silently becoming
 * `null`, so the author sees what they typed and the backend reports the real
 * problem.
 */
export function coerceToDeclared(raw: string, field: ToolField): unknown {
  if (isWholeTemplateValue(raw)) return raw
  const trimmed = raw.trim()
  if (trimmed === '') return ''
  if (field.kind !== 'json') return raw
  try {
    return JSON.parse(trimmed)
  } catch {
    return raw
  }
}

/** Render a stored value as the text a generated field shows. */
export function valueToText(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}
