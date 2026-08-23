import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { DownloadInstance, DownloadSnapshot } from '@/api-client/types'
import { DEFAULT_MODEL } from '../../../defaultModel.ts'
import {
  deriveViewState,
  downloadPercent,
  failureReason,
  isDefaultModelInstalled,
  type DeriveViewStateInput,
  type ProviderLike,
} from './viewState.ts'

// TEST-9 (default-model-onboarding) — the step's view state is DERIVED from the
// live stores, never latched.
//
// This is the client half of INV-6: "a download started from Onboarding
// continues if the user navigates away, and its progress stays visible". A step
// that remembered its own progress would show a stale or empty state on
// re-entry no matter how healthy the server-side transfer was. Deriving is what
// makes re-attachment automatic — so the load-bearing case here is the FRESH
// derivation (a brand-new mount, no prior state) landing on `downloading`.

function download(over: Partial<DownloadInstance> = {}): DownloadInstance {
  return {
    id: 'dl-1',
    created_at: '2026-07-21T00:00:00Z',
    updated_at: '2026-07-21T00:00:00Z',
    started_at: '2026-07-21T00:00:00Z',
    provider_id: 'provider-1',
    repository_id: DEFAULT_MODEL.repositoryId,
    status: 'downloading',
    request_data: {
      model_name: DEFAULT_MODEL.name,
      repository_path: DEFAULT_MODEL.repositoryPath,
    },
    ...over,
  } as DownloadInstance
}

function snapshot(over: Partial<DownloadSnapshot> = {}): DownloadSnapshot {
  return {
    key: 'llamacpp@v1',
    task_id: 'task-1',
    engine: 'llamacpp',
    version: 'v1',
    backend: 'cpu',
    status: 'downloading',
    bytes_received: 1,
    ...over,
  } as DownloadSnapshot
}

const localProvider = (models: { name: string; enabled: boolean }[]): ProviderLike => ({
  provider_type: 'local',
  enabled: true,
  llm_models: models,
})

function input(over: Partial<DeriveViewStateInput> = {}): DeriveViewStateInput {
  return {
    downloads: [],
    runtimeDownloads: [],
    providers: [],
    stage: 'idle',
    installing: false,
    error: null,
    runtimeUnavailable: false,
    runtimeKey: null,
    ...over,
  }
}

test('nothing installed and nothing running is an offer', () => {
  assert.equal(deriveViewState(input()), 'offer')
})

test('a FRESH derivation with an in-flight download shows downloading (INV-6 re-entry)', () => {
  // No prior local state of any kind — exactly what a re-mounted step has after
  // the user navigated away and came back.
  const view = deriveViewState(input({ downloads: [download({ status: 'downloading' })] }))
  assert.equal(view, 'downloading')

  // Pending counts too: the transfer is registered but has not started moving.
  assert.equal(
    deriveViewState(input({ downloads: [download({ status: 'pending' })] })),
    'downloading',
  )
})

test('a download for a DIFFERENT model is ignored', () => {
  const other = download({
    request_data: { model_name: 'someone-elses-model', repository_path: 'Other-Repo' },
  })
  assert.equal(deriveViewState(input({ downloads: [other] })), 'offer')
})

test('an in-flight runtime download shows the runtime stage', () => {
  const view = deriveViewState(
    input({ runtimeKey: 'llamacpp@v1', runtimeDownloads: [snapshot()] }),
  )
  assert.equal(view, 'installing-runtime')
})

test('an installed model outranks a stale terminal download record', () => {
  // After a successful install the completed instance stays in the array. If a
  // FAILED earlier attempt also lingers, reporting `failed` over an installed
  // model would be a lie the user cannot act on.
  const view = deriveViewState(
    input({
      downloads: [download({ status: 'failed', error_message: 'earlier attempt' })],
      providers: [localProvider([{ name: DEFAULT_MODEL.name, enabled: true }])],
    }),
  )
  assert.equal(view, 'already-installed')
})

test('a failed download shows failed, with its reason', () => {
  const failed = download({ status: 'failed', error_message: 'clone rejected' })
  assert.equal(deriveViewState(input({ downloads: [failed] })), 'failed')
  assert.equal(failureReason(input({ downloads: [failed] })), 'clone rejected')
})

test('a cancelled download returns to the offer path, not an error', () => {
  const cancelled = download({ status: 'cancelled' })
  assert.equal(deriveViewState(input({ downloads: [cancelled] })), 'cancelled')
})

test('an unavailable runtime is its own state, distinct from failure', () => {
  assert.equal(deriveViewState(input({ runtimeUnavailable: true })), 'runtime-unavailable')
})

test('orchestration in flight shows preparing', () => {
  assert.equal(deriveViewState(input({ installing: true, stage: 'provider' })), 'preparing')
})

test('installed detection matches the descriptor name under a local provider only', () => {
  assert.equal(
    isDefaultModelInstalled([localProvider([{ name: DEFAULT_MODEL.name, enabled: true }])]),
    true,
  )
  assert.equal(
    isDefaultModelInstalled([
      { provider_type: 'openai', enabled: true, llm_models: [{ name: DEFAULT_MODEL.name, enabled: true }] },
    ]),
    false,
    'a remote provider hosting a same-named model is not our local install',
  )
  assert.equal(isDefaultModelInstalled([localProvider([])]), false)
})

test('percent is null until a total is known, and is clamped', () => {
  assert.equal(downloadPercent(undefined), null)
  assert.equal(downloadPercent(download({ progress_data: undefined })), null)
  assert.equal(
    downloadPercent(
      download({
        progress_data: { phase: 'downloading', current: 50, total: 200, message: '', speed_bps: 0, eta_seconds: 0 },
      }),
    ),
    25,
  )
  assert.equal(
    downloadPercent(
      download({
        progress_data: { phase: 'downloading', current: 999, total: 100, message: '', speed_bps: 0, eta_seconds: 0 },
      }),
    ),
    100,
    'a current beyond total must not render past 100%',
  )
})
