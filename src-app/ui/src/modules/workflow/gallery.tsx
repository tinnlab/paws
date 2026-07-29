/**
 * Dev-gallery seed for the `workflow` module — the workflow cassette, overlay
 * open-states (assignment / detail / import / run / dry-run / tests), and seeded
 * surfaces (run-progress, tests, dry-run, elicitation, editable-array, runs list,
 * step artifacts). Auto-discovered by the gallery's runtime registry
 * (`@/dev/gallery/support`); never imported by `module.tsx`, so it is dev-only
 * and tree-shaken from prod.
 */
import { lazy, useEffect, useRef } from 'react'
import type {
  DryRunResult,
  SSEElicitationRequiredData,
  TestRunResponse,
  Tool,
  ValidateDefResponse,
  Workflow,
} from '@/api-client/types'
import type { ModuleGallery } from '@/dev/gallery/support'
import { holdPatch, lazyBound, lazyNamed, lazyProps } from '@/dev/gallery/support'
import type { BuilderStep } from './components/builder/stepForms'
import { HUMANISED_CODES } from './components/builder/validationCopy'
import type { BuilderDef } from './stores/WorkflowBuilder.store'
import { workflowCassette } from '@/dev/gallery/fixtures/workflow'
import { llmGroupsList } from '@/dev/gallery/fixtures/llm-providers'
import { GroupSystemWorkflowsAssignment } from '@/modules/workflow/widgets/groupSystemWorkflowsAssignmentDrawer'
import { WorkflowDrawer } from '@/modules/workflow/stores/workflowDrawer'

const group = llmGroupsList.groups[0]

const noop = () => {}

const workflowFixture = {
  id: 'wf-gallery-0001',
  name: 'Weekly literature digest',
  description: 'Search, screen, and summarize new papers on a saved query.',
  scope: 'user',
  version: '1.0.0',
  is_system: false,
  enabled: true,
  created_at: '2026-02-01T10:00:00Z',
  updated_at: '2026-02-01T10:00:00Z',
  compiled_ir_json: {
    inputs: [
      { name: 'query', description: 'Search terms', required: true },
      { name: 'max_results', description: 'Cap', required: false, default: 20 },
    ],
    steps: [{ id: 'search' }, { id: 'summarize' }],
  },
} as const

/** Minimal Workflow object — the dialogs only read `.id`. */
const galleryWorkflow = {
  id: 'wf-s1',
  name: 'Gallery workflow',
} as unknown as Workflow

/** A canned test run with a passed, a failed (with failure detail), and a
 *  skipped fixture so the passed/failed/skipped tags + the failure branch all
 *  render (WorkflowTestsPanel :62,66,67 + the `r.failure` arm). */
const cannedTestResult: TestRunResponse = {
  total: 3,
  passed: 1,
  failed: 1,
  skipped: 1,
  results: [
    { name: 'greets the user', passed: true, duration_ms: 42 },
    {
      name: 'summarizes the abstract',
      passed: false,
      duration_ms: 118,
      failure: {
        output_name: 'summary',
        assertion: 'contains',
        expected: '"insulin resistance"',
        actual_preview: '"the study examined blood glucose…"',
      },
    },
    { name: 'real_llm end-to-end', passed: false, skipped: true, duration_ms: 0 },
  ],
}

/** A canned dry-run with a runtime-dependent step so the estimate table, the
 *  cost statistic, and the `runtime-dependent` cell all render. */
const cannedDryRunResult: DryRunResult = {
  total_est_calls: 7,
  total_est_tokens: 12800,
  est_cost_usd: 0.0384,
  steps: [
    {
      step_id: 'draft',
      kind: 'llm',
      est_calls: 1,
      est_tokens_in: 900,
      est_tokens_out: 1200,
      runtime_dependent: false,
    },
    {
      step_id: 'map_sections',
      kind: 'llm_map',
      est_calls: 6,
      est_tokens_in: 5400,
      est_tokens_out: 5300,
      runtime_dependent: true,
    },
  ],
}

/** An elicitation whose schema has a required string field left empty, so a
 *  programmatic submit-click fails validation and lights the inline error. */
const galleryElicitation: SSEElicitationRequiredData = {
  elicitation_id: 'elicit-s1',
  run_id: 'run-s1',
  step_id: 'ask',
  message: 'Please provide the missing details before continuing.',
  deadline_at: new Date(Date.now() + 600_000).toISOString(),
  schema: {
    type: 'object',
    properties: {
      title: { type: 'string', title: 'Manuscript title' },
    },
    required: ['title'],
  },
}

/**
 * Build a lazy wrapper for the modal panels (tests / dry-run) whose loading /
 * error / result branches live in LOCAL `useState`, driven entirely by the
 * outcome of a `WorkflowStore` action. We patch that action on the store —
 * inside the async lazy loader, BEFORE the panel ever mounts — so the panel's
 * mount-effect call resolves/rejects/hangs into the branch we want.
 */
function panelSurface(
  loader: () => Promise<Record<string, any>>,
  panelName: 'WorkflowTestsPanel' | 'DryRunPreviewDialog',
  actionName: 'test' | 'dryRun',
  outcome: 'loading' | 'error' | 'result',
  result: unknown,
) {
  return lazy(async () => {
    const mod = await loader()
    const Panel = mod[panelName]
    const WorkflowModule = await import('@/modules/workflow/stores/workflow')
    const impl =
      outcome === 'loading'
        ? () => new Promise<never>(() => {})
        : outcome === 'error'
          ? () =>
              Promise.reject(
                new Error('Upstream returned 500 — service unavailable'),
              )
          : () => Promise.resolve(result)
    WorkflowModule.useWorkflowStore.setState({ [actionName]: impl } as any)
    return {
      default: () => (
        <Panel workflow={galleryWorkflow} open onClose={() => undefined} />
      ),
    }
  })
}

/** WorkflowElicitForm wrapper that auto-clicks Submit (with a required field
 *  left blank) so validation fails and the inline error alert renders
 *  (:484,485). */
