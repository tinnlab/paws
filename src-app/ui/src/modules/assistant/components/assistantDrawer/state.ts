import type { Assistant } from '@/api-client/types'
import type { StoreSet } from '@ziee/framework/store-kit'

export const assistantDrawerState = {
  open: false,
  loading: false,
  editingAssistant: null as Assistant | null,
  // paws: `isTemplate` removed with the assistant-templates admin surface
  // (design item 12) — nothing could ever set it true again.
  isCloning: false,
}

export type AssistantDrawerState = typeof assistantDrawerState
export type AssistantDrawerSet = StoreSet<AssistantDrawerState>
export type AssistantDrawerGet = () => AssistantDrawerState
