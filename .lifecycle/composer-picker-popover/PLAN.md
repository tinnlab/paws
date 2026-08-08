# PLAN — composer-picker-popover

## Design source

Realizes `docs/design/composer-picker-popover.md` §2 (Design: anatomy, keyboard/focus
model, empty states), §3 (Non-negotiables) and §4 (Dead code removed). That design was
written for this change — no prior design doc existed for the composer `+` submenu
pickers, so a research/design pass produced one (it maps the three near-identical
popovers on `main`, the three user-visible defects, and the primitives the app already
owns) before any plan item was written.

Owner request the design derives from, verbatim: *"for selection of assistant and
knowledge base, we need to limit the width of popover container, if there are so many of
them, we need to limit the height too with react overlay scroll bar and show a search
box on top"*.

## Invariants

Lifted verbatim from `docs/design/composer-picker-popover.md` §3.

- **INV-1**: The popover panel width is bounded: a long item name never widens the panel beyond its cap; the row truncates instead.
- **INV-2**: The list height is bounded and scrolls through the app's overlayscrollbars `ScrollArea`, never a native scrollbar and never an unbounded list.
- **INV-3**: A search box is rendered at the top of the popover and filters the list as you type, and a filter that matches nothing shows an explicit no-matches state rather than a blank panel.
- **INV-4**: The assistant picker and the knowledge-base picker are built from ONE shared primitive; neither carries its own popover shell, search or scroll implementation.
- **INV-5**: Focus lands in the search box when the popover opens, ArrowUp/ArrowDown move through the results, Enter selects the active result, and Escape closes the picker.

## Items

- **ITEM-1**: Add the shared primitive `ComposerPickerPopover` (`src-app/ui/src/modules/chat/components/ComposerPickerPopover.tsx`) — the popover shell for a composer `+` submenu picker: bounded panel, search box, scrolling list, empty states, ARIA wiring, keyboard model. Generic over an item type; the caller supplies items (`{ id, label, disabled? }` + arbitrary payload), a row renderer for the trailing metadata, and a select handler. Composition of existing kit parts only — no new scroll or combobox engine.
- **ITEM-2**: Bounded width (INV-1). The panel is `w-auto min-w-60 max-w-80` (240–320px, 4px scale); every row lays out as `min-w-0 flex-1 truncate` with the full label in `title`, so a long name truncates instead of widening the panel.
- **ITEM-3**: Bounded height + overlay scrollbar (INV-2). The list is wrapped in kit `ScrollArea axis="y" autoHide="leave"` capped at `max-h-64` (256px), mirroring `sdk/packages/kit/src/kit/dropdown.tsx:80-84`. No native `overflow-y-auto` anywhere in the primitive (keeps `lint:native-scroll` clean).
- **ITEM-4**: Search box on top (INV-3). An always-rendered kit `Input` at the top of the panel (suppressed only when the caller has zero items), case-insensitive substring filter on the item label, `allowClear`, a search icon prefix, and an accessible name supplied by the caller. Replaces the KB picker's `kbs.length > 6` threshold branch and its stale-`query` hazard.
- **ITEM-5**: Two distinct empty states (INV-3). "No matches." when the filter excludes everything (owned by the primitive); a caller-supplied `emptyContent` when there are zero items at all, so KB keeps its "No knowledge bases yet — create one →" CTA and assistant keeps its explanatory line. Never a blank panel.
- **ITEM-6**: Keyboard + focus + ARIA (INV-5). Focus lands in the search input on open; input is `role="combobox"` with `aria-expanded`/`aria-controls`/`aria-activedescendant`; list is `role="listbox"`, rows are `role="option"` with `aria-selected`; ArrowDown/ArrowUp move the active option (wrapping), Home/End jump, Enter activates it, Escape closes ONLY this submenu (stops propagation so the parent `+` popover stays open), and the active option is scrolled into view.
- **ITEM-7**: Adopt the primitive in `AssistantMenuItem` (single-select). Preserves the per-conversation/per-pane key, the `assistants::read` gate, the "No assistant" clear row, `close()` on select, and the existing `assistant-menu-trigger` / `assistant-menu-options` / `assistant-option-*` / `assistant-option-none` testids.
- **ITEM-8**: Adopt the primitive in `KbMenuItem` (multi-select toggle). Preserves the per-conversation/per-pane key, the `knowledge_base::use` gate, attach/detach toggling, the per-row index-status suffix + document count, the `/knowledge` CTA, and the existing `kb-menu-trigger` / `kb-menu-options` / `kb-menu-search` / `kb-menu-empty` / `kb-option-*` testids.
- **ITEM-9**: Both triggers use the existing shared `PlusMenuItem` row instead of the two hand-rolled copies, and the assistant rows' imperative `e.currentTarget.className` hover/focus mutation (AssistantMenuItem.tsx:130-143) is deleted in favour of Tailwind `hover:`/`data-` state classes owned by the primitive.
- **ITEM-10**: Delete the dead third assistant picker `modules/assistant/chat-extension/components/AssistantSelector.tsx` (no production caller; referenced only by gallery-coverage manifests that falsely claim it renders within the assistant page), and update/regenerate the gallery coverage + state-matrix registries that name it.
- **ITEM-11**: Gallery coverage for the primitive's conditional states so `check:state-matrix` and `gate:ui` actually exercise them: a populated many-item state (proves the height cap + scrollbar), a filtered state, a no-matches state, a zero-items state, and a narrow ~390px viewport render.

