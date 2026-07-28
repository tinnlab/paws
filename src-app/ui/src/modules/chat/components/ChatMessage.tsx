import { memo, useMemo, useRef, type ReactNode } from 'react'
import { Alert, ScrollArea } from '@ziee/kit'
import { cn } from '@/lib/utils'
import type {
  MessageWithContent,
  MessageContentDataImage,
} from '@/api-client/types'
import { ExtensionSlot, chatExtensionRegistry } from '@/modules/chat/core/extensions'
import { ContentRenderer } from '@/modules/chat/components/ContentRenderer'
import { shouldShowEmptyCompletionNotice } from '@/modules/chat/components/emptyCompletion'
import { MessageContext } from '@/modules/chat/core/MessageContext'
import { BranchNavigator } from '@/modules/chat/components/BranchNavigator'
import { MessageActions } from '@/modules/chat/components/MessageActions'
import { CollapsibleBlock } from '@/modules/chat/components/CollapsibleBlock'
import { shouldOfferCollapse } from '@/modules/chat/components/collapsible'
import { messageText } from '@/modules/chat/components/findMatches'
import { useConversationFind } from '@/modules/chat/components/ConversationFindContext'
import { normalizeToolResultOrder } from '@/modules/chat/core/utils/normalizeToolResultOrder'
import { ActivityRail } from '@/modules/chat/components/rail/ActivityRail'
import {
  segmentRail,
  type PlacedRailStep,
} from '@/modules/chat/components/rail/railSegmentation'

