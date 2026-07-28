import { createExtension, type ChatExtension } from '@/modules/chat/core/extensions'
import { mcpBuiltinsRailContributions } from './railContribution'

/**
 * `mcp-builtins` chat extension — auto-discovered by chat's
 * `modules/<name>/chat-extension/extension.tsx` glob.
 *
 * A contribution-only bridge for the built-in MCP servers that are pure BACKEND
 * surfaces and therefore have no frontend module of their own:
 *
 *  - `control_mcp` (`list_capabilities` / `describe_capability` / `invoke_capability`)
 *  - `tool_result_mcp` (`get_tool_result`)
 *  - `bio_mcp` (`biomcp`)
 *
 * It ships NO slots, NO stores, NO renderers and NO `module.tsx` — the app's
 * module manifest globs `modules/**\/module.tsx`, so this folder is invisible to
 * the module loader and only the chat-extension glob picks it up. Its sole job
 * is to own the MEANING of those servers' rail steps, so that meaning lives with
 * a named owner instead of in a central tool map.
 *
 * If any of the three ever grows a real frontend module, move its block out of
 * `railContribution.ts` into that module's own `chat-extension/` and delete the
 * corresponding entry here.
 */
const mcpBuiltinsExtension: ChatExtension = createExtension({
  name: 'mcp-builtins',
  description:
    'Activity-rail step descriptors for the built-in control / tool-result / bio MCP servers',
  priority: 57,
  railContributions: mcpBuiltinsRailContributions,
})

export default mcpBuiltinsExtension
