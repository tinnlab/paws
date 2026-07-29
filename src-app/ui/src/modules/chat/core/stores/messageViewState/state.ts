import type { StoreSet } from '@ziee/framework/store-kit'
import type { InlineFileViewState } from '@/modules/chat/core/stores/messageViewState.helpers'

export const messageViewStateState = {
  /** message id → collapsed (absent ⇒ default-collapsed). */
  collapsed: {} as Record<string, boolean>,
  /** resource_link URI → InlineFileViewState (absent ⇒ default). */
  files: {} as Record<string, InlineFileViewState>,
  /**
   * `<messageId>#<spanIndex>` → activity-rail open flag (absent ⇒ the derived
   * default: open while the turn works, collapsed once the answer exists).
   *
   * Keyed by MESSAGE, not held in component state (INV-7). The rail joins the
   * mechanism `CollapsibleBlock` and `InlineFilePreview` already use, and fixes
   * the precedent it would otherwise have copied: `ThinkingContent` keeps its
   * expanded flag in `useState`, and because the message list is virtualised,
   * scrolling away and back silently re-collapses it mid-read.
   */
  rails: {} as Record<string, boolean>,
  /** `<messageId>#step#<stepKey>` → that step's inline-detail open flag. */
  steps: {} as Record<string, boolean>,
}

export type MessageViewStateState = typeof messageViewStateState
export type MessageViewStateSet = StoreSet<MessageViewStateState>
export type MessageViewStateGet = () => MessageViewStateState
