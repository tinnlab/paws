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

/**
 * Every permission the install flow's own calls require, as a HELD set the mock
 * evaluates the component's `allOf` against.
 *
 * This is why the mock below is not `() => canInstall`: a mock that ignores its
 * argument proves nothing about WHICH permissions the component gates on, so
 * dropping any member of the real `allOf` would leave every test green. Here,
 * removing one from the component's list makes the "missing one" case pass
 * wrongly and the drop-one loop below catch it.
 */
const REQUIRED_PERMISSIONS = [
  'llm_providers::read',
  'llm_models::read',
  'groups::read',
  'llm_local_runtime::versions_read',
  'user_llm_providers::read',
  'llm_models::create',
  'llm_providers::edit',
  'llm_providers::assign_groups',
  'llm_local_runtime::create',
  'llm_local_runtime::update',
] as const

const stores = vi.hoisted(() => ({
  canInstall: true,
  /** Permissions the simulated user holds; `null` means "all of them". */
  held: null as string[] | null,
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
    contextUnavailable: false,
    cancelError: null as string | null,
  },
  hardwareInfo: null as unknown,
}))

const cancelInstall = vi.hoisted(() => vi.fn(async () => undefined))
const install = vi.hoisted(() => vi.fn(async () => undefined))
const dismissError = vi.hoisted(() => vi.fn(() => undefined))
const loadContext = vi.hoisted(() => vi.fn(async () => undefined))
const reset = vi.hoisted(() => vi.fn(() => undefined))
const setReady = vi.hoisted(() => vi.fn(() => undefined))

/**
 * A real-enough `usePermission`: it EVALUATES the expression it is handed
 * against the held set, so the component's actual `allOf` list is under test.
 */
function evaluate(expr: unknown): boolean {
  if (stores.held === null) return stores.canInstall
  const held = stores.held
  if (typeof expr === 'string') return held.includes(expr)
  if (expr && typeof expr === 'object' && 'allOf' in expr) {
    const all = (expr as { allOf: string[] }).allOf
    return all.every(p => held.includes(p))
  }
  return false
}

