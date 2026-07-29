import { z } from 'zod'
import type { StepDef } from '@/api-client/types'

// ---------------------------------------------------------------------------
// Pure, unit-testable module backing the workflow builder's per-kind step forms.
//
// The generated `StepDef` is a FLAT tagged union discriminated by `kind` (the
// backend `#[serde(flatten)]`s `StepConfig` onto `StepDef`, so the wire shape
// carries `kind` + the config fields directly on the step). The generator is
// FLATTEN-LOSSY: it drops the shared base fields (`id`, `description`,
// `message`, `depends_on`, …) from the TS type even though serde flatten still
// emits + accepts them on the wire. We re-add them here as `StepBase` and
// intersect: an intersection with a union distributes, giving a discriminated
// union of steps that each carry the base fields AND their kind's config.
//
// Drift-safety — why there is NO compile-time guard here:
//  A type-level `BuilderStep extends StepDef` assertion is a TAUTOLOGY and
//  guards nothing: `BuilderStep = StepBase & StepDef` and the wire step element
//  resolves to the same imported `StepDef`, so `(StepBase & StepDef) extends
//  StepDef` is unconditionally true. A genuine compile-time drift check is
//  impossible while the generated `StepDef` is itself flatten-lossy — both the
//  builder and wire sides derive from the same lossy type, so neither can catch
//  a base-field change the codegen already dropped. The runtime WIRE is
//  nevertheless correct because serde-flatten emits + accepts every field
//  (base + config). Drift is caught by the backend def→bundle round-trip
//  INTEGRATION test, not a compile-time check; the real fix — a non-lossy
//  `emit_ts` generator that keeps the flattened base fields on `StepDef` — is
//  the tracked follow-up.
// ---------------------------------------------------------------------------

export const STEP_KINDS = [
  'agent',
  'llm',
  'llm_map',
  'sandbox',
  'elicit',
  'tool',
] as const

export type StepKind = (typeof STEP_KINDS)[number]

/** Shared step fields the generated `StepDef` union omits (see module note). */
export interface StepBase {
  id: string
  description?: string | null
  /** The elicit prompt (kind `elicit`) OR a dynamic status line for others. */
  message?: string | null
  depends_on?: string[]
}

export type BuilderStep = StepBase & StepDef

/** Domain-language label per kind. The agent kind is deliberately named in
 *  plain terms ("AI assistant task") rather than tool jargon. */
export const STEP_KIND_LABELS: Record<StepKind, string> = {
  agent: 'AI assistant task',
  llm: 'LLM prompt',
  llm_map: 'Map over a list',
  sandbox: 'Run code',
  elicit: 'Ask the user',
  tool: 'Call a tool',
}

/** One-line helper text shown in the add-step menu. */
export const STEP_KIND_DESCRIPTIONS: Record<StepKind, string> = {
  agent: 'An autonomous assistant that uses tools to complete a task',
  llm: 'A single prompt to the language model',
  llm_map: 'Run a prompt once per item in a list',
  sandbox: 'Execute a shell command in an isolated sandbox',
  elicit: 'Pause and collect input from a person',
  tool: 'Invoke one specific tool on a server',
}

/** Default agent iteration ceiling (mirrors backend `default_agent_max_steps`). */
export const DEFAULT_AGENT_MAX_STEPS = 30
export const DEFAULT_MAX_PARALLEL = 5
export const MAX_PARALLEL_HARD_CAP = 20
export const DEFAULT_SANDBOX_TIMEOUT_MS = 30_000
export const DEFAULT_ELICIT_TIMEOUT_MS = 300_000

/** Build a fresh step id `<kind>_<n>` unique against `existingIds`. Pure so it
 *  can be unit-tested independent of the store. */
export function nextStepId(kind: StepKind, existingIds: string[]): string {
  const taken = new Set(existingIds)
  let n = 1
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const candidate = `${kind}_${n}`
    if (!taken.has(candidate)) return candidate
    n += 1
  }
}

/** A brand-new step of the given kind with sensible defaults. */
export function createStep(kind: StepKind, existingIds: string[]): BuilderStep {
  const id = nextStepId(kind, existingIds)
  const base: StepBase = { id, description: '', depends_on: [] }
  switch (kind) {
    case 'agent':
      return {
        ...base,
        kind: 'agent',
        prompt: '',
        system: null,
        servers: [],
        max_steps: DEFAULT_AGENT_MAX_STEPS,
        output_format: 'text',
      }
    case 'llm':
      // No `tools`: the backend rejects a non-empty `tools` on an llm step
      // (validate.rs E6, WORKFLOW_DEAD_TOOLS_FIELD). Omitted here so the field
      // stays absent from the wire payload.
      return {
        ...base,
        kind: 'llm',
        prompt: '',
        output_format: 'text',
      }
    case 'llm_map':
      // No `tools` — same reason as the `llm` kind above.
      return {
        ...base,
        kind: 'llm_map',
        prompt: '',
        for_each: '',
        item_var: 'item',
        output_format: 'text',
        max_parallel: DEFAULT_MAX_PARALLEL,
        max_retries: 0,
        on_error: 'fail',
      }
    case 'sandbox':
      return {
        ...base,
        kind: 'sandbox',
        run: '',
        stdin: null,
        timeout_ms: DEFAULT_SANDBOX_TIMEOUT_MS,
      }
    case 'elicit':
      return {
        ...base,
        kind: 'elicit',
        message: '',
        schema: { type: 'object', properties: {} },
        timeout_ms: DEFAULT_ELICIT_TIMEOUT_MS,
      }
    case 'tool':
      return {
        ...base,
        kind: 'tool',
        server: '',
        tool: '',
        arguments: {},
      }
  }
}

