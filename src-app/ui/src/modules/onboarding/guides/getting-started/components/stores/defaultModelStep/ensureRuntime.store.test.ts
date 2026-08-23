/**
 * TEST-24 (default-model-onboarding) — the runtime-provisioning leg.
 *
 * The property that matters most here is not "it downloads a runtime" but
 * **which version it then promotes to SYSTEM DEFAULT**. That id is written
 * deployment-wide, so resolving it by engine alone can hand `setDefaultVersion`
 * somebody else's llama.cpp build — a machine that already had one, or a
 * concurrent install from the runtime settings page.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Version = {
  id: string
  engine: string
  version: string
  platform: string
  arch: string
  backend: string
}

const state = vi.hoisted(() => ({
  installedVersions: [] as Version[],
  /**
   * What the version list becomes once the download has run. Kept separate
   * because `ensureRuntime` checks installed-ness BEFORE downloading — seeding
   * the post-download list upfront would short-circuit the whole leg and make
   * the test assert nothing.
   */
  versionsAfterDownload: null as Version[] | null,
  available: null as unknown,
  snapshots: new Map<string, { status: string; result_version_id?: string }>(),
  startedKey: 'llamacpp@v2.0.0',
  downloadStarted: false,
}))

const loadVersions = vi.hoisted(() =>
  vi.fn(async (_engine?: string) => {
    if (state.downloadStarted && state.versionsAfterDownload) {
      state.installedVersions = state.versionsAfterDownload
    }
    return undefined
  }),
)
const setDefaultVersion = vi.hoisted(() => vi.fn(async (_id: string) => undefined))
const startDownload = vi.hoisted(() =>
  vi.fn(async (_req: unknown) => {
    state.downloadStarted = true
    return { key: state.startedKey }
  }),
)
const listAvailable = vi.hoisted(() => vi.fn(async () => state.available))

vi.mock('@/modules/llm-local-runtime/stores/runtimeVersion', () => ({
  RuntimeVersion: {
    loadVersions,
    setDefaultVersion,
    get $() {
      return { versions: state.installedVersions }
    },
  },
}))
vi.mock('@/modules/llm-local-runtime/stores/runtimeDownloadProgress', () => ({
  RuntimeDownloadProgress: {
    startDownload,
    get $() {
      return { activeByKey: state.snapshots }
    },
  },
}))
vi.mock('@/api-client', () => ({
  ApiClient: { RuntimeVersion: { listAvailable } },
}))

const HOST = { platform: 'linux', arch: 'x86_64' }

function variant(over: Partial<Version> = {}) {
  return {
    platform: HOST.platform,
    arch: HOST.arch,
    backend: 'cpu',
    matches_host: true,
    size_bytes: 1,
    ...over,
  }
}

function availableWith(version: string) {
  return {
    platform: HOST.platform,
    arch: HOST.arch,
    engines: [
      {
        engine: 'llamacpp',
        source: 'live',
        credential_status: 'none',
        versions: [
          {
            version,
            prerelease: false,
            installed: false,
            installed_backends: [],
            binary_ready: true,
            published_at: '2026-01-01T00:00:00Z',
            recommended_backend: 'cpu',
            variants: [variant()],
          },
        ],
      },
    ],
  }
}

function makeStore() {
  const draft = { runtimeKey: null as string | null, runtimeUnavailable: false }
  return {
    draft,
    set: (fn: (d: typeof draft) => void) => fn(draft),
    get: () => draft,
  }
}

async function ensureRuntime(store: ReturnType<typeof makeStore>) {
  const factory = (await import('./actions/ensureRuntime.ts')).default
  return factory(store.set as never, store.get as never)()
}

beforeEach(() => {
  state.installedVersions = []
  state.versionsAfterDownload = null
  state.downloadStarted = false
  state.available = availableWith('v2.0.0')
  state.snapshots = new Map()
  state.startedKey = 'llamacpp@v2.0.0'
  loadVersions.mockClear()
  setDefaultVersion.mockClear()
  startDownload.mockClear()
  listAvailable.mockClear()
  vi.resetModules()
})

describe('ensureRuntime', () => {
  it('skips entirely when a llama.cpp runtime is already installed', async () => {
    state.installedVersions = [
      { id: 'v-existing', engine: 'llamacpp', version: 'v1', ...HOST, backend: 'cpu' },
    ]

    await expect(ensureRuntime(makeStore())).resolves.toBe('ready')
    expect(startDownload, 'no gratuitous re-download').not.toHaveBeenCalled()
    expect(
      setDefaultVersion,
      'a deployment that already chose a default must keep it',
    ).not.toHaveBeenCalled()
  })

  it('reports UNAVAILABLE rather than erroring when nothing is installable', async () => {
    state.available = { platform: HOST.platform, arch: HOST.arch, engines: [] }
    const store = makeStore()

    await expect(ensureRuntime(store)).resolves.toBe('unavailable')
    expect(store.draft.runtimeUnavailable).toBe(true)
    expect(startDownload).not.toHaveBeenCalled()
  })

  it('promotes the version it DOWNLOADED, not merely one with the same engine', async () => {
    // The snapshot completes without a result id (the SSE path can dismiss the
    // entry), so the fallback lookup runs — and the version list contains an
    // UNRELATED llama.cpp build that sorts first. Matching on engine alone would
    // promote that one deployment-wide.
    state.snapshots = new Map([[state.startedKey, { status: 'completed' }]])
    state.versionsAfterDownload = [
      {
        id: 'v-someone-elses',
        engine: 'llamacpp',
        version: 'v9.9.9',
        ...HOST,
        backend: 'cuda12.9',
      },
      {
        id: 'v-ours',
        engine: 'llamacpp',
        version: 'v2.0.0',
        ...HOST,
        backend: 'cpu',
      },
    ]

    await expect(ensureRuntime(makeStore())).resolves.toBe('ready')
    expect(setDefaultVersion).toHaveBeenCalledWith('v-ours')
  })

  it('prefers the id the download itself reported', async () => {
    state.snapshots = new Map([
      [state.startedKey, { status: 'completed', result_version_id: 'v-reported' }],
    ])

    await expect(ensureRuntime(makeStore())).resolves.toBe('ready')
    expect(setDefaultVersion).toHaveBeenCalledWith('v-reported')
  })

  it('fails when the runtime download fails — it does not fall through to "ready"', async () => {
    state.snapshots = new Map([[state.startedKey, { status: 'failed' }]])

    await expect(ensureRuntime(makeStore())).resolves.toBe('failed')
    expect(setDefaultVersion).not.toHaveBeenCalled()
  })

  it('records the key so the step can render the runtime download live', async () => {
    state.snapshots = new Map([
      [state.startedKey, { status: 'completed', result_version_id: 'v-reported' }],
    ])
    const store = makeStore()

    await ensureRuntime(store)
    expect(store.draft.runtimeKey).toBe(state.startedKey)
  })
})
