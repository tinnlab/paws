import { defineStore, registerLazyStore } from '@ziee/framework/store-kit'
import { assistantDrawerState, type AssistantDrawerState } from './state'
import type { Actions } from './actions.gen'

const AssistantDrawerDef = defineStore<AssistantDrawerState, Actions>('AssistantDrawer', {
  state: assistantDrawerState,
  actions: import.meta.glob('./actions/*.ts'),
  init: ({ on, get, set, actions }) => {
    // paws: the `assistant_template.*` subscriptions are removed with the
    // templates admin surface (design item 12). They only ever fired while the
    // drawer was open ON a template, which nothing can do now. The events
    // themselves still exist on the backend (the seeded template row and
    // clone-on-signup are unchanged) — they simply have no listener here.
    on('assistant.updated', event => {
      const s = get()
      if (!s.isCloning && s.editingAssistant?.id === event.data.assistant.id) {
        set({ editingAssistant: event.data.assistant })
      }
    })
    on('assistant.deleted', event => {
      const s = get()
      if (!s.isCloning && s.editingAssistant?.id === event.data.assistantId) {
        actions.closeAssistantDrawer()
      }
    })
  },
})

export const AssistantDrawer = registerLazyStore(AssistantDrawerDef)
export const useAssistantDrawerStore = AssistantDrawerDef.store
