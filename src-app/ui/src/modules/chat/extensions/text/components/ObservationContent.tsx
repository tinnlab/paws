import { memo } from 'react'
import { Radio } from 'lucide-react'
import { Card, Text } from '@ziee/kit'
import type { MessageContent } from '@/api-client/types'

interface ObservationContentProps {
  content: MessageContent
  isUser: boolean
}

/**
 * Renders a ziee-INTERNAL `observation` content block — content the SYSTEM
 * injected into the conversation (e.g. a completed background sub-agent's result)
 * — as a distinct observation card, clearly "the system reporting a result", NOT
 * a user bubble. On the wire this same block maps to plain user-role text so the
 * model sees it; here we draw it distinctly. Mirrors `ThinkingContent`'s card
 * shape (Card size="sm", icon + label header) so it reads as the same class of
 * system-process affordance.
 */
export const ObservationContent = memo(function ObservationContent({
  content,
}: ObservationContentProps) {
  const data = content.content as { text?: string }
  const text = data.text?.trim()
  if (!text) {
    return null
  }

  return (
    <Card size="sm" className="mb-2 border-info/40 bg-info/5" data-testid="observation-card">
      <div className="flex items-center gap-2 min-w-0">
        <Radio className="size-4 text-info shrink-0" />
        <Text strong className="truncate text-info">
          System update
        </Text>
      </div>
      <div className="mt-2 text-sm text-muted-foreground whitespace-pre-wrap">
        {text}
      </div>
    </Card>
  )
})
