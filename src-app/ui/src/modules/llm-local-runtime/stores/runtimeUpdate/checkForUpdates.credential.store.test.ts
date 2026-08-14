import { describe, expect, test, vi, beforeEach } from 'vitest'

/**
 * The ONE line of wiring between the new backend field and the new UI branch.
 *
 * `AvailableVersionsCard.test.tsx` seeds the store directly, and the gallery
 * cell does the same — so neither of them executes the mapping in
 * `stores/runtimeUpdate/actions/checkForUpdates.ts` that copies
 * `response.credential_status` onto the store's `RuntimeUpdateCheck`. Delete
 * that mapping and every other UI gate stays green while the notice can never
 * appear in the real app: the classic "UI-green ≠ works-in-app" shape.
 *
 * So this drives the REAL action against a stubbed API client — the api-client
 * is the external boundary and the only thing mocked; the reducer, the store
 * write, and the derived fields all run for real.
 */

const checkUpdates = vi.fn()

vi.mock('@/api-client', () => ({
  ApiClient: {
    RuntimeVersion: {
      checkUpdates: (...args: unknown[]) => checkUpdates(...args),
    },
  },
}))

// The action reads the current default version off the sibling store.
//
// The stub deliberately MIMICS THE PROXY'S CONTRACT rather than being a plain
// object: a bare field read is a React hook and is illegal outside render, so
// here it THROWS, while `.$` returns the snapshot. A plain-object stub makes
// the two indistinguishable — which is precisely why the real defect (a
// reactive `RuntimeVersion.versions` read inside this async action, throwing
// React #321 and being swallowed into `state.error`) was invisible to this
// tier and shipped. With this stub, reverting the action to the reactive read
// turns these tests red instead of silently passing.
const runtimeVersionSnapshot = { versions: [] as unknown[] }
vi.mock('@/modules/llm-local-runtime/stores/runtimeVersion', () => ({
  RuntimeVersion: new Proxy({} as Record<string, unknown>, {
    get: (_t, prop) => {
      if (prop === '$') return runtimeVersionSnapshot
      throw new Error(
        `[test] reactive read of RuntimeVersion.${String(prop)} outside ` +
          `render — that is a hook call (React #321). Use RuntimeVersion.$.`,
      )
    },
  }),
}))

const RESPONSE = {
  engine: 'llamacpp',
  platform: 'linux',
  arch: 'x86_64',
  versions: [
    {
      version: 'v0.0.3-alpha',
      installed: false,
      installed_backends: [],
      binary_ready: true,
      available_backends: ['cpu'],
      recommended_backend: 'cpu',
      size_bytes: 12928771,
      prerelease: false,
      published_at: '2026-05-30T15:53:54Z',
    },
  ],
  source: 'live',
  checked_at: '2026-08-10T09:15:00Z',
}

async function runAction(credential_status: string | undefined) {
  checkUpdates.mockResolvedValueOnce({ ...RESPONSE, credential_status })
  const { RuntimeUpdateRaw, RuntimeUpdate } = await import(
    '@/modules/llm-local-runtime/stores/runtimeUpdate'
  )
  RuntimeUpdateRaw.setState({
    checking: new Map(),
    error: null,
    updateChecks: new Map(),
  } as never)
  return { result: await RuntimeUpdate.checkForUpdates('llamacpp'), RuntimeUpdateRaw }
}

describe('checkForUpdates — credential_status wiring', () => {
  beforeEach(() => {
    checkUpdates.mockReset()
  })

  test('a rejected verdict from the API reaches the store', async () => {
    const { result, RuntimeUpdateRaw } = await runAction('rejected')

    expect(result.credential_status).toBe('rejected')
    // ...and it is what the CARD will read — the store entry, not the return
    // value, is what drives the render.
    expect(
      (RuntimeUpdateRaw.getState() as never as {
        updateChecks: Map<string, { credential_status?: string }>
      }).updateChecks.get('llamacpp')?.credential_status,
    ).toBe('rejected')
  })

  test('an accepted verdict is passed through unchanged, not normalised away', async () => {
    // The negative control: without it, the test above would pass against a
    // mapping that hardcoded 'rejected'.
    const { result } = await runAction('used')
    expect(result.credential_status).toBe('used')
  })

  test('a missing field defaults to absent rather than undefined', async () => {
    // An older or partial payload must read as "no token configured" — the
    // card's strict `=== 'rejected'` comparison then simply renders nothing,
    // instead of the store carrying an undefined that widens the union.
    const { result } = await runAction(undefined)
    expect(result.credential_status).toBe('absent')
  })
})
