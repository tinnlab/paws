import { Bot, Check, ChevronRight } from 'lucide-react'
import { Permissions } from '@/api-client/permissions'
import { usePermission } from '@/core/permissions'
import { newChatAssistantKey } from '@/modules/assistant/stores'
import { useChatPaneOrNull } from '@/modules/chat/core/pane/ChatPaneContext'
import { usePlusDropdown } from '@/modules/chat/components/PlusDropdownContext'
import { PlusMenuItem } from '@/modules/chat/components/PlusMenuItem'
import {
  ComposerPickerPopover,
  type ComposerPickerItem,
} from '@/modules/chat/components/ComposerPickerPopover'
import { AssistantPicker } from '@/modules/assistant/stores/assistantPicker'
import { Chat } from '@/modules/chat/core/stores/chatBridge'

/** Sentinel id for the "No assistant" clear row (never a real assistant id). */
const CLEAR_ID = '__no_assistant__'

/**
 * AssistantMenuItem — the "+" dropdown row for choosing this conversation's assistant.
 *
 * Single-SELECT: activating a row selects it and closes the "+" dropdown. All of the
 * popover shell — bounded width, the capped + overlay-scrolled list, the search box,
 * the keyboard model — lives in `ComposerPickerPopover`; this file supplies data.
 */
export function AssistantMenuItem() {
  // Permission gate (layer 4) — mirrors KbMenuItem. Without `assistants::read`
  // the picker's store never loads anything (it self-gates), so an ungated menu
  // item would render forever as a dead end ("No assistants available") for a
  // user who also has no Settings -> Assistants page to populate it from.
  const canRead = usePermission(Permissions.AssistantsRead)
  // Per-conversation selection (ITEM-5): the picker store keys the selected
  // assistant by conversation/pane, so `selectedAssistantId` is derived below
  // from `selectedByConversation[key]`, not read globally off the store.
  const { availableAssistants, selectedByConversation, selectAssistant, clearAssistant, loading } =
    AssistantPicker
  const { close } = usePlusDropdown()
  // Key by THIS pane's conversation (bridge-resolved). (ITEM-5)
  const pane = useChatPaneOrNull()
  const key = Chat.conversation?.id ?? newChatAssistantKey(pane?.paneId)
  const selectedAssistantId = selectedByConversation[key]

  const selectedAssistant = availableAssistants.find((a: any) => a.id === selectedAssistantId)

  if (!canRead) return null

  const handleSelect = (item: ComposerPickerItem) => {
    if (item.id === CLEAR_ID) clearAssistant(key)
    else selectAssistant(key, item.id)
    close()
  }

  const items: ComposerPickerItem[] = [
    // The clear row only exists once there is something to clear.
    ...(selectedAssistantId
      ? [
          {
            id: CLEAR_ID,
            label: 'No assistant',
            testId: 'assistant-option-none',
            leading: <Check aria-hidden className="size-4 shrink-0 opacity-0" />,
            separatorAfter: true,
            // An ACTION, not a choice: it must stay reachable while a query is
            // active, or a user who types to find an assistant can no longer clear
            // the current one without first clearing the query.
            pinned: true,
          },
        ]
      : []),
    ...availableAssistants.map((assistant: any) => ({
      id: assistant.id as string,
      label: assistant.name as string,
      testId: `assistant-option-${assistant.id}`,
      leading: (
        <Check
          aria-hidden
          className={`size-4 shrink-0 ${assistant.id === selectedAssistantId ? 'opacity-100' : 'opacity-0'}`}
        />
      ),
    })),
  ]

  const selectedIds = selectedAssistantId ? new Set([selectedAssistantId]) : undefined

  return (
    <ComposerPickerPopover
      data-testid="assistant-menu-options"
      trigger={
        <PlusMenuItem
          data-testid="assistant-menu-trigger"
          aria-label="Select assistant"
          icon={<Bot />}
          label={
            loading && availableAssistants.length === 0
              ? 'Loading assistants…'
              : selectedAssistant
                ? selectedAssistant.name
                : 'Select assistant'
          }
          trailing={<ChevronRight className="size-3 opacity-45" />}
        />
      }
      items={items}
      selectedIds={selectedIds}
      onSelect={handleSelect}
      closeOnSelect
      searchLabel="Search assistants"
      searchPlaceholder="Filter assistants…"
      noMatchesText="No matches."
      emptyContent={
        // Distinguish "still loading" from "you have none" — the trigger row above
        // already says "Loading assistants…", and a panel reading "No assistants
        // available" in the same frame contradicts it.
        <div className="px-2 py-2 text-sm text-muted-foreground">
          {loading ? 'Loading assistants…' : 'No assistants available'}
        </div>
      }
    />
  )
}
