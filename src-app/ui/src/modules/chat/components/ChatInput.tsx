import { useState } from 'react'
import { Button, Popover, Tooltip, message } from '@ziee/kit'
import { Plus, SendHorizontal as SendIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ExtensionSlot, useSendBlocked } from '@/modules/chat/core/extensions'
import { PlusDropdownContext } from '@/modules/chat/components/PlusDropdownContext'
import { EditingMessageBanner } from '@/modules/chat/components/EditingMessageBanner'
import { Chat } from '@/modules/chat/core/stores/chatBridge'
import { useChatExtensionsReady } from '@/modules/chat/extensions'

interface ChatInputProps {
  disabled?: boolean
  className?: string
  style?: React.CSSProperties
}

/**
 * ChatInput Component
 * Orchestrates message sending using extension stores
 */
export function ChatInput(props: ChatInputProps) {
  // Chat extensions (text input, file/MCP/memory composers, toolbar pills)
  // register asynchronously on first chat mount. Gate the real composer on
  // readiness so its extension slots are populated before it paints — otherwise
  // the toolbar pills flash in a beat after the composer appears. (Hook-count
  // safety is NOT the reason: send-blocking now runs each extension's hook in its
  // own probe via `useSendBlocked`, so it's stable regardless of the set.)
  const extensionsReady = useChatExtensionsReady()
  if (!extensionsReady) {
    // Composer-shaped skeleton — matches the card outline + toolbar row so there
    // is no layout jump when the real, extension-populated composer swaps in.
    return (
      <div
        className={`w-full relative ${props.className ?? ''}`}
        style={props.style}
        data-chat-composer
        data-testid="chat-composer-loading"
      >
        <div className="rounded-lg bg-card border border-border">
          <div className="px-3 pt-2.5 pb-1 min-h-14" />
          <div className="flex justify-between items-center gap-2 px-2 pt-1 pb-2">
            <div className="h-8 w-8 rounded-md bg-muted animate-pulse" />
            <div className="h-8 w-8 rounded-md bg-muted animate-pulse" />
          </div>
        </div>
      </div>
    )
  }
  return <ChatInputInner {...props} />
}

/**
 * The real composer. Extensions can block the Send button via `useSendBlocker`;
 * `useSendBlocked` runs each extension's hook in its OWN probe (no hooks in a
 * loop), returning both the aggregate `isBlocked` flag and the probe nodes to
 * render — so a changing extension set never varies this component's hook count.
 */
