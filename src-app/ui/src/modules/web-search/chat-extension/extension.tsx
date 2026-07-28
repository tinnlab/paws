import {
  type ChatExtension,
  createExtension,
} from '@/modules/chat/core/extensions'
import { webSearchRailContributions } from '@/modules/web-search/chat-extension/describeActivity'

/**
 * web-search chat extension (auto-discovered at `modules/*\/chat-extension/`).
 *
 * Contributes ONLY rail step descriptors (ITEM-19). It registers no content-type
 * renderer, so expanding a step delegates to `renderContent({ content })` — the
 * already-registered generic tool renderer — exactly as the rail's default path
 * intends. There is nothing else this module needs from the chat lifecycle: the
 * `web_search` MCP server is attached server-side by the backend chat extension
 * (`server/src/modules/web_search/chat_extension/`).
 */
const webSearchExtension: ChatExtension = createExtension({
  name: 'web-search',
  description: 'Rail steps for the web_search / fetch_url tool family',
  priority: 40,
  railContributions: webSearchRailContributions,
})

export default webSearchExtension