## Files to touch

Frontend workspace: `src-app/ui` only. `src-app/desktop/ui` resolves these modules
through its `fallbackSrc: ../../ui/src` vite alias and holds **no** override copy of
`AssistantMenuItem` / `KbMenuItem` / `PlusMenuItem` (verified: `find src-app/desktop/ui`
returns none), so there is nothing to mirror there.

Added:
- `docs/design/composer-picker-popover.md` (design source; already written)
- `src-app/ui/src/modules/chat/components/ComposerPickerPopover.tsx`
- `src-app/ui/src/modules/chat/components/ComposerPickerPopover.test.tsx` (component harness)
- `src-app/ui/src/modules/chat/components/composerPickerFilter.ts` + `.test.ts` counterpart is NOT used — the filter/active-index reducer is exercised through the mounted harness (see TESTS.md rationale)
- `src-app/ui/tests/e2e/chat/composer-picker-popover.spec.ts`

Edited:
- `src-app/ui/src/modules/assistant/chat-extension/components/AssistantMenuItem.tsx`
- `src-app/ui/src/modules/knowledge-base/chat-extension/components/KbMenuItem.tsx`
- `src-app/ui/src/dev/gallery/coverage.ts`
- `src-app/ui/src/dev/gallery/stateCoverage.ts`
- `src-app/ui/src/dev/gallery/galleryCoverage.generated.ts` (regenerated, not hand-edited)
- `src-app/ui/src/dev/gallery/stateMatrix.generated.ts` (regenerated, not hand-edited)
- a gallery story under `src-app/ui/src/dev/gallery/` for the primitive's states

Deleted:
- `src-app/ui/src/modules/assistant/chat-extension/components/AssistantSelector.tsx`

## Patterns to follow