const elicitErrorSurface = lazy(async () => {
  const mod = await import('@/modules/workflow/components/WorkflowElicitForm')
  const WorkflowElicitForm = mod.WorkflowElicitForm
  return {
    default: () => {
      const ref = useRef<HTMLDivElement>(null)
      useEffect(() => {
        // The form finishes async validation after the first mount tick;
        // retrying the click keeps the error branch lit for the render pass.
        let n = 0
        const t = setInterval(() => {
          // Select the Submit button by role, not its testid literal (the
          // testid-unique guard forbids repeating a data-testid string here).
          const btn = ref.current?.querySelector<HTMLButtonElement>(
            'button[type="button"]',
          )
          btn?.click()
          if (++n > 12) clearInterval(t)
        }, 200)
        return () => clearInterval(t)
      }, [])
      return (
        <div ref={ref}>
          <WorkflowElicitForm
            elicitation={galleryElicitation}
            submitting={false}
            onSubmit={() => undefined}
          />
        </div>
      )
    },
  }
})

/** EditableArrayTable inside a RHF Form whose field array is empty → the
 *  "No rows" empty `<tr>` (:358). */
const arrayEmptySurface = lazy(async () => {
  const { Form, useForm } = await import('@ziee/kit')
  const { EditableArrayTable } = await import(
    '@/modules/workflow/components/EditableArrayTable'
  )
  const arraySchema = {
    type: 'array',
    title: 'Rows',
    items: {
      type: 'object',
      properties: { label: { type: 'string', title: 'Label' } },
      required: [],
    },
  } as any
  return {
    default: () => {
      const form = useForm({ defaultValues: { rows: [] } })
      return (
        <div className="p-4">
          <Form
            data-testid="s1-array-empty-form"
            form={form}
            onSubmit={() => undefined}
          >
            <EditableArrayTable name="rows" schema={arraySchema} />
          </Form>
        </div>
      )
    },
  }
})

// ── Builder + agent-timeline fixtures (ITEM-7/9) ────────────────────────────
//
// Every fixture below is TYPED against the generated api-client (`BuilderStep`
// = `StepBase & StepDef`, `Tool`, `ValidateDefResponse`) rather than written as
// an untyped literal, so a backend shape change breaks the build here instead of
// silently leaving the gallery showing a state the server can no longer produce.

type AgentStep = Extract<BuilderStep, { kind: 'agent' }>
type ToolStep = Extract<BuilderStep, { kind: 'tool' }>

/** A representative, fully-populated agent step: a plain-language task, two
 *  selected capabilities, Balanced effort (max_steps 30), Text output, and a
 *  system directive — the centrepiece the friendly agent form renders. */
const agentStepFixture: AgentStep = {
  id: 'agent_1',
  kind: 'agent',
  description: 'Research the topic',
  depends_on: [],
  prompt:
    'Find the three most-cited papers on CRISPR base editing published since 2023 and summarise their key findings in plain language for a non-specialist.',
  system: 'You are a meticulous research assistant. Cite every claim with a DOI.',
  servers: ['literature_search', 'web_search'],
  max_steps: 30,
  output_format: 'text',
}

/** A tool step pointing at a server that is NOT in the author's accessible set —
 *  the input to the documented hand-entry fallback (INV-6). Its arguments are
 *  free key/value rows: a literal, a `{{ }}` reference, and a boolean. */
const toolStepFixture: ToolStep = {
  id: 'tool_1',
  kind: 'tool',
  description: 'Look up the trial registry',
  depends_on: ['agent_1'],
  server: 'literature_search',
  tool: 'search_trials',
  arguments: {
    query: 'CRISPR base editing',
    limit: '{{ inputs.since_year }}',
    legacy_flag: true,
  },
}

// ── The RESOLVED tool-step path (INV-3 + INV-4) ─────────────────────────────
//
// The primary state needs a server the builder can actually resolve, so the Tool
// field renders as a POPULATED PICKER and the arguments form is generated from
// the picked tool's declared schema. `ToolStepForm` resolves the step's server
// NAME against `McpServer.servers` and then fetches
// `GET /api/mcp/servers/{id}/tools`, so the fixture has to satisfy BOTH halves:
//   - the name must be one the shared crawl cassette makes accessible
//     (`McpServer.listAccessible` seeds `weather-api` + `fetch`);
//   - `McpServerRuntime.listTools` must be in this module's cassette (below).
// If the crawl fixture ever drops that server the surface degrades VISIBLY to
// the stated-reason alert rather than silently rendering the escape hatch.

/** A server name the shared crawl cassette really makes accessible. */
const RESOLVABLE_SERVER = 'weather-api'

/** The declared input schema of `get_forecast`, as a real MCP server returns it
 *  — a required string, an optional integer with a default, a boolean, and a
 *  closed enum — so the generated form shows one typed control per kind. */
const forecastInputSchema = {
  type: 'object',
  required: ['location'],
  properties: {
    location: {
      type: 'string',
      title: 'Location',
      description: 'City, region or coordinates to forecast.',
    },
    days: {
      type: 'integer',
      description: 'How many days ahead to forecast.',
      default: 3,
    },
    include_hourly: {
      type: 'boolean',
      description: 'Include an hour-by-hour breakdown.',
    },
    units: {
      type: 'string',
      enum: ['metric', 'imperial'],
      description: 'Unit system for the returned values.',
    },
  },
}

/** What `GET /api/mcp/servers/{id}/tools` answers for the tool-step surfaces —
 *  several tools so the picker has something to search, the first carrying the
 *  four-shape schema above. */
const resolvableServerTools: Tool[] = [
  {
    name: 'get_forecast',
    description: 'Daily forecast for a place',
    input_schema: forecastInputSchema,
  },
  {
    name: 'get_current_conditions',
    description: 'Current conditions for a place',
    input_schema: {
      type: 'object',
      required: ['location'],
      properties: { location: { type: 'string', title: 'Location' } },
    },
  },
  {
    name: 'list_stations',
    description: 'Weather stations near a place',
    input_schema: {
      type: 'object',
      properties: {
        location: { type: 'string', title: 'Location' },
        radius_km: { type: 'integer', default: 50 },
      },
    },
  },
]

