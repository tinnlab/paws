import { Server } from 'lucide-react'
import { createModule } from '@ziee/framework'
import { Permissions } from '@/api-client/permissions'
import { lazyWithPreload } from '@/utils/lazyWithPreload'
import '@/modules/hub/modules/llm-models/types'

const ModelsHubTab = lazyWithPreload(() =>
  import('./components/ModelsHubTab').then(m => ({ default: m.ModelsHubTab })),
)

export default createModule({
  metadata: {
    name: 'hub-llm-models',
    version: '1.0.0',
    description: 'Hub catalog for LLM models',
  },
  // smart-loading gate (build-lifted into the manifest)
  // paws: HIDDEN with its parent hub (design item 11). Restore by putting back:
  //   (ctx) => ctx.isAuthenticated && ctx.can(Permissions.HubModelsRead) &&
  //     (ctx.path === '/hub' || ctx.path.startsWith('/hub/'))
  // and deleting 'hub-llm-models' from PAWS_HIDDEN_MODULE_NAMES.
  shouldLoad: () => false,
  dependencies: [],
  stores: [],
  slots: {
    hubTabs: [
      {
        id: 'models',
        label: 'Models',
        icon: <Server />,
        component: ModelsHubTab,
        order: 10,
        permissions: {
          read: Permissions.HubModelsRead,
          refresh: Permissions.HubModelsRefresh,
        },
        refresh: async () => {
          const { useHubModelsStore } = await import('@/modules/hub/modules/llm-models/stores/hub-models-store')
          await useHubModelsStore.getState().refreshFromGitHub()
        },
      },
    ],
  },
})
