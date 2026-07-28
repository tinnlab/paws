import { useId, useSyncExternalStore, type ReactNode } from 'react'
import { Button, Text } from '@ziee/kit'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ToolStatusIcon } from '@/modules/chat/core/ToolStatusIcon'
import { TOOL_STATUS } from '@/modules/chat/core/tool-status'
import {
  useMessageViewStateStore,
  MessageViewState as MessageViewStateStore,
  type MessageViewFullState,
} from '@/modules/chat/core/stores/messageViewState'
import { railLiveVersion, subscribeRailLive } from '@/modules/chat/core/rail/liveSteps'
import { RailStep } from '@/modules/chat/components/rail/RailStep'
import {
  deriveRailOpen,
  isQuietSingle,
  spanHasFailure,
  type PlacedRailStep,
} from '@/modules/chat/components/rail/railSegmentation'
import { railStateKey, railSummary } from '@/modules/chat/components/rail/railView'

/**
 * The ACTIVITY RAIL — a thin timeline BESIDE the answer, in place of a stack of
 * bordered boxes in front of it.
 *
 * Lifecycle (ITEM-7 / ITEM-9, INV-4 / INV-5):
 *  - open while the turn is working,
 *  - collapsed to one summary line once the answer exists,
 *  - user-toggleable thereafter,
 *  - FORCED open by a failed or timed-out step, which overrides a user collapse
 *    exactly as the retired group card's `deriveGroupOpen` overrode one for a
 *    pending approval. A red dot inside a collapsed summary is a silent failure.
 *
 * DEC-3/DEC-5: a span of ONE step renders as a single quiet line (no spine, no
 * summary, no collapse control) because that is 84% of tool-using messages and a
 * rail of one is ceremony; a long span renders EVERY step, uncapped, because any
 * cap risks hiding a failure.
 */
export function ActivityRail({
  steps: segmented,
  messageId,
  isStreaming,
  resolveStep,
  renderStepDetail,
}: {
  steps: PlacedRailStep[]
  messageId: string
  /** True while THIS turn is still streaming. */
  isStreaming: boolean
  /** Re-derives a step's descriptor at render time (status / timing / artifacts). */
  resolveStep: (step: PlacedRailStep) => PlacedRailStep['step']
  /** Resolves one step's inline detail body through the owning contribution. */
  renderStepDetail: (step: PlacedRailStep) => ReactNode
}) {
  // Re-render when a live step changes (a pending approval arriving, a call
  // finishing) even though no block was added to the message. Core owns the
  // seam; whichever extension owns the tool SSE frames feeds it.
  useSyncExternalStore(subscribeRailLive, railLiveVersion, railLiveVersion)

  // Re-derive the descriptors HERE, where the subscription is. The parent
  // (`ChatMessage`) is `memo`'d and subscribes to nothing, so a descriptor it
  // segmented would stay frozen at `running` for a call that finished without
  // adding a block to the message — which is the ordinary completion path.
  // Segmentation still owns the SHAPE (ITEM-5); this refreshes only the state.
  const steps = segmented.map(p => ({ index: p.index, step: resolveStep(p) }))

  // Keyed on the FIRST step (its `tool_use_id`), not this span's position, so a
  // rail the user opened cannot silently re-collapse when a new span appears
  // earlier in the same streaming turn (INV-7).
  const key = railStateKey(messageId, steps[0]?.step.key ?? '0')
  // `aria-controls` needs a real id on the region the toggle governs.
  const stepsId = `rail-steps-${useId()}`
  const userOpen = useMessageViewStateStore(
    (s: MessageViewFullState) => s.rails[key],
  )

  if (steps.length === 0) return null

  const hasFailure = spanHasFailure(steps)
  const quiet = isQuietSingle(steps)

  // A lone step is always visible — there is nothing to collapse, so INV-5 holds
  // trivially and DEC-3's "no ceremony" shape costs nothing.
  if (quiet) {
    const s = steps[0]
    return (
      <div className="w-full py-0.5" data-testid="activity-rail" data-rail-shape="single">
        <RailStep
          step={s.step}
          messageId={messageId}
          detail={renderStepDetail(s)}
          showSpine={false}
          isLast
        />
      </div>
    )
  }

  const open = deriveRailOpen({ isStreaming, hasFailure, userOpen })
  const summary = railSummary(steps)
  // A forced-open rail must not offer a control that appears to close it and
  // then doesn't — so the toggle is suppressed rather than made inert.
  const toggleable = !hasFailure && !isStreaming

  return (
    <div
      className="w-full"
      data-testid="activity-rail"
      data-rail-shape="rail"
      data-open={open ? '' : undefined}
      data-forced-open={hasFailure ? '' : undefined}
    >
      {/* When the rail is FORCED open (a failure, or a live turn) the summary is
          not a control at all — it is a status line. It must NOT be a disabled
          Button: the kit's base style is `disabled:opacity-50
          disabled:pointer-events-none`, which would render a FAILURE summary as
          the dimmest, unfocusable, tooltip-less element in the message. INV-5
          exists to make a failure loud; that would make it the quietest thing on
          screen. So the two states are two different elements. */}
      {toggleable ? (
        <Button
          variant="ghost"
          block
          onClick={() => MessageViewStateStore.setRailOpen(key, !open)}
          aria-expanded={open}
          aria-controls={stepsId}
          aria-label={`${TOOL_STATUS[summary.status].label}, activity: ${summary.text}`}
          data-testid="activity-rail-summary"
          className="h-auto min-w-0 justify-start gap-2 px-1 py-0.5 font-normal"
        >
          <ToolStatusIcon status={summary.status} />
          <Text type="secondary" className="min-w-0 truncate text-xs">
            {summary.text}
          </Text>
          <ChevronDown
            aria-hidden
            className={cn(
              'ms-auto size-3.5 shrink-0 text-muted-foreground transition-transform',
              open && 'rotate-180',
            )}
          />
        </Button>
      ) : (
        <div
          className="flex w-full min-w-0 items-center gap-2 px-1 py-0.5"
          data-testid="activity-rail-summary"
        >
          <ToolStatusIcon status={summary.status} />
          <Text type="secondary" className="min-w-0 truncate text-xs">
            {summary.text}
          </Text>
        </div>
      )}

      {open && (
        <div
          id={stepsId}
          className="relative flex flex-col ps-1 pt-0.5"
          data-testid="activity-rail-steps"
        >
          {steps.map((s, i) => (
            <RailStep
              key={s.step.key || `step:${i}`}
              step={s.step}
              messageId={messageId}
              detail={renderStepDetail(s)}
              showSpine
              isLast={i === steps.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  )
}
