import { Alert, Text } from '@ziee/kit'
import { CheckCircle2 } from 'lucide-react'

/**
 * The last probe outcome for one repository, rendered as a distinct
 * affordance per state.
 *
 * Why this exists as a shared component rather than an inline conditional:
 * the repository list and the repository drawer both surface the result, and
 * before this change BOTH rendered only the `unhealthy` case. The probe now
 * has a THIRD outcome (`unverified` — "reachable, but ziee could not confirm
 * this URL lists models"), and a state that is invisible in the UI is a state
 * the operator reads as `healthy`. One component keeps the two surfaces from
 * drifting apart again.
 *
 * State → treatment:
 *
 * | status       | treatment                                              |
 * |--------------|--------------------------------------------------------|
 * | `healthy`    | quiet confirmation line — the capability was CONFIRMED  |
 * | `unverified` | warning Alert — reachable, capability NOT confirmed     |
 * | `unhealthy`  | error Alert — unreachable, or credentials rejected      |
 * | `untested`   | nothing (never probed; there is nothing to report)      |
 *
 * `unverified` is deliberately a WARNING, not an error: the repository is
 * still enabled and may well work (a self-hosted mirror ziee cannot classify
 * is the common case). Rendering it as an error would push operators to
 * "fix" a working deployment.
 */
export interface LlmRepositoryHealthProps {
  /** `last_health_check_status` from the repository row. */
  status: string | null | undefined
  /** `last_health_check_reason` — why the probe reached this outcome. */
  reason?: string | null
  /** `last_health_check_at` — ISO timestamp of the last probe. */
  checkedAt?: string | null
  /**
   * Test selector for the PROBLEM states (`unverified` / `unhealthy`).
   *
   * Deliberately separate from `healthyTestId`: existing e2e specs assert
   * that a successful probe leaves ZERO `llmrepo-health-alert-*` nodes in the
   * row, and that assertion is worth keeping — "an alert is present" should
   * keep meaning "something needs attention". The confirmation line is a
   * different affordance and gets its own id.
   */
  'data-testid': string
  /** Test selector for the quiet `healthy` confirmation line. */
  healthyTestId: string
  className?: string
}

/** "… at <local time>" suffix, omitted when the row was never stamped. */
function whenSuffix(checkedAt: string | null | undefined): string {
  return checkedAt ? ` at ${new Date(checkedAt).toLocaleString()}` : ''
}

export function LlmRepositoryHealth({
  status,
  reason,
  checkedAt,
  'data-testid': alertTestId,
  healthyTestId,
  className,
}: LlmRepositoryHealthProps) {
  if (status === 'unhealthy') {
    return (
      <Alert
        data-testid={alertTestId}
        tone="error"
        className={className}
        title={`Connection test failed${whenSuffix(checkedAt)}`}
        description={reason ?? 'No reason recorded.'}
      />
    )
  }

  if (status === 'unverified') {
    return (
      <Alert
        data-testid={alertTestId}
        tone="warning"
        className={className}
        title={`Not verified as a model repository${whenSuffix(checkedAt)}`}
        description={
          <>
            <span className="block">
              {reason ??
                'ziee reached this URL but could not confirm that it lists models.'}
            </span>
            <span className="block text-muted-foreground">
              The repository is still enabled — downloads may work. Only a
              confirmed model listing is reported as verified.
            </span>
          </>
        }
      />
    )
  }

  if (status === 'healthy') {
    return (
      <div
        data-testid={healthyTestId}
        className={`flex items-center gap-1 ${className ?? ''}`}
      >
        <CheckCircle2 className="size-3.5 text-success" aria-hidden />
        <Text type="secondary" className="text-xs">
          {`Verified as a model repository${whenSuffix(checkedAt)}`}
        </Text>
      </div>
    )
  }

  // `untested` (or an unknown future value) — nothing was measured, so there
  // is nothing honest to say.
  return null
}
