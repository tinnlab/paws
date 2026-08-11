/**
 * Dev-gallery seed for the `llm-local-runtime` module — the runtime engine
 * download drawer + seeded available-versions / live-logs / version-models
 * states. Auto-discovered by the gallery's runtime registry
 * (`@/dev/gallery/support`); never imported by `module.tsx`, so it is dev-only
 * and tree-shaken from prod.
 */
import type { ModuleGallery } from '@/dev/gallery/support'
import { holdPatch, lazyNamed, lazyProps } from '@/dev/gallery/support'
import { RuntimeDownloadDrawer as RuntimeDownloadDrawerStore } from '@/modules/llm-local-runtime/stores/runtimeDownloadDrawer'

export const gallery: ModuleGallery = {
  overlays: [
    {
      slug: 'overlay-runtime-download-drawer',
      surface: 'modules/llm-local-runtime/components/drawers/RuntimeDownloadDrawer',
      title: 'Runtime engine download (drawer)',
      component: lazyNamed(
        () =>
          import('@/modules/llm-local-runtime/components/drawers/RuntimeDownloadDrawer'),
        'RuntimeDownloadDrawer',
      ),
      open: () =>
        RuntimeDownloadDrawerStore.openDrawer({
          id: 'llamacpp',
          name: 'llama.cpp',
          display_name: 'llama.cpp',
        } as any),
    },
  ],
  seeded: [
    // ── LiveLogsPanel: no log output yet → the empty state (prop modelId). ───────
    {
      slug: 'seeded-live-logs-empty',
      title: 'Local runtime live logs — empty',
      note: 'no log lines yet → "No log output yet" empty',
      path: '/',
      initialPath: '/',
      component: lazyProps(
        () => import('@/modules/llm-local-runtime/components/LiveLogsPanel'),
        'LiveLogsPanel',
        { modelId: 'gallery-model-1' },
      ),
    },
    // ── AvailableVersionsCard: an update check that resolved but has NO published
    //    binaries for this host → the "No published binaries" empty (:162,163). ────
    {
      slug: 'seeded-s3-available-versions-empty',
      title: 'Available runtime versions — none published',
      note: 'updateCheck loaded but readyUpstream.length===0 → "No published binaries" text',
      path: '/',
      initialPath: '/',
      component: lazyProps(
        () => import('@/modules/llm-local-runtime/components/AvailableVersionsCard'),
        'AvailableVersionsCard',
        { engine: 'llamacpp' },
      ),
      setup: async () => {
        const { RuntimeUpdateRaw } = await import(
          '@/modules/llm-local-runtime/stores/runtimeUpdate'
        )
        const { RuntimeConfigRaw } = await import(
          '@/modules/llm-local-runtime/stores/runtimeConfig'
        )
        await holdPatch(() => {
          RuntimeConfigRaw.setState({
            gpu: {
              platform: 'linux',
              arch: 'x86_64',
              available: ['cpu'],
              recommended: 'cpu',
            },
            loadingGpu: false,
          } as any)
          RuntimeUpdateRaw.setState({
            checking: new Map(),
            updateChecks: new Map([
              [
                'llamacpp',
                {
                  engine: 'llamacpp',
                  platform: 'linux',
                  arch: 'x86_64',
                  versions: [],
                  latest_version: '',
                  has_updates: false,
                },
              ],
            ]),
          } as any)
        })
      },
    },
    // ── AvailableVersionsCard: the release feed is UNREACHABLE and nothing was
    //    ever cached. Must state that the versions are unknown — rendering the
    //    "No published binaries" empty here would claim upstream published
    //    nothing, a different and false statement, and is how a rate-limited
    //    box looked like an engine with no releases. ─────────────────────────
    {
      slug: 'seeded-s3-available-versions-unreachable',
      title: 'Available runtime versions — feed unreachable',
      note: 'source=unavailable + unavailable_reason, no cached rows → explicit "couldn\'t reach" state, NOT an empty list',
      path: '/',
      initialPath: '/',
      component: lazyProps(
        () => import('@/modules/llm-local-runtime/components/AvailableVersionsCard'),
        'AvailableVersionsCard',
        { engine: 'llamacpp' },
      ),
      setup: async () => {
        const { RuntimeUpdateRaw } = await import(
          '@/modules/llm-local-runtime/stores/runtimeUpdate'
        )
        const { RuntimeConfigRaw } = await import(
          '@/modules/llm-local-runtime/stores/runtimeConfig'
        )
        await holdPatch(() => {
          RuntimeConfigRaw.setState({
            gpu: {
              platform: 'linux',
              arch: 'x86_64',
              available: ['cpu'],
              recommended: 'cpu',
            },
            loadingGpu: false,
          } as any)
          RuntimeUpdateRaw.setState({
            checking: new Map(),
            updateChecks: new Map([
              [
                'llamacpp',
                {
                  engine: 'llamacpp',
                  platform: 'linux',
                  arch: 'x86_64',
                  versions: [],
                  source: 'unavailable',
                  unavailable_reason:
                    'GitHub API: HTTP 403 rate limit exceeded',
                  latest_version: '',
                  has_updates: false,
                },
              ],
            ]),
          } as any)
        })
      },
    },
    // ── AvailableVersionsCard: the feed could not be REFRESHED, but a previous
    //    catalogue survives. The rows are real and installable; they are simply
    //    labelled with when they were last fetched. ─────────────────────────
    {
      slug: 'seeded-s3-available-versions-stale-cache',
      title: 'Available runtime versions — stale cache',
      note: 'source=cache + unavailable_reason → rows still listed, with a "couldn\'t refresh" notice',
      path: '/',
      initialPath: '/',
      component: lazyProps(
        () => import('@/modules/llm-local-runtime/components/AvailableVersionsCard'),
        'AvailableVersionsCard',
        { engine: 'llamacpp' },
      ),
      setup: async () => {
        const { RuntimeUpdateRaw } = await import(
          '@/modules/llm-local-runtime/stores/runtimeUpdate'
        )
        const { RuntimeConfigRaw } = await import(
          '@/modules/llm-local-runtime/stores/runtimeConfig'
        )
        await holdPatch(() => {
          RuntimeConfigRaw.setState({
            gpu: {
              platform: 'linux',
              arch: 'x86_64',
              available: ['cpu'],
              recommended: 'cpu',
            },
            loadingGpu: false,
          } as any)
          RuntimeUpdateRaw.setState({
            checking: new Map(),
            updateChecks: new Map([
              [
                'llamacpp',
                {
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
                    {
                      version: 'v0.0.2-alpha',
                      installed: false,
                      installed_backends: [],
                      binary_ready: true,
                      available_backends: ['cpu'],
                      recommended_backend: 'cpu',
                      size_bytes: 12928151,
                      prerelease: false,
                      published_at: '2026-05-29T22:07:51Z',
                    },
                  ],
                  source: 'cache',
                  checked_at: '2026-08-10T09:15:00Z',
                  unavailable_reason: 'GitHub API: HTTP 403 rate limit exceeded',
                  latest_version: 'v0.0.3-alpha',
                  has_updates: true,
                },
              ],
            ]),
          } as any)
        })
      },
    },
    // ── AvailableVersionsCard: the operator's GITHUB_TOKEN was REJECTED and the
    //    read was rescued anonymously. The list is real and installable; the
    //    only thing wrong is the credential, which is otherwise undiscoverable
    //    — and which must NOT be rendered as "GitHub is unreachable". ────────
    {
      slug: 'seeded-s3-available-versions-credential-rejected',
      title: 'Available runtime versions — GITHUB_TOKEN rejected',
      note: 'credential_status=rejected + source=live → rows list normally PLUS a credential notice; no unreachable/stale notice',
      path: '/',
      initialPath: '/',
      component: lazyProps(
        () => import('@/modules/llm-local-runtime/components/AvailableVersionsCard'),
        'AvailableVersionsCard',
        { engine: 'llamacpp' },
      ),
      setup: async () => {
        const { RuntimeUpdateRaw } = await import(
          '@/modules/llm-local-runtime/stores/runtimeUpdate'
        )
        const { RuntimeConfigRaw } = await import(
          '@/modules/llm-local-runtime/stores/runtimeConfig'
        )
        await holdPatch(() => {
          RuntimeConfigRaw.setState({
            gpu: {
              platform: 'linux',
              arch: 'x86_64',
              available: ['cpu'],
              recommended: 'cpu',
            },
            loadingGpu: false,
          } as any)
          RuntimeUpdateRaw.setState({
            checking: new Map(),
            updateChecks: new Map([
              [
                'llamacpp',
                {
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
                  credential_status: 'rejected',
                  latest_version: 'v0.0.3-alpha',
                  has_updates: true,
                },
              ],
            ]),
          } as any)
        })
      },
    },
    // ── AvailableVersionsCard: a ready version WITH a FAILED download snapshot →
    //    the inline progress line (:300) + the failed-error text (:301,302). ───────
    {
      slug: 'seeded-s3-available-versions-failed-row',
      title: 'Available runtime versions — failed download row',
      note: 'a binary_ready version + a failed progress snapshot → the row error line',
      path: '/',
      initialPath: '/',
      component: lazyProps(
        () => import('@/modules/llm-local-runtime/components/AvailableVersionsCard'),
        'AvailableVersionsCard',
        { engine: 'llamacpp' },
      ),
      setup: async () => {
        const { RuntimeUpdateRaw } = await import(
          '@/modules/llm-local-runtime/stores/runtimeUpdate'
        )
        const { RuntimeConfigRaw } = await import(
          '@/modules/llm-local-runtime/stores/runtimeConfig'
        )
        const { RuntimeDownloadProgress } = await import(
          '@/modules/llm-local-runtime/stores/runtimeDownloadProgress'
        )
        await holdPatch(() => {
          RuntimeConfigRaw.setState({
            gpu: {
              platform: 'linux',
              arch: 'x86_64',
              available: ['cpu'],
              recommended: 'cpu',
            },
            loadingGpu: false,
          } as any)
          RuntimeUpdateRaw.setState({
            checking: new Map(),
            updateChecks: new Map([
              [
                'llamacpp',
                {
                  engine: 'llamacpp',
                  platform: 'linux',
                  arch: 'x86_64',
                  latest_version: '1.2.0',
                  has_updates: true,
                  versions: [
                    {
                      version: '1.2.0',
                      installed: false,
                      installed_backends: [],
                      binary_ready: true,
                      available_backends: ['cpu'],
                      recommended_backend: 'cpu',
                      size_bytes: 734_003_200,
                      prerelease: false,
                    },
                  ],
                },
              ],
            ]),
          } as any)
          RuntimeDownloadProgress.__setState({
            activeByKey: new Map([
              [
                'llamacpp@1.2.0@cpu',
                {
                  key: 'llamacpp@1.2.0@cpu',
                  engine: 'llamacpp',
                  version: '1.2.0',
                  backend: 'cpu',
                  task_id: 's3-task',
                  status: 'failed',
                  bytes_received: 0,
                  error: 'Download failed: upstream returned 503.',
                },
              ],
            ]),
          } as any)
        })
      },
    },
    // ── VersionModelsBlock: an installed engine version with zero models using it →
    //    the "No models use this version" Empty (:80). Pure-props, no store seed. ──
    {
      slug: 'seeded-s3-version-models-empty',
      title: 'Runtime version models — empty',
      note: 'models.length===0 → the "safe to delete" Empty',
      path: '/',
      initialPath: '/',
      component: lazyProps(
        () => import('@/modules/llm-local-runtime/components/VersionModelsBlock'),
        'VersionModelsBlock',
        {
          engine: 'llamacpp',
          versionId: 's3-v1',
          models: [],
          versionOptions: [{ value: 's3-v1', label: '1.0.0' }],
          canManage: true,
          canViewLogs: true,
        },
      ),
    },
    // ── VersionModelsBlock: a model auto-start LATCHED as failed → the `failed`
    //    tag + the "Clear failed state" recovery button (:210, :301). `failed` is
    //    `statuses.get(id)?.status === 'failed'`, and `statuses` is only ever
    //    written by the on-demand Diagnose probe (nothing loads on mount), so the
    //    state is reached by seeding the probe RESULT through the real store —
    //    the same shape as the available-versions failed-download row above. ─────
    {
      slug: 'seeded-s3-version-models-failed',
      title: 'Runtime version models — failed (latched) model',
      note: 'a diagnosed model whose status is `failed` → the failed tag + Clear failed state',
      path: '/',
      initialPath: '/',
      component: lazyProps(
        () => import('@/modules/llm-local-runtime/components/VersionModelsBlock'),
        'VersionModelsBlock',
        {
          engine: 'llamacpp',
          versionId: 's3-v1',
          models: [
            {
              id: 's3-model-failed',
              display_name: 'Qwen3 4B (latched)',
              running: false,
              pinned: true,
            },
          ],
          versionOptions: [{ value: 's3-v1', label: '1.0.0' }],
          canManage: true,
          canViewLogs: true,
        },
      ),
      setup: async () => {
        const { RuntimeModelUsageStore } = await import(
          '@/modules/llm-local-runtime/stores/runtimeModelUsage'
        )
        await holdPatch(() => {
          RuntimeModelUsageStore.setState({
            statuses: new Map([
              [
                's3-model-failed',
                { model_id: 's3-model-failed', status: 'failed' },
              ],
            ]),
          } as any)
        })
      },
    },
  ],
}
