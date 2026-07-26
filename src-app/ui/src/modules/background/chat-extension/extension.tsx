//! background chat extension (auto-discovered at `modules/*/chat-extension/`).
//!
//! Moves a conversation's background sub-agent runs INTO the conversation:
//!   - a right-panel "Tasks" tab (`registerPanelRenderer('background')`), and
//!   - an end-of-conversation affordance (`message_list_footer`) that opens it.
//!
//! Replaces the former global "Background tasks" sidebar page — a run belongs to
//! the conversation that spawned it, and `GET /api/background/runs` now scopes
//! disjointly by `conversation_id`, so this is the only surface for a
//! conversation's runs. Mirrors `modules/literature/chat-extension/extension.tsx`.
import { Bot } from 'lucide-react'
import { createExtension, type ChatExtension } from '@/modules/chat/core/extensions'
import { BackgroundRunsFooter } from '../components/BackgroundRunsFooter'
import '../types' // PanelRendererMap declaration merge for 'background'

const backgroundExtension: ChatExtension = createExtension({
  name: 'background',
  description:
    "Surfaces a conversation's background sub-agent runs in-chat (right-panel Tasks tab + end-of-conversation affordance).",

  // Register the right-panel renderer in `initialize` — `loadConversation`
  // restores the persisted panel snapshot only AFTER initialize() runs, so a
  // renderer registered anywhere else would miss rehydrated tabs. The lazy
  // imports keep the panel chunk (and the run cards it pulls in) out of the chat
  // entry bundle until a conversation actually opens the tab. Mirrors the
  // literature extension's screening-panel registration; re-registration per pane
  // mount is an idempotent Map.set.
  initialize: async () => {
    const { registerPanelRenderer } = await import('@/modules/chat/core/stores/chat')
    const { BackgroundRunsPanel } = await import('../components/BackgroundRunsPanel')
    registerPanelRenderer('background', {
      icon: <Bot />,
      component: BackgroundRunsPanel,
    })
  },

  // Pinned below the last turn. The component renders null when the conversation
  // has no runs, so it is invisible on an ordinary chat and only appears once a
  // sub-agent has been launched.
  slots: {
    message_list_footer: {
      component: BackgroundRunsFooter,
      order: 20,
    },
  },
})

export default backgroundExtension