/** A CORRECTLY-CONFIGURED tool step on a resolvable server: the picked tool
 *  declares a schema, so each declared property gets its own typed control — a
 *  literal for `location`, a `{{ }}` reference in the NUMBER field (the case a
 *  typed control cannot hold, so it renders as template text with a way back),
 *  a boolean, and one schema-undeclared key that must survive editing (DEC-6). */
const resolvedToolStepFixture: ToolStep = {
  id: 'tool_1',
  kind: 'tool',
  description: 'Look up the forecast',
  depends_on: [],
  server: RESOLVABLE_SERVER,
  tool: 'get_forecast',
  arguments: {
    location: 'Detroit, MI',
    days: '{{ inputs.horizon_days }}',
    include_hourly: true,
    legacy_units: 'imperial',
  },
}

/** A JUST-ADDED tool step (what `AddStepMenu` produces once a server is picked):
 *  no tool chosen yet and no arguments — the `ToolStepForm` empty state. */
const newToolStepFixture: ToolStep = {
  id: 'tool_1',
  kind: 'tool',
  description: '',
  depends_on: [],
  server: RESOLVABLE_SERVER,
  tool: '',
  arguments: {},
}

/** A representative 5-step workflow (agent → llm → elicit → sandbox → tool) so
 *  the populated builder shows real-data master/detail layout. */
const builderFiveStepDef: BuilderDef = {
  inputs: [
    { name: 'topic', description: 'The research topic', required: true },
    {
      name: 'since_year',
      description: 'Earliest publication year',
      required: false,
      default: 2023,
    },
  ],
  steps: [
    agentStepFixture,
    {
      id: 'summarize',
      kind: 'llm',
      description: 'Summarise the findings',
      depends_on: ['agent_1'],
      prompt: 'Summarise the key points from {{ agent_1.output }} in five bullets.',
      output_format: 'text',
      tools: [],
    },
    {
      id: 'review',
      kind: 'elicit',
      description: 'Human review',
      depends_on: ['summarize'],
      message: 'Does this summary look right before we export it?',
      schema: {
        type: 'object',
        properties: { approved: { type: 'boolean', title: 'Approved' } },
      },
      timeout_ms: 300_000,
    },
    {
      id: 'export',
      kind: 'sandbox',
      description: 'Export to PDF',
      depends_on: ['review'],
      run: 'pandoc summary.md -o digest.pdf',
      stdin: null,
      timeout_ms: 30_000,
    },
    toolStepFixture,
  ],
}

/**
 * The SAME workflow, genuinely broken in exactly the ways `errorValidation`
 * describes — because a fixture whose findings contradict its own definition is
 * a state the real system can never produce, and a reviewer reading it sees a
 * self-contradictory surface (two steps marked broken whose config is visibly
 * complete). Each divergence from `builderFiveStepDef` is the precondition of
 * one finding below:
 *
 *  - `agent_1.prompt` is EMPTY          → `WORKFLOW_PROMPT_MISSING` (validate.rs, the prompt XOR check)
 *  - `agent_1.output_format` is `json`  → its output type is Unknown, so a field
 *    access on it DEGRADES TO A WARNING instead of erroring (type_infer.rs:114 +
 *    ref_check.rs:361)
 *  - `summarize.prompt` reads `{{ agent_1.output.title }}` → the access the
 *    `WORKFLOW_REF_FIELD_UNRESOLVED` warning names actually EXISTS in the def
 *  - `tool_1.tool` is EMPTY             → `WORKFLOW_TOOL_NO_TOOL` (validate.rs, check_steps_shape)
 *  - there is a `sandbox` step and no top-level sandbox flavor (`BuilderDef`
 *    carries none) → `WORKFLOW_SANDBOX_FLAVOR_REQUIRED` (validate.rs, check_security)
 */
const builderBrokenDef: BuilderDef = {
  inputs: builderFiveStepDef.inputs,
  steps: builderFiveStepDef.steps.map(step => {
    if (step.id === 'agent_1' && step.kind === 'agent') {
      return { ...step, prompt: '', output_format: 'json' }
    }
    if (step.id === 'summarize' && step.kind === 'llm') {
      return {
        ...step,
        prompt:
          'Summarise the key points from {{ agent_1.output.title }} in five bullets.',
      }
    }
    if (step.id === 'tool_1' && step.kind === 'tool') {
      return { ...step, tool: '' }
    }
    return step
  }),
}

/** A clean validation (no errors) with a cost estimate — the populated-builder
 *  happy path. */
const cleanValidation: ValidateDefResponse = {
  errors: [],
  warnings: [],
  cost_estimate: cannedDryRunResult,
}

/** A validation with ≥2 errors + a warning + a whole-workflow finding + a cost
 *  estimate — every panel branch lit, including the unattributed one.
 *
 *  These are REAL backend findings: each `code`/`layer`/`location`/`message`
 *  quadruple is copied from the emit site named beside it, so what the design
 *  review sees here is what the server actually produces for `builderBrokenDef`.
 *  (This fixture previously carried invented codes — `unresolved_reference`,
 *  layer `graph` — and prose that was ALREADY humanised, which is precisely why
 *  a design pass over the gallery never saw the raw "step has neither prompt:
 *  nor prompt_file:" the live app was showing. A fixture that flatters the
 *  product hides the defect it was built to catch.)
 *
 *  The warning's message is NOT hand-shortened: `ref_check.rs:434 render_expr`
 *  renders the WHOLE `RefExpr` (head + every access), so the quoted expression
 *  is `agent_1.output.title`, not `agent_1.output` — the loop at `:302` mutates
 *  its own cursor and never truncates `expr`. */
