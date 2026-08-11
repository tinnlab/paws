import { Download, RotateCw } from 'lucide-react'
import { useEffect } from 'react'
import {
  Button,
  Card,
  Separator,
  ErrorState,
  Flex,
  Progress,
  Space,
  Spin,
  Tag,
  Text,
  message,
} from '@ziee/kit'
import { Can } from '@/core/permissions'
import { Permissions } from '@/api-client/permissions'
import type { DownloadSnapshot, GpuDetectionResponse } from '@/api-client/types'
import type { RuntimeAvailableVersion, RuntimeEngine } from '../types'
import { HoverRow, formatBytes } from './_engineVersionsShared'
import { RuntimeConfig } from '@/modules/llm-local-runtime/stores/runtimeConfig'
import { RuntimeUpdate } from '@/modules/llm-local-runtime/stores/runtimeUpdate'
import { RuntimeDownloadProgress } from '@/modules/llm-local-runtime/stores/runtimeDownloadProgress'

const BACKEND_LABEL: Record<string, string> = {
  cpu: 'CPU',
  cuda: 'NVIDIA CUDA',
  metal: 'Apple Metal',
  rocm: 'AMD ROCm',
  vulkan: 'Vulkan',
  opencl: 'OpenCL',
}

/**
 * Per-engine "Available versions" card — upstream releases the
 * runtime can install for this host, plus the host context that
 * decides which assets are actually available (platform / arch /
 * detected GPU backends).
 *
 *  - Card `extra` houses the "Check for updates" button (matches
 *    the peer pattern of putting the primary card action in `extra`,
 *    e.g. UsersSettings's `+` create button).
 *  - The Platform + Available backends strip lives at the top of
 *    the body because it's the precondition for "what's even
 *    installable for me" — operators see they're on macos/aarch64
 *    with Metal recommended, then see which version archives match.
 *  - Each version row has the size right after the version label,
 *    the latest/installed/prerelease tags last, and an Install
 *    button on the right (with a live Progress bar underneath
 *    when a download is in flight via the SSE store).
 */
