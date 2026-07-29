import { Wrench } from 'lucide-react'
import { createExtension, type ChatExtension } from '@/modules/chat/core/extensions'
import type { ToolCallPanelData } from '@/modules/chat/components/toolCallPanel/ToolCallPanel'

/**
 * Registers the `tool_call` RIGHT-PANEL renderer — level-2 detail for an
 * activity-rail step (ITEM-12 / DEC-7).
 *
 * It goes through the existing panel mechanism rather than inventing a
 * placement, so it inherits all three layouts (in-pane slide-over, drawer,
 * resizable column) and the per-conversation persistence that four tab types
 * already rely on. The tab id is derived deterministically from `tool_use_id`
 * (DEC-8), so re-opening a step focuses its existing tab instead of stacking
 * duplicates — the same discipline as `lit:${tool_use_id}`.
 *
 * Registration lives in `initialize` because `loadConversation` restores the
 * persisted panel snapshot only AFTER initialize runs; a renderer registered
 * anywhere else would miss rehydrated tabs (the same reason the background and
 * literature extensions register there).
 */
declare module '@/modules/chat/core/stores/chat' {
  interface PanelRendererMap {
    tool_call: ToolCallPanelData
  }
}

const toolCallPanelExtension: ChatExtension = createExtension({
  name: 'tool-call-panel',
  description: "Right-panel full record for one activity-rail step.",

  initialize: async () => {
    const { registerPanelRenderer } = await import('@/modules/chat/core/stores/chat')
    const { ToolCallPanel } = await import(
      '@/modules/chat/components/toolCallPanel/ToolCallPanel'
    )
    registerPanelRenderer('tool_call', {
      icon: <Wrench />,
      component: ToolCallPanel,
    })
  },
})

export default toolCallPanelExtension
