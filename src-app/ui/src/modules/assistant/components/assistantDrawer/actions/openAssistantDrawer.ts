import type { Assistant } from '@/api-client/types'
import type { AssistantDrawerGet, AssistantDrawerSet } from '../state'

// paws: the `isTemplate` parameter is gone with the assistant-templates admin
// surface (design item 12) — the removed page was its only caller with `true`.
// `isCloning` stays: it is a distinct mode (create-from-template), and although
// no call site passes it today the drawer still branches on it.
export default (set: AssistantDrawerSet, _get: AssistantDrawerGet) =>
  async (assistant?: Assistant | null, isCloning = false) => {
    set({ open: true, editingAssistant: assistant || null, isCloning })
  }