export function AvailableVersionsCard({ engine }: { engine: RuntimeEngine }) {
  const { gpu, loadingGpu } = RuntimeConfig
  const { updateChecks, checking, error: updateError } = RuntimeUpdate
  const { activeByKey } = RuntimeDownloadProgress

  const updateCheck = updateChecks.get(engine)
  const isChecking = checking.get(engine) || false

  // Backend keys for the progress store are `engine@version@backend`;
  // we resolve the backend via the same fallback `handleDownload` uses.
  const progressKey = (v: RuntimeAvailableVersion) => {
    const backend = v.recommended_backend ?? v.available_backends[0] ?? 'cpu'
    return `${engine}@${v.version}@${backend}`
  }

  // Auto-load gpu + update check on mount.
  useEffect(() => {
    if (!gpu && !loadingGpu) {
      RuntimeConfig.loadGpu().catch(() => {})
    }
    if (!updateCheck && !isChecking) {
      RuntimeUpdate.checkForUpdates(engine).catch(() => {
        // Surfaced via the store; the card just shows "couldn't check".
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine])

  const platform = updateCheck?.platform ?? gpu?.platform
  const arch = updateCheck?.arch ?? gpu?.arch

  // When the version feed itself failed to load, the card already shows a
  // persistent ErrorState below. GPU detection is a SEPARATE request that
  // retries with backoff (~6s) — leaving the Platform/Available-backends rows
  // spinning stacked ON TOP of that error reads as broken ("never spinner-on-
  // error"). Treat the rows as not-loading in that posture: they collapse to
  // `null` (no gpu yet) or show detected data if it arrived, never a spinner.
  const feedFailed = !!updateError && !updateCheck
  const gpuLoading = loadingGpu && !feedFailed

  // Only show binaries actually published for this host (filters out
  // tags whose release pipeline is still building).
  const readyUpstream = (updateCheck?.versions ?? []).filter(
    v => v.binary_ready,
  )

  // The server answers 200 even when the release feed is unreachable, carrying
  // the reason instead of throwing it away in a 500. `unavailable_reason` set
  // means "this list could not be refreshed" — with rows it's stale-but-real,
  // without rows it's genuinely unknown. Neither may be rendered as "there are
  // no versions".
  const feedUnreachable = !!updateCheck?.unavailable_reason
  const staleCheckedAt = updateCheck?.checked_at
    ? new Date(updateCheck.checked_at).toLocaleString()
    : undefined

  // A configured GITHUB_TOKEN that GitHub REFUSED. Deliberately independent of
  // `feedUnreachable`: the server retries anonymously, so the common outcome is
  // a perfectly fresh list served on the 60/hr anonymous budget — nothing is
  // broken, but the operator would otherwise have no way to learn their
  // credential is dead, and no way to tell this apart from "GitHub is down".
  // Rendered above the list rather than inside any one branch, because it is
  // equally true when versions render, when the cache is stale, and when the
  // feed is unreachable.
  const credentialRejected = updateCheck?.credential_status === 'rejected'

  const handleDownload = async (v: RuntimeAvailableVersion) => {
    if (!platform || !arch) {
      message.error(
        'Host platform/arch not detected yet — try again in a moment.',
      )
      return
    }
    const backend = v.recommended_backend ?? v.available_backends[0] ?? 'cpu'
    try {
      // Detached on the server: this returns as soon as the task
      // is registered; the SSE subscription opened by the store
      // drives the progress bar. A page reload re-attaches via
      // the store's loadActive() on mount, so the bar survives.
      await RuntimeDownloadProgress.startDownload({
        engine,
        version: v.version,
        platform,
        arch,
        backend,
      })
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Failed to start download')
    }
  }

  // One place that re-runs the check and swallows the rejection (the store
  // already surfaces the failure via `error`). Extracted so the three retry
  // affordances share it instead of each carrying its own empty catch.
  const retryCheck = () => {
    void RuntimeUpdate.checkForUpdates(engine).catch(() => undefined)
  }

  const handleCheckForUpdates = async () => {
    try {
      const result = await RuntimeUpdate.checkForUpdates(engine)
      // The server no longer 500s on an unreachable feed — it answers 200 with
      // an `unavailable_reason` — so the catch below never fires for that case.
      // Reporting "you're up to date" off an empty list would be the exact lie
      // the degradation vocabulary exists to remove.
      if (result?.unavailable_reason) {
        message.error(
          `Couldn't reach the ${engine} release feed — the version list may be out of date.`,
        )
        return
      }
      const readyAfter = (result?.versions ?? []).filter(rv => rv.binary_ready)
      const newCount = readyAfter.filter(rv => !rv.installed).length
      if (newCount === 0) {
        message.success(`No new ${engine} versions — you're up to date.`)
      } else {
        message.success(
          `Found ${newCount} new ${engine} ${
            newCount === 1 ? 'version' : 'versions'
          }.`,
        )
      }
    } catch (e) {
      message.error(
        e instanceof Error ? `Update check failed: ${e.message}` : 'Update check failed',
      )
    }
  }

  return (
    <Card
      title="Available versions"
      data-testid="llmrt-available-versions-card"
      extra={
        <Can permission={Permissions.RuntimeVersionRead}>
          <Button
            icon={<RotateCw />}
            loading={isChecking}
            onClick={handleCheckForUpdates}
            data-testid="llmrt-check-updates-btn"
            aria-label={`Check for updates for ${engine}`}
          >
            Check for updates
          </Button>
        </Can>
      }
    >
      <Flex vertical className="gap-4">
        <PlatformRow gpu={gpu} loadingGpu={gpuLoading} />
        <BackendsRow gpu={gpu} loadingGpu={gpuLoading} />

        <Separator className="!my-2" />

        {credentialRejected && (
          // Not an error state: the versions below (if any) are real. This is
          // the one thing the operator cannot discover any other way — their
          // token is being refused, so they are silently on the 60/hr
          // anonymous budget instead of 5000/hr.
          <Text type="secondary" data-testid="llmrt-available-credential-rejected">
            GitHub refused the configured GITHUB_TOKEN, so releases were fetched
            anonymously (a lower rate limit). Check or unset the token.
          </Text>
        )}

        {isChecking && !updateCheck ? (
          <Spin label="Checking for updates" />
        ) : updateError && !updateCheck ? (
          <ErrorState
            resource="available versions"
            description="Couldn't reach the upstream release feed."
            details={updateError}
            onRetry={retryCheck}
            data-testid="llmrt-available-error"
          />
        ) : !updateCheck ? (
          <Text type="secondary">
            Could not reach the upstream release feed.
          </Text>
        ) : feedUnreachable && (updateCheck.versions?.length ?? 0) === 0 ? (
          // The feed is unreachable AND we have nothing cached. Say exactly
          // that — rendering "No published binaries found" here would claim
          // upstream published nothing, which is a different (and false)
          // statement, and it is why a rate-limited box looked like an engine
          // with no releases.
          <ErrorState
            resource="available versions"
            description="Couldn't reach the upstream release feed, so the installable versions are unknown."
            details={updateCheck.unavailable_reason}
            onRetry={retryCheck}
            data-testid="llmrt-available-unreachable"
          />
        ) : readyUpstream.length === 0 ? (
          <Text type="secondary">
            No published binaries found for {platform}/{arch}.
          </Text>
        ) : (
          <Flex vertical gap="small">
            {feedUnreachable && (
              // Cached-but-stale: the rows below are real, they just could not
              // be refreshed. Showing them beats hiding them, as long as the
              // user is told they may be out of date.
              <Text type="secondary" data-testid="llmrt-available-stale-notice">
                Couldn't refresh from the release feed
                {staleCheckedAt ? ` — showing versions last updated ${staleCheckedAt}` : ''}.
              </Text>
            )}
            {readyUpstream.slice(0, 10).map(v => (
              <AvailableVersionRow
                key={v.version}
                v={v}
                isLatest={v.version === updateCheck.latest_version}
                progress={activeByKey.get(progressKey(v))}
                onDownload={() => handleDownload(v)}
              />
            ))}
            {readyUpstream.length > 10 && (
              <Text type="secondary">
                +{readyUpstream.length - 10} older versions hidden
              </Text>
            )}
          </Flex>
        )}
      </Flex>
    </Card>
  )
}

function PlatformRow({
  gpu,
  loadingGpu,
}: {
  gpu: GpuDetectionResponse | null
  loadingGpu: boolean
}) {
  if (loadingGpu && !gpu) {
    return (
      <div data-testid="llmrt-platform-row">
        <Text type="secondary">Platform: </Text>
        <Spin size="sm" label="Loading platform" />
      </div>
    )
  }
  if (!gpu) return null
  return (
    <div data-testid="llmrt-platform-row">
      <Text type="secondary">Platform: </Text>
      <Text strong>
        {gpu.platform}/{gpu.arch}
      </Text>
    </div>
  )
}

function BackendsRow({
  gpu,
  loadingGpu,
}: {
  gpu: GpuDetectionResponse | null
  loadingGpu: boolean
}) {
  if (loadingGpu && !gpu) {
    return (
      <Flex align="center" gap="small" wrap data-testid="llmrt-backends-row">
        <Text type="secondary">Available backends:</Text>
        <Spin size="sm" label="Loading backends" />
      </Flex>
    )
  }
  if (!gpu) return null
  return (
    <Flex align="center" gap="small" wrap data-testid="llmrt-backends-row">
      <Text type="secondary">Available backends:</Text>
      <Space size="small" wrap>
        {gpu.available.map(b => (
          <Tag
            key={b}
            variant="outline"
            tone={b === gpu.recommended ? 'success' : undefined}
            data-testid={`llmrt-backend-tag-${b}`}
          >
            {BACKEND_LABEL[b] ?? b}
          </Tag>
        ))}
      </Space>
    </Flex>
  )
}

function AvailableVersionRow({
  v,
  isLatest,
  progress,
  onDownload,
}: {
  v: RuntimeAvailableVersion
  isLatest: boolean
  /** Live progress snapshot for this row's (engine, version, backend),
   *  or `undefined` when no download is active. */
  progress?: DownloadSnapshot
  onDownload: () => void
}) {
  const inProgress =
    progress != null &&
    progress.status !== 'completed' &&
    progress.status !== 'failed'
  const failed = progress?.status === 'failed'
  return (
    <HoverRow data-testid={`llmrt-version-row-${v.version}`}>
      <Flex vertical gap="small">
        <Flex justify="between" align="center" gap="small" wrap>
          <Space wrap>
            <Text strong>{v.version}</Text>
            {v.size_bytes != null && !v.installed && (
              <Text type="secondary" className="text-xs">
                {formatBytes(v.size_bytes)}
              </Text>
            )}
            {isLatest && <Tag tone="info" variant="outline" data-testid={`llmrt-version-latest-tag-${v.version}`}>latest</Tag>}
            {v.installed && <Tag tone="success" variant="outline" data-testid={`llmrt-version-installed-tag-${v.version}`}>installed</Tag>}
            {v.prerelease && <Tag variant="outline" data-testid={`llmrt-version-prerelease-tag-${v.version}`}>prerelease</Tag>}
          </Space>
          <Can permission={Permissions.RuntimeVersionCreate}>
            <Button
              icon={<Download />}
              loading={inProgress}
              disabled={v.installed || inProgress}
              onClick={onDownload}
              data-testid={`llmrt-version-install-${v.version}`}
              aria-label={`Install ${v.version}`}
            >
              {v.installed
                ? 'Installed'
                : inProgress
                ? 'Installing…'
                : 'Install'}
            </Button>
          </Can>
        </Flex>
        {progress && <DownloadProgressLine progress={progress} />}
        {failed && progress?.error && (
          <Text type="secondary">{progress.error}</Text>
        )}
      </Flex>
    </HoverRow>
  )
}

/** Inline progress bar + bytes/percent line under an in-flight row. */
function DownloadProgressLine({ progress }: { progress: DownloadSnapshot }) {
  const total = progress.total_bytes ?? 0
  const recv = progress.bytes_received
  const pct =
    // A completed download (incl. cached/skipped, which complete before any
    // byte-progress SSE arrives) is 100% — otherwise it renders a stuck 0% bar
    // with a "success" colour until the first event lands.
    progress.status === 'completed'
      ? 100
      : progress.percent != null
      ? Math.round(progress.percent)
      : total > 0
      ? Math.round((recv / total) * 100)
      : undefined
  return (
    <Flex vertical className="gap-1">
      <Progress
        value={pct ?? 0}
        data-testid={`llmrt-download-progress-${progress.key}`}
        tone={
          progress.status === 'failed'
            ? 'error'
            : progress.status === 'completed'
            ? 'success'
            : 'primary'
        }
        // Indeterminate-looking when total_bytes is unknown: keep
        // the bar at 0% and rely on the byte counter for feedback.
        showInfo={pct != null}
        size="sm"
        aria-label={`Download progress: ${pct ?? 0}%`}
      />
      <Text type="secondary" className="text-xs">
        {formatBytes(recv)}
        {total > 0 ? ` / ${formatBytes(total)}` : ''}
        {progress.status === 'completed' ? ' — Completed' : ''}
      </Text>
    </Flex>
  )
}
