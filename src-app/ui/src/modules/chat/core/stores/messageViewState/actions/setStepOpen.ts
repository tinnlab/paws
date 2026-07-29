import type { MessageViewStateSet } from '../state'

export default (set: MessageViewStateSet) => {
  /**
   * Persist whether ONE rail step's inline detail is expanded (ITEM-8/ITEM-11).
   * `key` is `stepStateKey(messageId, step.key)`; absent ⇒ closed.
   */
  return (key: string, open: boolean) =>
    set(d => {
      d.steps[key] = open
    })
}
