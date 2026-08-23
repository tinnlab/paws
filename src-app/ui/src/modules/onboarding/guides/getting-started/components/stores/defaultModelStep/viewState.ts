/**
 * The step's view state, DERIVED — never latched.
 *
 * INV-6 says a download started from Onboarding continues if the user navigates
 * away and stays visible elsewhere. The step therefore owns no transfer state:
 * it recomputes what to show from whatever the live stores currently hold, so
 * leaving and returning re-attaches by construction rather than by a
 * reconnect path someone has to remember to write. `deriveViewState` is pure so
 * that property is testable without mounting anything.
 */

import type { DownloadInstance, DownloadSnapshot, LlmModel } from '@/api-client/types'
import { DEFAULT_MODEL } from '@/modules/onboarding/guides/getting-started/defaultModel'
import type { InstallStage } from './state'

export type DefaultModelView =
  /** Nothing installed, nothing running — the install is on offer. */
  | 'offer'
  /** Enabling the local provider / resolving the runtime, before any transfer. */
  | 'preparing'
  /** The llama.cpp runtime is downloading. */
  | 'installing-runtime'
  /** The weights are downloading. */
  | 'downloading'
  /** The model exists under an enabled local provider. */
  | 'already-installed'
  /** The last attempt failed; a reason and a Retry are shown. */
  | 'failed'
  /** The last attempt was cancelled by the user; the offer returns. */
  | 'cancelled'
  /** No installable runtime for this host (offline / nothing published). */
  | 'runtime-unavailable'

/** The subset of a provider this derivation needs. */
export interface ProviderLike {
  provider_type: string
  enabled: boolean
  llm_models?: Pick<LlmModel, 'name' | 'enabled'>[]
}

export interface DeriveViewStateInput {
  /** Live `LlmModelDownload.downloads`. */
  downloads: DownloadInstance[]
  /** Live `RuntimeDownloadProgress.activeByKey` values. */
  runtimeDownloads: DownloadSnapshot[]
  /** Live `LlmProvider.providers`. */
  providers: ProviderLike[]
  stage: InstallStage
  installing: boolean
  error: string | null
  runtimeUnavailable: boolean
  /** Key of the runtime download this step started, if any. */
  runtimeKey: string | null
}

/** Is this download instance the default model's? */
export function isDefaultModelDownload(d: DownloadInstance): boolean {
  return (
    d.request_data.model_name === DEFAULT_MODEL.name &&
    d.request_data.repository_path === DEFAULT_MODEL.repositoryPath
  )
}

/** The default model's in-flight download, if one exists right now. */
export function activeDefaultModelDownload(
  downloads: DownloadInstance[],
): DownloadInstance | undefined {
  return downloads.find(
    d =>
      isDefaultModelDownload(d) && (d.status === 'downloading' || d.status === 'pending'),
  )
}

/**
 * Is the default model installed?
 *
 * Matched on the descriptor's STABLE name under a local provider — the same key
 * `llm_models`' `UNIQUE (provider_id, name)` enforces, so this agrees with the
 * database rather than approximating it.
 */
export function isDefaultModelInstalled(providers: ProviderLike[]): boolean {
  return providers.some(
    p =>
      p.provider_type === 'local' &&
      (p.llm_models ?? []).some(m => m.name === DEFAULT_MODEL.name),
  )
}

export function deriveViewState(input: DeriveViewStateInput): DefaultModelView {
  const {
    downloads,
    runtimeDownloads,
    providers,
    stage,
    installing,
    error,
    runtimeUnavailable,
    runtimeKey,
  } = input

  // A live transfer outranks everything: the user is watching it happen, and it
  // is the state that must survive them leaving and coming back.
  const active = activeDefaultModelDownload(downloads)
  if (active) return 'downloading'

  const runtime = runtimeKey
    ? runtimeDownloads.find(r => r.key === runtimeKey)
    : undefined
  if (runtime && runtime.status !== 'completed' && runtime.status !== 'failed') {
    return 'installing-runtime'
  }

  // Installed beats a stale terminal download record: after a successful
  // install the completed instance is still in the array, and reporting
  // `failed`/`cancelled` over an installed model would be a lie.
  if (isDefaultModelInstalled(providers)) return 'already-installed'

  if (error) return 'failed'
  if (runtime?.status === 'failed') return 'failed'
  if (runtimeUnavailable) return 'runtime-unavailable'

  // Terminal transfer outcomes, most recent first. `failed` keeps its reason and
  // a Retry; `cancelled` returns to the plain offer because the user asked for
  // that and re-offering is the whole affordance.
  const terminal = [...downloads]
    .filter(isDefaultModelDownload)
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))[0]
  if (terminal?.status === 'failed') return 'failed'
  if (terminal?.status === 'cancelled') return 'cancelled'

  if (installing || stage !== 'idle') return 'preparing'

  return 'offer'
}

/** The failure reason to show, from whichever source produced it. */
export function failureReason(input: DeriveViewStateInput): string | null {
  if (input.error) return input.error
  const runtime = input.runtimeKey
    ? input.runtimeDownloads.find(r => r.key === input.runtimeKey)
    : undefined
  if (runtime?.status === 'failed') {
    return runtime.error ?? 'The local runtime download failed.'
  }
  const terminal = [...input.downloads]
    .filter(isDefaultModelDownload)
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))[0]
  if (terminal?.status === 'failed') {
    return terminal.error_message ?? 'The model download failed.'
  }
  return null
}

/** Percent for the active weights download, or null when it has no total yet. */
export function downloadPercent(d: DownloadInstance | undefined): number | null {
  const total = d?.progress_data?.total
  const current = d?.progress_data?.current
  if (!total || typeof current !== 'number') return null
  return Math.min(100, Math.max(0, Math.round((current / total) * 100)))
}
