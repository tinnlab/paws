import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'
import { Alert, Button, Spinner, Text } from '@ziee/kit'
import type { WorkflowBuilderStore } from '../../stores/WorkflowBuilder.store'
import {
  type AttributedFinding,
  attributeFindings,
  findingStepTitle,
  humaniseInstallError,
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
  index,
  onSelect,
}: {
  finding: AttributedFinding
  /** Position within its list — only to keep the goto testid addressable when
   *  one step carries several findings (a tool step missing BOTH server and
   *  tool renders two buttons for the same step id). */
  index: number
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
      <li
        className="flex items-start gap-2"
        data-testid="wf-builder-finding"
        data-finding-index={index}
      >
        {body}
      </li>
    )
  }

  return (
    <li
      data-testid="wf-builder-finding"
      data-step-id={finding.stepId}
      data-finding-index={index}
    >
      <Button
        type="button"
        variant="ghost"
        data-testid={`wf-builder-finding-goto-${finding.stepId}`}
        data-finding-index={index}
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
  // `runValidate` writes its failure reason here and deliberately KEEPS the
  // prior `validation` — so without this the author sees either "Add steps to
  // validate" with steps present, or a stale green "No blocking errors." while
  // Save is computed from that same stale object. Humanised because `save()`
  // also writes here, and its message is the raw validator wire string (INV-1).
  const error = store.error
  const errorText = error ? humaniseInstallError(error, steps) : null
  // WHICH act failed. A save failure and a check failure both land in `error`
  // but mean opposite things about the findings below: after a failed CHECK they
  // are stale; after a failed SAVE they are current (the check still ran).
  const checkFailed = store.errorSource === 'validate'

  // Attribute + humanise ONCE, above any map, so the panel and the step list can
  // never disagree about which steps are broken — and so no store read happens
  // inside a loop (Rules of Hooks).
  const errors = attributeFindings(validation?.errors ?? [], steps)
  const warnings = attributeFindings(validation?.warnings ?? [], steps)

  // INV-2 — a finding "can take the user to that step". Selecting alone only
  // does that when the config panel is already on screen: the panel sits at the
  // BOTTOM of the page and the layout stacks below `md`, so on a narrow viewport
  // the newly-selected step's configuration is below the fold and the click has
  // no visible effect at all. Bring it into view after the selection renders.
  // (`block: 'nearest'` = no movement when it is already visible, so the wide
  // layout is unchanged.)
  const onSelect = (stepId: string) => {
    store.selectStep(stepId)
    requestAnimationFrame(() => {
      const el = document.querySelector('[data-testid="wf-builder-step-config"]')
      if (!el) return
      // Only when the START of the configuration is off-screen: on a wide
      // viewport it is already beside the list, and scrolling there would be an
      // unasked-for jump. `block: 'start'` (not `nearest`) because the panel can
      // be taller than the viewport, and `nearest` would then align its BOTTOM —
      // leaving the author at the end of a form they were just sent to.
      const top = el.getBoundingClientRect().top
      if (top < 0 || top >= window.innerHeight) {
        el.scrollIntoView({ block: 'start' })
      }
    })
  }

  return (
    <div className="flex flex-col gap-3" data-testid="wf-builder-validation">
      <div className="flex items-center gap-2">
        <Text strong>Validation</Text>
        {validating && <Spinner size="sm" label="Validating workflow" />}
      </div>

      {errorText && (
        <Alert
          data-testid="wf-builder-validation-error"
          tone="error"
          title={errorText}
          description={
            checkFailed && validation
              ? 'The results below are from an earlier check and may be out of date.'
              : undefined
          }
        />
      )}

      {!validation && !validating && !errorText && (
        <Text type="secondary" className="text-xs">
          Add steps to validate the workflow.
        </Text>
      )}

      {/* The green line is a CLAIM that the workflow is currently valid, so it
          is suppressed while the last CHECK is known to have failed — those
          findings are stale and Save is computed from the same object. A failed
          SAVE does not make it false (the check still ran), so it stays. */}
      {validation && errors.length === 0 && !checkFailed && (
        <div className="flex items-center gap-2" data-testid="wf-builder-valid">
          <CheckCircle2 className="size-4 text-success" aria-hidden />
          <Text className="text-sm">No blocking errors.</Text>
        </div>
      )}

      {errors.length > 0 && (
        <ul className="flex flex-col gap-2" data-testid="wf-builder-errors">
          {errors.map((f, i) => (
            <Finding key={`e-${i}`} finding={f} index={i} onSelect={onSelect} />
          ))}
        </ul>
      )}

      {warnings.length > 0 && (
        <ul className="flex flex-col gap-2" data-testid="wf-builder-warnings">
          {warnings.map((f, i) => (
            <Finding key={`w-${i}`} finding={f} index={i} onSelect={onSelect} />
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
