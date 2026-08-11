/**
 * COMPONENT HARNESS for the "Available versions" card's three catalogue states.
 *
 * ## Why a mounted harness rather than assertions about the source
 *
 * The defect this covers is a RENDER decision, and the wrong render is the one
 * that looks fine: when the upstream release feed could not be reached, the card
 * used to fall through to "No published binaries found for linux/x86_64" —
 * a sentence that asserts something about UPSTREAM ("it published nothing")
 * when the truth is about US ("we couldn't ask"). On a rig that ran for days
 * that sentence was the whole user-visible story, and it is why zero engine
 * versions were ever installed: there is nothing to click on an empty list, so
 * not one install was ever even attempted.
 *
 * Reading the code cannot prove which branch wins; only mounting it can.
 *
 * Runner: Vitest + jsdom (`npm run test:component`). The `.tsx` extension is
 * load-bearing — `npm run test:unit` is `node --test "src/**\/*.test.ts"` and
 * cannot load `.tsx` at all, so a renamed file would run NOTHING and still read
 * like a pass.
 *
 *   npx vitest run src/modules/llm-local-runtime/components/AvailableVersionsCard.test.tsx
 */
import { afterEach, describe, expect, test } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true

if (!('ResizeObserver' in globalThis)) {
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {
      return undefined
    }
    unobserve() {
      return undefined
    }
    disconnect() {
      return undefined
    }
  }
}
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

const READY_VERSION = {
  version: 'v0.0.3-alpha',
  installed: false,
  installed_backends: [] as string[],
  binary_ready: true,
  available_backends: ['cpu'],
  recommended_backend: 'cpu',
  size_bytes: 12928771,
  prerelease: false,
  published_at: '2026-05-30T15:53:54Z',
}

type CatalogState = {
  versions: typeof READY_VERSION[]
  source: 'live' | 'cache' | 'unavailable'
  checked_at?: string
  unavailable_reason?: string
  credential_status?: 'absent' | 'used' | 'rejected'
}

let root: Root | null = null
let host: HTMLElement | null = null

/**
 * Register a real Auth-shaped store proxy for the permission primitives.
 *
 * The card renders `<Can permission=...>` and reads the download-progress
 * store, whose `init` calls `hasPermissionNow` — which throws
 * "[permissions] Auth view not registered" unless an app has injected one.
 * Mirrors the same setup in `modules/file-rag/pages/FileRagAdminPage.test.tsx`.
 * The user is an admin so the Install affordances render; a permission-gating
 * assertion is not what these tests are for.
 */
async function registerAuthView() {
  const { defineStore, registerLazyStore } = await import('@ziee/framework/store-kit')
  const { setAuthView } = await import('@ziee/framework/permissions')
  const AuthDef = defineStore<
    { user: { id: string; is_admin: boolean } | null; permissions: string[] },
    Record<string, never>
  >('TestAuthAvailableVersions', {
    state: {
      user: { id: 'test-admin', is_admin: true },
      permissions: [],
    },
    actions: () => ({}),
  })
  setAuthView(registerLazyStore(AuthDef) as never)
}

/** Mount the REAL card with the store seeded to a given catalogue state. */
async function mountWithCatalog(state: CatalogState) {
  await registerAuthView()
  const { RuntimeUpdateRaw } = await import(
    '@/modules/llm-local-runtime/stores/runtimeUpdate'
  )
  const { RuntimeConfigRaw } = await import(
    '@/modules/llm-local-runtime/stores/runtimeConfig'
  )
  const { AvailableVersionsCard } = await import(
    '@/modules/llm-local-runtime/components/AvailableVersionsCard'
  )

  RuntimeConfigRaw.setState({
    gpu: {
      platform: 'linux',
      arch: 'x86_64',
      available: ['cpu'],
      recommended: 'cpu',
    },
    loadingGpu: false,
  } as never)
  RuntimeUpdateRaw.setState({
    checking: new Map(),
    error: null,
    updateChecks: new Map([
      [
        'llamacpp',
        {
          engine: 'llamacpp',
          platform: 'linux',
          arch: 'x86_64',
          latest_version: state.versions[0]?.version ?? '',
          has_updates: false,
          ...state,
        },
      ],
    ]),
  } as never)

  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(<AvailableVersionsCard engine="llamacpp" />)
  })
  return host
}

const text = () => host?.textContent ?? ''
const testId = (id: string) => host?.querySelector(`[data-testid="${id}"]`) ?? null

afterEach(async () => {
  if (root) {
    const r = root
    await act(async () => {
      r.unmount()
    })
    root = null
  }
  host?.remove()
  host = null
})