vi.mock('@/core/permissions', () => ({
  usePermission: (expr: unknown) => evaluate(expr),
  hasPermissionNow: (expr: unknown) => evaluate(expr),
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
// The MODEL PICKER's provider list — what the step derives "installed" from,
// and the same list `defaultModelId()` reasons over. The server has already
// filtered it to enabled + group-reachable providers, so an empty list is
// exactly what a user sees when the provider is shared with nobody.
//
// NOT `UserLlmProviders`: that store backs the personal-API-key page and
// filters `provider_type !== 'local'`, so the local provider is never in it.
vi.mock('@/modules/user-llm-providers/modelPicker', () => ({
  ModelPicker: {
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
      get contextUnavailable() {
        return stores.step.contextUnavailable
      },
      get cancelError() {
        return stores.step.cancelError
      },
      cancelInstall,
      install,
      dismissError,
      loadContext,
      reset,
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
  stores.held = null
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
    contextUnavailable: false,
    cancelError: null,
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

  test('a DISABLED model is not reported as ready to chat with', async () => {
    // The installed copy promises the user they can start chatting; the picker
    // resolves the first ENABLED model, so a disabled one is not a default.
    stores.providers = [
      {
        provider_type: 'local',
        enabled: true,
        llm_models: [{ name: DEFAULT_MODEL.name, enabled: false }],
      },
    ]
    await mount()
    expect(q('onboarding-default-model-installed-tag')).toBeNull()
    expect(q('onboarding-default-model-install-button')).not.toBeNull()
  })

  test('a model under a DISABLED provider is not reported as ready either', async () => {
    // Mounted separately rather than folded into the case above: the two guards
    // are different clauses, and a single seeded fixture can only exercise one.
    stores.providers = [
      {
        provider_type: 'local',
        enabled: false,
        llm_models: [{ name: DEFAULT_MODEL.name, enabled: true }],
      },
    ]
    await mount()
    expect(q('onboarding-default-model-installed-tag')).toBeNull()
    expect(q('onboarding-default-model-install-button')).not.toBeNull()
  })

  test('a FAILED cancel is surfaced while the download is still running', async () => {
    // The download is still active, so the view is `downloading` — where the
    // install-failure alert is not rendered at all. Without a dedicated
    // surface the user clicks Cancel, sees the bar keep moving, and cannot tell
    // whether the request was even sent.
    stores.downloads = [activeDownload()]
    stores.step.cancelError = "The download couldn't be cancelled: 503"
    await mount()

    const alert = q('onboarding-default-model-cancel-error-alert')
    expect(alert).not.toBeNull()
    expect(alert!.textContent).toContain("couldn't be cancelled")
    // …and the transfer's own controls are still there, because it is still running.
    expect(q('onboarding-default-model-cancel-button')).not.toBeNull()
  })

  test('a failed CONTEXT load says so instead of silently offering the install', async () => {
    // Rendering the plain offer would invite a user who already has the model to
    // re-download 5.68 GB.
    stores.step.contextUnavailable = true
    await mount()

    const alert = q('onboarding-default-model-context-alert')
    expect(alert).not.toBeNull()
    expect(alert!.textContent).toMatch(/already installed/i)
  })

  test('every non-idle state is announced to assistive technology', async () => {
    // Each state change here is the RESULT of a control that then disappears or
    // is disabled — which browsers blur — so without a live region a
    // screen-reader user gets no signal that anything happened.
    stores.downloads = [activeDownload()]
    await mount()
    const live = q('onboarding-default-model-live-status')
    expect(live).not.toBeNull()
    expect(live!.getAttribute('aria-live')).toBe('polite')
    expect(live!.textContent).toMatch(/downloading/i)
  })

  test('completion is announced, not just shown', async () => {
    stores.providers = [
      {
        provider_type: 'local',
        enabled: true,
        llm_models: [{ name: DEFAULT_MODEL.name, enabled: true }],
      },
    ]
    await mount()
    expect(q('onboarding-default-model-live-status')!.textContent).toMatch(
      /installed and ready/i,
    )
  })

  test('the memory advisory renders BEFORE the install control', async () => {
    // A warning that exists to inform a decision has to be visible before the
    // button that makes it — at ~390px it is not, if it sits below the card.
    stores.hardwareInfo = { memory: { total_ram: 4 * 1024 ** 3 } }
    await mount()

    const advisory = q('onboarding-default-model-memory-alert')!
    const install = q('onboarding-default-model-install-button')!
    expect(advisory).not.toBeNull()
    expect(install).not.toBeNull()
    // DOCUMENT_POSITION_FOLLOWING === 4: install comes after the advisory.
    expect(advisory.compareDocumentPosition(install) & 4).toBeTruthy()
  })

  test('a model the user cannot REACH is not reported as installed', async () => {
    // The step derives from the user-facing provider list, which the server has
    // already filtered to enabled + group-reachable. An empty list is what a
    // user sees when the provider is shared with nobody — the exact state this
    // feature exists to prevent, and one the admin list would have hidden.
    stores.providers = []
    await mount()
    expect(q('onboarding-default-model-installed-tag')).toBeNull()
    expect(q('onboarding-default-model-install-button')).not.toBeNull()
  })

  test('holding EVERY required permission renders the install control', async () => {
    // The positive control for the drop-one loop below: without it, a component
    // gated on something impossible would pass every "absent" assertion.
    stores.held = [...REQUIRED_PERMISSIONS]
    await mount()
    expect(q('onboarding-default-model-install-button')).not.toBeNull()
  })

  for (const missing of REQUIRED_PERMISSIONS) {
    test(`dropping ${missing} alone removes the install control`, async () => {
      // Each of these is required by a call the flow actually makes. Gating on a
      // subset would render an enabled button for a user who 403s partway
      // through — after the provider state has already been changed. Because the
      // mock evaluates the component's real `allOf`, deleting a permission from
      // the component turns exactly this case red.
      stores.held = REQUIRED_PERMISSIONS.filter(p => p !== missing)
      await mount()

      expect(host!.textContent, 'the step still renders for them').toContain(
        'Local Model',
      )
      expect(q('onboarding-default-model-install-button')).toBeNull()
      expect(q('onboarding-default-model-cancel-button')).toBeNull()
      expect(q('onboarding-default-model-retry-button')).toBeNull()
    })
  }

  test('a user with no permissions at all sees an explanation, not controls', async () => {
    stores.canInstall = false
    await mount()

    // Positive control: the step still RENDERS for them — otherwise "no
    // controls" would be indistinguishable from "nothing rendered".
    expect(host!.textContent).toContain('Local Model')
    expect(host!.textContent).toContain('administrator')

    expect(q('onboarding-default-model-install-button')).toBeNull()
    expect(q('onboarding-default-model-cancel-button')).toBeNull()
    expect(q('onboarding-default-model-retry-button')).toBeNull()

    // The context IS loaded for them — its own read self-gates on the
    // permission they hold — because they still need to know whether the model
    // is already there.
    expect(loadContext).toHaveBeenCalled()
  })

  test('an unpermitted user on a CONFIGURED deployment is told it is ready, not to wait', async () => {
    // Otherwise they finish onboarding waiting on an admin for a model they
    // already have — the two situations are indistinguishable from the static
    // "your administrator installs it" copy.
    stores.canInstall = false
    stores.providers = [
      {
        provider_type: 'local',
        enabled: true,
        llm_models: [{ name: DEFAULT_MODEL.name, enabled: true }],
      },
    ]
    await mount()

    expect(q('onboarding-default-model-installed-tag')).not.toBeNull()
    expect(host!.textContent).toMatch(/ready for you/i)
    expect(host!.textContent).not.toMatch(/administrator installs it/i)
    // …and still no controls they cannot use.
    expect(q('onboarding-default-model-install-button')).toBeNull()
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
