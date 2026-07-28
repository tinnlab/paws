import type {
  RailActivityContext,
  RailContribution,
  RailStepDescriptor,
} from '@/modules/chat/components/rail/railTypes'
import {
  countLabel,
  railToolStepBase,
  stringOf,
  structuredOf,
  toolUseOf,
} from '@/modules/chat/components/rail/railBlocks'

/**
 * The `agent` module's activity-rail contribution (ITEM-21).
 *
 * The six CORE META-TOOLS are not MCP tools at all: the agent loop injects them
 * into the model's tool list and handles them ITSELF, in-process, before the
 * approval gate and before `ToolProvider::call`
 * (`src-app/agent-core/src/core_tools.rs:44-75` — `CoreTool::from_name`).
 * Their names are reserved and UNPREFIXED:
 *
 * | tool | declared at |
 * |---|---|
 * | `delegate`      | `agent-core/src/core_tools.rs:37` (`DELEGATE_TOOL`) |
 * | `schedule_next` | `agent-core/src/core_tools.rs:41` (`SCHEDULE_NEXT_TOOL`) |
 * | `task_create`   | `agent-core/src/tasklist.rs:50` |
 * | `task_update`   | `agent-core/src/tasklist.rs:51` |
 * | `task_get`      | `agent-core/src/tasklist.rs:52` |
 * | `task_list`     | `agent-core/src/tasklist.rs:53` |
 *
 * `structured_content` per tool:
 * - `delegate`      → **None** (`core_tools.rs:446`)
 * - `schedule_next` → **None** (`core_tools.rs:380`)
 * - `task_create` / `task_update` / `task_list` → `{tasks: TaskItem[]}`
 *   (`tasklist.rs:281`, via `task_list_result`)
 * - `task_get`      → `{task: TaskItem}` (`tasklist.rs:296`)
 *
 * A `TaskItem` is `{id, content, active_form, status, owner?, deps?}` with
 * `status ∈ pending | in_progress | completed` (snake_case on the wire —
 * `agent-core/src/types.rs:206-230`).
 *
 * ITEM-6 is load-bearing here, not theoretical: `delegate` and `schedule_next`
 * emit NO structured content at all, so they MUST render as name-only rows.
 */

// ─────────────────────────────────────────────────────────────────────────────
// DE-DUPLICATION (ITEM-21) — which of the two producers we suppressed, and why.
//
// `task_create` / `task_update` change the agent's task list, and the backend
// reports that change TWICE:
//
//   (a) the persisted tool call — a `tool_use` + `tool_result` pair on the
//       assistant message, whose `structured_content` is `{tasks: [...]}`
//       (`tasklist.rs::task_list_result`);
//   (b) the live `taskListChanged` SSE frame carrying the SAME full snapshot
//       (`AgentEvent::TaskListChanged { run_id, items }` →
//       `chat/agent_host/event_sink.rs:182-189`).
//
// **We suppress (b): the SSE frame is NEVER turned into a rail step.** This
// module registers no rail contribution and no `RailLiveSource` for it. Reasons,
// in order of weight:
//
//   1. The frame carries NEITHER a `message_id` NOR a `tool_use_id`
//      (`SSEChatStreamTaskListChangedData` is `{run_id, items}`), so it cannot
//      key a step: DEC-8 makes `tool_use_id` the rail's step identity, and a
//      frame-derived row would have to invent one — and would then stack a new
//      row on every snapshot instead of updating one.
//   2. It is EPHEMERAL by construction: `event_sink.rs` publishes it with
//      `publish_raw_event`, deliberately OUTSIDE the per-conversation content
//      replay buffer, and the frontend `TaskListStore` documents itself as
//      non-durable across reload. A rail whose step count changed on reload
//      would break the "audit any step" job the rail exists to serve.
//   3. It is already surfaced, losslessly and by its owner: the frame feeds
//      `chat/extensions/task-list/` → `TaskListStore` → the `message_footer`
//      slot's live checklist. Re-describing it as a rail step would duplicate
//      that surface, not add to it.
//
// The persisted tool call (a) therefore remains the SOLE step producer, and any
// live information about it reaches the rail through the core-owned live-step
// seam (`chat/core/rail/liveSteps.ts`), which merges INTO the existing step by
// `tool_use_id` rather than creating a second one. `describeActivity.test.ts`
// pins exactly that: a `task_update` whose live snapshot also arrives yields ONE
// step, not two.
// ─────────────────────────────────────────────────────────────────────────────

