import type { TextStoreGet, TextStoreSet } from '../state'

/**
 * Set the composer's text AND its caret/selection in one step.
 *
 * `end` defaults to `start`, i.e. a collapsed caret. This is what an insertion
 * must use instead of `setText`: writing the value alone leaves the caret at the
 * end of the textarea regardless of where the text went.
 */
export default (_set: TextStoreSet, get: TextStoreGet) =>
  (text: string, start: number, end: number = start) => {
    const { applyComposerEdit } = get()
    if (!applyComposerEdit) {
      console.warn('[TextStore] applyComposerEdit function not registered')
      return
    }
    applyComposerEdit(text, start, end)
  }
