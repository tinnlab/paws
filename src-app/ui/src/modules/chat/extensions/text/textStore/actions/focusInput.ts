import type { TextStoreGet, TextStoreSet } from '../state'

/** Focus the composer via the registered closure over its own ref. */
export default (_set: TextStoreSet, get: TextStoreGet) => () => {
  const { focusMessage } = get()
  if (!focusMessage) {
    console.warn('[TextStore] focusMessage function not registered')
    return
  }
  focusMessage()
}