/** Domain labels, keyed by the RAW meta-tool name. */
const LABELS: Record<string, string> = {
  delegate: 'Delegating to sub-agents',
  schedule_next: 'Scheduling its next run',
  task_create: 'Adding a task',
  task_update: 'Updating the task list',
  task_get: 'Reading a task',
  task_list: 'Reviewing the task list',
}

/** A `TaskItem` as it appears in `structured_content` (only what the row uses). */
interface WireTaskItem {
  content?: unknown
  active_form?: unknown
  status?: unknown
}

function taskItems(sc: Record<string, unknown> | null): WireTaskItem[] | null {
  if (!sc) return null
  const raw = sc.tasks
  if (!Array.isArray(raw)) return null
  return raw.filter(
    (t): t is WireTaskItem => !!t && typeof t === 'object' && !Array.isArray(t),
  )
}

/** "3 of 7 done" — or a bare count when nothing is completed yet. */
function progressDetail(items: WireTaskItem[]): string {
  if (items.length === 0) return 'no tasks'
  const done = items.filter(t => t.status === 'completed').length
  const active = items.find(t => t.status === 'in_progress')
  const activeLabel =
    typeof active?.active_form === 'string' && active.active_form.trim()
      ? active.active_form.trim()
      : null
  const progress = `${done} of ${items.length} done`
  return activeLabel ? `${activeLabel} · ${progress}` : progress
}

/** Number of children a `delegate` call requested, from its INPUT. */
function delegateChildCount(ctx: RailActivityContext): number | null {
  const input = toolUseOf(ctx.content)?.input
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const children = (input as Record<string, unknown>).children
  return Array.isArray(children) ? children.length : null
}

/** What a `schedule_next` call asked for, from its INPUT. */
function scheduleDetail(ctx: RailActivityContext): string | null {
  const input = toolUseOf(ctx.content)?.input
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const obj = input as Record<string, unknown>
  if (obj.stop === true) return 'finished — will not run again'
  const delay = obj.delay_seconds
  if (typeof delay === 'number' && Number.isFinite(delay) && delay >= 0) {
    return delay >= 60
      ? `in ~${Math.round(delay / 60)} min`
      : `in ~${Math.round(delay)}s`
  }
  return 'as soon as allowed'
}

export function describeAgentActivity(
  ctx: RailActivityContext,
): RailStepDescriptor | null {
  const base = railToolStepBase(ctx)
  if (!base) return null
  const label = LABELS[base.label]
  if (!label) return null

  // Core meta-tools are intercepted BEFORE the approval gate, so they should
  // never be `pending-approval` — but the live seam is the authority on status,
  // so honour it rather than assuming (INV-3 costs nothing here).
  const blocking = base.status === 'pending-approval'
  const sc = structuredOf(ctx)
  let detail: string | null = null

  switch (base.label) {
    // ── the two NO-structured-content tools (ITEM-6's real cases) ──
    case 'delegate': {
      const n = delegateChildCount(ctx)
      detail = n === null ? null : countLabel(n, 'sub-agent')
      break
    }
    case 'schedule_next':
      detail = scheduleDetail(ctx)
      break

    // ── the task tools ──
    case 'task_create':
    case 'task_update':
    case 'task_list': {
      const items = taskItems(sc)
      detail = items === null ? null : progressDetail(items)
      break
    }
    case 'task_get': {
      const task = sc?.task
      detail =
        task && typeof task === 'object' && !Array.isArray(task)
          ? stringOf(task as Record<string, unknown>, 'content', 'active_form')
          : null
      break
    }
  }

  return { ...base, label, blocking, ...(detail ? { detail } : {}) }
}

/**
 * Order 40 — ahead of `mcp`'s generic fallback (1000). The meta-tools are
 * unprefixed by design (MCP tools are namespaced `server__tool`, so there is no
 * collision — `core_tools.rs:24`, DEC-11), which is why matching on the bare name
 * is safe.
 */
export const agentRailContributions: RailContribution[] = [
  {
    contentTypes: ['tool_use'],
    order: 40,
    describeActivity: describeAgentActivity,
    // `renderDetail` omitted → the rail delegates to `renderContent({content})`.
  },
]