function ChatInputInner({
  disabled = false,
  className = '',
  style,
}: ChatInputProps) {
  const [focused, setFocused] = useState(false)
  const [plusOpen, setPlusOpen] = useState(false)

  // Get stores
  const { sendMessage, sending, isStreaming } = Chat

  // Extensions can block the Send button via `useSendBlocker`. File's
  // chat-extension uses this to gate Send while uploads are in flight
  // — chat itself stays file-agnostic. Click-time defense lives in the
  // `beforeSendMessage` aggregator (called inside sendMessage).
  const [isBlockedByExtension, sendBlockerProbes] = useSendBlocked()

  const handleSend = async () => {
    if (sending || isStreaming || disabled || isBlockedByExtension) return

    try {
      // sendMessage auto-creates conversation if missing
      // Text extension validates content via beforeSendMessage
      // NewChatPage handles navigation via useEffect
      await sendMessage()
    } catch (error: any) {
      console.error('Failed to send message:', error)
      message.error(error.message || 'Failed to send message')
    }
  }

  return (
    <div className={`w-full relative ${className}`} style={style} data-chat-composer>
      {/* Send-blocker probes: one per extension, each runs its useSendBlocker in
          isolation (return null). Mounted here so the aggregate flag stays live. */}
      {sendBlockerProbes}

      <div
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className={cn(
          'rounded-lg bg-card border transition-colors',
          focused ? 'border-primary ring-2 ring-accent' : 'border-border',
        )}
      >
        {/* Edit mode indicator — shown when user is editing an existing message */}
        <EditingMessageBanner />

        {/* Input area */}
        <div className="px-3 pt-2.5 pb-1">
          {/* Extension slot: input area prefix (file previews, etc.) */}
          <ExtensionSlot name="input_area_prefix" />

          {/* Extension slot: main text input */}
          <ExtensionSlot name="text_input" />

          {/* Extension slot: input area suffix */}
          <ExtensionSlot name="input_area_suffix" />
        </div>

        {/* Toolbar — the left (secondary) group yields space first so the right
            send group is never clipped on narrow widths (chat panel or mobile). */}
        <div className="flex justify-between items-center gap-2 px-2 pt-1 pb-2">
          {/* Left: + dropdown + other toolbar actions. NO explicit `min-w-*`:
              the group's AUTOMATIC (content-derived) minimum is what protects
              its buttons, and an explicit min-width would replace it.

              History. `min-w-0` was the first bug: basis 0 meant the group never
              competed for space, so a long model name squeezed it to ~2px and
              its `shrink-0` "+" overflowed. `min-w-10` (a 40px floor for the "+"
              alone) was the second: an explicit min-width still REPLACES the
              automatic minimum, so the group could shrink to 40px and every
              OTHER `shrink-0` button in `toolbar_actions` — MicButton, Schedule,
              Compact — overflowed to the right and was painted over by the model
              select, making the mic literally unclickable in a narrow pane (a
              3-way split). That was the "KNOWN LIMIT" noted here; this is its
              durable fix.

              Dropping the override only works once nothing inside contributes a
              text-width minimum: a flex container's min-content sums its
              children's MIN-CONTENT contributions, and `min-width:0` alone does
              NOT reduce a text element's contribution (that is why removing the
              override used to push Send ~150px outside the composer). The
              keyboard-tips element therefore now carries `w-0 flex-1`, whose
              flex base size of 0 makes its contribution genuinely 0. With that,
              this group's automatic minimum is exactly its un-shrinkable icon
              buttons — no more, no less — and the deficit lands where the design
              always intended: on the model NAME, which truncates. */}
          <div className="flex items-center gap-1 flex-1">
            {/* Tooltip anchors to the wrapper span (a distinct DOM node), not
                the Popover-trigger button — two triggers on ONE node thrash and
                flicker. The button suppresses its own aria-label auto-tooltip via
                data-tooltip-wrapped so only the span's tooltip shows. */}
            <Tooltip content="Add tools & files">
              <span className="inline-flex shrink-0">
                <Popover
                  open={plusOpen}
                  onOpenChange={setPlusOpen}
                  align="start"
                  side="top"
                  className="w-auto"
                  content={
                    <PlusDropdownContext.Provider value={{ close: () => setPlusOpen(false) }}>
                      <ExtensionSlot name="toolbar_plus_items" className="flex flex-col" />
                    </PlusDropdownContext.Provider>
                  }
                >
                  <Button
                    data-testid="chat-input-add-btn"
                    data-tooltip-wrapped=""
                    icon={<Plus className="size-4" />}
                    variant="ghost"
                    size="default"
                    aria-label="Add tools & files"
                  />
                </Popover>
              </span>
            </Tooltip>
            {/* NO `min-w-0` here either: this slot holds the `shrink-0` icon
                buttons (mic / schedule / compact), so it must keep its automatic
                content-derived minimum — with `min-w-0` it collapses to 0 and
                those buttons overflow it, which is what made the mic
                unclickable. The tips element inside contributes 0 (see the
                keyboard extension), so this minimum is just the buttons. */}
            <ExtensionSlot name="toolbar_actions" className="flex items-center gap-1" />
          </div>

          {/* Right: model selector + send button. `shrink-0` sits on the SEND
              BUTTON, not on the group: the model selector now sizes to its
              content (so a long model name shows in full when there's room), and
              under pressure the NAME is what must give way — never Send. A
              `shrink-0` on the whole group would instead force the left actions
              to absorb every pixel and let a long name push Send off the edge.

              The left group's protection is a min-width FLOOR on that group (see
              above), deliberately not a `max-w` ceiling here. A ceiling reserves
              space unconditionally: the left group is `flex-1` with a zero basis,
              so it grows into whatever the ceiling leaves over even when it holds
              nothing but the 36px "+" button — which truncated the model name
              ~90px earlier than the row actually required and left a hole in the
              middle of the toolbar. A floor gives the left group exactly what it
              needs and hands the model name everything else. */}
          <div className="flex items-center gap-2 min-w-0">
            <ExtensionSlot name="toolbar_model" className="min-w-0" />
            <Button
              data-testid="chat-input-send-btn"
              size="default"
              className="shrink-0"
              icon={<SendIcon className="-rotate-90" />}
              onClick={handleSend}
              disabled={sending || isStreaming || disabled || isBlockedByExtension}
              loading={sending || isStreaming || isBlockedByExtension}
              aria-label="Send message"
            />
          </div>
        </div>
        {/* Status row: active MCP servers + selected assistant. An intentional
            variable-length wrap row (chips count depends on active tools/pills);
            the testid gives the geometry audit a stable target so its B1
            near-fit wrap can be allow-listed precisely (not by class substring).
            pb-3 (not pb-2): the outlined status chips (memory / summary pills)
            are the composer card's last row, so their bottom border sat only 8px
            from the card's own border — a crowded double stroke (A12). 12px of
            breathing room clears the double-border without ghosting the pills. */}
        <ExtensionSlot
          name="toolbar_status"
          data-testid="composer-status-slot"
          className="flex flex-wrap items-center gap-1.5 px-3 pb-3 empty:hidden"
        />
      </div>
    </div>
  )
}