- **The searchable-list keyboard/ARIA model** — mirror `sdk/packages/kit/src/kit/multi-select.tsx:32-166` (`VirtualMultiList`): `role="combobox"` input with `aria-activedescendant`, `role="listbox"` container, `role="option"` rows, wrapping arrow-key nav, active-option scroll-into-view. This is the in-repo precedent; do not invent a second model.
- **ScrollArea inside a popover** — mirror `sdk/packages/kit/src/kit/dropdown.tsx:80-84` exactly: the popover content gets `p-0` / no own overflow, and the `ScrollArea axis="y" autoHide="leave"` owns both the height cap and the inner padding.
- **The `+` submenu trigger row** — reuse `src-app/ui/src/modules/chat/components/PlusMenuItem.tsx` (icon + truncating label + `trailing` chevron), as `McpMenuItem`, `SkillMenuItem` and the Export item already do. Do not re-copy its class string.
- **Picker row metadata** — keep KB's existing `statusSuffix()` shape (`N failed` / `N indexing` / `empty` + document count) and its `text-destructive` / `text-muted-foreground` tokens.
- **Component test harness** — mirror `src-app/ui/src/modules/js-tool/.../JsToolApprovalContent.test.tsx` (vitest + jsdom + testing-library, run by `npm run test:component`); the workspace's vitest `include` is `src/**/*.store.test.ts` and `src/**/*.test.tsx`, so the spec MUST be `.test.tsx` or it runs nothing.
- **E2E selectors** — accessibility-first per CLAUDE.md (`getByRole` > `getByLabel` > `getByText` > `getByTestId`). Existing `data-testid`s are preserved for the specs that already use them; **no new static `data-testid` literal is introduced**, because the static registry lives in the SDK submodule (`sdk/packages/kit/src/testIds.generated.ts`, per `gallery.config.json:testidOut`) and a new literal would force a cross-repo submodule commit for a pure UI fix. New surfaces are selected by role/label.
- **Design system** — semantic tokens only (`bg-popover`, `text-muted-foreground`, `bg-accent`, `text-destructive`), the 4px spacing rhythm, the radius scale, and **logical direction properties only** (`ps/pe`, `ms/me`, `text-start`); `npm run lint:colors` and `npm run lint:logical-direction` gate this.

---

## Plan audit (phase 2) — verdicts verified against the codebase

### Breakage risk

- `assistant-menu-trigger` and `kb-menu-trigger` are consumed by ~10 e2e specs
  (`tests/e2e/chat/chat-input-slots.spec.ts:56,93,146`,
  `tests/e2e/14-knowledge-base/kb-attach-chat.spec.ts:22`,
  `tests/e2e/14-split-chat/kb-grounding-per-pane.spec.ts:60`, …) plus the per-item
  `assistant-option-${id}` / `kb-option-${id}` ids. All are preserved verbatim by
  ITEM-7/ITEM-8; the primitive takes explicit testid props rather than deriving them,
  precisely so no existing selector moves.
- Both pickers are per-pane state (`useChatPaneOrNull()` + `kbKey(convId, paneId)` /
  `newChatAssistantKey(paneId)`). The refactor keeps that keying inside the caller; the
  primitive is stateless w.r.t. selection, so split-pane isolation cannot regress
  through it.
- The KB picker deliberately does NOT close the `+` dropdown on select (multi-select);
  the assistant one does (`usePlusDropdown().close()`). The primitive must therefore not
  own close-on-select — it is the caller's `onSelect` that decides.
- Deleting `AssistantSelector.tsx` (ITEM-10) is safe: grep shows zero production
  importers and no extension-slot registration; only gallery manifests reference it.

### Pattern conformance

- `ScrollArea` (`@ziee/kit`, overlayscrollbars ^2.16.0 / -react ^0.5.6) is the app's
  canonical wrapper and is already used inside a popover at `kit/dropdown.tsx:83` — the
  primitive copies that recipe rather than adding a second integration. ✔ matches the
  brief's "reuse, don't hand-roll".
- `PlusMenuItem` already exists and is used by 3 of the 6 `+` items; adopting it in the
  remaining two is conformance, not new API.
- The imperative `e.currentTarget.className` hover swap in AssistantMenuItem violates
  CODING_GUIDELINES §13 ("no inline `e.currentTarget.style/className` for hover/focus");
  ITEM-9 removes it.
- Raw `role="button" tabIndex={0}` divs for rows are replaced by `role="option"` inside a
  `role="listbox"` — the correct ARIA for a picker and axe-clean, without needing a raw
  `<button>` (which the `noRestrictedInteractive` guardrail forbids in module code).

### Migration collisions

None. This is a frontend-only change: no `.sql` migration is added, no server module is
touched, so the server migration sequence (max `202607200200`) and the desktop `1e13`
block are both untouched. See BASE.md.

### OpenAPI regen