export const ChatMessage = memo(function ChatMessage({
  message,
  isStreaming = false,
  interrupted = false,
  finalizing = false,
}: {
  message: MessageWithContent
  /** True only for the message currently streaming — it is never collapsed. */
  isStreaming?: boolean
  /** True when this turn was cancelled / errored / aborted (a partial, not a
   *  genuine empty completion) — suppresses the empty-completion notice. */
  interrupted?: boolean
  /** True during the sub-second streaming→persisted handoff for this turn — the
   *  persisted tail may not be swapped in yet, so a transient empty assistant
   *  frame must not flash the empty-completion notice. */
  finalizing?: boolean
}) {
  const isUser = message.role === 'user'
  const { activeMatchId } = useConversationFind()
  const isActiveMatch = activeMatchId === message.id

  // Once a message has streamed in THIS mount, never retroactively clamp it:
  // snapping a long answer the user is reading from full height to a 384px
  // clamp the instant streaming ends is a jarring reflow (DEC-6 exempts only
  // the in-flight message; this extends that to the just-finished one). The ref
  // survives the isStreaming true→false transition; a fresh mount (reload) has
  // it false, so history still clamps.
  const wasStreamingRef = useRef(false)
  if (isStreaming) wasStreamingRef.current = true

  // Memoized so the find-highlight re-render (every ChatMessage consumes the
  // find context, so an active-match change re-renders them all) doesn't
  // recompute the message text + collapse decision each time — only when its
  // inputs change. The ACTIVE find match is never clamped, so the matched text
  // can't hide below the fold when find scrolls to it (isActiveMatch in deps
  // triggers recompute; reading the ref is safe because isStreaming is a dep).
  const offerCollapse = useMemo(() => {
    // Short-circuit BEFORE the O(n) messageText concat: a streaming, just-
    // streamed, or active-match message is never clamped, so don't rebuild the
    // full text on every streaming token (that would be O(n^2) over a stream).
    if (isStreaming || wasStreamingRef.current || isActiveMatch) return false
    return shouldOfferCollapse({
      length: messageText(message).length,
      isStreaming: false,
    })
  }, [message, isStreaming, isActiveMatch])

  // Does this assistant turn contain a user-visible answer (text / tool call /
  // attachment), or only reasoning / nothing? A FINALISED, non-interrupted
  // assistant turn with no visible answer is the "empty completion" case —
  // surface an inline notice instead of rendering nothing (the silent-stop bug).
  // Memoized like `offerCollapse`: this component re-renders on every find-
  // highlight change, and the gate need only recompute when its inputs do.
  const contents = message.contents ?? []
  const showEmptyCompletionNotice = useMemo(
    () =>
      shouldShowEmptyCompletionNotice({
        isUser,
        isStreaming,
        interrupted,
        finalizing,
        message,
      }),
    [isUser, isStreaming, interrupted, finalizing, message],
  )

  // Check if message has any content to render. A finalised, empty assistant
  // turn has no blocks but still renders the notice below, so don't bail then.
  if (contents.length === 0 && !showEmptyCompletionNotice) {
    return null
  }

  // Render blocks in their authoritative backend order. Sort by
  // `sequence_order` (a copy — never mutate the store's array during
  // render), NOT `created_at`: blocks written in one DB transaction can
  // share a timestamp, and streaming-injected blocks carry monotonic
  // sequence_order. This keeps tool_use → tool_result(files) → text in
  // the right places.
  const sortedContents = [...contents].sort(
    (a, b) => a.sequence_order - b.sequence_order,
  )

  // A SYSTEM/observation message (e.g. a background sub-agent result injected by
  // push-to-resume) rides a user-ROLE message on the wire (so the model sees it as
  // context), but must NOT render as a right-aligned user bubble — it renders as a
  // distinct full-width observation card. The bubble geometry is otherwise keyed
  // purely on the role, so gate every layout decision on `renderAsUser` (role user
  // AND not an observation message) rather than the raw role.
  const isObservation =
    contents.length > 0 &&
    contents.every(c => c.content_type === 'observation')
  const renderAsUser = isUser && !isObservation

  // For user messages, file attachments lift OUT of the text bubble and render
  // as a single horizontal row ABOVE it (outside the bordered box) that
  // x-scrolls when it overflows, instead of wrapping or stacking vertically.
  // A user-attached image is an `image` block whose source is a stored file —
  // it's an attachment too, so it joins the row (and renders as the same
  // FileCard). Assistant/tool images (url/base64 or model-returned) stay inline
  // in the body. Assistant messages keep every block in the body.
  const isAttachmentBlock = (c: (typeof sortedContents)[number]): boolean =>
    c.content_type === 'file_attachment' ||
    (c.content_type === 'image' &&
      (c.content as MessageContentDataImage).source?.type === 'file')
  const attachmentBlocks = renderAsUser ? sortedContents.filter(isAttachmentBlock) : []
  // Relocate each tool_result adjacent to its producing tool_use (by
  // tool_use_id) so a run of tool calls is contiguous regardless of where an
  // artifact tool_result physically landed (streaming-appended-at-end or
  // persisted order). This lets the MCP group renderer wrap the artifact in the
  // "N tools called" card instead of leaving it stranded next to the group. Pure
  // — never mutates the store array (operates on the sorted copy).
  const bubbleBlocks = normalizeToolResultOrder(
    renderAsUser
      ? sortedContents.filter(c => !isAttachmentBlock(c))
      : sortedContents,
  )

  // ── Activity-rail segmentation (ITEM-2) ────────────────────────────────────
  // Blocks are segmented ONCE into activity spans vs prose vs breakouts, and
  // every span records how many blocks each of its steps owns. The renderer
  // below walks that same array, so the "span says N, renders M" class of bug
  // that the retired group card lived with is structurally impossible (ITEM-5).
  //
  // Membership comes from CONTRIBUTIONS — core asks each extension "is this a
  // step of yours?" and never inspects a tool name itself.
  const segments = segmentRail(
    bubbleBlocks,
    ctx => chatExtensionRegistry.resolveRailStep(ctx)?.step ?? null,
  )

  const railCtx = (placed: PlacedRailStep) => ({
    content: bubbleBlocks[placed.index],
    blocks: bubbleBlocks,
    index: placed.index,
  })

  /**
   * Re-derive one step's descriptor at RENDER time.
   *
   * Segmentation above runs during THIS component's render, and this component
   * is `memo`'d on the message — it subscribes to nothing live. A tool call that
   * finishes without adding a block to the message (the ordinary case: the
   * `mcpToolComplete` frame only updates the live store) would therefore leave
   * the segmented descriptor frozen at `running`, with a ticking timer that never
   * settles, until some unrelated re-render happened to refresh it.
   *
   * So the rail re-resolves each step inside `ActivityRail`, which IS subscribed
   * to the live-step seam. Segmentation still decides the SHAPE of the message
   * exactly once (ITEM-5 — the span/render desync stays structurally impossible);
   * only the per-step status/timing/artifacts refresh.
   */
  const resolveStep = (placed: PlacedRailStep) => {
    const resolved = chatExtensionRegistry.resolveRailStep(railCtx(placed))?.step
    if (!resolved) return placed.step
    // FIX_ROUND-3: keep SEGMENTATION's key, not the contribution's.
    // `segmentRail` disambiguates a repeated `tool_use_id` to `${key}#${i}`
    // (railSegmentation.ts:122) precisely because two steps sharing a key would
    // collide on the React key, on the per-message expansion state
    // (`stepStateKey`) and on the detail-panel tab id. Re-resolution goes back to
    // the contribution, which never re-applies that suffix — so taking the
    // resolved key wholesale silently UNDID the disambiguation on exactly the
    // replayed-call case it exists for, and made the breakout's `data-step-key`
    // (segmentation-namespaced) and a rail row's (contribution-namespaced) two
    // different namespaces.
    return resolved.key === placed.step.key ? resolved : { ...resolved, key: placed.step.key }
  }

  /** Resolve one step's inline detail through the SAME contribution that
   *  described it, so the label and the body can never come from different
   *  extensions. */
  const renderStepDetail = (placed: PlacedRailStep): ReactNode => {
    const ctx = railCtx(placed)
    const resolved = chatExtensionRegistry.resolveRailStep(ctx)
    if (!resolved) return null
    return chatExtensionRegistry.renderRailDetail(
      ctx,
      resolved.contribution,
      renderAsUser,
      placed.step.consumed,
    )
  }

  const bubbleNodes: ReactNode[] = []
  for (const seg of segments) {
    const block = bubbleBlocks[seg.index]
    const key = block?.id || `blk-${seg.index}`

    if (seg.kind === 'span') {
      // A rail is keyed by the message, never by component state (INV-7): its
      // expanded state survives the virtualiser unmounting this row.
      bubbleNodes.push(
        <ActivityRail
          key={`rail-${seg.steps[0]?.step.key ?? seg.index}`}
          steps={seg.steps}
          messageId={message.id}
          isStreaming={isStreaming}
          resolveStep={resolveStep}
          renderStepDetail={renderStepDetail}
        />,
      )
      continue
    }

    if (seg.kind === 'breakout') {
      // Anything that needs the USER breaks out of the rail (INV-3): full width,
      // and with no control that collapses or hides it. The contribution declared
      // it blocking; core does not know which content types those are.
      //
      // It renders through the ORDINARY content path, not the step's inline
      // detail body — a request for input is not a "detail", it is the surface
      // itself. An approval prompt must arrive as the full approve/deny card the
      // extension already ships, not as the lighter argument/result body a
      // collapsed row expands into.
      bubbleNodes.push(
        <div
          key={`breakout-${key}`}
          className="w-full"
          data-testid="rail-breakout"
          // The SAME identity a rail row would have carried (`RailStep` renders
          // `data-step-key={step.key}`). Exposing it here is what lets an
          // acceptance test assert INV-3 on a REAL stream, where the tool_use_id
          // is generated by the model and unknown to the spec: read the key off
          // the breakout, then prove no rail step anywhere carries it.
          data-step-key={seg.step.key}
        >
          <ContentRenderer content={block} isUser={renderAsUser} />
        </div>,
      )
      continue
    }

    bubbleNodes.push(
      <ContentRenderer key={key} content={block} isUser={renderAsUser} />,
    )
  }

  return (
    <div
      className={cn(
        // Role is encoded in the geometry of THIS role-tagged element, not just
        // a nested bubble: user messages shrink-to-content and pin to the right
        // (self-end + w-fit, capped so they never span full width and read as
        // centered); assistant messages stay flush-left and full-width. This is
        // what lets a reader — and the C7 role-signature check — tell them apart.
        'flex flex-col overflow-visible group scroll-mt-24',
        renderAsUser ? 'items-end self-end w-fit max-w-[85%]' : 'items-start w-full',
        // Transient highlight for the active in-conversation find match (ITEM-1).
        isActiveMatch && 'rounded-lg ring-2 ring-primary ring-offset-2 ring-offset-background transition-shadow',
      )}
      data-testid="chat-message"
      data-role={message.role}
      data-message-id={message.id}
      data-find-active={isActiveMatch ? '' : undefined}
    >
      {/* User attachments: a single horizontal row above the bubble that
          x-scrolls (via the app's overlay ScrollArea) when it overflows.
          max-w-full (not w-full): the outer container is a flex column with
          items-end, so a content-width strip shrinks-to-fit and pins to the
          RIGHT edge — matching the right-aligned user bubble — instead of
          spanning full width and stranding the files on the left. The cap keeps
          it inside the bubble's max width, so a long list still x-scrolls. */}
      {attachmentBlocks.length > 0 && (
        <ScrollArea
          axis="x"
          className="max-w-full mb-2"
          data-testid="message-attachments"
        >
          {/* ml-auto: right-align the file row inside the scroll viewport so a
              short list packs against the bubble's right edge (matching the
              right-aligned user message); a no-op once the row overflows (it just
              scrolls). */}
          {/* px-1/py-1: the x-axis ScrollArea clips at the viewport edge, and a
              FileCard's focus/selection ring renders just OUTSIDE its border — so
              the first/last card's ring got shaved. A small inset gives every
              edge ring room while the row still scrolls. */}
          <div className="flex gap-2 w-max px-1 py-1 ms-auto">
            {attachmentBlocks.map((content, index) => (
              <ContentRenderer
                key={`${content.id || `att-${index}`}`}
                content={content}
                isUser={renderAsUser}
              />
            ))}
          </div>
        </ScrollArea>
      )}

      {/* Text bubble — only when there is non-attachment content. A files-only
          message has no text block (the text extension emits none for empty
          input), so bubbleBlocks is empty and no empty bubble renders. */}
      {bubbleBlocks.length > 0 && (
        <div
          key={message.id}
          className={cn(
            'rounded-lg relative flex flex-col',
            // User: a subtle token-driven tint (reads as a "bubble" in both
            // themes) hugging its content. Assistant: flush, borderless,
            // full-width — no avatar, no card.
            renderAsUser
              ? 'bg-primary/10 w-fit max-w-full px-3 py-2'
              : 'bg-transparent w-full p-0',
          )}
        >
          <div
            className={
              // overflow-x-clip (NOT overflow-x-hidden): `overflow-x: hidden`
              // forces the browser to compute `overflow-y: auto`, turning this
              // into a vertical scroll container that CLIPS the top border of a
              // first-child card (tool-group / MCP card) and can vertically
              // offset the bubble text. `overflow-x: clip` clips wide content
              // horizontally while leaving `overflow-y` truly visible.
              // px-0.5: a 2px horizontal inset so a full-width child Card's
              // left/right border + rounded corners aren't shaved by the clip.
              'flex flex-1 w-full overflow-x-clip flex-col px-0.5'
            }
          >
            {offerCollapse ? (
              <CollapsibleBlock
                className="w-full"
                messageId={message.id}
                data-testid="chat-message-collapsible"
              >
                <div className={'w-full flex flex-col gap-2'}>{bubbleNodes}</div>
              </CollapsibleBlock>
            ) : (
              <div className={'w-full flex flex-col gap-2'}>{bubbleNodes}</div>
            )}
          </div>
        </div>
      )}

      {/* Empty-completion notice: the turn finished with only reasoning (or
          nothing) and made no tool call, so there is no answer to show. Without
          this the assistant message renders just a collapsed thinking card — or
          nothing at all — and the chat appears to hang. Detected at render time
          so it also shows on reload. */}
      {showEmptyCompletionNotice && (
        <Alert
          tone="warning"
          data-testid="chat-empty-completion-notice"
          className="w-full"
          description="The model returned an empty response and made no tool call. Please try again."
        />
      )}

      {/* Core components + extension slots rendered outside the bubble */}
      <MessageContext.Provider value={message}>
        {/* Generic below-the-bubble extension point. Tool-returned files now
            render inline at their tool_result block (see the file extension's
            `tool_result` content renderer), so nothing registers here today. */}
        <ExtensionSlot name="message_footer" />
        <div className="flex flex-row items-center gap-1 mt-1">
          {/* The branch switcher sits on the message's OUTER edge: user rows are
              right-aligned so it goes last (far right, after copy+edit);
              assistant rows are left-aligned so it goes first (far left). */}
          {renderAsUser ? (
            <>
              <MessageActions />
              <BranchNavigator />
            </>
          ) : (
            <>
              <BranchNavigator />
              <MessageActions />
            </>
          )}
          {/* Extensions can register additional message actions here */}
          <ExtensionSlot name="message_actions" />
        </div>
      </MessageContext.Provider>
    </div>
  )
})