// ---------------------------------------------------------------------------
// Per-kind zod schema — validates a step's config for inline field feedback in
// the forms. The backend `POST /validate-def` remains the source of truth (its
// findings render in the validation panel); these client schemas only surface
// required-field hints as the author types. Pure + exported for unit tests.
// ---------------------------------------------------------------------------

// EVERY schema node below carries AUTHORED copy for its TYPE error as well as
// for its checks (INV-1). A required field can arrive ABSENT, not merely empty:
// the backend declares the optional config fields with
// `skip_serializing_if = "Option::is_none"` (`validate.rs`), so a step authored
// with `prompt_file:` reaches the builder with NO `prompt` key at all. With a
// custom message attached only to `.min(1, …)`, zod answered that with its own
// diagnostic — "Invalid input: expected string, received undefined" — which
// `LabeledControl` renders verbatim under the field: raw schema-validator
// language in front of the person building the workflow.
//
// The class guard is `stepForms.test.ts::no zod default diagnostic can reach a
// field…`: it walks every kind × every field × absent/null/wrong-type/
// out-of-range, so a new kind, a new field, or a new node with no authored copy
// fails there rather than shipping.

/** A required text field: absent, null, non-string and blank all read alike. */
const nonEmpty = (label: string) => {
  const required = `${label} is required`
  return z.string({ error: required }).trim().min(1, required)
}

/** The prompt field on `agent` / `llm` / `llm_map`, which is required only when
 *  the step does NOT supply its wording from a file.
 *
 *  MIRRORS `validate.rs::prompt_source`, the sole authority on this rule:
 *      inline = prompt.filter(|s| !s.is_empty())
 *      file   = prompt_file.filter(|s| !s.is_empty())
 *      WORKFLOW_PROMPT_MISSING fires only when NEITHER is present
 *  (an EMPTY string is absent on BOTH fields — an empty `prompt_file:` resolves
 *  to the bundle directory, which can never be read).
 *  So a step with a `prompt_file:` is COMPLETE to the backend with no typed
 *  prompt at all — and, since `prompt` is declared
 *  `skip_serializing_if = "Option::is_none"`, it reaches the builder with no
 *  `prompt` key whatsoever. Requiring one unconditionally showed the author a
 *  red "is required" under an empty box, beside a green "No blocking errors."
 *  panel and an enabled Save — a FALSE reason (INV-6) they could not act on,
 *  because the builder renders no prompt-file control to clear.
 *
 *  When the wording comes from a file the field is `nullish`, not dropped: the
 *  TYPE error keeps its authored copy so no zod diagnostic can reach the author
 *  (INV-1). `''`/`null` pass because the backend reads them as "no typed
 *  prompt" — clearing the box is how the author resolves `WORKFLOW_PROMPT_BOTH`
 *  on this surface.
 *
 *  TWO deliberate places where this field is STRICTER than the backend, both
 *  about whitespace, and neither a disagreement about validity:
 *   - beside a `prompt_file:`, `'   '` passes this check but is
 *     `PromptSource::Both` to the backend, so the validation PANEL reports
 *     `WORKFLOW_PROMPT_BOTH`. Field-level requiredness and step-level
 *     exclusivity are different questions on different surfaces; this one only
 *     answers "must the author type something here".
 *   - with NO `prompt_file:`, `'   '` is a valid inline prompt to the backend
 *     (`prompt_source` filters on `is_empty()`, not `trim()` — DEC-3) while the
 *     `.trim().min(1)` below marks the field required. That is intentional: a
 *     whitespace-only prompt is a typo, not an intent, and catching it as the
 *     author types is better than sending it to a model. Being stricter in the
 *     FORM is safe; being stricter in the backend would not be, which is why
 *     `promptSuppliedByFile` mirrors the backend exactly and this does not. */
const promptField = (label: string, suppliedByFile: boolean) => {
  const required = `${label} is required`
  const text = z.string({ error: required }).trim()
  return suppliedByFile ? text.nullish() : text.min(1, required)
}

