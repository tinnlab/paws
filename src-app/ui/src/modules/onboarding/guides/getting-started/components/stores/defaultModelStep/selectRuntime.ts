/**
 * Pick the llama.cpp build to install on THIS host.
 *
 * `GET /local-runtime/versions/available` answers **200 even when the upstream
 * release feed is unreachable**, putting the truth in `source` /
 * `unavailable_reason`; its own doc-comment states the intent — "so an empty
 * list is never mistaken for 'no versions exist'". This module honours that: an
 * empty or host-incompatible list returns `null`, which the step renders as
 * *runtime unavailable* (offline), never as an error and never as silence
 * (DEC-8).
 */

import type {
  AvailableVersionsResponse,
  DownloadVersionRequest,
  InstallableVersion,
} from '@/api-client/types'

/** A version is only a candidate if some published variant matches this host. */
function hostVariants(v: InstallableVersion) {
  return (v.variants ?? []).filter(variant => variant.matches_host)
}

/**
 * Newest-first ordering.
 *
 * `published_at` is the honest signal and is optional; when it is missing on
 * either side the comparison falls back to the version tag so ordering stays
 * total and deterministic rather than depending on array order.
 */
function newestFirst(a: InstallableVersion, b: InstallableVersion): number {
  if (a.published_at && b.published_at) {
    return a.published_at < b.published_at ? 1 : a.published_at > b.published_at ? -1 : 0
  }
  return a.version < b.version ? 1 : a.version > b.version ? -1 : 0
}

/**
 * The exact `{engine, version, platform, arch, backend}` tuple
 * `POST /local-runtime/versions/download` requires, or `null` when this host
 * has nothing installable.
 */
export function selectRuntimeVariant(
  available: AvailableVersionsResponse | null | undefined,
  engine = 'llamacpp',
): DownloadVersionRequest | null {
  const entry = (available?.engines ?? []).find(e => e.engine === engine)
  if (!entry) return null

  const candidate = (entry.versions ?? [])
    // A prerelease is not what a first-run user should be handed by default.
    .filter(v => !v.prerelease)
    // `binary_ready` is the API's own "≥1 variant matches this host" flag, but
    // the variant list is what the download call actually needs, so require
    // both rather than trusting the summary flag alone.
    .filter(v => hostVariants(v).length > 0)
    .sort(newestFirst)[0]

  if (!candidate) return null

  const variants = hostVariants(candidate)
  const preferred =
    variants.find(v => v.backend === candidate.recommended_backend) ?? variants[0]

  return {
    engine,
    version: candidate.version,
    platform: preferred.platform,
    arch: preferred.arch,
    backend: preferred.backend,
  }
}

/**
 * Is a usable llama.cpp runtime ALREADY installed?
 *
 * When one is, the whole runtime leg is skipped — re-installing an engine a
 * machine already has would be a gratuitous download, and overwriting an
 * existing system default would quietly change behaviour for a deployment that
 * had already chosen one.
 */
export function hasInstalledRuntime(
  versions: { engine: string }[] | null | undefined,
  engine = 'llamacpp',
): boolean {
  return (versions ?? []).some(v => v.engine === engine)
}
