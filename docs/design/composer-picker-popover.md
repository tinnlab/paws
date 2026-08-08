# Composer picker popover — one bounded, searchable submenu primitive

Status: accepted · 2026-08-08
Owner request (verbatim): *"for selection of assistant and knowledge base, we need to
limit the width of popover container, if there are so many of them, we need to limit
the height too with react overlay scroll bar and show a search box on top"*

---

## 1. Problem

The chat composer's `+` dropdown (`ExtensionSlot name="toolbar_plus_items"`,
`src-app/ui/src/modules/chat/components/ChatInput.tsx:153-173`) hosts six items. Three
of them open a **nested right-side popover** listing entities to pick:

| item | file | list |
|---|---|---|
| Assistant | `modules/assistant/chat-extension/components/AssistantMenuItem.tsx:75` | assistants (single-select) |
| Knowledge bases | `modules/knowledge-base/chat-extension/components/KbMenuItem.tsx:134` | KBs (multi-select toggle) |
| Export | `modules/chat/extensions/export/extension.tsx:203` | 3 fixed formats |

The three were written independently. Each re-implements the popover props
(`side="right" align="start" className="w-auto"`), a content container with an inline
`style={{ minWidth: N, margin: -4 }}`, the row markup, the keyboard handler and the
active styling. `modules/chat/components/PlusMenuItem.tsx` exists as the shared **row**
primitive, and its own docblock concedes that the assistant item "reuses the same
wrapper classes" — i.e. copies them — rather than the component.

The user-visible consequences, all present on `main`:

1. **Unbounded width.** Neither picker caps its width. The panel is `w-auto` with only a
   `minWidth` floor, and the assistant row applies no truncation at all, so a single
   long assistant name stretches the whole panel across the chat column. KB rows carry
   `truncate` but inside an uncapped `w-auto` panel `flex-1 truncate` never engages —
   the panel just grows.
2. **Unbounded height, no scroll.** Neither picker caps its height and neither has a
   scroll container of any kind. Twenty knowledge bases render as a twenty-row panel
   that runs off the viewport with no way to reach the bottom rows.
3. **Search is missing or conditional.** The assistant picker has no search. The KB
   picker renders one **only when there are more than six** KBs, which is the moment the
   list is already unusable, and the hidden-below-seven branch leaves a stale `query` in
   state.

The app already owns every primitive needed to fix this and uses none of them here:
`ScrollArea` (overlayscrollbars, `@ziee/kit`), kit `Input`, kit `Popover`, `PlusMenuItem`.
`scripts/lint-native-scroll.mjs` exists precisely to stop new native scrollers.

## 2. Design

Add **one** app-level primitive — `ComposerPickerPopover`
(`src-app/ui/src/modules/chat/components/ComposerPickerPopover.tsx`) — that owns the
shell of a composer `+` submenu picker: the popover, the bounded panel, the search box,
the scrolling list, the empty states, the ARIA wiring and the keyboard model. The
assistant and knowledge-base items become thin callers that supply items and a row
renderer. It is composition of existing kit parts, not a new scroll/combobox engine.

### 2.1 Anatomy

```
PlusMenuItem (trigger row, shared)          ← reused, not re-styled
└─ kit Popover  side="right" align="start"
   panel:  w-auto min-w-60 max-w-80          ← bounded width
   ├─ kit Input   role=combobox              ← search box, ON TOP, always present
   └─ kit ScrollArea axis="y"  max-h-64      ← bounded height, overlayscrollbars
      └─ div role=listbox
         └─ div role=option ×N               ← caller-rendered row content
   (or) empty state: "no matches" | caller-supplied "nothing configured yet"
```

Width is bounded by `min-w-60 max-w-80` (240–320px, on the 4px scale) with `w-auto`
between them, so short lists stay compact and a long name is **truncated by the row**
(`min-w-0 flex-1 truncate`, full text in `title`) instead of widening the panel.

Height is bounded by `max-h-64` (256px) on the `ScrollArea`. The scrollbar is the app's
overlayscrollbars one (`ScrollArea` from `@ziee/kit`, the same recipe as
`sdk/packages/kit/src/kit/dropdown.tsx:80-84`), never a native `overflow-y-auto`.

The search box is **always rendered**, never threshold-gated: the threshold is what
produced the stale-query branch, and a permanently-present box is one less thing that
moves under the user.

### 2.2 Keyboard + focus model

The canonical ARIA 1.2 combobox/listbox pattern, matching the one already implemented in
`sdk/packages/kit/src/kit/multi-select.tsx:32-166` (`VirtualMultiList`):

- focus lands in the **search input** when the popover opens; the input keeps focus for
  the whole interaction so typing never breaks,
- the input is `role="combobox"` with `aria-expanded`, `aria-controls` and
  `aria-activedescendant` pointing at the active option,
- the list is `role="listbox"`, rows are `role="option"` with `aria-selected`,
- `ArrowDown`/`ArrowUp` move the active option (wrapping), `Home`/`End` jump to the
  first/last, `Enter` activates the active option, `Escape` closes **only** this
  submenu — not the parent `+` popover,
- the active option is scrolled into view as it moves.

### 2.3 Empty states — two distinct ones

A blank panel is never acceptable. The primitive distinguishes:

- **no matches** — the filter excluded everything. Rendered by the primitive.
- **nothing configured** — the caller has zero items at all. Supplied by the caller, so
  the KB picker keeps its "No knowledge bases yet — create one →" call to action and the
  assistant picker keeps its explanatory line. When there are zero items the search box
  is suppressed (there is nothing to search).

### 2.4 Non-goals

- The **Export** submenu is not migrated in this change. It is a fixed three-row list
  with no scale problem; the primitive is built so it can adopt the shell later.
- No new scroll library, no new combobox engine, no cmdk adoption: `ScrollArea` and kit
  `Input` already exist and are the app's convention.
- No change to selection semantics, persistence, permission gating, or per-pane keying
  of either picker.

## 3. Non-negotiables

These are the promises this design makes. They are lifted verbatim into the plan's
`## Invariants` and each is pinned to an executable acceptance test.

- **N1** — The popover panel width is bounded: a long item name never widens the panel
  beyond its cap; the row truncates instead.
- **N2** — The list height is bounded and scrolls through the app's overlayscrollbars
  `ScrollArea`, never a native scrollbar and never an unbounded list.
- **N3** — A search box is rendered at the top of the popover and filters the list as
  you type, and a filter that matches nothing shows an explicit no-matches state rather
  than a blank panel.
- **N4** — The assistant picker and the knowledge-base picker are built from ONE shared
  primitive; neither carries its own popover shell, search or scroll implementation.
- **N5** — Focus lands in the search box when the popover opens, ArrowUp/ArrowDown move
  through the results, Enter selects the active result, and Escape closes the picker.

## 4. Dead code removed

`modules/assistant/chat-extension/components/AssistantSelector.tsx` is a **third**
assistant picker (a kit `Combobox`) with no production caller — it is registered in no
extension slot and referenced only by gallery coverage manifests, which claim it is
"rendered within the assistant module page" (it is not). Per the repo's dead-code rule it
is deleted with this change rather than left to drift alongside the primitive.
