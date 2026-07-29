import { Permissions } from '@/api-client/permissions'
import { createModule } from '@ziee/framework'
import { lazyWithPreload } from '@/utils/lazyWithPreload'
import { usePermission } from '@/core/permissions'

import { NotificationBellWidget } from './components/NotificationBellWidget'
import { useNotificationsStore } from './stores/Notifications.store'
import '@/modules/notification/types' // register Notifications (declaration merge)
import '@/modules/notification/kinds' // register ziee's notification kinds/renderers (SDK seam)

const NotificationsPage = lazyWithPreload(() =>
  import('./pages/NotificationsPage').then(m => ({
    default: m.NotificationsPage,
  })),
)
const AgentInboxPage = lazyWithPreload(() =>
  import('./pages/AgentInboxPage').then(m => ({
    default: m.AgentInboxPage,
  })),
)
const NotificationToastListener = lazyWithPreload(() =>
  import('./components/NotificationToastListener').then(m => ({
    default: m.NotificationToastListener,
  })),
)

export default createModule({
  metadata: {
    name: 'notification',
    version: '1.0.0',
    description: 'Notification inbox',
  },
  // smart-loading gate (build-lifted into the manifest)
  shouldLoad: (ctx) => ctx.isAuthenticated,
  dependencies: ['router'],
  routes: [
    {
      path: '/notifications',
      element: NotificationsPage,
      requiresAuth: true,
      permission: Permissions.NotificationsRead,
    },
    {
      // Agent/background inbox (ITEM-26) — a focused view over the same
      // notifications, narrowed to background sub-agent / scheduled-loop results.
      // Same read perm as the inbox (self-gated store; no 403 for a role without
      // the grant).
      path: '/notifications/background',
      element: AgentInboxPage,
      requiresAuth: true,
      permission: Permissions.NotificationsRead,
    },
  ],
  stores: [{ name: 'Notifications', store: useNotificationsStore }],
  components: [
    {
      id: 'notification-toast-listener',
      component: NotificationToastListener,
      // Gate: notifications are per-user (`notifications::read`, held by every
      // authenticated user). A logged-out visitor has no notifications, so don't
      // load the toast-listener chunk on the login page.
      shouldMount: () => usePermission(Permissions.NotificationsRead),
      order: 90,
    },
  ],
  slots: {
    // There is deliberately NO "Background results" sidebarNavigation entry.
    // The BELL below (`sidebarBottom`) is the single central surface for
    // agent / background / scheduled results, and it already navigates each
    // result to the conversation it landed in (`/chat/{conversationId}`); its
    // "View all" goes to `/notifications` (`Notifications.store.ts` `inboxPath`).
    // A second top-level nav destination for the same data was redundant chrome.
    //
    // NOTE the `/notifications/background` route below (AgentInboxPage, a view
    // over the same inbox filtered to agent kinds) therefore has NO in-app entry
    // point any more — it is a URL/bookmark target only. It is kept rather than
    // deleted because the brief scoped this change to the nav entry; whether to
    // link it from the inbox or remove it is a tracked follow-up for the owner.
    sidebarBottom: [
      {
        id: 'notification-bell',
        component: NotificationBellWidget,
        order: 5,
        // Gate: the bell + list render the user's notifications (backed by
        // `notifications::read`). Match the data's read perm so a role
        // without the grant sees neither the bell nor a 403 fetch.
        permission: Permissions.NotificationsRead,
      },
    ],
  },
})
