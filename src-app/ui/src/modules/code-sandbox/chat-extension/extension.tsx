import {
  type ChatExtension,
  createExtension,
} from '@/modules/chat/core/extensions'
import { codeSandboxRailContributions } from '@/modules/code-sandbox/chat-extension/describeActivity'

/**
 * code-sandbox chat extension (auto-discovered at `modules/*\/chat-extension/`).
 *
 * Contributes ONLY rail step descriptors (ITEM-19) — no content-type renderer,
 * so an expanded step delegates to the already-registered generic tool renderer
 * via `renderContent({ content })`. The sandbox MCP server itself is registered
 * and attached entirely server-side (`server/src/modules/code_sandbox/`).
 */
const codeSandboxExtension: ChatExtension = createExtension({
  name: 'code-sandbox',
  description: 'Rail steps for the code_sandbox execute/file tool family',
  priority: 40,
  railContributions: codeSandboxRailContributions,
})

export default codeSandboxExtension
