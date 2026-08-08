import {
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react'
import { Input, Popover, ScrollArea } from '@ziee/kit'
import { Search } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * The composer "+" submenu picker — ONE shell for every list-style item in the
 * chat composer's "+" dropdown.
 *
 * Realizes `docs/design/composer-picker-popover.md`. Before it, the assistant and
 * knowledge-base items each hand-rolled the same popover, the same
 * `style={{ minWidth, margin: -4 }}` content box and the same row markup, and
 * NEITHER bounded its width or height or (for assistants) offered a search box —
 * so one long name stretched the panel across the chat column and twenty entries
 * ran off the viewport with no way to reach the bottom.
 *
 * The three promises this component owns, and how:
 *
 *  - **bounded width** — the panel is `w-auto` between `min-w-60` and `max-w-80`
 *    (240–320px). A long label is absorbed by the ROW (`min-w-0 flex-1 truncate`,
 *    full text kept in `title` so it stays recoverable), never by the panel.
 *  - **bounded height + overlay scrollbar** — the list lives in the app's
 *    overlayscrollbars `ScrollArea` capped at `max-h-64` (256px), copying the
 *    in-popover recipe at `sdk/packages/kit/src/kit/dropdown.tsx`. Deliberately NOT
 *    a native `overflow-y-auto` (see `scripts/lint-native-scroll.mjs`).
 *  - **search on top** — always rendered (suppressed only when the caller has zero
 *    items, where there is nothing to search). Its predecessor showed the box only
 *    above six knowledge bases, which both hid it exactly when the list was still
 *    unusable and stranded a stale query when the list shrank back.
 *
 * Keyboard model is the ARIA 1.2 combobox/listbox pattern already used by the kit's
 * `MultiSelect`: the search input keeps focus and owns `aria-activedescendant`, the
 * list is a `listbox` of `option`s, arrows wrap, Home/End jump, Enter activates, and
 * Escape closes ONLY this submenu — its propagation is stopped so the parent "+"
 * dropdown survives (a submenu that dismissed its parent would lose the user's place).
 *
 * Callers stay declarative: they pass DATA (`ComposerPickerItem[]` with optional
 * `leading`/`trailing` adornments) and a select handler. They must NOT read a store
 * proxy inside those adornments — reactive proxy reads are hooks in this codebase and
 * these render inside a `.map()`.
 */

/** Panel width bounds — kept as one named constant so the two callers cannot drift. */
const PICKER_PANEL_CLASSES = 'flex w-auto min-w-60 max-w-80 flex-col gap-2 p-2'
/**
 * List height cap (256px). Matches the caps the kit's own `ComboboxList` /
 * `MultiSelect` use, so every list-in-a-popover in the app agrees.
 */
const PICKER_LIST_MAX_H = 'max-h-64'
/** Neutralizes the kit popup's own `w-72` / `p-2.5` / `gap-2.5` so the panel owns them. */
const PICKER_POPUP_CLASSES = 'w-auto max-w-none gap-0 p-0'

export interface ComposerPickerItem {
  /** Stable identity; also what `onSelect` hands back. */
  id: string
  /** The searchable, truncatable text. */
  label: string
  /** Per-row test selector (e.g. `kb-option-<uuid>`); derived by the caller. */
  testId?: string
  /** Leading adornment — a selection check, an icon. */
  leading?: ReactNode
  /** Trailing metadata — an index-status suffix, a document count. */
  trailing?: ReactNode
  /** Renders a divider under this row (used for the assistant "No assistant" row). */
  separatorAfter?: boolean
  /**
   * Never filtered out. For rows that are an ACTION rather than a choice — the
   * assistant picker's "No assistant" clear row — which must stay reachable while a
   * query is active (otherwise a user with 26 assistants who types to find one can no
   * longer clear the selection without first clearing the query).
   */
  pinned?: boolean
}

export interface ComposerPickerPanelProps {
  items: readonly ComposerPickerItem[]
  /** Ids rendered as `aria-selected` — a set so multi-select callers are natural. */
  selectedIds?: ReadonlySet<string>
  onSelect: (item: ComposerPickerItem) => void
  /** Called when the user dismisses with Escape. */
  onDismiss?: () => void
  /** Accessible name for the search box (required — the caller owns i18n). */
  searchLabel: string
  searchPlaceholder: string
  /**
   * Shown when the filter excludes everything (required — the caller owns i18n).
   * This is the string a filtering UI shows most often; hardcoding it here would
   * make it the one string the caller could not translate.
   */
  noMatchesText: string
  /** Several rows may be selected at once (the KB picker). Drives `aria-multiselectable`. */
  multiSelect?: boolean
  /** Rendered INSTEAD of the search box + list when `items` is empty. */
  emptyContent: ReactNode
  /**
   * Initial filter text. The query is otherwise uncontrolled; this exists so the
   * gallery can render the FILTERED and NO-MATCHES states deterministically (they
   * are reachable only through typing, which a mount-only screenshot cannot do).
   * Production callers leave it unset.
   */
  defaultQuery?: string
  /** Container test selector; sub-elements derive `${id}-search` / `${id}-no-matches`. */
  'data-testid': string
}

/**
 * The picker's presentational body. Exported separately from the popover so it can be
 * mounted (and screenshot in the gallery) without a portal — the popover is what makes
 * a component untestable in jsdom, not the list.
 */
export function ComposerPickerPanel({
  items,
  selectedIds,
  onSelect,
  onDismiss,
  searchLabel,
  searchPlaceholder,
  noMatchesText,
  multiSelect,
  emptyContent,
  defaultQuery = '',
  'data-testid': testId,
}: ComposerPickerPanelProps) {
  const [query, setQuery] = useState(defaultQuery)
  const [activeIndex, setActiveIndex] = useState(0)
  const listRef = useRef<HTMLDivElement | null>(null)
  const baseId = useId()
  const listId = `${baseId}-list`
  const optionId = useCallback((index: number) => `${baseId}-opt-${index}`, [baseId])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter(item => item.pinned || item.label.toLowerCase().includes(q))
  }, [items, query])

  // Derived, not stored: the filter can shrink the list under the stored index at any
  // keystroke, so clamping here keeps `aria-activedescendant` pointing at a row that
  // actually exists without an effect that lags a render behind.
  const active = filtered.length === 0 ? -1 : Math.min(activeIndex, filtered.length - 1)
  const hasResults = filtered.length > 0

  const moveActive = useCallback(
    (next: number) => {
      setActiveIndex(next)
      // getElementById, NOT a `#id` querySelector: `useId()` ids contain characters
      // that are not valid bare CSS selectors, and `CSS.escape` does not exist in
      // jsdom (nor in every browser we claim to support).
      const el = listRef.current?.ownerDocument.getElementById(optionId(next))
      // jsdom has no layout and no scrollIntoView; guard rather than crash.
      el?.scrollIntoView?.({ block: 'nearest' })
    },
    [optionId],
  )

  const activate = useCallback(
    (item: ComposerPickerItem | undefined) => {
      if (!item) return
      onSelect(item)
    },
    [onSelect],
  )

  const onSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    // While an IME candidate window is open, Escape dismisses the CANDIDATE and Enter
    // COMMITS it — neither is a picker action. Base UI's own dismiss guards this the
    // same way; since this handler stopPropagation()s Escape, that guard would never
    // run, so it has to be repeated here.
    if (event.nativeEvent.isComposing) return
    const count = filtered.length
    switch (event.key) {
      // Every list-navigation key behaves the same way when there is nothing to
      // navigate: fall through to the input's own caret handling rather than
      // swallowing it. (Arrows used to preventDefault unconditionally while
      // Home/End did not — an inconsistency with no reason behind it.)
      case 'ArrowDown':
        if (count === 0) break
        event.preventDefault()
        moveActive(active === count - 1 ? 0 : active + 1)
        break
      case 'ArrowUp':
        if (count === 0) break
        event.preventDefault()
        moveActive(active <= 0 ? count - 1 : active - 1)
        break
      case 'Home':
        if (count === 0) break
        event.preventDefault()
        moveActive(0)
        break
      case 'End':
        if (count === 0) break
        event.preventDefault()
        moveActive(count - 1)
        break
      case 'Enter': {
        // Only claim the key when there is actually a row to activate.
        const target = active >= 0 ? filtered[active] : undefined
        if (!target) break
        event.preventDefault()
        activate(target)
        break
      }
      case 'Escape':
        event.preventDefault()
        // Close THIS submenu only — the parent "+" dropdown must stay open.
        event.stopPropagation()
        onDismiss?.()
        break
      default:
        break
    }
  }

  // "Nothing configured" is about CHOICES, not rows: a pinned action row (the
  // assistant "No assistant" clear row) must not make an empty picker look populated.
  // The old assistant picker showed its "No assistants available" line INDEPENDENTLY
  // of the clear row, and both were visible when a selected assistant had been
  // deleted — so the pinned rows are still rendered alongside the empty state.
  if (!items.some(item => !item.pinned)) {
    return (
      <div data-testid={testId} className={PICKER_PANEL_CLASSES}>
        {emptyContent}
        {items.length > 0 && (
          <div role="listbox" aria-label={searchLabel}>
            {items.map(item => (
              <div
                key={item.id}
                data-testid={item.testId}
                role="option"
                aria-selected={false}
                onMouseDown={event => event.preventDefault()}
                onClick={() => activate(item)}
                className="flex min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground hover:bg-accent"
              >
                {item.leading}
                <span className="min-w-0 flex-1 truncate" title={item.label}>
                  {item.label}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div data-testid={testId} className={PICKER_PANEL_CLASSES}>
      <Input
        data-testid={`${testId}-search`}
        role="combobox"
        aria-label={searchLabel}
        // Only claim an expanded, controlled listbox while one is actually rendered —
        // in the no-matches state the list is replaced, so a hardcoded aria-expanded
        // + aria-controls would dangle.
        aria-expanded={hasResults}
        aria-controls={hasResults ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? optionId(active) : undefined}
        value={query}
        onChange={event => {
          setQuery(event.target.value)
          setActiveIndex(0)
        }}
        onKeyDown={onSearchKeyDown}
        placeholder={searchPlaceholder}
        prefix={<Search aria-hidden />}
        size="sm"
      />
      {filtered.length === 0 ? (
        // A real state, never a blank panel.
        <div
          data-testid={`${testId}-no-matches`}
          className="px-2 py-2 text-sm text-muted-foreground"
        >
          {noMatchesText}
        </div>
      ) : (
        <ScrollArea axis="y" autoHide="leave" className={cn(PICKER_LIST_MAX_H, '-mx-1 px-1')}>
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={searchLabel}
            // Without this, several rows carrying aria-selected=true is unexplained
            // to AT — the KB picker is a multi-select toggle (its predecessor said so
            // with aria-pressed, which the listbox model replaced).
            aria-multiselectable={multiSelect || undefined}
          >
            {/* Every `option` MUST be a DIRECT child of the `listbox`: ARIA's
                required-children relationship (and axe's `aria-required-children`)
                does not see through a wrapper element, and a screen reader stops
                announcing "item N of M". So there is no per-item wrapper div, and a
                separator is a BORDER on the row rather than a sibling node — a
                role-less div between the options would break the same rule.
                Locked by a test that asserts `option.parentElement === listbox`. */}
            {filtered.map((item, index) => {
              const selected = selectedIds?.has(item.id) ?? false
              return (
                <div
                  key={item.id}
                  id={optionId(index)}
                  data-testid={item.testId}
                  role="option"
                  aria-selected={selected}
                  data-active={index === active || undefined}
                  // Keep DOM focus in the search input: the Base UI popup is
                  // tabIndex=-1, so a plain mousedown on a non-focusable row moves
                  // focus off the input and every later keystroke (and
                  // aria-activedescendant) is stranded. That is the DEFAULT flow for
                  // the multi-select KB picker, which stays open after a click.
                  onMouseDown={event => event.preventDefault()}
                  onClick={() => activate(item)}
                  onMouseMove={() => {
                    if (index !== activeIndex) setActiveIndex(index)
                  }}
                  className={cn(
                    'flex min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                    'data-[active]:bg-accent data-[active]:text-accent-foreground',
                    selected ? 'text-primary' : 'text-foreground',
                    item.separatorAfter && 'mb-1 rounded-b-none border-b border-border pb-2',
                  )}
                >
                  {item.leading}
                  {/* min-w-0 + truncate is what keeps a long name from widening the
                      panel; `title` keeps the elided text recoverable. */}
                  <span className="min-w-0 flex-1 truncate" title={item.label}>
                    {item.label}
                  </span>
                  {item.trailing}
                </div>
              )
            })}
          </div>
        </ScrollArea>
      )}
    </div>
  )
}

export interface ComposerPickerPopoverProps extends Omit<ComposerPickerPanelProps, 'onDismiss'> {
  /**
   * The "+" row that opens this submenu — always a `PlusMenuItem`, rendered by the
   * CALLER rather than assembled from icon/label props here.
   *
   * Why the caller owns it: the generated static testid registry
   * (`sdk/packages/kit/src/testIds.generated.ts`) only records testid
   * attributes whose value is a literal string. (This sentence deliberately
   * avoids spelling that attribute out with a quoted value: the registry
   * scanner is a text scan, so an example written literally here would be
   * harvested as a real id.) Passing the id down as a prop would turn
   * `assistant-menu-trigger` / `kb-menu-trigger` — the ids ~10 existing e2e specs
   * target — into template-derived ids and silently drop their compile-time
   * typo-check. Keeping the element at the call site keeps the literal where the
   * scanner can see it.
   *
   * Nothing is injected into the element here: Base UI's own Trigger already emits
   * `aria-expanded`, and a `cloneElement` override would only be a way for a caller
   * prop to defeat it (render-element props win Base UI's merge).
   */
  trigger: ReactElement
  /** Whether activating an item should close the picker (single-select) or not. */
  closeOnSelect?: boolean
}

export function ComposerPickerPopover({
  trigger,
  closeOnSelect = false,
  onSelect,
  ...panel
}: ComposerPickerPopoverProps) {
  // Controlled so Escape can close THIS popover while its propagation is stopped
  // (a stopped event never reaches Base UI's own dismiss handler).
  const [open, setOpen] = useState(false)

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side="right"
      align="start"
      className={PICKER_POPUP_CLASSES}
      content={
        <ComposerPickerPanel
          {...panel}
          onSelect={item => {
            onSelect(item)
            if (closeOnSelect) setOpen(false)
          }}
          onDismiss={() => setOpen(false)}
        />
      }
    >
      {trigger}
    </Popover>
  )
}
