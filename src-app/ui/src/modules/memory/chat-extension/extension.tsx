import {
  type ChatExtension,
  createExtension,
} from '@/modules/chat/core/extensions'
import { MemoryStatusPill } from '@/modules/memory/chat-extension/components/MemoryStatusPill'
import { memoryRailContributions } from '@/modules/memory/chat-extension/describeActivity'

// Memory Extension (frontend chat-extension shim).
//
// The actual retrieval / extraction backend lives in
// modules/memory/{chat_extension,engine} on the server side. This
// extension is purely a UI hook: it registers a toolbar_status slot
// component (the per-conversation memory-mode pill, Plan §7 Phase 5).
// Auto-discovered by chat/extensions/index.ts via the
// import.meta.glob pattern over `../../*/chat-extension/extension.tsx`.
//
// No composeRequestFields needed — the backend memory bridge reads
// the per-conversation mode from `conversation_memory_settings`
// (migration 76) when assembling the prompt; the frontend pill
// writes via PUT /api/conversations/{id}/memory-mode.
const memoryExtension: ChatExtension = createExtension({
  name: 'memory',
  description: 'Per-conversation memory retrieval override pill',
  // Render late so the pill appears after the assistant / MCP chips
  // (existing chips use order 10 + 20; we use 30).
  priority: 90,

  slots: {
    toolbar_status: { component: MemoryStatusPill, order: 30 },
  },

  // Rail step descriptors for the remember/recall/forget tool family (ITEM-19).
  // Registered HERE rather than in a second extension: one module owns one
  // chat-extension, and the auto-discovery glob would otherwise pick up two
  // files claiming the name `memory`.
  railContributions: memoryRailContributions,

  // NO `afterStreamComplete` hook — deliberately.
  //
  // It used to call `Memories.load()` after every completed turn so the
  // (usually closed) /memories page would be fresh. That was redundant with the
  // notify-and-refetch contract and the live-UI audit measured it as an
  // `irrelevant` fetch on the compose-send flow: `GET /api/memories` on a page
  // that has no use for the memories domain.
  //
  // Freshness is unchanged, because it never depended on this hook:
  //   - the `Memories` store's `init` registers `on('sync:memory', reload)` +
  //     `on('sync:reconnect', reload)` (`memory/stores/memories/index.ts`), and
  //   - the server publishes `SyncEntity::Memory` from every write —
  //     `memory/engine/extractor.rs` (extract / update / delete) and
  //     `memory/reaper.rs` — i.e. from the SAME `after_llm_call` extraction this
  //     hook was trying to chase.
  // The hook's own comment already conceded that ("the sync:memory event
  // subscription handles eventual consistency"). Worse, it *instantiated* the
  // Memories store — running that `init` and its first `load()` — on the turns
  // of every user who never opens the page.
})

export default memoryExtension
