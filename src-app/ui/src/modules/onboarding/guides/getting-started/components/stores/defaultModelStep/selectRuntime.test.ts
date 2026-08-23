import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AvailableVersionsResponse, InstallableVersion } from '@/api-client/types'
import { hasInstalledRuntime, selectRuntimeVariant } from './selectRuntime.ts'

// TEST-10 (default-model-onboarding) — runtime selection, and the offline case.
//
// The load-bearing rule here is DEC-8: `GET /local-runtime/versions/available`
// answers **200 with an empty list** when the upstream release feed is
// unreachable, carrying the truth in `source` / `unavailable_reason`. Its own
// doc-comment says the endpoint exists so "an empty list is never mistaken for
// 'no versions exist'". A selector that silently returned "nothing to install"
// would turn an offline machine into a silent no-op install.

function version(over: Partial<InstallableVersion> = {}): InstallableVersion {
  return {
    version: 'v1.0.0',
    prerelease: false,
    installed: false,
    installed_backends: [],
    binary_ready: true,
    published_at: '2026-01-01T00:00:00Z',
    recommended_backend: 'cpu',
    variants: [
      { platform: 'linux', arch: 'x86_64', backend: 'cpu', matches_host: true, size_bytes: 1 },
    ],
    ...over,
  } as InstallableVersion
}

function available(versions: InstallableVersion[]): AvailableVersionsResponse {
  return {
    platform: 'linux',
    arch: 'x86_64',
    engines: [
      {
        engine: 'llamacpp',
        source: 'live',
        credential_status: 'none',
        versions,
      },
    ],
  } as AvailableVersionsResponse
}

test('an empty engines list is UNAVAILABLE, never silently "no versions"', () => {
  assert.equal(selectRuntimeVariant(available([])), null)
  assert.equal(selectRuntimeVariant({ platform: 'linux', arch: 'x86_64', engines: [] } as AvailableVersionsResponse), null)
  assert.equal(selectRuntimeVariant(null), null)
  assert.equal(selectRuntimeVariant(undefined), null)
})

test('picks the newest non-prerelease version that has a host-matching variant', () => {
  const picked = selectRuntimeVariant(
    available([
      version({ version: 'v1.0.0', published_at: '2026-01-01T00:00:00Z' }),
      version({ version: 'v2.0.0', published_at: '2026-06-01T00:00:00Z' }),
      version({ version: 'v3.0.0', published_at: '2026-09-01T00:00:00Z', prerelease: true }),
    ]),
  )
  assert.deepEqual(picked, {
    engine: 'llamacpp',
    version: 'v2.0.0',
    platform: 'linux',
    arch: 'x86_64',
    backend: 'cpu',
  })
})

test('a version with no host-matching variant is skipped, not selected', () => {
  const foreignOnly = version({
    version: 'v9.0.0',
    published_at: '2026-12-01T00:00:00Z',
    variants: [
      { platform: 'macos', arch: 'aarch64', backend: 'metal', matches_host: false, size_bytes: 1 },
    ],
  })
  const picked = selectRuntimeVariant(available([foreignOnly, version({ version: 'v1.0.0' })]))
  assert.equal(picked?.version, 'v1.0.0', 'the newer foreign-only build must not be chosen')

  // …and when it is the ONLY option, that is the offline/unavailable case.
  assert.equal(selectRuntimeVariant(available([foreignOnly])), null)
})

test('prefers the recommended backend among host-matching variants', () => {
  const picked = selectRuntimeVariant(
    available([
      version({
        recommended_backend: 'cuda12.9',
        variants: [
          { platform: 'linux', arch: 'x86_64', backend: 'cpu', matches_host: true, size_bytes: 1 },
          { platform: 'linux', arch: 'x86_64', backend: 'cuda12.9', matches_host: true, size_bytes: 2 },
        ],
      }),
    ]),
  )
  assert.equal(picked?.backend, 'cuda12.9')
})

test('falls back to a host-matching variant when the recommendation is absent', () => {
  const picked = selectRuntimeVariant(
    available([
      version({
        recommended_backend: 'rocm6.1',
        variants: [
          { platform: 'linux', arch: 'x86_64', backend: 'cpu', matches_host: true, size_bytes: 1 },
        ],
      }),
    ]),
  )
  assert.equal(picked?.backend, 'cpu', 'a recommendation with no published variant must not strand the install')
})

test('ordering stays deterministic when publish dates are missing', () => {
  const picked = selectRuntimeVariant(
    available([
      version({ version: 'v1.0.0', published_at: undefined }),
      version({ version: 'v2.0.0', published_at: undefined }),
    ]),
  )
  assert.equal(picked?.version, 'v2.0.0')
})

test('an already-installed runtime is detected so the leg can be skipped', () => {
  assert.equal(hasInstalledRuntime([{ engine: 'llamacpp' }]), true)
  assert.equal(hasInstalledRuntime([{ engine: 'mistralrs' }]), false)
  assert.equal(hasInstalledRuntime([]), false)
  assert.equal(hasInstalledRuntime(null), false)
})
