//! lit_search chat extension (auto-discovered at modules/*/chat-extension/).
//!
//! Registers the `literature` right-panel renderer (the screening workbench), a
//! `tool_result` content renderer (the inline "Open in screening" card for
//! `literature_search` results), and the module's ACTIVITY-RAIL contributions
//! covering all SIX `lit_search` tools.
//!
//! The content-type registry early-exits on the first renderer that CLAIMS a
//! block, and a renderer claims via its static `contentMatch`. This card claims
//! only its own blocks, so every other `tool_result` reaches the next registered
//! renderer by itself — which is what let ITEM-24 delete the cross-module
//! delegation this extension used to carry. See LiteratureToolResultCard.

import { FileSearch } from 'lucide-react'
import { createExtension, type ChatExtension } from '@/modules/chat/core/extensions'
import { LiteratureToolResultCard } from '../components/LiteratureToolResultCard'
import { literatureRailContributions } from './railContribution'
import '../types' // PanelRendererMap declaration merge for 'literature'

const literatureExtension: ChatExtension = createExtension({
  name: 'literature',
  description: 'Literature search: screening right-panel + tool-result card',
  // Below the file extension's 80 so this wins the `tool_result` content type
  // (the registry early-exits on the first renderer); the card delegates every
  // non-literature block back to the file view. See LiteratureToolResultCard.
  priority: 75,

  initialize: async () => {
    const { registerPanelRenderer } = await import('@/modules/chat/core/stores/chat')
    const { LiteratureScreeningPanel } = await import('../components/LiteratureScreeningPanel')
    registerPanelRenderer('literature', {
      icon: <FileSearch />,
      component: LiteratureScreeningPanel,
    })
  },

  // Co-owned tool_result renderer — its static `contentMatch` claims ONLY
  // well-formed literature_search results, so every other block falls through
  // to the next registered renderer without any manual delegation (ITEM-24).
  contentTypes: {
    tool_result: LiteratureToolResultCard,
  },

  // Each extension contributes its own step descriptor + detail body (INV-1).
  railContributions: literatureRailContributions,
})

export default literatureExtension
