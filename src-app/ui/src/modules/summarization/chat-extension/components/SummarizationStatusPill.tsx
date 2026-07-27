import { Shrink, FileText, EyeOff, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Tooltip, Tag, Dropdown, message } from '@ziee/kit'
import { ApiClient } from '@/api-client'
import { ConversationSummarization as ConversationSummarizationStore } from '@/modules/summarization/stores/conversationSummarization'
import { SummarizationAdmin as SummarizationAdminStore } from '@/modules/summarization/stores/summarizationAdmin'
import { Chat } from '@/modules/chat/core/stores/chatBridge'
import { isSessionCreatedConversation } from '@/core/sessionCreatedConversations'
import {
  shouldLoadSummaryOnOpen,
  type SummaryTriggerState,
} from '@/modules/summarization/chat-extension/summaryRefreshTrigger'

type Mode = 'inherit' | 'on' | 'off'

/**
 * SummarizationStatusPill — per-conversation summarization-mode pill
 * in the chat composer's `toolbar_status` slot. Mirrors
 * `MemoryStatusPill` (memory's per-conversation pill).
 *
 * Also acts as the **read-model driver** for the in-thread summary
 * marker: subscribes to `messages.size` + `conversation.id` and calls
 * `ConversationSummarizationStore.loadForConversation(id)`
 * on change. This load-bearing pattern rides cross-device freshness
 * transitively on `sync:conversation` — DO NOT move the trigger
 * elsewhere (audit lesson from the crashed-session redo).
 */
export function SummarizationStatusPill() {
  // Read every Stores.X.field at the TOP, before any conditional.
  // Each proxy access fires a useEffect; reading conditionally after
  // a guard triggers "Rendered more hooks than during the previous
  // render."
  const conversation = Chat.conversation
  const isStreaming = Chat.isStreaming
  const adminSettings = SummarizationAdminStore.settings
  const [mode, setMode] = useState<Mode>('inherit')
  const [loading, setLoading] = useState(false)

  // Per-conversation mode fetch. Soft-fails to 'inherit' on any error
  // (the pill stays interactive even if the read raced a switch).
  useEffect(() => {
    let cancelled = false
    if (!conversation?.id) {
      setMode('inherit')
      return
    }
    ;(async () => {
      try {
        const resp = await ApiClient.Conversation.getSummarizationMode({
          id: conversation.id,
        })
        if (!cancelled)
          setMode((resp.summarization_mode as Mode) ?? 'inherit')
      } catch {
        if (!cancelled) setMode('inherit')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [conversation?.id])

  // Drive the summary read-model for the OPEN / SWITCH case only — NOT per
  // message, which fired 3–4× per send for the ONE server-side write the
  // `after_llm_call` hook performs. The TURN-END read is owned by this
  // extension's `afterStreamComplete` hook (see `../extension.tsx`), which the
  // stream handler invokes exactly once per completed turn. The rationale for
  // both halves — and for why the transport-level in-flight coalescer cannot
  // cover this — is in `summaryRefreshTrigger.ts`.
  //
  // The trigger STAYS in this component (the audit lesson recorded in this
  // file's header): the pill is the read-model driver for
  // `SummaryBoundaryMarker`, and the turn-end hook lives in the same extension.
  useEffect(() => {
    const id = conversation?.id ?? null
    const next: SummaryTriggerState = {
      conversationId: id,
      streaming: isStreaming,
      createdInThisSession: id ? isSessionCreatedConversation(id) : false,
    }
    if (!next.conversationId) {
      ConversationSummarizationStore.clear()
      return
    }
    // Non-reactive snapshot read: this runs in an effect, and subscribing to the
    // store here would re-render the pill on its own load. "Held" covers both
    // the settled cache AND an in-flight read for the same id, so two mounts
    // inside one request window do not both fire.
    const snap = ConversationSummarizationStore.$
    const held =
      snap.current?.conversationId === next.conversationId ||
      (snap.loading && snap.requestedConversationId === next.conversationId)
    if (shouldLoadSummaryOnOpen(next, held ? next.conversationId : null)) {
      void ConversationSummarizationStore.loadForConversation(next.conversationId)
    }
  }, [conversation?.id, isStreaming])

  if (!conversation?.id) return null
  // Known cross-cutting limitation (mirrors MemoryStatusPill): for
  // non-admins, `adminSettings` stays null because
  // `SummarizationAdmin.__init__.settings` is self-gated on
  // `summarization::settings::read`. So `null?.enabled === false` is
  // false, and the pill shows for non-admins even when the admin
  // disabled summarization deployment-wide. The deeper fix is a
  // public-readable `enabled` flag served alongside `/auth/me`;
  // tracked with memory as a single follow-up so the two pills don't
  // drift apart in the meantime.
  if (adminSettings?.enabled === false) return null

  // Per-conversation mode is fetched on `conversation.id` change above.
  // It deliberately has NO `sync:conversation` subscription: toggling
  // mode on device A is not visible on device B until next conv switch
  // or `messages.size` change. This matches the backend (the PUT
  // handler emits no Conversation sync event — same shape as memory's
  // memory-mode endpoint).

  async function setRemote(next: Mode) {
    if (!conversation?.id) return
    setLoading(true)
    try {
      await ApiClient.Conversation.setSummarizationMode({
        id: conversation.id,
        summarization_mode: next,
      })
      setMode(next)
      message.success(`Summarization: ${next} for this conversation`)
    } catch (e: any) {
      message.error(e?.message ?? 'Failed to update summarization mode')
    } finally {
      setLoading(false)
    }
  }

  const items = [
    {
      key: 'inherit',
      label: 'Inherit (follow deployment setting)',
      icon: <Shrink />,
    },
    { key: 'on', label: 'Always summarize this conversation', icon: <FileText /> },
    {
      key: 'off',
      label: 'Never summarize this conversation',
      icon: <EyeOff />,
    },
  ]

  const labelByMode: Record<Mode, string> = {
    inherit: 'Summary: auto',
    on: 'Summary: on',
    off: 'Summary: off',
  }
  const toneByMode: Record<Mode, Parameters<typeof Tag>[0]['tone']> = {
    inherit: undefined,
    on: 'success',
    off: 'error',
  }

  return (
    <Tooltip content="Per-conversation summarization override">
      <Dropdown
        data-testid="summ-mode-dropdown"
        items={items}
        onSelect={(key) => setRemote(key as Mode)}
        disabled={loading}
        nativeButton={false}
      >
        <Tag variant="outline"
          data-testid="summ-mode-tag"
          tone={toneByMode[mode]}
          icon={
            loading ? (
              <Loader2 className="animate-spin" />
            ) : mode === 'off' ? (
              <EyeOff />
            ) : (
              <Shrink />
            )
          }
          aria-label={`Summarization override: ${labelByMode[mode]}`}
          className="cursor-pointer m-0"
        >
          {labelByMode[mode]}
        </Tag>
      </Dropdown>
    </Tooltip>
  )
}
