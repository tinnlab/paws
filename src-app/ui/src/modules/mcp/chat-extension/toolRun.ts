import type {
  MessageContent,
  MessageContentDataToolUse,
} from '@/api-client/types'
import type { McpToolCall } from '@/modules/mcp/stores/mcpComposer'

/**
 * Pure helpers for the mcp chat extension.
 *
 * This module used to also hold the "N tools called" GROUP CARD's policy —
 * `runToolUseIds` / `hasArtifactInRun` / `shouldWrapRun` / `shouldAutoOpen` /
 * `deriveGroupOpen`. The group card is retired (DEC-4, hard cutover): grouping,
 * auto-open and the force-open-on-approval rule are the ACTIVITY RAIL's, and the
 * rail expresses them without the fragile dual-call invariant `shouldWrapRun`
 * existed to hold together (ITEM-5). What remains is artifact attribution, which
 * is genuinely mcp's: only mcp knows which of ITS in-flight calls an
 * `artifactCreated` frame belongs to.
 */

/**
 * Resolve which `tool_use` an incoming artifact belongs to, robust under
 * parallel tools.
 * - Prefer the explicit `eventToolUseId` (the current backend always sends it).
 * - Legacy fallback (no event id): attribute ONLY when unambiguous — exactly one
 *   `tool_use` block in the message, or exactly one in-flight
 *   (`started`/`pending_approval`) store call. Otherwise return `null` and skip:
 *   never guess "the last tool_use", which would mis-attach a parallel artifact.
 */
export function resolveArtifactToolUseId(
  contents: MessageContent[],
  storeCalls: ReadonlyMap<string, McpToolCall>,
  eventToolUseId?: string | null,
): string | null {
  if (eventToolUseId) return eventToolUseId

  const toolUseIds = contents
    .filter(c => c.content_type === 'tool_use')
    .map(c => (c.content as MessageContentDataToolUse | undefined)?.id)
    .filter((id): id is string => !!id)
  if (toolUseIds.length === 1) return toolUseIds[0]

  // Disambiguate via a single in-flight call — but only among THIS message's
  // tool_use ids, never the global store: an in-flight call from another
  // conversation (or a prior turn) must not capture this artifact, and the
  // returned id must be a tool_use that actually exists in this message.
  const messageUseIds = new Set(toolUseIds)
  const inFlight = [...storeCalls.values()].filter(
    c =>
      (c.status === 'started' || c.status === 'pending_approval') &&
      messageUseIds.has(c.tool_use_id),
  )
  if (inFlight.length === 1) return inFlight[0].tool_use_id

  return null
}
