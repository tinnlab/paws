import type { TextStoreGet, TextStoreSet } from '../state'

/** Register the value+selection applier (called by TextInput on mount). */
export default (set: TextStoreSet, _get: TextStoreGet) =>
  (applier: (text: string, start: number, end: number) => void) => {
    set(state => {
      state.applyComposerEdit = applier
    })
  }
