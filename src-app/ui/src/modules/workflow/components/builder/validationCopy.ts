import type { ValidationError } from '@/api-client/types'
import type { BuilderStep, StepKind } from './stepForms'
import { STEP_KIND_LABELS } from './stepForms'

// ---------------------------------------------------------------------------
// The PRESENTATION boundary for workflow validation findings (ITEM-1, INV-1).
//
// The backend validator is a machine-readable contract: `validate_for_install`
// turns a finding into an `AppError` for the install/import/run paths, and
// `workflow_mcp`'s `validate_workflow` tool serializes it for the MODEL. Its
// messages are therefore written in the wire vocabulary ("step has neither
// prompt: nor prompt_file:") and MUST stay that way.
//
// A person building a workflow is not reading YAML. So the humanisation lives
// HERE, keyed off the stable `ValidationError.code`, where the step's KIND is
// also known — which matters, because one backend code can mean different
// things to a person: WORKFLOW_PROMPT_MISSING on an `agent` step is a missing
// TASK, on an `llm` step a missing PROMPT.
//
// DRIFT GUARD: `validate.rs`'s `validation_codes_are_registered_and_humanised`
// test reads THIS FILE and fails the backend suite if any code it can emit has
// no entry in `HUMAN_COPY`. So a new backend finding cannot ship without human
// copy. Keep the `HUMAN_COPY` keys as plain quoted string literals — the Rust
// test matches them textually.
// ---------------------------------------------------------------------------

/** What a finding is attached to. `null` step ⇒ it concerns the whole workflow. */
export interface AttributedFinding {
  finding: ValidationError
  /** The step this finding belongs to, resolved from `location`. */
  stepId: string | null
  /** 1-based position of that step in the list (for "Step 3 · …"). */
  stepIndex: number | null
  /** The step's author-facing label (its description, else its id). */
  stepLabel: string | null
  /** Person-facing sentence. Never a raw schema key. */
  text: string
  severity: 'error' | 'warning'
}

/** Context a copy function may use to say something specific. */
interface CopyContext {
  /** The step the finding points at, when it resolves to one. */
  step?: BuilderStep
  /** The raw backend message — the fallback, and occasionally a detail source. */
  message: string
}

type CopyFn = (ctx: CopyContext) => string

/**
 * `code` → person-facing sentence.
 *
 * Rules for entries here:
 *  - say what the PERSON must do, not what the schema requires;
 *  - never name a YAML key, a Rust field, or a wire type;
 *  - stay one sentence where possible — the panel is dense.
 */
