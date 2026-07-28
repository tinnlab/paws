import {
  type ChatExtension,
  createExtension,
} from '@/modules/chat/core/extensions'
import { citationsRailContributions } from '@/modules/citations/chat-extension/describeActivity'

/**
 * citations chat extension (auto-discovered at `modules/*\/chat-extension/`).
 *
 * Contributes ONLY rail step descriptors (ITEM-19) — no content-type renderer,
 * so an expanded step delegates to the already-registered generic tool renderer
 * via `renderContent({ content })`. The citations MCP server is registered and
 * auto-attached entirely server-side (`server/src/modules/citations/`).
 */
const citationsExtension: ChatExtension = createExtension({
  name: 'citations',
  description: 'Rail steps for the six citation tools',
  priority: 40,
  railContributions: citationsRailContributions,
})

export default citationsExtension
