import type { TextStoreGet, TextStoreSet } from '../state'

/** Register the focus closure (called by TextInput on mount). */
export default (set: TextStoreSet, _get: TextStoreGet) => (focuser: () => void) => {
  set(state => {
    state.focusMessage = focuser
  })
}