const errorValidation: ValidateDefResponse = {
  errors: [
    {
      // The prompt XOR check — `agent_1` has an empty prompt and no prompt_file.
      code: 'WORKFLOW_PROMPT_MISSING',
      layer: 'semantic',
      location: 'agent_1',
      message: 'step has neither prompt: nor prompt_file:',
    },
    {
      // check_steps_shape — `tool_1` has an empty tool:.
      code: 'WORKFLOW_TOOL_NO_TOOL',
      layer: 'semantic',
      location: 'tool_1',
      message: 'tool step has empty tool:',
    },
    {
      // check_security — emitted via `ValidationError::err`, so it carries NO
      // location: it resolves to no step and renders as "Whole workflow".
      code: 'WORKFLOW_SANDBOX_FLAVOR_REQUIRED',
      layer: 'semantic',
      message: 'workflow has kind: sandbox steps but no top-level sandbox.flavor',
    },
  ],
  warnings: [
    {
      // ref_check.rs:361-372, reached from `walk_accesses` for the `.title`
      // access in `summarize.prompt` against `agent_1`'s Unknown json output.
      code: 'WORKFLOW_REF_FIELD_UNRESOLVED',
      layer: 'semantic',
      location: 'summarize.prompt',
      message:
        "'agent_1.output.title' accesses field '.title' but the object shape is unknown; cannot type-check (ensure the field exists at runtime)",
      severity: 'warning',
    },
  ],
  cost_estimate: cannedDryRunResult,
}

// A GATE, not a comment: every code in the fixture must be one the builder can
// humanise. `HUMANISED_CODES` is the same registry the backend's
// `validation_codes_are_registered_and_humanised` test reads, so a fixture code
// the server can no longer emit (or that lost its human copy) fails LOUDLY at
// gallery boot instead of quietly rendering the raw wire message — the exact
// failure mode that let the invented `unresolved_reference` code survive here.
// It throws for the same reason `mergeModuleCassettes` throws on a collision:
// the gallery is a review instrument, and a silently wrong instrument is worse
// than a broken one.
for (const finding of [...errorValidation.errors, ...errorValidation.warnings]) {
  if (!HUMANISED_CODES.includes(finding.code)) {
    throw new Error(
      `[gallery] workflow validation fixture uses "${finding.code}", which is not in validationCopy.ts's HUMANISED_CODES — either the backend renamed it or the fixture invented it.`,
    )
  }
}

/** The friendly agent form (ITEM-9), populated — a wrapper instantiates the
 *  per-instance builder store with the agent step seeded as its initial state
 *  (no network), then renders the real form with a store + step prop. */
const agentFormSurface = lazy(async () => {
  const { WorkflowBuilderStoreDef } = await import(
    '@/modules/workflow/stores/WorkflowBuilder.store'
  )
  const { AgentStepForm } = await import(
    '@/modules/workflow/components/builder/AgentStepForm'
  )
  return {
    default: () => {
      const store = WorkflowBuilderStoreDef.use({
        def: { inputs: [], steps: [agentStepFixture] },
        selectedStepId: 'agent_1',
      })
      return (
        <div className="max-w-xl p-4">
          <AgentStepForm store={store} step={agentStepFixture} />
        </div>
      )
    },
  }
})

/** The populated builder (ITEM-7): step-list master + config-panel detail +
 *  inputs editor + validation panel, driven by a store seeded with the 4-step
 *  def and the agent step selected — so the detail column shows the agent form. */
const populatedBuilderSurface = lazy(async () => {
  const { WorkflowBuilderStoreDef } = await import(
    '@/modules/workflow/stores/WorkflowBuilder.store'
  )
  const { StepList } = await import(
    '@/modules/workflow/components/builder/StepList'
  )
  const { StepConfigPanel } = await import(
    '@/modules/workflow/components/builder/StepConfigPanel'
  )
  const { WorkflowInputsEditor } = await import(
    '@/modules/workflow/components/builder/WorkflowInputsEditor'
  )
  const { BuilderValidationPanel } = await import(
    '@/modules/workflow/components/builder/BuilderValidationPanel'
  )
  return {
    default: () => {
      const store = WorkflowBuilderStoreDef.use({
        name: 'CRISPR literature digest',
        def: builderFiveStepDef,
        selectedStepId: 'agent_1',
        validation: cleanValidation,
      })
      return (
        <div className="flex flex-col gap-4 p-4">
          <WorkflowInputsEditor store={store} />
          <div className="flex flex-col md:flex-row gap-4">
            <div className="md:w-80 shrink-0">
              <StepList store={store} />
            </div>
            <div className="flex-1 min-w-0">
              <StepConfigPanel store={store} />
            </div>
          </div>
          <BuilderValidationPanel store={store} />
        </div>
      )
    },
  }
})

/**
 * The tool step's PRIMARY state (INV-3 + INV-4) — the one a design review has to
 * be able to look at: a resolvable server, so the Tool field is a real PICKER
 * over that server's tools, and a picked tool that declares a schema, so each
 * property gets its own typed control (required string / integer with a default
 * / boolean / closed enum) plus a `{{ }}` reference held in the number field and
 * one schema-undeclared key kept alive under "Additional arguments".
 *
 * Rendered through the real `StepConfigPanel` with the TOOL step selected, so
 * this is genuinely `StepConfigPanel → ToolStepForm → ToolArgumentsForm` — the
 * production path, not a hand-assembled sub-component. Nothing is stubbed: the
 * catalog store fetches `McpServerRuntime.listTools` through the mock API from
 * this module's cassette, and every control commits into the builder store, so
 * the generated fields and the DEC-5 back-to-a-typed-control button are LIVE.
 */
const toolStepSchemaSurface = lazy(async () => {
  const { WorkflowBuilderStoreDef } = await import(
    '@/modules/workflow/stores/WorkflowBuilder.store'
  )
  const { StepConfigPanel } = await import(
    '@/modules/workflow/components/builder/StepConfigPanel'
  )
  return {
    default: () => {
      const store = WorkflowBuilderStoreDef.use({
        def: {
          inputs: [
            {
              name: 'horizon_days',
              description: 'How many days ahead to look',
              required: false,
              default: 3,
            },
          ],
          steps: [resolvedToolStepFixture],
        },
        selectedStepId: 'tool_1',
      })
      return (
        <div className="max-w-xl p-4">
          <StepConfigPanel store={store} />
        </div>
      )
    },
  }
})

/** A JUST-ADDED tool step: the server is chosen but no tool is picked yet, so
 *  the picker sits at its placeholder, no schema-generated form exists, and the
 *  arguments list shows its "No arguments" empty row — the state an author is in
 *  the moment they add the step. */
