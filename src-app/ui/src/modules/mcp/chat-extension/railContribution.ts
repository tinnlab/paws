import type { RailContribution } from '@/modules/chat/components/rail/railTypes'
import {
  railToolStepBase,
  titleCaseToolId,
} from '@/modules/chat/components/rail/railBlocks'
import type { MessageContentDataElicitationRequest } from '@/api-client/types'

/**
 * The mcp extension's rail contributions (ITEM-18).
 *
 * Two entries, and BOTH are deliberately last-resort:
 *
 *  - the GENERIC tool step at `order: 1000`, so every tool-family contribution
 *    (web search, code sandbox, citations, …) gets to claim its own tools first
 *    and describe them in domain language. mcp catches whatever is left and
 *    degrades to a readable, title-cased tool name (ITEM-6). This is the exact
 *    inverse of the pattern being deleted: no module's tool names live here.
 *  - `elicitation_request`, marked BLOCKING so it breaks out of the rail
 *    full-width and non-collapsible (INV-3). A form the user must fill in is
 *    never a collapsed row.
 */

/** The generic tool step — mcp owns the `tool_use` wire vocabulary. */
const genericToolStep: RailContribution = {
  contentTypes: ['tool_use'],
  // LAST. Every domain contribution outranks this one by construction.
  order: 1000,
  describeActivity: ctx => {
    const base = railToolStepBase(ctx)
    if (!base) return null
    return {
      ...base,
      label: titleCaseToolId(base.label),
      // A tool awaiting approval NEEDS the user, so it must not be collapsible
      // inside a rail (INV-3). This replaces the retired group card's
      // `deriveGroupOpen` force-open: instead of forcing a container open, the
      // request simply never enters the container.
      blocking: base.status === 'pending-approval',
    }
  },
  // No `renderDetail`: the CORE default body already renders redacted arguments,
  // the result, and any file the step produced — and it does so for EVERY
  // contribution, which is the only way that redaction can be a property rather
  // than a per-contributor obligation.
}

/** An elicitation form — always a breakout, never a row. */
const elicitationStep: RailContribution = {
  contentTypes: ['elicitation_request'],
  order: 1000,
  describeActivity: ctx => {
    const data = ctx.content.content as MessageContentDataElicitationRequest | undefined
    return {
      key: data?.elicitation_id || `elicit:${ctx.index}`,
      label: data?.message?.trim() || 'The tool needs more information',
      status: 'pending-approval',
      consumed: 1,
      blocking: true,
    }
  },
}

export const mcpRailContributions: RailContribution[] = [
  genericToolStep,
  elicitationStep,
]
