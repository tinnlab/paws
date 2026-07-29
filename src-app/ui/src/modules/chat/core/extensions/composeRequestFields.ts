import type { ExtensionRequestFields } from '@/modules/chat/core/extensions/types'
import { isStaleBuild } from '@ziee/framework/chunk-recovery'
import {
  buildCompositionFailureMessage,
  RequestFieldCompositionError,
  type RequestFieldFailure,
} from '@/modules/chat/core/extensions/requestFieldFailure'

/**
 * FAIL-CLOSED composition of the outgoing chat-request fields.
 *
 * Extracted from `registry.tsx` (which is JSX and therefore not directly
 * unit-testable under `node --test`) exactly as `beforeSendCancel.ts` was —
 * same directory, same reasoning: the decision under test is a small pure
 * algebra and it deserves its own spec.
 *
 * ── The rule, and why it is fail-CLOSED ─────────────────────────────────────
 * The previous behaviour caught a contributor's throw, `console.error`'d it, and
 * RETURNED the surviving contributors' fields. That is indistinguishable from
 * success at the call site, so `sendMessage` POSTed a body missing whatever the
 * failed contributor was supposed to add — in practice `model_id`, answered by
 * the server with a raw `422 missing field \`model_id\``.
 *
 * There is deliberately NO per-extension "required" opt-in. A flag an author can
 * forget defaults the whole system back to this bug (the same failure class as
 * forgetting one of the two `mcp.rs` edits when adding a built-in MCP server:
 * everything registers, curl works, and the capability silently never arrives).
 * And "degrade gracefully" is not what silently dropping a contributor buys: it
 * sends WITHOUT the user's attached files / MCP selection / assistant, which is
 * worse than an actionable abort. A contributor that genuinely wants to tolerate
 * its own failure catches it inside its own `composeRequestFields`, where the
 * choice is explicit, local and reviewable.
 *
 * ── The cost this buys, stated plainly ─────────────────────────────────────
 * Fail-closed makes a NOMINALLY-OPTIONAL contributor able to block a send. The
 * sharpest case is `mcp`, whose `composeRequestFields` opens with a dynamic
 * `import()` — exactly the chunk failure this module exists for — so a stale
 * build there blocks even a plain text send from a user with zero MCP servers
 * selected, where its contribution would have been `{}`.
 *
 * That is accepted, not overlooked. The same contributor also carries
 * `tool_approvals`: catching its own failure and returning `{}` would silently
 * drop a user's tool approval/denial and let the turn proceed as if it had never
 * been given — a materially worse outcome than an abort the user can act on and
 * retry. The tradeoff is pinned by a test (`an OPTIONAL contributor's failure
 * blocks the send`) so it can never become accidental.
 *
 * Every contributor still RUNS even after one fails — a first failure must not
 * hide a second, and must not skip a healthy contributor either.
 */

/** One contributor, reduced to what composition needs. */
export interface RequestFieldContributor {
  name: string
  compose: () => Promise<ExtensionRequestFields> | ExtensionRequestFields
}

/**
 * Run every contributor and merge their fields in order (later wins).
 *
 * @throws {RequestFieldCompositionError} if ANY contributor failed, naming all
 *         of them, with a message the user can act on.
 */
export async function composeRequestFieldsFrom(
  contributors: RequestFieldContributor[],
): Promise<ExtensionRequestFields> {
  let fields: ExtensionRequestFields = {}
  const failures: RequestFieldFailure[] = []
  // Captured AT THE MOMENT OF FAILURE, not re-read when the message is built.
  // The stale-build mark is a single process-wide flag that a SUCCESSFUL import
  // clears, and contributors run sequentially — so a later contributor resolving
  // its own lazy action would clear the mark set by an earlier one's chunk 404,
  // and the message would lose "the app may have been updated" in exactly the
  // deploy-while-a-tab-is-open case the hint exists to describe.
  let staleAtFailure = false

  for (const contributor of contributors) {
    try {
      const contributed = await contributor.compose()
      fields = { ...fields, ...contributed }
    } catch (error) {
      // Still logged — the console line carries the stack, which the user-facing
      // message deliberately does not. What changed is that it is no longer the
      // ONLY consequence.
      console.error(
        `[ChatExtensions] Error in ${contributor.name}.composeRequestFields:`,
        error,
      )
      failures.push({ extension: contributor.name, cause: error })
      staleAtFailure = staleAtFailure || isStaleBuild()
    }
  }

  if (failures.length > 0) {
    throw new RequestFieldCompositionError(
      buildCompositionFailureMessage(failures, staleAtFailure),
      { failures },
    )
  }

  return fields
}