const toolStepNewSurface = lazy(async () => {
  const { WorkflowBuilderStoreDef } = await import(
    '@/modules/workflow/stores/WorkflowBuilder.store'
  )
  const { ToolStepForm } = await import(
    '@/modules/workflow/components/builder/ToolStepForm'
  )
  return {
    default: () => {
      const store = WorkflowBuilderStoreDef.use({
        def: { inputs: [], steps: [newToolStepFixture] },
        selectedStepId: 'tool_1',
      })
      return (
        <div className="max-w-xl p-4">
          <ToolStepForm store={store} step={newToolStepFixture} />
        </div>
      )
    },
  }
})

/** The tool step's documented FALLBACK (INV-6): the step points at a server that
 *  is not in the author's accessible set, so the tool name + arguments are
 *  entered by hand — with a stated reason, never a silently empty picker. */
const toolStepFallbackSurface = lazy(async () => {
  const { WorkflowBuilderStoreDef } = await import(
    '@/modules/workflow/stores/WorkflowBuilder.store'
  )
  const { ToolStepForm } = await import(
    '@/modules/workflow/components/builder/ToolStepForm'
  )
  return {
    default: () => {
      const store = WorkflowBuilderStoreDef.use({
        def: { inputs: [], steps: [toolStepFixture] },
        selectedStepId: 'tool_1',
      })
      return (
        <div className="max-w-xl p-4">
          <ToolStepForm store={store} step={toolStepFixture} />
        </div>
      )
    },
  }
})

/** The builder with PROBLEMS: the step list marks which steps are incomplete
 *  and the panel names + links to each (INV-2). Two steps are broken for
 *  DIFFERENT reasons while a THIRD, unrelated step is selected — the owner's
 *  actual situation, and the state a clean-validation fixture cannot show. */
const problemBuilderSurface = lazy(async () => {
  const { WorkflowBuilderStoreDef } = await import(
    '@/modules/workflow/stores/WorkflowBuilder.store'
  )
  const { StepList } = await import(
    '@/modules/workflow/components/builder/StepList'
  )
  const { BuilderValidationPanel } = await import(
    '@/modules/workflow/components/builder/BuilderValidationPanel'
  )
  return {
    default: () => {
      const store = WorkflowBuilderStoreDef.use({
        def: builderBrokenDef,
        // Deliberately NOT one of the broken steps: a finding must be
        // actionable from wherever the author happens to be reading it.
        selectedStepId: 'review',
        validation: errorValidation,
      })
      return (
        <div className="flex flex-col gap-4 p-4 md:flex-row">
          <div className="shrink-0 md:w-80">
            <StepList store={store} />
          </div>
          <div className="min-w-0 flex-1">
            <BuilderValidationPanel store={store} />
          </div>
        </div>
      )
    },
  }
})

/** The builder validation panel with ≥1 error + ≥1 warning + a cost estimate. */
const validationErrorSurface = lazy(async () => {
  const { WorkflowBuilderStoreDef } = await import(
    '@/modules/workflow/stores/WorkflowBuilder.store'
  )
  const { BuilderValidationPanel } = await import(
    '@/modules/workflow/components/builder/BuilderValidationPanel'
  )
  return {
    default: () => {
      // The def MUST be seeded alongside the validation: a finding is attributed
      // by resolving its `location` against the real steps, so a validation-only
      // fixture renders every finding as "Whole workflow" and silently fails to
      // exercise the attribution this panel exists to do.
      const store = WorkflowBuilderStoreDef.use({
        def: builderBrokenDef,
        validation: errorValidation,
      })
      return (
        <div className="max-w-2xl p-4">
          <BuilderValidationPanel store={store} />
        </div>
      )
    },
  }
})