describe('AvailableVersionsCard — catalogue states', () => {
  /**
   * TEST-12 (positive control). Without this, the two degradation assertions
   * below would pass against a card that renders nothing at all.
   */
  test('a live catalogue lists installable versions with an Install action', async () => {
    await mountWithCatalog({ versions: [READY_VERSION], source: 'live' })

    expect(text()).toContain('v0.0.3-alpha')
    expect(testId('llmrt-version-install-v0.0.3-alpha')).not.toBeNull()
    // A healthy catalogue must not claim it is stale or unreachable.
    expect(testId('llmrt-available-stale-notice')).toBeNull()
    expect(testId('llmrt-available-unreachable')).toBeNull()
  })

  /**
   * TEST-11 — feed unreachable AND nothing cached.
   *
   * The assertion that matters is the NEGATIVE one: the card must not say
   * "No published binaries found", because that sentence claims upstream
   * published nothing. This test is written so it would FAIL against the
   * pre-fix behaviour, where exactly that sentence was rendered.
   */
  test('an unreachable feed with no cache says so, and never claims upstream is empty', async () => {
    await mountWithCatalog({
      versions: [],
      source: 'unavailable',
      unavailable_reason: 'GitHub API: HTTP 403 rate limit exceeded',
    })

    expect(testId('llmrt-available-unreachable')).not.toBeNull()
    expect(text()).not.toContain('No published binaries')
    // The reason is surfaced, so the operator can act on it (set GITHUB_TOKEN,
    // wait out the limit) rather than concluding the engine has no releases.
    expect(text()).toMatch(/couldn't reach|could not reach/i)
  })

  /**
   * TEST-11 (cached half) — the feed could not be refreshed but a previous
   * catalogue survives. Those rows are real and installable, so they must still
   * render; they are simply labelled. Hiding them would reproduce the original
   * defect (nothing to click) despite the data being right there.
   */
  test('a stale cached catalogue still lists installable versions, labelled', async () => {
    await mountWithCatalog({
      versions: [READY_VERSION],
      source: 'cache',
      checked_at: '2026-08-10T09:15:00Z',
      unavailable_reason: 'GitHub API: HTTP 403 rate limit exceeded',
    })

    // Still installable — this is the whole point of retaining on failure.
    expect(text()).toContain('v0.0.3-alpha')
    expect(testId('llmrt-version-install-v0.0.3-alpha')).not.toBeNull()
    // ...but labelled as not-refreshed, so the list is not passed off as fresh.
    expect(testId('llmrt-available-stale-notice')).not.toBeNull()
    expect(text()).toMatch(/couldn't refresh|could not refresh/i)
    // And it is NOT the unreachable-with-nothing state.
    expect(testId('llmrt-available-unreachable')).toBeNull()
  })

  /**
   * The genuinely-empty case must remain distinguishable from the unreachable
   * one: a successful check that returned no host-ready builds still says "no
   * published binaries", because that is now a true statement about upstream.
   */
  test('a successful check with no host builds still reports upstream as empty', async () => {
    await mountWithCatalog({ versions: [], source: 'live' })

    expect(text()).toContain('No published binaries')
    expect(testId('llmrt-available-unreachable')).toBeNull()
    expect(testId('llmrt-available-stale-notice')).toBeNull()
  })

  /**
   * TEST-11 (credential half) — a REJECTED GITHUB_TOKEN is reported as a
   * rejected token, independently of whether the feed was reachable.
   *
   * The load-bearing pairing is that the rejection notice renders ALONGSIDE a
   * full, installable list and WITHOUT the unreachable/stale notices. That is
   * the state the fix creates: the server retried anonymously and got real
   * versions, so claiming "couldn't reach GitHub" here would be false — yet
   * saying nothing would leave the operator silently on the 60/hr budget with
   * a dead credential and no way to find out.
   */
  test('a rejected credential is reported alongside a live, installable list', async () => {
    await mountWithCatalog({
      versions: [READY_VERSION],
      source: 'live',
      credential_status: 'rejected',
    })

    // The catalogue is real and actionable — nothing is degraded.
    expect(text()).toContain('v0.0.3-alpha')
    expect(testId('llmrt-version-install-v0.0.3-alpha')).not.toBeNull()

    // The credential notice is present and names the variable to fix.
    expect(testId('llmrt-available-credential-rejected')).not.toBeNull()
    expect(text()).toContain('GITHUB_TOKEN')

    // ...and it is NOT the feed-unreachable or stale-cache notice. Conflating
    // them would tell the operator GitHub is down while it plainly is not.
    expect(testId('llmrt-available-unreachable')).toBeNull()
    expect(testId('llmrt-available-stale-notice')).toBeNull()
  })

  /**
   * Negative control for the test above: an ACCEPTED credential must produce no
   * notice at all. Without this, the assertion above would pass against a card
   * that nagged about GITHUB_TOKEN unconditionally.
   */
  test('an accepted credential produces no credential notice', async () => {
    await mountWithCatalog({
      versions: [READY_VERSION],
      source: 'live',
      credential_status: 'used',
    })

    expect(text()).toContain('v0.0.3-alpha')
    expect(testId('llmrt-available-credential-rejected')).toBeNull()
    expect(text()).not.toContain('GITHUB_TOKEN')
  })

  /**
   * A rejected credential AND an unreachable feed can co-occur (the token was
   * refused and the anonymous retry also failed). Both must be stated: the
   * outage explains the empty list, the credential explains what to fix.
   */
  test('a rejected credential and an unreachable feed are BOTH reported', async () => {
    await mountWithCatalog({
      versions: [],
      source: 'unavailable',
      unavailable_reason:
        'Failed to list releases: HTTP 401 Unauthorized (GitHub rejected the configured GITHUB_TOKEN, and the anonymous retry also failed — check or unset the token)',
      credential_status: 'rejected',
    })

    expect(testId('llmrt-available-unreachable')).not.toBeNull()
    expect(testId('llmrt-available-credential-rejected')).not.toBeNull()
    expect(text()).not.toContain('No published binaries')
  })
})
