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
        // A CLEARED box must become absent, not `""`. The backend reads
        // `Some("")` as "no typed prompt" (validate.rs: has_prompt filters
        // empty), so `prompt: "" ` + `prompt_file:` passes validation GREEN —
        // and then dispatch.rs's load_raw_prompt, which matches only
        // (Some,None)/(None,Some), fails the RUN with "invalid prompt config".
        // WORKFLOW_PROMPT_BOTH's copy tells the author to clear this box, so
        // without this normalisation the builder's own remedy breaks the run.
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
