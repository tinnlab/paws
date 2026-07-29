import { Segmented } from '@ziee/kit'
import type { WorkflowBuilderStore } from '../../stores/WorkflowBuilder.store'
import { type BuilderStep, configErrors, promptSuppliedByFile, PROMPT_FROM_FILE_NOTE } from './stepForms'
import { LabeledControl, PromptField } from './builderFields'

type LlmStep = Extract<BuilderStep, { kind: 'llm' }>

interface Props {
  store: WorkflowBuilderStore
  step: LlmStep
}

/** A single language-model prompt. */
export function LlmStepForm({ store, step }: Props) {
  const errors = configErrors(step)
  const patch = (p: Record<string, unknown>) => store.updateStep(step.id, p)

  // A step whose wording comes from `prompt_file:` needs no typed prompt
  // (validate.rs: WORKFLOW_PROMPT_MISSING fires only when NEITHER is
  // present). Marking it required anyway is a false statement, and the
  // only one left on the field — obeying it produces WORKFLOW_PROMPT_BOTH.
  const fromFile = promptSuppliedByFile(step)

  return (
    <div className="flex flex-col gap-4">
      <PromptField
        store={store}
        stepId={step.id}
        label="Prompt"
        value={step.prompt ?? ''}
        // A CLEARED box must become absent, not `""`. Both the backend
        // validator and the runner now read `Some("")` as "no typed prompt"
        // (they share `validate::prompt_source`), so `prompt: ""` beside a
        // `prompt_file:` validates GREEN *and* runs from the file. Writing the
        // empty string through is nevertheless wrong: it is not what the author
        // meant, it is not what `toWorkflowDef` should serialise, and it was
        // what made the two sides disagree before the rule was shared.
        // WORKFLOW_PROMPT_BOTH's copy tells the author to clear this box, so
        // this normalisation is what keeps its remedy honest.
        onChange={v => patch({ prompt: v || null })}
        placeholder="Write the prompt. Insert a reference to reuse an input or a prior step's output."
        rows={6}
        required={!fromFile}
        description={fromFile ? PROMPT_FROM_FILE_NOTE : undefined}
        error={errors.prompt}
        testid="wf-builder-llm-prompt"
      />

      <LabeledControl
        label="Output"
        description="A written answer, or a structured (JSON) result."
      >
        <Segmented
          data-testid="wf-builder-llm-output"
          aria-label="Output format"
          value={step.output_format === 'json' ? 'json' : 'text'}
          onValueChange={v => patch({ output_format: v })}
          options={[
            { value: 'text', label: 'Text' },
            { value: 'json', label: 'Structured' },
          ]}
        />
      </LabeledControl>

      {/* No tools picker here: the backend `validate-def` (E6,
          WORKFLOW_DEAD_TOOLS_FIELD) rejects a non-empty `tools` on an
          llm/llm_map step. Tool use belongs to the `tool` step kind (a single
          named tool) and to the agent step's `servers` (capabilities). */}
    </div>
  )
}
