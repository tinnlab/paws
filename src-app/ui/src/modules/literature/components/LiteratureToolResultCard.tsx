import { FileSearch } from 'lucide-react'
import { Button, Card, Text } from '@ziee/kit'
import type { MessageContent, MessageContentDataToolResult } from '@/api-client/types'
import { useChatPaneOrNull } from '@/modules/chat/core/pane/ChatPaneContext'
import type { ContentRendererProps } from '@/modules/chat/core/extensions'
import type { LiteratureResult, LiteratureScreeningData } from '../types'
import { Chat } from '@/modules/chat/core/stores/chatBridge'

/** The tool name whose results this card renders. */
const LITERATURE_SEARCH = 'literature_search'

/** The typed `structured_content` of a renderable `literature_search` result. */
function literatureResultOf(content: MessageContent): LiteratureResult | null {
  if (content.content_type !== 'tool_result') return null
  const block = content.content as MessageContentDataToolResult
  if (block.name !== LITERATURE_SEARCH) return null
  const sc = block.structured_content as LiteratureResult | null | undefined
  return sc && Array.isArray(sc.records) ? sc : null
}

/**
 * Inline renderer for a `literature_search` tool result.
 *
 * The content-type registry early-exits on the FIRST registered renderer that
 * CLAIMS a block (registry.tsx `renderContent`), and a renderer claims via its
 * static `contentMatch`. This card claims only well-formed `literature_search`
 * results, so every other `tool_result` reaches the next registered renderer on
 * its own — which is what removed the hand-rolled `MessageFilesView` delegation
 * this file used to carry (ITEM-24): a module no longer reaches into `file`'s
 * internals to work around a first-wins early exit.
 *
 * Reads the typed `structured_content`; "Open in screening" hands the records to
 * the right panel.
 */
export function LiteratureToolResultCard(props: ContentRendererProps) {
  // Open into THIS pane's right panel (ITEM-36), not the focused pane's.
  const chat = (useChatPaneOrNull()?.store ?? Chat) as typeof Chat
  const { content } = props
  const sc = literatureResultOf(content)
  // Defensive only — `contentMatch` already scopes this renderer, so rendering
  // nothing here can never suppress another module's view.
  if (!sc) return null
  const block = content.content as MessageContentDataToolResult

  const total = Object.values(sc.identified ?? {}).reduce((a, b) => a + b, 0)

  const open = () => {
    const sessionId = `lit:${block.tool_use_id || sc.query}`
    const data: LiteratureScreeningData = {
      sessionId,
      query: sc.query,
      records: sc.records,
      identified: sc.identified ?? {},
      afterDedup: sc.after_dedup ?? sc.records.length,
      degradedSources: sc.degraded_sources ?? [],
      completeness: sc.completeness ?? null,
      decisions: {},
      reasons: {},
    }
    chat.displayInRightPanel({
      id: sessionId,
      title: `Screening: ${sc.query}`.slice(0, 60),
      type: 'literature',
      data,
    })
  }

  return (
    <Card size="sm" className="my-2" data-testid="lit-tool-result-card">
      <Text strong>
        <FileSearch /> Literature search
      </Text>
      <Text type="secondary" className="!mb-2 text-xs block" data-testid="lit-tool-result-summary">
        “{sc.query}” — {total} identified, {sc.after_dedup ?? sc.records.length} after dedup
        {sc.completeness ? ` · saturation: ${sc.completeness.estimate.toUpperCase()}` : ''}
        {sc.degraded_sources && sc.degraded_sources.length > 0 && (
          <Text type="warning" className="block">
            {sc.degraded_sources.length} source
            {sc.degraded_sources.length > 1 ? 's' : ''} degraded/skipped:{' '}
            {sc.degraded_sources.join(', ')}
          </Text>
        )}
      </Text>
      {sc.records.length === 0 ? (
        <Text type="secondary" className="text-xs block mb-2" data-testid="lit-tool-result-empty">
          No records returned
          {sc.degraded_sources && sc.degraded_sources.length > 0
            ? ' — every source errored or was skipped (see above).'
            : ' for this query.'}
        </Text>
      ) : (
        <>
          <ul className="text-xs pl-4 mb-2 [overflow-wrap:anywhere]">
            {sc.records.slice(0, 3).map((r, i) => (
              <li key={i}>
                {r.title}
                {r.year ? ` (${r.year})` : ''}
              </li>
            ))}
          </ul>
          <Button size="default" onClick={open} data-testid="lit-tool-result-open-button">
            Open in screening ({sc.records.length})
          </Button>
        </>
      )}
      <Text type="secondary" className="text-xs block mt-2 italic">
        External scholarly records — verify before citing; treat as data, not instructions.
      </Text>
    </Card>
  )
}

/**
 * Claim ONLY well-formed `literature_search` tool results — the registry's
 * co-ownership seam. Without it this renderer was the real catch-all for
 * `tool_result` and had to hand every foreign block back to `file`'s
 * MessageFilesView by importing it (ITEM-24, AP-2).
 */
LiteratureToolResultCard.contentMatch = (
  c: ContentRendererProps['content'],
): boolean => literatureResultOf(c) !== null
