/**
 * COMPONENT HARNESS for the Onboarding "Local Model" step.
 *
 * Covers TEST-13 and TEST-14 of the `default-model-onboarding` feature.
 *
 * ## Why mounted, and why here rather than in an e2e
 *
 * The three properties under test are RENDER decisions in states a browser run
 * cannot reach cheaply — `downloading` needs a live multi-GB transfer,
 * `failed` needs one to fail, `already-installed` needs one to have finished.
 * Driving those from Playwright would need either a live Hugging Face fetch
 * (forbidden by the design's test strategy) or an edit to the shared per-test
 * server spawn (forbidden by rule B3). Mounting the real component with its
 * store inputs seeded reaches all of them in milliseconds, and still asserts
 * real DOM rather than reading the source — which is the distinction that
 * matters (CLAUDE.md records that this harness is what finally closed a class of
 * defect twenty rounds of source-scanning guards could not).
 *
 *   npx vitest run src/modules/onboarding/guides/getting-started/components/DefaultModelStep.test.tsx
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { DownloadInstance } from '@/api-client/types'
import { DEFAULT_MODEL } from '../defaultModel'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true

if (!globalThis.matchMedia) {
  globalThis.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof globalThis.matchMedia
}

// ── Store + permission inputs, seeded per test ─────────────────────────────
//
// The component is the unit under test; these are the inputs it derives from.

const stores = vi.hoisted(() => ({
  canInstall: true,
  downloads: [] as unknown[],
  providers: [] as unknown[],
  activeByKey: new Map<string, unknown>(),
  step: {
    installing: false,
    stage: 'idle' as string,
    error: null as string | null,
    runtimeUnavailable: false,
    runtimeKey: null as string | null,
    loading: false,
  },
  hardwareInfo: null as unknown,
}))

const cancelInstall = vi.hoisted(() => vi.fn(async () => undefined))
const install = vi.hoisted(() => vi.fn(async () => undefined))
const dismissError = vi.hoisted(() => vi.fn(() => undefined))
const loadContext = vi.hoisted(() => vi.fn(async () => undefined))
const setReady = vi.hoisted(() => vi.fn(() => undefined))

vi.mock('@/core/permissions', () => ({
  usePermission: () => stores.canInstall,
  hasPermissionNow: () => stores.canInstall,
}))
vi.mock('@/modules/onboarding/stores/onboarding', () => ({
  Onboarding: { setReady },
}))
vi.mock('@/modules/llm-provider/stores/llmModelDownload', () => ({
  LlmModelDownload: {
    get downloads() {
      return stores.downloads
    },
  },
}))
vi.mock('@/modules/llm-provider/stores/llmProvider', () => ({
  LlmProvider: {
    get providers() {
      return stores.providers
    },
  },
}))
vi.mock('@/modules/llm-local-runtime/stores/runtimeDownloadProgress', () => ({
  RuntimeDownloadProgress: {
    get activeByKey() {
      return stores.activeByKey
    },
  },
}))
vi.mock('@/modules/hardware/hardware', () => ({
  Hardware: {
    get hardwareInfo() {
      return stores.hardwareInfo
    },
  },
}))
vi.mock(
  '@/modules/onboarding/guides/getting-started/components/stores/defaultModelStep',
  () => ({
    DefaultModelStep: {
      get installing() {
        return stores.step.installing
      },
      get stage() {
        return stores.step.stage
      },
      get error() {
        return stores.step.error
      },
      get runtimeUnavailable() {
        return stores.step.runtimeUnavailable
      },
      get runtimeKey() {
        return stores.step.runtimeKey
      },
      get loading() {
        return stores.step.loading
      },
      cancelInstall,
      install,
      dismissError,
      loadContext,
    },
  }),
)

let root: Root | null = null
let host: HTMLElement | null = null
/** The action the step registers with the wizard's Next button. */
let registered: (() => Promise<void>) | null = null

function activeDownload(over: Partial<DownloadInstance> = {}): DownloadInstance {
  return {
    id: 'dl-1',
    created_at: '2026-07-21T00:00:00Z',
    updated_at: '2026-07-21T00:00:00Z',
    started_at: '2026-07-21T00:00:00Z',
    provider_id: 'p-1',
    repository_id: DEFAULT_MODEL.repositoryId,
    status: 'downloading',
    progress_data: {
      phase: 'downloading',
      current: 30,
      total: 100,
      message: '',
      speed_bps: 0,
      eta_seconds: 0,
    },
    request_data: {
      model_name: DEFAULT_MODEL.name,
      repository_path: DEFAULT_MODEL.repositoryPath,
    },
    ...over,
  } as DownloadInstance
}

async function mount() {
  const { default: DefaultModelStep } = await import('./DefaultModelStep')
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(
      <DefaultModelStep
        registerBeforeNext={fn => {
          registered = fn
        }}
      />,
    )
  })
  return host
}

const q = (id: string) => host!.querySelector(`[data-testid="${id}"]`)

beforeEach(() => {
  stores.canInstall = true
  stores.downloads = []
  stores.providers = []
  stores.activeByKey = new Map()
  stores.step = {
    installing: false,
    stage: 'idle',
    error: null,
    runtimeUnavailable: false,
    runtimeKey: null,
    loading: false,
  }
  stores.hardwareInfo = null
  registered = null
  cancelInstall.mockClear()
  install.mockClear()
  dismissError.mockClear()
  loadContext.mockClear()
  setReady.mockClear()
})

