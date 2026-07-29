import type { ExtensionRequestFields } from '@/modules/chat/core/extensions/types'
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
    }
  }

  if (failures.length > 0) {
    throw new RequestFieldCompositionError(
      buildCompositionFailureMessage(failures),
      { failures },
    )
  }

  return fields
}
