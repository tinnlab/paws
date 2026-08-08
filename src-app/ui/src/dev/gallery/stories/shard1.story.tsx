/**
 * Shard 1 kit/component stories (parallel gap grind). OWNED BY SHARD 1 ONLY.
 * Add `GalleryStory` objects for kit-component state gaps (loading/empty/error
 * variants rendered on the browse canvas). Prefix every story id and case
 * data-testid with `s1-` so they never collide. Do NOT edit stories/index.ts
 * (integrator-owned aggregator) — it already imports this file.
 */
import type { GalleryStory } from '../story'
import { ComposerPickerPanel } from '@/modules/chat/components/ComposerPickerPopover'

/**
 * Composer picker panel — the scale + filter states.
 *
 * The panel is rendered DIRECTLY (not through its Popover): a story must not open
 * an overlay on mount, because the browse canvas mounts every story at once and a
 * portalled popup would sit over the whole page (see `overlays.story.tsx`).
 *
 * 26 entries, not 3 — a short list would not exercise the 256px height cap or the
 * overlayscrollbars viewport at all, and the whole point of this surface is what
 * happens at scale. One entry carries a pathologically long name so the width cap
 * and row truncation are visible in the same shot.
 */
const LONG_ENTRY_LABEL =
  'A knowledge base with a deliberately very long name that must truncate inside the row instead of widening the whole popover panel'

const pickerItems = Array.from({ length: 26 }, (_, i) => ({
  id: `s1-picker-${i}`,
  label: i === 0 ? LONG_ENTRY_LABEL : `Knowledge base ${String(i).padStart(2, '0')}`,
}))

const noop = () => undefined

const composerPickerStory: GalleryStory = {
  id: 's1-composer-picker',
  title: 'Composer picker panel',
  note: '26 entries (height cap + overlay scrollbar), long-name truncation, filtered, no-matches, nothing-configured',
  cases: [
    {
      key: 'populated',
      label: 'Populated (26) — capped + scrolls',
      render: () => (
        <ComposerPickerPanel
          data-testid="s1-picker-populated"
          items={pickerItems}
          selectedIds={new Set(['s1-picker-3'])}
          onSelect={noop}
          searchLabel="Search knowledge bases"
          searchPlaceholder="Filter knowledge bases…"
          emptyContent={null}
        />
      ),
    },
    {
      key: 'filtered',
      label: 'Filtered — a live query',
      render: () => (
        <ComposerPickerPanel
          data-testid="s1-picker-filtered"
          items={pickerItems}
          onSelect={noop}
          defaultQuery="base 1"
          searchLabel="Search knowledge bases"
          searchPlaceholder="Filter knowledge bases…"
          emptyContent={null}
        />
      ),
    },
    {
      key: 'no-matches',
      label: 'No matches — a real state, not a blank panel',
      render: () => (
        <ComposerPickerPanel
          data-testid="s1-picker-no-matches"
          items={pickerItems}
          onSelect={noop}
          defaultQuery="zzzzz-no-such-entry"
          searchLabel="Search knowledge bases"
          searchPlaceholder="Filter knowledge bases…"
          emptyContent={null}
        />
      ),
    },
    {
      key: 'nothing-configured',
      label: 'Nothing configured yet — caller CTA, no search box',
      render: () => (
        <ComposerPickerPanel
          data-testid="s1-picker-empty"
          items={[]}
          onSelect={noop}
          searchLabel="Search knowledge bases"
          searchPlaceholder="Filter knowledge bases…"
          emptyContent={
            <div className="px-2 py-2 text-sm text-muted-foreground">
              No knowledge bases yet — create one →
            </div>
          }
        />
      ),
    },
  ],
}

export const shard1Stories: GalleryStory[] = [composerPickerStory]