export const gallery: ModuleGallery = {
  cassette: {
    ...workflowCassette,
    // The tool step's PICKER + schema-generated arguments are driven by the real
    // `ToolCatalogStoreDef.load` → `GET /api/mcp/servers/{id}/tools` path, so the
    // tool-step surfaces need this endpoint recorded. It is answered for ANY
    // server id: the surfaces that must NOT resolve point at a server NAME the
    // accessible list does not contain, so `entryForServerName` short-circuits
    // before any request is made. (No other module seeds this key — the merge
    // step throws on a collision.)
    'McpServerRuntime.listTools': { tools: resolvableServerTools },
  },
  overlays: [
    {
      slug: 'overlay-group-workflows-assignment',
      surface: 'modules/workflow/widgets/GroupSystemWorkflowsAssignmentDrawer',
      title: 'Group → Workflows (drawer)',
      component: lazyNamed(
        () => import('@/modules/workflow/widgets/GroupSystemWorkflowsAssignmentDrawer'),
        'GroupSystemWorkflowsAssignmentDrawer',
      ),
      open: () => GroupSystemWorkflowsAssignment.openDrawer(group),
    },
    {
      slug: 'overlay-workflow-detail-drawer',
      surface: 'modules/workflow/components/WorkflowDetailDrawer',
      title: 'Workflow detail (drawer)',
      // The gallery overlay host (`OverlayFrame`) now wraps every overlay in a
      // MemoryRouter, so the drawer's `useNavigate` "Edit" affordance resolves
      // without a per-component wrapper — render the real component directly.
      component: lazyNamed(
        () => import('@/modules/workflow/components/WorkflowDetailDrawer'),
        'WorkflowDetailDrawer',
      ),
      open: () => WorkflowDrawer.open(workflowFixture as any),
    },
    {
      slug: 'overlay-import-workflow-dialog',
      surface: 'modules/workflow/components/ImportWorkflowDialog',
      title: 'Import workflow (dialog)',
      component: lazyBound(
        () => import('@/modules/workflow/components/ImportWorkflowDialog'),
        'ImportWorkflowDialog',
        { open: true, onClose: noop },
      ),
    },
    {
      slug: 'overlay-workflow-run-dialog',
      surface: 'modules/workflow/components/WorkflowRunDialog',
      title: 'Run workflow (dialog)',
      component: lazyBound(
        () => import('@/modules/workflow/components/WorkflowRunDialog'),
        'WorkflowRunDialog',
        {
          open: true,
          onClose: noop,
          conversationId: 'conv-1',
          workflow: workflowFixture,
          onStarted: noop,
        },
      ),
    },
    {
      slug: 'overlay-dry-run-preview-dialog',
      surface: 'modules/workflow/components/DryRunPreviewDialog',
      title: 'Dry-run preview (dialog)',
      component: lazyBound(
        () => import('@/modules/workflow/components/DryRunPreviewDialog'),
        'DryRunPreviewDialog',
        { open: true, onClose: noop, workflow: workflowFixture },
      ),
    },
    {
      slug: 'overlay-workflow-tests-panel',
      surface: 'modules/workflow/components/WorkflowTestsPanel',
      title: 'Workflow tests (dialog)',
      component: lazyBound(
        () => import('@/modules/workflow/components/WorkflowTestsPanel'),
        'WorkflowTestsPanel',
        { open: true, onClose: noop, workflow: workflowFixture },
      ),
    },
  ],
  seeded: [
    // ── WorkflowRunsList: no runs for this workflow → empty (prop workflowId). ───
    {
      slug: 'seeded-workflow-runs-empty',
      title: 'Workflow runs list — empty',
      note: '!loading[wf] && items.length===0 → the empty state',
      path: '/',
      initialPath: '/',
      component: lazyProps(
        () => import('@/modules/workflow/components/WorkflowRunsList'),
        'WorkflowRunsList',
        { workflowId: 'wf-1', onSelectRun: () => undefined },
      ),
      setup: async () => {
        const { useWorkflowRunsStore } = await import(
          '@/modules/workflow/stores/workflowRuns'
        )
        await holdPatch(() =>
          useWorkflowRunsStore.setState({
            runs: { 'wf-1': [] },
            loading: { 'wf-1': false },
          } as any),
        )
      },
    },
    // ── StepArtifacts: a step with no artifacts → the `return null` arm. ─────────
    {
      slug: 'seeded-step-artifacts-empty',
      title: 'Workflow step artifacts — empty',
      note: 'artifacts.length===0 → renders nothing',
      path: '/',
      initialPath: '/',
      component: lazyProps(
        () => import('@/modules/workflow/components/StepArtifacts'),
        'StepArtifacts',
        { runId: 'run-1', stepId: 'step-1', artifacts: [] },
      ),
    },
    // ── WorkflowRunProgressView: a failed run with a completed + a failed step →
    //    run-error alert (:178), per-step error (:240,241), and the
    //    completed/failed log-expander block (:268,269). ─────────────────────────
    {
      slug: 'seeded-s1-run-progress-error',
      title: 'Workflow run progress — failed run',
      note: 'run.error + a failed step (error) + completed step → error alert, step error, log expanders',
      path: '/',
      initialPath: '/',
      component: lazyProps(
        () => import('@/modules/workflow/components/WorkflowRunProgressView'),
        'WorkflowRunProgressView',
        { runId: 'run-s1-err' },
      ),
      setup: async () => {
        const { useWorkflowRunStore } = await import(
          '@/modules/workflow/stores/workflowRun'
        )
        await holdPatch(() =>
          useWorkflowRunStore.setState({
            runs: {
              'run-s1-err': {
                runId: 'run-s1-err',
                status: 'failed',
                totalTokens: 1840,
                connected: true,
                error: 'Run failed: sandbox step exited non-zero',
                stepOrder: ['draft', 'analyze'],
                steps: {
                  draft: {
                    stepId: 'draft',
                    stepKind: 'llm',
                    status: 'completed',
                    description: 'Draft the outline',
                    tokensUsed: 512,
                    msElapsed: 2300,
                    hasOutput: true,
                  },
                  analyze: {
                    stepId: 'analyze',
                    stepKind: 'sandbox',
                    status: 'failed',
                    description: 'Run the analysis script',
                    error: 'Command exited with code 1: ModuleNotFoundError',
                  },
                },
              },
            },
          } as any),
        )
      },
    },
    // ── WorkflowRunProgressView: a non-terminal run with no steps yet → the
    //    "Waiting for steps to start…" empty arm (:307). ─────────────────────────
    {
      slug: 'seeded-s1-run-progress-empty-steps',
      title: 'Workflow run progress — awaiting steps',
      note: 'non-terminal run with steps:{} stepOrder:[] → "Waiting for steps to start…"',
      path: '/',
      initialPath: '/',
      component: lazyProps(
        () => import('@/modules/workflow/components/WorkflowRunProgressView'),
        'WorkflowRunProgressView',
        { runId: 'run-s1-empty' },
      ),
      setup: async () => {
        const { useWorkflowRunStore } = await import(
          '@/modules/workflow/stores/workflowRun'
        )
        await holdPatch(() =>
          useWorkflowRunStore.setState({
            runs: {
              'run-s1-empty': {
                runId: 'run-s1-empty',
                status: 'running',
                totalTokens: 0,
                connected: true,
                stepOrder: [],
                steps: {},
              },
            },
          } as any),
        )
      },
    },
    // ── WorkflowTestsPanel: loading / error / result (local useState driven by
    //    WorkflowStore.test). :60 / :61 / :62,66,67. ──────────────────────────
    {
      slug: 'seeded-s1-tests-loading',
      title: 'Workflow tests — loading',
      note: 'test() pending → the load spinner',
      path: '/',
      initialPath: '/',
      component: panelSurface(() => import('@/modules/workflow/components/WorkflowTestsPanel'), 'WorkflowTestsPanel', 'test', 'loading', null),
    },
    {
      slug: 'seeded-s1-tests-error',
      title: 'Workflow tests — error',
      note: 'test() rejects → the error alert',
      path: '/',
      initialPath: '/',
      component: panelSurface(() => import('@/modules/workflow/components/WorkflowTestsPanel'), 'WorkflowTestsPanel', 'test', 'error', null),
    },
    {
      slug: 'seeded-s1-tests-result',
      title: 'Workflow tests — results',
      note: 'test() resolves with passed/failed/skipped → tags, list, failure detail',
      path: '/',
      initialPath: '/',
      component: panelSurface(
        () => import('@/modules/workflow/components/WorkflowTestsPanel'),
        'WorkflowTestsPanel',
        'test',
        'result',
        cannedTestResult,
      ),
    },
    // ── DryRunPreviewDialog: loading / error / result (WorkflowStore.dryRun).
    //    :58 / :59 / :60. ───────────────────────────────────────────────────────
    {
      slug: 'seeded-s1-dry-run-loading',
      title: 'Workflow dry-run — loading',
      note: 'dryRun() pending → the "Running dry run" spinner',
      path: '/',
      initialPath: '/',
      component: panelSurface(() => import('@/modules/workflow/components/DryRunPreviewDialog'), 'DryRunPreviewDialog', 'dryRun', 'loading', null),
    },
    {
      slug: 'seeded-s1-dry-run-error',
      title: 'Workflow dry-run — error',
      note: 'dryRun() rejects → the error alert',
      path: '/',
      initialPath: '/',
      component: panelSurface(() => import('@/modules/workflow/components/DryRunPreviewDialog'), 'DryRunPreviewDialog', 'dryRun', 'error', null),
    },
    {
      slug: 'seeded-s1-dry-run-result',
      title: 'Workflow dry-run — results',
      note: 'dryRun() resolves → est stats + per-step table (runtime-dependent cell)',
      path: '/',
      initialPath: '/',
      component: panelSurface(
        () => import('@/modules/workflow/components/DryRunPreviewDialog'),
        'DryRunPreviewDialog',
        'dryRun',
        'result',
        cannedDryRunResult,
      ),
    },
    // ── WorkflowElicitForm: validation-failed submit → the inline error alert
    //    (:484,485). Auto-clicked after mount with a required field left blank. ──
    {
      slug: 'seeded-s1-elicit-error',
      title: 'Workflow elicitation — validation error',
      note: 'required field blank + submit → "Please fix the highlighted fields" alert',
      path: '/',
      initialPath: '/',
      component: elicitErrorSurface,
    },
    // ── EditableArrayTable: an empty RHF field array → the "No rows" empty
    //    <tr> (:358). ───────────────────────────────────────────────────────────
    {
      slug: 'seeded-s1-array-empty',
      title: 'Workflow editable array table — empty',
      note: 'empty field array → the "No rows" empty row',
      path: '/',
      initialPath: '/',
      component: arrayEmptySurface,
    },
    // ── Builder — friendly agent form (ITEM-9), populated. ──────────────────────
    {
      slug: 'seeded-wf-builder-agent-form',
      title: 'Workflow builder — agent task form',
      note: 'populated AgentStepForm: instructions + 2 capabilities + Balanced effort + Text output + read-back',
      path: '/',
      initialPath: '/',
      fullHeight: true,
      component: agentFormSurface,
    },
    // ── Builder — empty (create mode). Real WorkflowBuilderPage, no def. ────────
    {
      slug: 'seeded-wf-builder-empty',
      title: 'Workflow builder — new (empty)',
      note: 'WorkflowBuilderPage create mode (no :id) → initEmpty → empty step list + inputs',
      path: '/settings/workflows/builder',
      initialPath: '/settings/workflows/builder',
      fullHeight: true,
      component: lazyNamed(
        () =>
          import('@/modules/workflow/components/builder/WorkflowBuilderPage'),
        'WorkflowBuilderPage',
      ),
    },
    // ── Builder — populated (4-step workflow incl. an agent step). ─────────────
    {
      slug: 'seeded-wf-builder-populated',
      title: 'Workflow builder — populated (5 steps)',
      note: 'step-list + config-panel + inputs + validation, seeded with agent→llm→elicit→sandbox→tool; agent step selected',
      path: '/',
      initialPath: '/',
      fullHeight: true,
      component: populatedBuilderSurface,
    },
    // ── Builder — steps with problems: per-step invalid markers + attribution.
    {
      slug: 'seeded-wf-builder-problems',
      title: 'Workflow builder — steps with problems',
      note: 'a genuinely broken def: two steps invalid for different reasons + a whole-workflow finding, with a THIRD step selected — the step list marks the broken ones and each attributed finding names + links to its step',
      path: '/',
      initialPath: '/',
      fullHeight: true,
      component: problemBuilderSurface,
    },
    // ── Builder — tool step: the PRIMARY state (INV-3 + INV-4). ───────────────
    {
      slug: 'seeded-wf-builder-tool-schema-form',
      title: 'Workflow builder — tool step, picker + schema-driven arguments',
      note: 'StepConfigPanel with the TOOL step selected: a resolvable server, a populated tool picker, and one typed control per declared property (required string, integer with a default, boolean, enum) plus a {{ }} reference held in the NUMBER field and a schema-undeclared key kept alive',
      path: '/',
      initialPath: '/',
      fullHeight: true,
      component: toolStepSchemaSurface,
    },
    // ── Builder — tool step: just added, nothing picked yet. ──────────────────
    {
      slug: 'seeded-wf-builder-tool-new',
      title: 'Workflow builder — tool step, nothing picked yet',
      note: 'a just-added tool step: server chosen, no tool selected, no generated form, and the "No arguments" empty row',
      path: '/',
      initialPath: '/',
      fullHeight: true,
      component: toolStepNewSurface,
    },
    // ── Builder — tool step: hand-entry fallback (INV-6). ─────────────────────
    {
      slug: 'seeded-wf-builder-tool-fallback',
      title: 'Workflow builder — tool step, server not available',
      note: 'the documented escape hatch: the step points at a server the author cannot access, so a stated reason + free-text tool name + key/value arguments — never a silently empty picker',
      path: '/',
      initialPath: '/',
      fullHeight: true,
      component: toolStepFallbackSurface,
    },
    // ── Builder — validation panel with errors + warnings + cost. ──────────────
    {
      slug: 'seeded-wf-builder-validation-error',
      title: 'Workflow builder — validation errors',
      note: 'ValidateDefResponse with 2 step-attributed errors + an unattributed "Whole workflow" error + a warning + a cost estimate → every panel branch',
      path: '/',
      initialPath: '/',
      fullHeight: true,
      component: validationErrorSurface,
    },
    // ── Run — agent activity timeline, RUNNING (last row status:running). ──────
    {
      slug: 'seeded-wf-run-agent-running',
      title: 'Agent run timeline — running',
      note: 'agent step with an accreting activity timeline; the last row is status:running',
      path: '/',
      initialPath: '/',
      fullHeight: true,
      component: lazyProps(
        () => import('@/modules/workflow/components/WorkflowRunProgressView'),
        'WorkflowRunProgressView',
        { runId: 'run-agent-running' },
      ),
      setup: async () => {
        const { useWorkflowRunStore } = await import(
          '@/modules/workflow/stores/workflowRun'
        )
        await holdPatch(() =>
          useWorkflowRunStore.setState({
            runs: {
              'run-agent-running': {
                runId: 'run-agent-running',
                status: 'running',
                totalTokens: 3420,
                connected: true,
                currentStep: 'agent_1',
                stepOrder: ['agent_1'],
                steps: {
                  agent_1: {
                    stepId: 'agent_1',
                    stepKind: 'agent',
                    status: 'running',
                    description: 'Research the topic',
                    agentActivity: [
                      { type: 'agent_activity', seq: 1, kind: 'tool_call', tool: 'literature_search', title: 'Searching the literature', detail: 'query: CRISPR base editing, 2023–2025', status: 'ok' },
                      { type: 'agent_activity', seq: 2, kind: 'tool_result', tool: 'literature_search', title: 'Found 24 papers', status: 'ok' },
                      { type: 'agent_activity', seq: 3, kind: 'tool_call', tool: 'fetch_paper_fulltext', title: 'Reading the 3 most-cited papers', status: 'ok' },
                      { type: 'agent_activity', seq: 4, kind: 'thinking', title: 'Comparing the key findings', status: 'ok' },
                      { type: 'agent_activity', seq: 5, kind: 'message', title: 'Drafting a plain-language summary', status: 'running' },
                    ],
                  },
                },
              },
            },
          } as any),
        )
      },
    },
    // ── Run — agent timeline with a PENDING GATE (inline elicitation form). ────
    {
      slug: 'seeded-wf-run-agent-gate',
      title: 'Agent run timeline — gate open',
      note: 'agent step paused on a human gate → inline WorkflowElicitForm anchored to the gate row',
      path: '/',
      initialPath: '/',
      fullHeight: true,
      component: lazyProps(
        () => import('@/modules/workflow/components/WorkflowRunProgressView'),
        'WorkflowRunProgressView',
        { runId: 'run-agent-gate' },
      ),
      setup: async () => {
        const { useWorkflowRunStore } = await import(
          '@/modules/workflow/stores/workflowRun'
        )
        await holdPatch(() =>
          useWorkflowRunStore.setState({
            runs: {
              'run-agent-gate': {
                runId: 'run-agent-gate',
                status: 'waiting',
                totalTokens: 5120,
                connected: true,
                currentStep: 'agent_1',
                pendingElicitation: {
                  elicitation_id: 'elicit-agent-1',
                  run_id: 'run-agent-gate',
                  step_id: 'agent_1',
                  message: 'I found two candidate review protocols. Which should I follow?',
                  deadline_at: new Date(Date.now() + 600_000).toISOString(),
                  schema: {
                    type: 'object',
                    properties: {
                      choice: { type: 'string', title: 'Which protocol should I use?' },
                    },
                    required: ['choice'],
                  },
                },
                stepOrder: ['agent_1'],
                steps: {
                  agent_1: {
                    stepId: 'agent_1',
                    stepKind: 'agent',
                    status: 'running',
                    description: 'Research the topic',
                    agentActivity: [
                      { type: 'agent_activity', seq: 1, kind: 'tool_call', tool: 'literature_search', title: 'Searching the literature', status: 'ok' },
                      { type: 'agent_activity', seq: 2, kind: 'tool_result', tool: 'literature_search', title: 'Found 24 papers', status: 'ok' },
                      { type: 'agent_activity', seq: 3, kind: 'gate', title: 'Waiting for your input', detail: 'The assistant paused to ask which review protocol to follow.', status: 'running' },
                    ],
                  },
                },
              },
            },
          } as any),
        )
      },
    },
    // ── Run — agent timeline, COMPLETED (all activity ok, step done). ──────────
    {
      slug: 'seeded-wf-run-agent-completed',
      title: 'Agent run timeline — completed',
      note: 'agent step with all activity status:ok and the step completed → output + log expanders',
      path: '/',
      initialPath: '/',
      fullHeight: true,
      component: lazyProps(
        () => import('@/modules/workflow/components/WorkflowRunProgressView'),
        'WorkflowRunProgressView',
        { runId: 'run-agent-done' },
      ),
      setup: async () => {
        const { useWorkflowRunStore } = await import(
          '@/modules/workflow/stores/workflowRun'
        )
        await holdPatch(() =>
          useWorkflowRunStore.setState({
            runs: {
              'run-agent-done': {
                runId: 'run-agent-done',
                status: 'completed',
                totalTokens: 6890,
                connected: true,
                stepOrder: ['agent_1'],
                steps: {
                  agent_1: {
                    stepId: 'agent_1',
                    stepKind: 'agent',
                    status: 'completed',
                    description: 'Research the topic',
                    tokensUsed: 6890,
                    msElapsed: 48200,
                    hasOutput: true,
                    outputPreview:
                      'Three papers stand out: Anzalone et al. (2023) on prime-editing efficiency, …',
                    agentActivity: [
                      { type: 'agent_activity', seq: 1, kind: 'tool_call', tool: 'literature_search', title: 'Searching the literature', status: 'ok' },
                      { type: 'agent_activity', seq: 2, kind: 'tool_result', tool: 'literature_search', title: 'Found 24 papers', status: 'ok' },
                      { type: 'agent_activity', seq: 3, kind: 'tool_call', tool: 'fetch_paper_fulltext', title: 'Read the 3 most-cited papers', status: 'ok' },
                      { type: 'agent_activity', seq: 4, kind: 'thinking', title: 'Compared the key findings', status: 'ok' },
                      { type: 'agent_activity', seq: 5, kind: 'message', title: 'Wrote the plain-language summary', status: 'ok' },
                    ],
                  },
                },
              },
            },
          } as any),
        )
      },
    },
  ],
}
