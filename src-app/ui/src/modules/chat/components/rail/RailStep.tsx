import { useEffect, useId, useState, type ReactNode } from 'react'
import { Button, Text } from '@ziee/kit'
import { ChevronRight, FileText, PanelRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ToolStatusIcon } from '@/modules/chat/core/ToolStatusIcon'
import {
  useMessageViewStateStore,
  MessageViewState as MessageViewStateStore,
  type MessageViewFullState,
} from '@/modules/chat/core/stores/messageViewState'
import { Chat } from '@/modules/chat/core/stores/chatBridge'
import { useChatPaneOrNull } from '@/modules/chat/core/pane/ChatPaneContext'
import type { RailStepDescriptor } from '@/modules/chat/components/rail/railTypes'
import {
  clampLabel,
  splitArtifacts,
  stepAccessibleName,
  stepStateKey,
  stepTiming,
  toolCallTabId,
} from '@/modules/chat/components/rail/railView'

/** Re-render cadence for a RUNNING step's elapsed timer (DEC-9). */
const TICK_MS = 1000

/**
 * The rail's ROW PRIMITIVE (ITEM-3) — the one place a step is styled.
 *
 * Exported from the chat host and consumed by the rail only; contributions
 * never style a row, exactly as `CollapsibleBlock` / `PlusMenuItem` are host
 * primitives that extensions consume rather than restyle. Its predecessor and
 * visual twin is `workflow/components/run/AgentActivityTimeline`'s `ActivityRow`
 * (icon + line + status + "Show details"); that component is being pointed at
 * the same registry by ITEM-23, so the two stop diverging.
 *
 * INV-8: the label is `truncate` inside a `min-w-0` flex child and the row never
 * wraps, so at 390px the label ellipsises and the row stays one line.
 */
