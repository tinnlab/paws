import type { StoreSet } from '@ziee/framework/store-kit'

/**
 * Which leg of the install orchestration is currently running.
 *
 * This is ORCHESTRATION state, not transfer state. The transfers themselves
 * live server-side and are read from `LlmModelDownload` / `RuntimeDownloadProgress`
 * (DEC-9 / INV-6) — this store never keeps a copy of bytes, percent or status,
 * because a copy captured at one moment and read at another is the stale-snapshot
 * defect class, and because a copy would not survive the user leaving the step.
 */
export type InstallStage = 'idle' | 'provider' | 'runtime' | 'model'

export const defaultModelStepState = {
  /** An install orchestration is in flight (not: a transfer is in flight). */
  installing: false,
  stage: 'idle' as InstallStage,
  /** Failure from the orchestration itself; transfer failures come from the download stores. */
  error: null as string | null,
  /**
   * Runtime discovery found no installable llama.cpp build for this host.
   *
   * Distinct from an error: `GET /local-runtime/versions/available` answers 200
   * with an empty list when upstream is unreachable, carrying the truth in
   * `source` / `unavailable_reason` — so an empty list means "offline / nothing
   * published for this host", NEVER "no versions exist" (DEC-8).
   */
  runtimeUnavailable: false,
  /** Key of the runtime download this step started, for reading its live progress. */
  runtimeKey: null as string | null,
  /** Initial context load (providers + in-flight downloads) is running. */
  loading: false,
  /**
   * The context load FAILED, so the step cannot tell "not installed" from
   * "could not find out".
   *
   * Kept distinct from `error` (an install failure) because the remedy differs
   * and because silently rendering the plain offer would invite the user to
   * re-download 5.68 GB they may already have.
   */
  contextUnavailable: false,
  /**
   * A cancel request failed. Held separately from `error` because a cancel
   * failure happens WHILE the download is still running — a state whose view is
   * `downloading`, where the install-failure alert is not rendered at all, so
   * writing it to `error` would show the user nothing now and then resurface it
   * later under the wrong headline.
   */
  cancelError: null as string | null,
}

export type DefaultModelStepState = typeof defaultModelStepState
export type DefaultModelStepSet = StoreSet<DefaultModelStepState>
export type DefaultModelStepGet = () => DefaultModelStepState
