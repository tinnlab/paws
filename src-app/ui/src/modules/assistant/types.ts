import type { StoreProxy } from '@ziee/framework/stores'
import type {
  useUserAssistantsStore,
  useAssistantPickerStore,
} from '@/modules/assistant/stores'
import type { useAssistantDrawerStore } from '@/modules/assistant/components/assistantDrawer'

declare module '@ziee/framework/stores' {
  interface RegisteredStores {
    UserAssistants: StoreProxy<
      ReturnType<typeof useUserAssistantsStore.getState>
    >
    // paws: `TemplateAssistants` removed with the templates admin surface
    // (design item 12).
    AssistantDrawer: StoreProxy<
      ReturnType<typeof useAssistantDrawerStore.getState>
    >
    AssistantPicker: StoreProxy<
      ReturnType<typeof useAssistantPickerStore.getState>
    >
  }
}

export {}
