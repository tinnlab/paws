import type { StoreProxy } from '@ziee/framework/stores'

import type { useBackgroundRunsStore } from './stores/BackgroundRuns.store'

declare module '@ziee/framework/stores' {
  interface RegisteredStores {
    BackgroundRuns: StoreProxy<
      ReturnType<typeof useBackgroundRunsStore.getState>
    >
  }
}

// Register the `background` right-panel renderer type so a conversation's
// sub-agent runs open as a "Tasks" tab in the chat right panel (replacing the
// former global /background-tasks nav page). `data` is fully serializable — it
// carries only the conversation whose runs the panel shows, so a persisted panel
// snapshot rehydrates without any live object.
declare module '@/modules/chat/core/stores/chat' {
  interface PanelRendererMap {
    background: { conversationId: string }
  }
}

export {}
