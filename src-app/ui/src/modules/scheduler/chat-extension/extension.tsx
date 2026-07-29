import { createExtension, type ChatExtension } from '@/modules/chat/core/extensions'
import { schedulerRailContributions } from './railContribution'

/**
 * `scheduler` chat extension — auto-discovered by chat's
 * `modules/<name>/chat-extension/extension.tsx` glob.
 *
 * Contribution-only. It owns the two SKIPPED-TOOL markers a policy refusal
 * stamps onto a denial `tool_result` (`{unattended_denied}` /
 * `{admin_disabled}`) — the unattended one is the scheduler's own safety
 * posture, and the admin one is its twin, so they are described together.
 *
 * Distinct from `chat/extensions/schedule/`, which owns the composer's
 * "schedule or loop this chat" button; that surface creates scheduled tasks,
 * this one explains what a scheduled (or admin-restricted) run did NOT do.
 */
const schedulerExtension: ChatExtension = createExtension({
  name: 'scheduler',
  description:
    'Activity-rail step descriptors for policy-skipped tool calls (unattended / admin-disabled)',
  priority: 57,
  railContributions: schedulerRailContributions,
})

export default schedulerExtension
