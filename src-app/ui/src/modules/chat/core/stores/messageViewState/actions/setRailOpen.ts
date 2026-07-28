import type { MessageViewStateSet } from '../state'

export default (set: MessageViewStateSet) => {
  /**
   * Persist the user's open/closed choice for ONE activity rail (ITEM-8).
   *
   * `key` is `railStateKey(messageId, spanIndex)`. Keyed by message rather than
   * held in component state so an expanded rail survives the virtualiser
   * unmounting and remounting the row (INV-7) — the failure `ThinkingContent`
   * still exhibits.
   */
  return (key: string, open: boolean) =>
    set(d => {
      d.rails[key] = open
    })
}
