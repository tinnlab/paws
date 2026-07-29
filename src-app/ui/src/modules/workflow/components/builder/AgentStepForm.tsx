import { useMemo } from 'react'
import { Accordion, InputNumber, Segmented, Text, Textarea } from '@ziee/kit'

import type { WorkflowBuilderStore } from '../../stores/WorkflowBuilder.store'
import { type BuilderStep, configErrors, promptSuppliedByFile, PROMPT_FROM_FILE_NOTE } from './stepForms'
import { LabeledControl, PromptField } from './builderFields'
import { CapabilityMultiSelect } from './capabilities'
import { McpServer } from '@/modules/mcp/stores/mcpServer'
import {
  EFFORT_LABELS,
  EFFORTS,
  type Effort,
  agentReadback,
  effortToMaxSteps,
  maxStepsToEffort,
} from './agentStepForm'

type AgentStep = Extract<BuilderStep, { kind: 'agent' }>

interface AgentStepFormProps {
  store: WorkflowBuilderStore
  step: AgentStep
}

/**
 * ITEM-9 — the friendly agent-step form. Domain language over tool jargon: a
 * big "What should the assistant do?" task box, a capability picker, a named
 * EFFORT control (Quick/Balanced/Thorough → max_steps), an OUTPUT control, and
 * an Advanced disclosure for the system directive + an exact step ceiling. A
 * plain-English read-back sentence lets a non-technical author sanity-check the
 * configuration (show-then-act).
 */
export function AgentStepForm({ store, step }: AgentStepFormProps) {
  const errors = configErrors(step)
  const patch = (p: Record<string, unknown>) => store.updateStep(step.id, p)

  const servers = step.servers ?? []
  const maxSteps = step.max_steps ?? effortToMaxSteps('balanced')
  const effort = maxStepsToEffort(maxSteps)
  const outputFormat = step.output_format === 'json' ? 'json' : 'text'

  // Friendly capability labels for the read-back sentence.
  const allServers = McpServer.servers
  const capabilityLabels = useMemo(() => {
    const byName = new Map(
      (allServers ?? []).map(s => [s.name, s.display_name || s.name]),
    )
    return servers.map(name => byName.get(name) ?? name)
  }, [allServers, servers])

  const readback = agentReadback({
    prompt: step.prompt,
    max_steps: maxSteps,
    output_format: outputFormat,
    capabilityLabels,
  })

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
        label="What should the assistant do?"
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
        placeholder="Describe the task in plain language, e.g. “Find the three most-cited papers on the topic and summarise their key findings.”"
        rows={5}
        required={!fromFile}
        description={fromFile ? PROMPT_FROM_FILE_NOTE : undefined}
        error={errors.prompt}
        testid="wf-builder-agent-prompt"
      />

      <LabeledControl
        label="Capabilities"
        description="The tools this assistant is allowed to use. Leave empty for a reasoning-only task."
      >
        <CapabilityMultiSelect
          value={servers}
          onChange={v => patch({ servers: v })}
          testid="wf-builder-agent-servers"
        />
      </LabeledControl>

      <LabeledControl
        label="Effort"
        description="How hard the assistant should work before returning an answer."
      >
        <Segmented
          data-testid="wf-builder-agent-effort"
          aria-label="Effort"
          value={effort}
          onValueChange={v =>
            patch({ max_steps: effortToMaxSteps(v as Effort) })
          }
          options={EFFORTS.map(e => ({
            value: e,
            label: `${EFFORT_LABELS[e]} (${effortToMaxSteps(e)} steps)`,
          }))}
        />
      </LabeledControl>

      <LabeledControl
        label="Output"
        description="Return a written answer, or a structured (JSON) result later steps can read field-by-field."
      >
        <Segmented
          data-testid="wf-builder-agent-output"
          aria-label="Output format"
          value={outputFormat}
          onValueChange={v => patch({ output_format: v })}
          options={[
            { value: 'text', label: 'Text' },
            { value: 'json', label: 'Structured' },
          ]}
        />
      </LabeledControl>

      <div
        className="rounded-md bg-muted p-3"
        data-testid="wf-builder-agent-readback"
      >
        <Text className="text-xs font-medium text-muted-foreground">
          What this task will do
        </Text>
        <Text className="text-sm">{readback}</Text>
      </div>

      <Accordion
        data-testid="wf-builder-agent-advanced"
        type="single"
        collapsible
        items={[
          {
            key: 'advanced',
            label: 'Advanced',
            children: (
              <div className="flex flex-col gap-4 pt-2">
                <LabeledControl
                  label="System directive"
                  description="An optional instruction that shapes the assistant's behaviour (persona, constraints, format)."
                >
                  <Textarea
                    data-testid="wf-builder-agent-system"
                    rows={3}
                    value={step.system ?? ''}
                    onChange={e =>
                      patch({ system: e.target.value || null })
                    }
                    placeholder="You are a meticulous research assistant…"
                  />
                </LabeledControl>
                <LabeledControl
                  label="Exact step limit"
                  description="The maximum number of tool-use iterations. The Effort control sets this for you; override it here if you need a precise value."
                  error={errors.max_steps}
                >
                  <InputNumber
                    data-testid="wf-builder-agent-max-steps"
                    min={1}
                    precision={0}
                    className="w-40"
                    value={maxSteps}
                    onChange={v => patch({ max_steps: v ?? 1 })}
                  />
                </LabeledControl>
              </div>
            ),
          },
        ]}
      />
    </div>
  )
}
