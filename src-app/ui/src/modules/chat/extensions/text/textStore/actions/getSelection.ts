import type { ComposerSelection, TextStoreGet, TextStoreSet } from '../state'

/**
 * Get the composer's current caret/selection via the registered reader.
 *
 * `null` means "no insertion point" — either the composer has not registered
 * yet, or it has never been focused. Callers must treat that as "append at the
 * end", never as "position 0".
 */
export default (_set: TextStoreSet, get: TextStoreGet) =>
  (): ComposerSelection | null => {
    const { readSelection } = get()
    if (!readSelection) {
      console.warn('[TextStore] readSelection function not registered')
      return null
    }
    return readSelection()
  }
