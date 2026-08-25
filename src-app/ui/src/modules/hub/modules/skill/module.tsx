import { BookOpen } from 'lucide-react'
import { Permissions } from '@/api-client/permissions'
import { createModule } from '@ziee/framework'
import { lazyWithPreload } from '@/utils/lazyWithPreload'
import '@/modules/hub/modules/skill/types'

const SkillsHubTab = lazyWithPreload(() =>
  import('./components/SkillsHubTab').then(m => ({
    default: m.SkillsHubTab,
  })),
)

export default createModule({
  metadata: {
    name: 'hub-skill',
    version: '1.0.0',
    description: 'Hub catalog for skills',
  },
  // smart-loading gate (build-lifted into the manifest)
  // paws: HIDDEN with its parent hub (design item 11). NOTE this hides the hub's
  // skill CATALOG tab only — the `skill` module itself is NOT hidden. Restore by
  // putting back:
  //   (ctx) => ctx.isAuthenticated && ctx.can(Permissions.SkillsRead) &&
  //     (ctx.path === '/hub' || ctx.path.startsWith('/hub/'))
  // and deleting 'hub-skill' from PAWS_HIDDEN_MODULE_NAMES.
  shouldLoad: () => false,
  dependencies: [],
  stores: [],
  slots: {
    hubTabs: [
      {
        id: 'skills',
        label: 'Skills',
        icon: <BookOpen />,
        component: SkillsHubTab,
        order: 40,
        permissions: {
          read: Permissions.SkillsRead,
          refresh: Permissions.HubCatalogManage,
        },
        refresh: async () => {
          const { useHubSkillsStore } = await import('@/modules/hub/modules/skill/stores/hub-skills-store')
          await useHubSkillsStore.getState().refresh()
        },
      },
    ],
  },
})
