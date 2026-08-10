/**
 * Dev-gallery seed for the `llm-repository` module — the model-repository
 * drawer. Auto-discovered by the gallery's runtime registry
 * (`@/dev/gallery/support`); never imported by `module.tsx`, so it is dev-only
 * and tree-shaken from prod.
 */
import type { ModuleGallery } from '@/dev/gallery/support'
import { lazyNamed } from '@/dev/gallery/support'
import { LlmRepositoryDrawer as LlmRepositoryDrawerStore } from '@/modules/llm-repository/stores/llmRepositoryDrawer'

/**
 * One repository per PROBE OUTCOME, so the settings list renders all three
 * health affordances (`LlmRepositoryHealth`) at once.
 *
 * `unverified` exists because the probe now asserts a model-serving
 * CAPABILITY rather than "a socket answered 200": a host that is reachable
 * but cannot be confirmed to list models is reported honestly instead of
 * being dressed up as `healthy`. Rendering all three side by side is how a
 * visual review can see that they are actually distinguishable.
 */
const HEALTH_STATE_REPOSITORIES = [
  {
    id: 'lr000000-0000-0000-0000-000000000001',
    name: 'Hugging Face Hub',
    url: 'https://huggingface.co',
    auth_type: 'api_key',
    auth_config: {
      auth_test_api_endpoint: 'https://huggingface.co/api/whoami-v2',
    },
    enabled: true,
    built_in: true,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    last_health_check_at: '2026-07-20T10:30:00.000Z',
    last_health_check_status: 'healthy',
  },
  {
    id: 'lr000000-0000-0000-0000-000000000002',
    name: 'Internal mirror',
    url: 'https://models.internal.example',
    auth_type: 'none',
    auth_config: {},
    enabled: true,
    built_in: false,
    created_at: '2026-02-01T00:00:00.000Z',
    updated_at: '2026-02-01T00:00:00.000Z',
    last_health_check_at: '2026-07-20T10:31:00.000Z',
    last_health_check_status: 'unverified',
    last_health_check_reason:
      'https://models.internal.example/api/models answered 200 OK but the response is not a model listing, so this URL could not be confirmed as a model repository',
  },
  {
    id: 'lr000000-0000-0000-0000-000000000003',
    name: 'Stale token repo',
    url: 'https://repo.example.com',
    auth_type: 'bearer_token',
    auth_config: {},
    enabled: false,
    built_in: false,
    created_at: '2026-03-01T00:00:00.000Z',
    updated_at: '2026-03-01T00:00:00.000Z',
    last_health_check_at: '2026-07-20T10:32:00.000Z',
    last_health_check_status: 'unhealthy',
    last_health_check_reason:
      'HTTP request failed with status: 401 Unauthorized',
  },
]

export const gallery: ModuleGallery = {
  cassette: {
    'LlmRepository.list': {
      repositories: HEALTH_STATE_REPOSITORIES,
      total: HEALTH_STATE_REPOSITORIES.length,
      page: 1,
      per_page: 20,
    },
  },
  overlays: [
    {
      slug: 'overlay-llm-repository-drawer',
      surface: 'modules/llm-repository/components/LlmRepositoryDrawer',
      title: 'LLM Repository (drawer)',
      component: lazyNamed(
        () => import('@/modules/llm-repository/components/LlmRepositoryDrawer'),
        'LlmRepositoryDrawer',
      ),
      open: () => LlmRepositoryDrawerStore.openDrawer(),
    },
  ],
}
