import { createModule } from '@ziee/framework'
import { UserRound } from 'lucide-react'
import { SettingsLayoutDef } from '@/modules/settings/SettingsLayout'
import { lazyWithPreload } from '@/utils/lazyWithPreload'
import '@/modules/settings/types/SettingsSlots' // Register settings slot types

const GeneralSettings = lazyWithPreload(() => import('./GeneralSettings'))

export default createModule({
  metadata: {
    name: 'settings-general',
    version: '1.0.0',
    description: 'General user settings',
  },
  // smart-loading gate (build-lifted into the manifest)
  shouldLoad: (ctx) => ctx.isAuthenticated,
  dependencies: ['router'],
  routes: [
    {
      path: '/settings/general',
      element: GeneralSettings,
      requiresAuth: true,
      layout: SettingsLayoutDef,
    },
  ],
  slots: {
    settingsUserPages: [
      {
        id: 'general',
        icon: <UserRound size="1em" />,
        label: 'General',
        path: 'general',
        order: 10,
      },
    ],
  },
  initialize: () => {
    console.log('General settings module initialized')
  },
})