/**
 * What the author is told when a step's wording comes from `prompt_file:`.
 *
 * The builder renders no `prompt_file` control, so without this the field is a
 * blank required-looking box with no explanation — a SILENT degradation, which
 * DESIGN §2.5 forbids. Naming the file is also what stops the author "fixing"
 * the emptiness and landing on WORKFLOW_PROMPT_BOTH.
 */
export const PROMPT_FROM_FILE_NOTE =
  'This step takes its wording from a prompt file in the workflow bundle, so ' +
  'there is nothing to type here. Type something to override it — but then ' +
  'remove the file, since a step cannot use both.'

/** Whether a step supplies its wording from a file, by the backend's rule
 *  (`validate.rs::prompt_source` — a NON-EMPTY `prompt_file:` string; anything
 *  serde would not deserialize into `Some(String)`, and the empty string, are
 *  not a file).
 *
 *  The emptiness half matters: `prompt_file: ""` resolves to the bundle
 *  DIRECTORY, which can never be read, so the backend calls such a step
 *  `WORKFLOW_PROMPT_MISSING`. Accepting it here would lift the prompt
 *  requirement on a step the backend reports incomplete — the client-side twin
 *  of the validate/dispatch disagreement this rule exists to prevent.
 *
 *  The `!s.is_empty()` (NOT `trim()`) boundary is load-bearing and is pinned
 *  against the Rust source by
 *  `validate.rs::client_prompt_file_predicate_mirrors_prompt_source`, which
 *  fails the BACKEND suite if these two drift. */
export function promptSuppliedByFile(step: unknown): boolean {
  const pf = (step as { prompt_file?: unknown })?.prompt_file
  return typeof pf === 'string' && pf.length > 0
}

const NOT_A_NUMBER = 'Enter a number'
const NOT_A_WHOLE_NUMBER = 'Enter a whole number'

/** A required whole-number field, authored for absent / non-numeric / decimal. */
const wholeNumber = () =>
  z.number({ error: NOT_A_NUMBER }).int(NOT_A_WHOLE_NUMBER)

/** A required choice, authored for both "absent" and "not one of these". */
const choice = <T extends readonly [string, ...string[]]>(
  values: T,
  label: string,
) => z.enum(values, { error: `Choose ${label}` })

/** `fromFile` lifts the prompt requirement on the three kinds that accept a
 *  `prompt_file:` instead (see `promptField`). Defaults to `false`, so the
 *  single-argument call keeps its original meaning. */
export function buildStepZodSchema(
  kind: StepKind,
  fromFile = false,
): z.ZodTypeAny {
  switch (kind) {
    case 'agent':
      return z.object({
        prompt: promptField('A task description', fromFile),
        max_steps: wholeNumber().min(1, 'Must be at least 1'),
        output_format: choice(['text', 'json'], 'a result format'),
      })
    case 'llm':
      return z.object({
        prompt: promptField('A prompt', fromFile),
        output_format: choice(['text', 'json'], 'a result format'),
      })
    case 'llm_map':
      return z.object({
        prompt: promptField('A prompt', fromFile),
        for_each: nonEmpty('A list to map over'),
        item_var: nonEmpty('An item variable name'),
        max_parallel: wholeNumber()
          .min(1, 'Must be at least 1')
          .max(MAX_PARALLEL_HARD_CAP, `At most ${MAX_PARALLEL_HARD_CAP}`),
        max_retries: wholeNumber().min(0, 'Cannot be negative'),
      })
    case 'sandbox':
      return z.object({
        run: nonEmpty('A command to run'),
        timeout_ms: wholeNumber().min(1, 'Must be at least 1 ms'),
      })
    case 'elicit':
      return z.object({
        message: nonEmpty('A prompt for the user'),
        timeout_ms: wholeNumber().min(0, 'Cannot be negative'),
      })
    case 'tool':
      return z.object({
        server: nonEmpty('A server'),
        tool: nonEmpty('A tool name'),
      })
  }
}

/** Run the kind schema against a step and return `{ fieldName: message }` for
 *  the fields that fail. Never throws (unknown-shape input → best-effort). */
export function configErrors(step: BuilderStep): Record<string, string> {
  const schema = buildStepZodSchema(
    step.kind as StepKind,
    promptSuppliedByFile(step),
  )
  // `step.kind as StepKind` is an UNCHECKED cast — the wire may carry a kind
  // this build does not know — and the switch, being exhaustive over `StepKind`,
  // returns `undefined` for anything else. Dereferencing that broke the "never
  // throws" contract above. There is nothing to say about a kind we do not know:
  // the backend validator is the source of truth for it.
  if (!schema) return {}
  const result = schema.safeParse(step)
  if (result.success) return {}
  const errors: Record<string, string> = {}
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? '')
    if (key && !(key in errors)) errors[key] = issue.message
  }
  return errors
}
