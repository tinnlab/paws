import type { ComposerSelection, TextStoreGet, TextStoreSet } from '../state'

/** Register the caret/selection reader (called by TextInput on mount). */
export default (set: TextStoreSet, _get: TextStoreGet) =>
  (reader: () => ComposerSelection | null) => {
    set(state => {
      state.readSelection = reader
    })
  }
