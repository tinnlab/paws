import { createExtension, type ChatExtension } from '@/modules/chat/core/extensions'
import { agentRailContributions } from './railContribution'

/**
 * `agent` chat extension — auto-discovered by chat's
 * `modules/<name>/chat-extension/extension.tsx` glob.
 *
 * Contribution-only: it teaches the activity rail what the agent loop's six CORE
 * META-TOOLS mean (`delegate`, `schedule_next`, `task_create/update/get/list`).
 * Those tools are intercepted in-process by the loop
 * (`agent-core/src/core_tools.rs`), never routed to an MCP `ToolProvider`, so no
 * MCP-side owner exists for them — the module that owns the agent settings owns
 * their meaning.
 *
 * See the DE-DUPLICATION block in `railContribution.ts` for why the live
 * `taskListChanged` SSE frame is deliberately NOT a second step producer.
 */
const agentExtension: ChatExtension = createExtension({
  name: 'agent',
  description: "Activity-rail step descriptors for the agent loop's core meta-tools",
  priority: 57,
  railContributions: agentRailContributions,
})

export default agentExtension
