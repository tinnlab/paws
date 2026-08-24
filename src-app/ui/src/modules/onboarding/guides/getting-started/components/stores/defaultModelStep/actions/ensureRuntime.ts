import { ApiClient } from '@/api-client'
import type { DownloadVersionRequest } from '@/api-client/types'
import { DEFAULT_MODEL } from '@/modules/onboarding/guides/getting-started/defaultModel'
import { RuntimeDownloadProgress } from '@/modules/llm-local-runtime/stores/runtimeDownloadProgress'
import { RuntimeVersion as RuntimeVersionStore } from '@/modules/llm-local-runtime/stores/runtimeVersion'
import { hasInstalledRuntime, selectRuntimeVariant } from '../selectRuntime'
import type { DefaultModelStepGet, DefaultModelStepSet } from '../state'

/** How often the runtime download's SSE-fed store entry is re-read. */
const POLL_MS = 500
/** Backstop so a wedged task can never hang the install forever. */
const WAIT_TIMEOUT_MS = 15 * 60 * 1000
/** Floor between server-side version-list re-checks while a snapshot is absent. */
const LIST_FALLBACK_MS = 5000

export type EnsureRuntimeResult = 'ready' | 'unavailable' | 'failed'

/**
 * Make sure a llama.cpp runtime exists and is the system default.
 *
 * A fresh install has NO runtime version at all, and
 * `BinaryManager::select_runtime_version` has no auto-fetch — it walks
 * model → provider → system-default → latest and returns `None`. Without this,
 * the downloaded GGUF is a file the app can never serve, and the design's goal
 * ("finish Onboarding, have a model, talk to it") is not met (DEC-6).
 *
 * Skipped entirely when a llama.cpp version is already installed: re-downloading
 * an engine the machine has would be gratuitous, and re-pointing the system
 * default would quietly change behaviour for a deployment that already chose one.
 */
export default (set: DefaultModelStepSet, _get: DefaultModelStepGet) =>
  async (): Promise<EnsureRuntimeResult> => {
    await RuntimeVersionStore.loadVersions(DEFAULT_MODEL.engine)
    if (hasInstalledRuntime(RuntimeVersionStore.$.versions, DEFAULT_MODEL.engine)) {
      return 'ready'
    }

    const available = await ApiClient.RuntimeVersion.listAvailable({
      engine: DEFAULT_MODEL.engine,
    })
    const request = selectRuntimeVariant(available, DEFAULT_MODEL.engine)
    if (!request) {
      // 200-with-nothing means offline or nothing published for this host — a
      // state to SHOW, not an error and not a silent pass (DEC-8).
      set(draft => {
        draft.runtimeUnavailable = true
      })
      return 'unavailable'
    }

    const { key } = await RuntimeDownloadProgress.startDownload(request)
    set(draft => {
      draft.runtimeKey = key
      draft.runtimeUnavailable = false
    })

    const versionId = await waitForRuntimeDownload(key, request)
    if (!versionId) return 'failed'

    // Make it the default so `select_runtime_version` resolves it for a model
    // that names no required version of its own.
    await RuntimeVersionStore.loadVersions(DEFAULT_MODEL.engine)
    await RuntimeVersionStore.setDefaultVersion(versionId)
    return 'ready'
  }

/**
 * Wait for a runtime download to finish, returning the resulting version id.
 *
 * The store entry is SSE-fed and is auto-dismissed ~2s after completion, so a
 * key that DISAPPEARS is a completion we observed slightly too late, not a
 * failure — treated as such, with the version id recovered from the freshly
 * reloaded version list.
 */
async function waitForRuntimeDownload(
  key: string,
  request: DownloadVersionRequest,
): Promise<string | null> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS
  // A missing snapshot is checked against the server only occasionally. It
  // happens on the ordinary path (the entry is auto-dismissed ~2s after
  // completing), but re-listing versions on every 500 ms tick would fire ~1800
  // requests across the timeout window whenever a subscription is lost.
  let nextListAt = 0
  for (;;) {
    const snapshot = RuntimeDownloadProgress.$.activeByKey.get(key)

    if (snapshot?.status === 'completed') {
      return snapshot.result_version_id ?? (await findInstalledVersionId(request))
    }
    if (snapshot?.status === 'failed') return null
    if (!snapshot && Date.now() >= nextListAt) {
      // Either dismissed after completing, or never registered. The version
      // list is the authority either way — re-fetch rather than reading a list
      // that may predate the download.
      nextListAt = Date.now() + LIST_FALLBACK_MS
      const id = await findInstalledVersionId(request)
      if (id) return id
    }
    if (Date.now() > deadline) return null
    await new Promise(resolve => setTimeout(resolve, POLL_MS))
  }
}

/**
 * The id of the version this step asked for — matched on the full
 * `{engine, version, platform, arch, backend}` tuple, not just the engine.
 *
 * Matching on engine alone would return whichever llamacpp row happens to sort
 * first, which on a machine that already had one (or where another admin
 * installed one concurrently) is a DIFFERENT build — and that id is then handed
 * to `setDefaultVersion`, silently promoting someone else's runtime.
 */
async function findInstalledVersionId(
  request: DownloadVersionRequest,
): Promise<string | null> {
  await RuntimeVersionStore.loadVersions(DEFAULT_MODEL.engine)
  return (
    RuntimeVersionStore.$.versions.find(
      v =>
        v.engine === request.engine &&
        v.version === request.version &&
        v.platform === request.platform &&
        v.arch === request.arch &&
        v.backend === request.backend,
    )?.id ?? null
  )
}
