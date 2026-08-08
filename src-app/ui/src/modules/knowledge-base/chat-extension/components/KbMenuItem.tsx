import { useNavigate } from 'react-router-dom'
import { message } from '@ziee/kit'
import { BookOpen, Check, ChevronRight } from 'lucide-react'
import { type KnowledgeBase } from '@/api-client/types'
import { Permissions } from '@/api-client/permissions'
import { usePermission } from '@/core/permissions'
import { kbKey } from '@/modules/knowledge-base/stores/kbSelectionKey'
import { useChatPaneOrNull } from '@/modules/chat/core/pane/ChatPaneContext'
import { PlusMenuItem } from '@/modules/chat/components/PlusMenuItem'
import {
  ComposerPickerPopover,
  type ComposerPickerItem,
} from '@/modules/chat/components/ComposerPickerPopover'
import { KnowledgeBases } from '@/modules/knowledge-base/stores/knowledgeBases'
import { KnowledgeBaseComposer } from '@/modules/knowledge-base/stores/knowledgeBaseComposer'
import { Chat } from '@/modules/chat/core/stores/chatBridge'

const EMPTY_SET: ReadonlySet<string> = new Set()

/** Compact per-KB status suffix for a picker row (from indexing_summary). */
function statusSuffix(kb: KnowledgeBase): { text: string; className: string } | null {
  const s = kb.indexing_summary
  if (s.failed > 0) return { text: `${s.failed} failed`, className: 'text-destructive' }
  if (s.indexing + s.pending > 0)
    return { text: `${s.indexing + s.pending} indexing`, className: 'text-muted-foreground' }
  if (s.total === 0) return { text: 'empty', className: 'text-muted-foreground' }
  return null
}

/**
 * KbMenuItem — the "+" dropdown row for grounding the conversation on knowledge
 * bases. Opens a submenu listing the user's KBs; each row TOGGLES attach/detach.
 *
 * Multi-SELECT, so activating a row deliberately does NOT close the "+" dropdown
 * (that asymmetry with the assistant item is why closing is the caller's call, not
 * the primitive's). Shows per-KB index status, and — when the user has no KBs —
 * links to /knowledge instead of hiding. The popover shell (bounded width, capped +
 * overlay-scrolled list, always-present search, keyboard model) is
 * `ComposerPickerPopover`; the previous `kbs.length > 6` search threshold is gone.
 */
export function KbMenuItem() {
  const navigate = useNavigate()
  const canUse = usePermission(Permissions.KnowledgeBaseUse)
  const { items } = KnowledgeBases
  // Per-pane (ITEM-46/51): this pane's own conversation's selection — and, for a
  // new chat, this pane's OWN pending buffer (kbKey(null, paneId)) — resolved from
  // the pane's own store, so a pending selection here never leaks into another pane.
  const { selectionByConversation } = KnowledgeBaseComposer
  const pane = useChatPaneOrNull()
  const chat = (pane?.store ?? Chat) as typeof Chat
  const paneId = pane?.paneId ?? null
  const convId = chat.conversation?.id ?? null
  const selectedKbIds = selectionByConversation.get(kbKey(convId, paneId)) ?? EMPTY_SET

  if (!canUse) return null

  const kbs = Array.from(items.values())

  const toggle = (id: string) => {
    const p = selectedKbIds.has(id)
      ? KnowledgeBaseComposer.detachFor(convId, id, paneId)
      : KnowledgeBaseComposer.attachFor(convId, id, paneId)
    p.catch((e: unknown) =>
      message.error(e instanceof Error ? e.message : 'Failed to update knowledge bases'),
    )
  }

  const pickerItems: ComposerPickerItem[] = kbs.map(kb => {
    const active = selectedKbIds.has(kb.id)
    const status = statusSuffix(kb)
    return {
      id: kb.id,
      label: kb.name,
      testId: `kb-option-${kb.id}`,
      leading: (
        <Check aria-hidden className={`size-4 shrink-0 ${active ? 'opacity-100' : 'opacity-0'}`} />
      ),
      trailing: (
        <>
          {status && <span className={`shrink-0 text-xs ${status.className}`}>{status.text}</span>}
          <span className="shrink-0 text-xs text-muted-foreground">{kb.document_count}</span>
        </>
      ),
    }
  })

  return (
    <ComposerPickerPopover
      data-testid="kb-menu-options"
      trigger={
        <PlusMenuItem
          data-testid="kb-menu-trigger"
          aria-label="Knowledge bases"
          icon={<BookOpen />}
          label="Knowledge bases"
          trailing={<ChevronRight className="size-3 opacity-45" />}
        />
      }
      items={pickerItems}
      selectedIds={selectedKbIds}
      onSelect={item => toggle(item.id)}
      searchLabel="Search knowledge bases"
      searchPlaceholder="Filter knowledge bases…"
      noMatchesText="No matches."
      multiSelect
      emptyContent={
        // Empty → link to management, instead of a dead end.
        <div
          data-testid="kb-menu-empty"
          role="button"
          tabIndex={0}
          onClick={() => navigate('/knowledge')}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              navigate('/knowledge')
            }
          }}
          className="cursor-pointer rounded-md px-2 py-2 text-sm text-muted-foreground hover:bg-muted focus-visible:outline focus-visible:outline-2"
        >
          No knowledge bases yet — create one →
        </div>
      }
    />
  )
}