export function RailStep({
  step,
  messageId,
  detail,
  showSpine,
  isLast,
}: {
  step: RailStepDescriptor
  /** Stable message id — the per-message view-state key (INV-7). */
  messageId: string
  /** The owning extension's inline detail body, already resolved by the rail. */
  detail: ReactNode
  /** Draw the vertical timeline spine (suppressed for a lone quiet step, DEC-3). */
  showSpine: boolean
  isLast: boolean
}) {
  const key = stepStateKey(messageId, step.key)
  // Scoped selector — subscribe to THIS step's flag only, so expanding one row
  // doesn't re-render every other mounted rail (the same discipline
  // `InlineFilePreview` applies to its per-file entry).
  const open =
    useMessageViewStateStore((s: MessageViewFullState) => s.steps[key]) ?? false

  // Tick only while this step is actually running; a settled row schedules
  // nothing (a persisted transcript must not hold a timer per historical call).
  const running = step.status === 'running' || step.status === 'pending-approval'
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running || !step.startedAt || step.durationMs != null) return
    const t = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(t)
  }, [running, step.startedAt, step.durationMs])

  const chat = (useChatPaneOrNull()?.store ?? Chat) as typeof Chat
  const bodyId = `rail-step-body-${useId()}`

  const timing = stepTiming(step, now)
  const label = clampLabel(step.label)
  const { shown, overflow } = splitArtifacts(step.artifacts)
  const hasDetail = detail != null

  const openRecord = () => {
    if (!step.toolUseId) return
    void chat.displayInRightPanel({
      id: toolCallTabId(step.toolUseId),
      title: label,
      type: 'tool_call',
      data: { toolUseId: step.toolUseId, messageId, toolName: step.label },
    })
  }

  return (
    <div
      className="relative flex flex-col"
      data-testid="rail-step"
      data-step-key={step.key}
      data-status={step.status}
    >
      <div className="flex items-center gap-2 min-w-0 py-0.5">
        {/* Spine + node. The spine is a border on a fixed-width rail column so
            it aligns with the icon centre at every row height. */}
        {showSpine && (
          <span
            aria-hidden
            className={cn(
              'absolute start-[7px] w-px bg-border',
              isLast ? 'top-0 h-3' : 'top-0 -bottom-0.5',
            )}
          />
        )}
        <span className="relative z-10 flex size-4 shrink-0 items-center justify-center bg-background">
          <ToolStatusIcon status={step.status} />
        </span>

        {/* The disclosure is a control; the LABEL is not.
            They used to be one Button, which meant a step with no expandable
            body (every card-owning family while its call is still running)
            rendered its primary text at `disabled:opacity-50`, out of the tab
            order, with `pointer-events-none` killing the `title` tooltip that
            INV-8's truncation relies on — de-emphasising exactly the in-flight
            rows the rail exists to narrate. Never put non-control content inside
            a disabled control. */}
        {hasDetail ? (
          <Button
            size="icon"
            variant="ghost"
            className="size-5 shrink-0"
            tooltip={open ? 'Hide details' : 'Show details'}
            aria-expanded={open}
            aria-controls={bodyId}
            aria-label={stepAccessibleName(step, timing)}
            onClick={() => MessageViewStateStore.setStepOpen(key, !open)}
            data-testid="rail-step-toggle"
            icon={
              <ChevronRight
                className={cn('transition-transform', open && 'rotate-90')}
              />
            }
          />
        ) : (
          <span aria-hidden className="size-5 shrink-0" />
        )}

        {/* Label + detail as ONE non-wrapping unit. `min-w-0` lets the flex child
            shrink below its content width so `truncate` can engage (INV-8). */}
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <span
            className="min-w-0 truncate text-sm text-foreground"
            data-testid="rail-step-label"
            title={label}
          >
            {label}
          </span>
          {step.detail && (
            <span
              className="hidden min-w-0 truncate text-xs text-muted-foreground sm:inline"
              data-testid="rail-step-detail"
            >
              {step.detail}
            </span>
          )}
        </span>

        {/* Timing drops below 360px (ITEM-26) so the label keeps the width. */}
        {timing && (
          <Text
            type="secondary"
            className="ms-auto hidden shrink-0 text-xs tabular-nums min-[360px]:block"
            data-testid="rail-step-timing"
          >
            {timing}
          </Text>
        )}

        {step.toolUseId && (
          <Button
            size="icon"
            variant="ghost"
            className="size-6 shrink-0"
            tooltip="Open full record"
            aria-label={`Open full record for ${label}`}
            icon={<PanelRight />}
            onClick={openRecord}
            data-testid="rail-step-record-btn"
          />
        )}
      </div>

      {/* Artifact chips: files the step produced, reachable without expanding. */}
      {shown.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 ps-6 pb-0.5" data-testid="rail-step-artifacts">
          {/* A chip names a file the step produced, so it READS as actionable and
              therefore must BE actionable — by mouse and by keyboard. Activating
              one opens the step body, which is where the owning extension's own
              interactive file view (preview / open / download) is rendered. The
              rail deliberately does not open the file itself: that would mean
              core knowing which extension owns file viewing (INV-1). */}
          {shown.map(a => (
            <Button
              key={a.key}
              variant="ghost"
              className="h-auto max-w-[12rem] gap-1 rounded-sm bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground"
              aria-label={`Show ${a.name}`}
              onClick={() => MessageViewStateStore.setStepOpen(key, true)}
              data-testid="rail-step-artifact"
              icon={<FileText />}
            >
              <span className="truncate">{a.name}</span>
            </Button>
          ))}
          {overflow > 0 && (
            <Button
              variant="ghost"
              className="h-auto px-1 py-0.5 text-xs font-normal text-muted-foreground"
              aria-label={`Show ${overflow} more file${overflow === 1 ? '' : 's'}`}
              onClick={() => MessageViewStateStore.setStepOpen(key, true)}
              data-testid="rail-step-artifact-overflow"
            >
              {`+${overflow}`}
            </Button>
          )}
        </div>
      )}

      {/* Level-1 detail: the OWNING extension's body, rendered by the rail but
          authored by the contribution (ITEM-11). */}
      {open && hasDetail && (
        <div id={bodyId} className="ps-6 pb-1 pt-0.5" data-testid="rail-step-body">
          {detail}
        </div>
      )}
    </div>
  )
}