const HUMAN_COPY: Record<string, CopyFn> = {
  // ── whole-workflow shape ────────────────────────────────────────────────
  "WORKFLOW_NO_STEPS": () => 'This workflow has no steps yet — add at least one.',
  "WORKFLOW_TOO_MANY_STEPS": () =>
    'This workflow has too many steps — split it into smaller workflows (50 is the limit).',
  "WORKFLOW_SANDBOX_FLAVOR_REQUIRED": () =>
    'A step runs code, so the workflow needs a sandbox environment chosen for it.',
  "WORKFLOW_UNKNOWN_FLAVOR": () =>
    'That sandbox environment is not available on this server — pick one of the installed environments.',
  "WORKFLOW_CYCLE": () =>
    'These steps depend on each other in a loop, so there is no order that can run them — remove one of the dependencies.',
  "WORKFLOW_DUPLICATE_OUTPUT_NAME": () =>
    'Two results share the same name — give each result its own name.',

  // ── step identity ───────────────────────────────────────────────────────
  "WORKFLOW_BAD_STEP_ID": () =>
    "This step's internal name must start with a lowercase letter and use only lowercase letters, numbers and underscores.",
  "WORKFLOW_DUPLICATE_STEP_ID": () =>
    'Another step already uses this internal name — rename one of them.',
  "WORKFLOW_STEP_DESCRIPTION_TOO_LONG": () =>
    'This step label is too long — shorten it to under 200 characters.',

  // ── prompts ─────────────────────────────────────────────────────────────
  "WORKFLOW_PROMPT_MISSING": ({ step }) =>
    step?.kind === 'agent'
      ? 'This step needs a task description — say what the assistant should do.'
      : step?.kind === 'llm_map'
        ? 'This step needs a prompt to run for each item in the list.'
        : 'This step needs a prompt.',
  "WORKFLOW_PROMPT_BOTH": ({ step }) =>
    step?.kind === 'agent'
      ? 'This step has both a typed-in task and a task file — keep one of them.'
      : 'This step has both a typed-in prompt and a prompt file — keep one of them.',
  "WORKFLOW_PROMPT_FILE_MISSING": () =>
    "This step points at a prompt file that isn't in the workflow — add the file, or type the prompt in directly.",
  "WORKFLOW_PROMPT_FILE_UNSAFE": () =>
    'This step points at a prompt file outside the workflow — the file must live inside the workflow itself.',
  "WORKFLOW_PROMPT_FILE_ESCAPE": () =>
    'This step points at a prompt file outside the workflow — the file must live inside the workflow itself.',

  // ── per-kind configuration ──────────────────────────────────────────────
  "WORKFLOW_DEAD_TOOLS_FIELD": () =>
    'A prompt step cannot use tools — add a separate "Call a tool" step instead.',
  "WORKFLOW_SANDBOX_NO_RUN": () => 'This step needs a command to run.',
  "WORKFLOW_TOOL_NO_SERVER": () => 'Choose the server this step should call.',
  "WORKFLOW_TOOL_NO_TOOL": () => 'Choose the tool this step should call.',
  "WORKFLOW_ELICIT_NO_MESSAGE": () =>
    'This step needs the question to show the person running the workflow.',
  "WORKFLOW_ELICIT_TIMEOUT_CAP": () =>
    'This step waits too long for an answer — the longest allowed wait is 30 minutes (use 0 to wait indefinitely).',
  "WORKFLOW_PARALLEL_CAP": () =>
    'This step runs too many items at once — the maximum is 20.',
  "WORKFLOW_PARALLEL_ZERO": () =>
    'This step must run at least one item at a time.',
  "WORKFLOW_FOR_EACH_EMPTY": () =>
    'Choose the list this step should repeat over.',
  "WORKFLOW_FOR_EACH_NOT_TEMPLATE": () =>
    'The list to repeat over must come from an input or an earlier step — insert a reference instead of typing a value.',
  "WORKFLOW_ITEM_VAR_EMPTY": () =>
    'Give each item a name so the prompt can refer to it.',

  // ── dependencies ────────────────────────────────────────────────────────
  "WORKFLOW_UNKNOWN_DEPENDENCY": () =>
    'This step waits for a step that no longer exists — pick an existing step, or remove the dependency.',
  "WORKFLOW_SELF_DEPENDENCY": () =>
    'This step waits for itself, so it can never start — remove the dependency.',

  // ── references between steps ────────────────────────────────────────────
  "WORKFLOW_TEMPLATE_SYNTAX": ({ message }) =>
    `A reference in this step isn't written correctly (${message}).`,
  "WORKFLOW_UNKNOWN_INPUT_REF": () =>
    'This step refers to an input the workflow does not have — add that input, or point at an existing one.',
  "WORKFLOW_UNKNOWN_STEP_REF": () =>
    'This step refers to a step that does not exist — point at an existing step.',
  "WORKFLOW_BAD_STEP_FIELD": () =>
    "This step refers to something a step doesn't produce — use the step's result or its file.",
  "WORKFLOW_PATH_ACCESS": () =>
    "This step treats a file location as if it held structured data — use the step's result instead.",
  "WORKFLOW_REF_UNKNOWN_FIELD": () =>
    'This step reads a field that the earlier step does not produce — check the field name.',
  "WORKFLOW_REF_FIELD_NON_OBJECT": () =>
    'This step reads a field from something that is not structured data.',
  "WORKFLOW_REF_INDEX_NON_ARRAY": () =>
    'This step picks an item by position from something that is not a list.',
  "WORKFLOW_FOR_EACH_NOT_ARRAY": () =>
    'The list to repeat over is not a list — point at something that produces a list.',

  // ── warnings (non-blocking) ─────────────────────────────────────────────
  "WORKFLOW_FOR_EACH_TYPE_UNRESOLVED": () =>
    "We can't tell in advance whether this will be a list — double-check it produces one when the workflow runs.",
  "WORKFLOW_REF_INDEX_UNRESOLVED": () =>
    "We can't tell in advance whether this is a list — double-check it produces one when the workflow runs.",
  "WORKFLOW_REF_FIELD_UNRESOLVED": () =>
    "We can't tell in advance what fields this produces — double-check the field exists when the workflow runs.",

  // ── security / publishing ───────────────────────────────────────────────
  "WORKFLOW_ARTIFACT_PATH_UNSAFE": () =>
    "This step saves a file outside the workflow's own folder — use a path inside it.",
  "WORKFLOW_MOCK_IN_PUBLISHED": () =>
    'This step still has test stand-in data, which is only allowed while developing.',
}