afterEach(async () => {
  if (root) {
    const r = root
    await act(async () => {
      r.unmount()
    })
  }
  root = null
  host?.remove()
  host = null
})

describe('TEST-13 — the failed state still lets Onboarding continue (INV-3)', () => {
  test('renders the failure reason and a Retry, and Next still resolves', async () => {
    stores.downloads = [
      activeDownload({ status: 'failed', error_message: 'clone rejected by upstream' }),
    ]
    await mount()

    const alert = q('onboarding-default-model-error-alert')
    expect(alert, 'a failure must be surfaced, not swallowed').not.toBeNull()
    expect(alert!.textContent).toContain('clone rejected by upstream')

    expect(
      q('onboarding-default-model-retry-button'),
      'a failed install must offer a way to try again',
    ).not.toBeNull()

    // The INV-3 half: the action the step handed the wizard must resolve, so
    // Next advances out of a failed install rather than trapping the user.
    expect(registered, 'the step registers a before-next action').not.toBeNull()
    await expect(registered!()).resolves.toBeUndefined()

    // And it never marks the step un-ready.
    expect(setReady).toHaveBeenCalledWith(true)
    expect(setReady).not.toHaveBeenCalledWith(false)
  })

  test('an orchestration error is surfaced too', async () => {
    stores.step.error = 'No local provider is available to install into.'
    await mount()
    expect(q('onboarding-default-model-error-alert')!.textContent).toContain(
      'No local provider is available',
    )
  })
})

describe('TEST-14 — the transfer states, and what the step does NOT own (INV-6)', () => {
  test('downloading shows live progress and a Cancel', async () => {
    stores.downloads = [activeDownload()]
    await mount()

    const progress = q('onboarding-default-model-progress')
    expect(progress, 'a running transfer must show progress').not.toBeNull()
    // The kit puts `data-testid` on the wrapper and the ARIA on the bar itself
    // when an info formatter is supplied, so assert the accessible name where
    // a screen reader would actually find it.
    const bar = progress!.querySelector('[role="progressbar"]')
    expect(bar, 'the progress bar exposes a progressbar role').not.toBeNull()
    expect(bar!.getAttribute('aria-label')).toBeTruthy()
    expect(host!.textContent).toContain('30%')

    expect(q('onboarding-default-model-cancel-button')).not.toBeNull()
    expect(
      q('onboarding-default-model-install-button'),
      'Install must not be offered while a transfer is running',
    ).toBeNull()
  })

  test('UNMOUNTING does not cancel the transfer (INV-6)', async () => {
    stores.downloads = [activeDownload()]
    await mount()

    const r = root!
    await act(async () => {
      r.unmount()
    })
    root = null

    expect(
      cancelInstall,
      'leaving the step must NOT cancel a download the user started — that is ' +
        'exactly what INV-6 forbids',
    ).not.toHaveBeenCalled()
  })

  test('already-installed offers no install control', async () => {
    stores.providers = [
      {
        provider_type: 'local',
        enabled: true,
        llm_models: [{ name: DEFAULT_MODEL.name, enabled: true }],
      },
    ]
    await mount()

    expect(q('onboarding-default-model-installed-tag')).not.toBeNull()
    expect(q('onboarding-default-model-install-button')).toBeNull()
    expect(q('onboarding-default-model-cancel-button')).toBeNull()
    expect(q('onboarding-default-model-retry-button')).toBeNull()
  })

  test('a user without the permission sees an explanation and no controls', async () => {
    stores.canInstall = false
    await mount()

    // Positive control: the step still RENDERS for them — otherwise "no
    // controls" would be indistinguishable from "nothing rendered".
    expect(host!.textContent).toContain('Local Model')
    expect(host!.textContent).toContain('administrator')

    expect(q('onboarding-default-model-install-button')).toBeNull()
    expect(q('onboarding-default-model-cancel-button')).toBeNull()
    expect(q('onboarding-default-model-retry-button')).toBeNull()

    // It must not fire admin-only loads for a user who cannot use them.
    expect(loadContext).not.toHaveBeenCalled()
  })

  test('the offer names the file and size, and warns only on a small machine', async () => {
    stores.hardwareInfo = { memory: { total_ram: 4 * 1024 ** 3 } }
    await mount()

    expect(host!.textContent).toContain(DEFAULT_MODEL.mainFilename)
    expect(host!.textContent).toContain(`${DEFAULT_MODEL.sizeGb} GB`)
    expect(q('onboarding-default-model-install-button')).not.toBeNull()
    expect(q('onboarding-default-model-memory-alert')).not.toBeNull()
  })

  test('a roomy machine gets no memory warning', async () => {
    stores.hardwareInfo = { memory: { total_ram: 64 * 1024 ** 3 } }
    await mount()
    expect(q('onboarding-default-model-memory-alert')).toBeNull()
  })

  test('an undetected memory figure gets no memory warning', async () => {
    stores.hardwareInfo = null
    await mount()
    expect(q('onboarding-default-model-memory-alert')).toBeNull()
  })
})
