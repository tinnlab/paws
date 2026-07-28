import { RotateCw } from 'lucide-react'
import { Button, Flex, Text } from '@ziee/kit'
import { Permissions } from '@/api-client/permissions'
import { Can } from '@/core/permissions'

/**
 * The inline failure line for a download that ended in `failed`, shared by
 * `AvailableModelsCard` (whisper models) and `AvailableVersionsCard` (the
 * runtime binary) so the two cards on `/settings/voice` cannot drift apart.
 *
 * Both cards previously rendered a terminal task's error as a bare
 * `<Text type="secondary">{progress.error}</Text>` — visually indistinguishable
 * from the row's own metadata. Next to a "No models installed yet" empty state
 * that read as a file-validation error on an installed file, which is the
 * incoherent state this component exists to make unrenderable: a failure here is
 * always explicitly labelled as a failed INSTALL ATTEMPT, and always offers the
 * corrective action (retry) rather than leaving the user at a dead end.
 *
 * Retry is a MUTATION — it re-issues the same install the row's Install button
 * does — so it is gated on `voice::admin::manage`, exactly like that button. The
 * failure MESSAGE is not gated: both cards' download-task lists are served under
 * `voice::admin::read`, so a read-only voice admin does see a failed task and is
 * entitled to know why it failed; what they must not get is a control that can
 * only 403.
 *
 * See `.lifecycle/voice-model-bad-magic/` (INV-1, INV-2, INV-4, INV-8).
 */
export function DownloadFailureRow({
  reason,
  onRetry,
  testId,
  retryLabel,
}: {
  /** The server's failure message — already actionable (found/expected/action). */
  reason: string
  /**
   * Re-runs the same install. Omit to render the message without a retry.
   * Rendered only for a user holding `voice::admin::manage`.
   */
  onRetry?: () => void
  /** `data-testid` for the failure line. */
  testId: string
  /** Accessible name for the retry control, e.g. `Retry installing base`. */
  retryLabel: string
}) {
  return (
    <Flex
      align="start"
      justify="between"
      gap="small"
      wrap
      data-testid={testId}
      role="alert"
    >
      <Text tone="destructive" className="text-xs">
        <Text tone="destructive" strong className="text-xs">
          Install failed
        </Text>
        {' — '}
        {reason}
      </Text>
      {onRetry && (
        <Can permission={Permissions.VoiceAdminManage}>
          <Button
            icon={<RotateCw />}
            variant="outline"
            onClick={onRetry}
            data-testid={`${testId}-retry`}
            aria-label={retryLabel}
          >
            Retry
          </Button>
        </Can>
      )}
    </Flex>
  )
}
