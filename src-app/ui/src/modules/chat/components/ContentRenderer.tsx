import { memo, useSyncExternalStore } from 'react'
import type { MessageContent } from '@/api-client/types'
import { chatExtensionRegistry } from '@/modules/chat/core/extensions'
import { TextContent } from '@/modules/chat/components/TextContent'

interface ContentRendererProps {
  content: MessageContent
  isUser: boolean
}

export const ContentRenderer = memo(function ContentRenderer({
  content,
  isUser,
}: ContentRendererProps) {
  // Re-render when an extension registers or unregisters.
  //
  // `renderContent` reads a MUTABLE registry, and this component is `memo`'d on
  // `{content, isUser}` — neither of which changes when an extension arrives. So
  // a block rendered before its extension had registered fell through to the
  // "Unknown content type" branch below and STAYED there for the life of the
  // message: nothing would ever re-render it. Measured on the gallery's
  // elicitation surfaces at roughly 1 load in 10, where a blocking request for
  // user input rendered as the literal debug string
  // `Unknown content type: elicitation_request` instead of its form.
  //
  // The registry already publishes the exact signal for this
  // (`useChatExtensionList` uses it); this component simply never subscribed.
  useSyncExternalStore(
    chatExtensionRegistry.subscribeToExtensions,
    chatExtensionRegistry.getExtensionsVersion,
    chatExtensionRegistry.getExtensionsVersion,
  )

  // Try extension rendering first. A renderer always renders exactly this one
  // block — used for attachments, for a rail step's inline detail body, and as
  // the message run-loop's fallback.
  const extensionRenderer = chatExtensionRegistry.renderContent({
    content,
    isUser,
  })

  if (extensionRenderer !== null) {
    return <>{extensionRenderer}</>
  }

  // Fall back to built-in renderers
  switch (content.content_type) {
    case 'text':
      return <TextContent content={content} isUser={isUser} />

    // Add other content types as needed:
    // case 'tool_call':
    // case 'tool_result':
    // case 'file_attachment':
    // case 'error':

    default:
      return (
        <div className="text-muted-foreground">
          Unknown content type: {content.content_type}
        </div>
      )
  }
})
