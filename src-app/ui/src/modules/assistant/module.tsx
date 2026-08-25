import { Bot } from 'lucide-react'
import { createModule } from '@ziee/framework'
import { SettingsLayoutDef } from '@/modules/settings/SettingsLayout'
import '@/modules/assistant/types'
import { Permissions } from '@/api-client/permissions'
import { lazyWithPreload } from '@/utils/lazyWithPreload'
import '@/modules/settings/types/SettingsSlots' // Register settings slot types

const UserAssistantsSettings = lazyWithPreload(() =>
  import('./pages/UserAssistantsSettings').then(m => ({
    default: m.UserAssistantsSettings,
  })),
)
export default createModule({
  metadata: {
    name: 'assistants',
    version: '1.0.0',
    description: 'AI Assistants module for managing user assistants',
  },
  // smart-loading gate (build-lifted into the manifest)
  shouldLoad: (ctx) => ctx.isAuthenticated,
  dependencies: ['router'],
  routes: [
    {
      path: '/settings/assistants',
      element: UserAssistantsSettings,
      requiresAuth: true,
      permission: Permissions.AssistantsRead,
      layout: SettingsLayoutDef,
    },
    // paws: the /settings/assistant-templates route is REMOVED (design item 12).
    // Only the admin template SURFACE goes — `is_template`, the seeded
    // "Default Assistant" row and clone-on-signup all stay, so a new user still
    // gets an assistant (see DEC-2). The `assistant` module itself is core and
    // is NOT hidden.
  ],
  stores: [
  ],
  slots: {
    settingsUserPages: [
      {
        id: 'assistants',
        icon: <Bot />,
        label: 'Assistants',
        path: 'assistants',
        order: 20,
        permission: Permissions.AssistantsRead,
      },
    ],
    // paws: no `settingsAdminPages` entry — the "Assistant Templates" admin page
    // is removed (design item 12). See the routes note above.
  },
  initialize: () => {
    console.log('Assistants module initialized')
  },
})
