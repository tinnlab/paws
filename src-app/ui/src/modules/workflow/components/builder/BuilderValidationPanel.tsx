import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'
import { Button, Spinner, Text } from '@ziee/kit'
import type { WorkflowBuilderStore } from '../../stores/WorkflowBuilder.store'
import {
  type AttributedFinding,
  attributeFindings,
  findingStepTitle,
} from './validationCopy'

interface BuilderValidationPanelProps {
  store: WorkflowBuilderStore
}

/**
 * One finding.
 *
 * It is a BUTTON, not static text (ITEM-3 / INV-2): a finding names the step it
 * belongs to and takes the author there. The panel sits at the bottom of the
 * page while the config panel shows whichever step is selected, so a finding the
 * author cannot act on from where they are reading it is the defect this fixes.
 * A whole-workflow finding (no resolvable step) renders as plain text — there is
 * nowhere to go.
 */
function Finding({
  finding,
  onSelect,
}: {
  finding: AttributedFinding
  onSelect: (stepId: string) => void
}) {
  const isError = finding.severity === 'error'
  const Icon = isError ? XCircle : AlertTriangle
  const color = isError ? 'text-destructive' : 'text-warning'
  const title = findingStepTitle(finding)

  const body = (
    <>
      <Icon className={`size-4 mt-0.5 shrink-0 ${color}`} aria-hidden />
      <span className="flex min-w-0 flex-col text-start">
        <Text className="text-xs font-medium text-muted-foreground">{title}</Text>
        <Text className="text-sm">{finding.text}</Text>
      </span>
    </>
  )

  if (!finding.stepId) {
    return (
      <li className="flex items-start gap-2" data-testid="wf-builder-finding">
        {body}
      </li>
    )
  }

  return (
    <li data-testid="wf-builder-finding" data-step-id={finding.stepId}>
      <Button
        type="button"
        variant="ghost"
        data-testid={`wf-builder-finding-goto-${finding.stepId}`}
        className="flex h-auto w-full items-start justify-start gap-2 whitespace-normal py-1 text-start"
        onClick={() => onSelect(finding.stepId as string)}
      >
        {body}
      </Button>
    </li>
  )
}

/** ITEM-7 — inline validation + cost estimate from `POST /validate-def`. Errors
 *  block Save (the page disables the button); warnings are surfaced but allowed.
 *  Every finding is humanised + attributed to its step (ITEM-1 / ITEM-3). */
export function BuilderValidationPanel({ store }: BuilderValidationPanelProps) {
  const validation = store.validation
  const validating = store.validating
  const steps = store.def.steps
  const cost = validation?.cost_estimate

  // Attribute + humanise ONCE, above any map, so the panel and the step list can
  // never disagree about which steps are broken — and so no store read happens
  // inside a loop (Rules of Hooks).
  const errors = attributeFindings(validation?.errors ?? [], steps)
  const warnings = attributeFindings(validation?.warnings ?? [], steps)

  const onSelect = (stepId: string) => store.selectStep(stepId)

  return (
    <div className="flex flex-col gap-3" data-testid="wf-builder-validation">
      <div className="flex items-center gap-2">
        <Text strong>Validation</Text>
        {validating && <Spinner size="sm" label="Validating workflow" />}
      </div>

      {!validation && !validating && (
        <Text type="secondary" className="text-xs">
          Add steps to validate the workflow.
        </Text>
      )}

      {validation && errors.length === 0 && (
        <div className="flex items-center gap-2" data-testid="wf-builder-valid">
          <CheckCircle2 className="size-4 text-success" aria-hidden />
          <Text className="text-sm">No blocking errors.</Text>
        </div>
      )}

      {errors.length > 0 && (
        <ul className="flex flex-col gap-2" data-testid="wf-builder-errors">
          {errors.map((f, i) => (
            <Finding key={`e-${i}`} finding={f} onSelect={onSelect} />
          ))}
        </ul>
      )}

      {warnings.length > 0 && (
        <ul className="flex flex-col gap-2" data-testid="wf-builder-warnings">
          {warnings.map((f, i) => (
            <Finding key={`w-${i}`} finding={f} onSelect={onSelect} />
          ))}
        </ul>
      )}

      {cost && (
        <div
          className="rounded-md bg-muted p-3 flex flex-col gap-1"
          data-testid="wf-builder-cost"
        >
          <Text className="text-xs font-medium text-muted-foreground">
            Estimated cost
          </Text>
          <Text className="text-sm">
            {cost.total_est_calls} model call
            {cost.total_est_calls === 1 ? '' : 's'} ·{' '}
            {cost.total_est_tokens.toLocaleString()} tokens
            {cost.est_cost_usd != null
              ? ` · ~$${cost.est_cost_usd.toFixed(2)}`
              : ''}
          </Text>
        </div>
      )}
    </div>
  )
}