/** Every code this module can say in human language (drift-guard surface). */
export const HUMANISED_CODES: readonly string[] = Object.keys(HUMAN_COPY)

/**
 * The person-facing sentence for a finding. An UNKNOWN code falls back to the
 * backend's own message rather than to nothing — a finding must always be
 * readable, even in the (test-prevented) case where a new code slipped through.
 */
export function humaniseFinding(
  finding: ValidationError,
  step?: BuilderStep,
): string {
  const copy = HUMAN_COPY[finding.code]
  if (!copy) return finding.message
  return copy({ step, message: finding.message })
}

/**
 * The step a finding belongs to. `location` is either a bare step id (`agent_1`),
 * a step FIELD path (`agent_1.prompt`, `map.for_each`), an output path
 * (`outputs[name].from`), or absent. Anything that does not resolve to a real
 * step in `steps` is workflow-level.
 */
export function resolveFindingStep(
  finding: ValidationError,
  steps: BuilderStep[],
): BuilderStep | null {
  const loc = finding.location
  if (!loc) return null
  // `outputs[…]` is never a step.
  if (loc.startsWith('outputs[')) return null
  const head = loc.split('.')[0]
  return steps.find(s => s.id === head) ?? null
}

/** `error` for anything the backend did not explicitly mark a warning. */
function severityOf(finding: ValidationError): 'error' | 'warning' {
  return finding.severity === 'warning' ? 'warning' : 'error'
}

/**
 * Attribute + humanise a batch of findings against the current definition.
 * Pure; the panel and the step list both consume this ONE result so they can
 * never disagree about which steps are broken.
 */
export function attributeFindings(
  findings: readonly ValidationError[],
  steps: BuilderStep[],
): AttributedFinding[] {
  return findings.map(finding => {
    const step = resolveFindingStep(finding, steps)
    const stepIndex = step ? steps.findIndex(s => s.id === step.id) : -1
    return {
      finding,
      stepId: step?.id ?? null,
      stepIndex: stepIndex >= 0 ? stepIndex + 1 : null,
      stepLabel: step ? step.description?.trim() || step.id : null,
      text: humaniseFinding(finding, step ?? undefined),
      severity: severityOf(finding),
    }
  })
}

/** Per-step finding counts, for the step list's invalid markers. */
export interface StepFindingCounts {
  errors: number
  warnings: number
}

/**
 * Index attributed findings by step id. Findings with no resolvable step land
 * under the `WORKFLOW_LEVEL` key so the panel can group them without a second
 * pass and without any step being double-counted.
 */
export const WORKFLOW_LEVEL = '__workflow__'

export function indexFindingsByStep(
  attributed: readonly AttributedFinding[],
): Map<string, StepFindingCounts> {
  const out = new Map<string, StepFindingCounts>()
  for (const a of attributed) {
    const key = a.stepId ?? WORKFLOW_LEVEL
    const cur = out.get(key) ?? { errors: 0, warnings: 0 }
    if (a.severity === 'error') cur.errors += 1
    else cur.warnings += 1
    out.set(key, cur)
  }
  return out
}

/** "Step 3 · Research the topic", or "Whole workflow" when unattributed. */
export function findingStepTitle(a: AttributedFinding): string {
  if (a.stepIndex == null || a.stepLabel == null) return 'Whole workflow'
  return `Step ${a.stepIndex} · ${a.stepLabel}`
}

/** Human label for a step's kind, reused by the panel's grouping. */
export function stepKindLabel(step: BuilderStep): string {
  return STEP_KIND_LABELS[step.kind as StepKind] ?? step.kind
}
