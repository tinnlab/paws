import { Alert, Text } from '@ziee/kit'
import type {
  MessageContent,
  MessageContentDataToolUse,
  MessageContentDataToolResult,
} from '@/api-client/types'
import { redactedJson } from '@/modules/chat/core/rail/redactToolArgs'

/**
 * The CORE default body for an expanded rail step.
 *
 * Two properties this has to guarantee, and neither can be delegated to a
 * contribution:
 *
 * 1. **Redaction is structural.** Arguments are rendered through
 *    {@link redactedJson} here, in the one place every step without its own
 *    `renderDetail` lands. The first cut put redaction inside an optional
 *    contribution body, which every domain contribution pre-empted — so the
 *    families most likely to carry a credential printed arguments verbatim. A
 *    security property that ~17 contributors must each remember is not one.
 * 2. **No nested disclosure.** The rail row already carries the tool name, the
 *    status glyph, the timing and the expander, so this renders ONLY what the
 *    row cannot. Delegating to the extension's full tool CARD instead would put
 *    a second bordered box with a second chevron inside the very rail that
 *    exists to remove boxes — and those cards keep their open flag in component
 *    state, which a virtualised list silently resets on scroll (the exact
 *    `ThinkingContent` failure INV-7 exists to prevent, one level deeper).
 */
export function RailStepDetail({
  block,
  result,
}: {
  /** The step's anchor `tool_use` block. */
  block: MessageContent
  /** The paired `tool_result` block's payload, when one exists yet. */
  result?: MessageContentDataToolResult | null
}) {
  const use = block.content as MessageContentDataToolUse | undefined
  const hasInput = use?.input !== undefined && use?.input !== null
  const isError = result?.is_error === true

  if (!hasInput && !result) {
    return (
      <Text type="secondary" className="text-xs">
        No details recorded for this step.
      </Text>
    )
  }

  return (
    <div className="flex flex-col gap-2 text-xs" data-testid="rail-step-detail-body">
      {hasInput && (
        <div>
          <Text strong className="text-xs">
            Arguments
          </Text>
          <pre
            className="mt-1 max-h-40 overflow-auto rounded-sm bg-muted p-2"
            data-testid="rail-step-detail-args"
          >
            {redactedJson(use?.input)}
          </pre>
        </div>
      )}

      {result && !isError && (
        <div>
          <Text strong className="text-xs">
            Result
          </Text>
          <pre
            className="mt-1 max-h-40 overflow-auto rounded-sm bg-muted p-2"
            data-testid="rail-step-detail-result"
          >
            {result.content}
          </pre>
        </div>
      )}

      {result && isError && (
        <Alert
          tone="error"
          title="Error"
          description={result.content}
          data-testid="rail-step-detail-error"
        />
      )}
    </div>
  )
}