Not required. No Rust handler, request/response type or `JsonSchema` derive is touched,
so `openapi.json` and `api-client/types.ts` are unchanged in **both** workspaces. The
generated files that DO change are the gallery registries
(`galleryCoverage.generated.ts`, `stateMatrix.generated.ts`), regenerated via
`npm run gen:gallery-coverage` / `npm run gen:state-matrix`. The SDK-owned
`testIds.generated.ts` is deliberately left byte-identical (see *Patterns to follow*).

### Per-item verdicts

- **ITEM-1** — verdict: PASS — no `ComposerPickerPopover`/`ComposerPicker`/`SubmenuPopover` exists (grep: zero hits); the app-level `modules/chat/components/` is the right home (it is where `PlusMenuItem` + `PlusDropdownContext` already live) and avoids an SDK submodule change.
- **ITEM-2** — verdict: PASS — kit `PopoverContent` hardcodes `w-72`; a caller `className` is merged through `cn()` last, so `w-auto min-w-60 max-w-80` overrides it (the same override the three existing callers already rely on with `w-auto`).
- **ITEM-3** — verdict: PASS — `ScrollArea` requires the caller to size-constrain the host (`scroll-area.tsx:11-13`); `max-h-64` on the ScrollArea itself satisfies that. `lint:native-scroll` is advisory (exit 0) but the primitive introduces no native scroller, so it stays clean either way.
- **ITEM-4** — verdict: PASS — kit `Input` supports `prefix`, `allowClear`, `size` and `aria-label` (KIT_MANIFEST); it is already used as a search box at `ConversationPickerPane.tsx:124-130`. The KB picker's existing `kb-menu-search` testid is passed through, so `kb-attach-chat` specs keep working.
- **ITEM-5** — verdict: PASS — KB already has a `/knowledge` CTA empty state (KbMenuItem.tsx:65-81) worth preserving; making `emptyContent` a caller slot keeps it without the primitive knowing about knowledge bases.
- **ITEM-6** — verdict: CONCERN — the kit `Popover` wrapper does **not** forward Base UI's `initialFocus` (kit/popover.tsx:20-52 passes only `className` + hover handlers), so focus-on-open must be done with a ref effect inside the popover content, and Base UI's own popup focus runs in the PARENT's effect (parent effects run after children's) and may win the race. Resolution: prove it by mounting, not by reading — TEST-6 asserts `document.activeElement` is the search input; if the race bites, the fallback is a `data-autofocus`/`autoFocus` attribute on the input, still with no `setTimeout` hack.
- **ITEM-7** — verdict: PASS — `AssistantPicker` exposes `availableAssistants`, `selectedByConversation`, `selectAssistant`, `clearAssistant`, `loading`; nothing new is needed from the store.
- **ITEM-8** — verdict: CONCERN — `KnowledgeBases.items` is a `Map`; `Array.from(items.values())` inside render is fine, but the primitive must not re-sort or re-key it, and `KnowledgeBaseComposer.attachFor/detachFor` return promises whose rejection is surfaced with `message.error` today. Resolution: keep both behaviours verbatim in the caller's `onSelect`; the primitive never touches the promise.
- **ITEM-9** — verdict: PASS — `PlusMenuItem` is `forwardRef` + prop-spreading specifically so it can serve as a Popover trigger (its docblock says so, and the Export item already does it). The kit `Popover` auto-detects `nativeButton` from the child type and will correctly pass `false` for a non-button component child.
- **ITEM-10** — verdict: CONCERN — deleting the file makes `coverage.ts:84` / `stateCoverage.ts:129` dangle and the two `*.generated.ts` registries stale, which fails `check:gallery-coverage` + `check:state-matrix` inside `npm run check`. Resolution: delete the two hand-written entries in the same commit and regenerate both registries with `npm run gen:gallery-coverage` + `npm run gen:state-matrix`; phase 8's `npm run check` is the proof.
- **ITEM-11** — verdict: CONCERN — `check:state-matrix` requires a gallery cell for every NEW conditional render state, so the no-matches / filtered / many-items / zero-items branches each need one or an allowlisted reason. Resolution: add a real gallery story with those states (that is also what makes the height cap visually reviewable at 390px) rather than allowlisting them away.
