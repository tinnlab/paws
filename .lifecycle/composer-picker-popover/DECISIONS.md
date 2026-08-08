# DECISIONS — composer-picker-popover

Every human/product input the implementation needs, resolved up front. Nothing is left
unresolved — each decision below carries a Resolution and a Basis.

### DEC-1: One shared primitive, or fix the two pickers separately?
**Resolution:** ONE shared primitive, `ComposerPickerPopover`, adopted by both.
**Basis:** codebase — the two popovers are already near-identical (same
`side="right" align="start" className="w-auto"`, same `style={{minWidth, margin:-4}}`
content div, same row semantics) and `PlusMenuItem`'s own docblock records that the
assistant item COPIES its classes rather than using it. Fixing width/height/search twice
guarantees the next divergence. The brief also asks for exactly this if they don't share
a primitive and obviously should — they don't, and they do.

### DEC-2: Where does the primitive live — the app or the `sdk` kit submodule?
**Resolution:** the app, at `src-app/ui/src/modules/chat/components/ComposerPickerPopover.tsx`.
**Basis:** convention — it is a chat-composer-specific COMPOSITION of kit parts
(`Popover` + `Input` + `ScrollArea` + `PlusMenuItem`), not a generic control. That is
exactly where `PlusMenuItem` and `PlusDropdownContext` already live. Putting it in the
kit would mean a cross-repo change to a submodule shared with CytoAnalyst for a
ziee-composer concern.

### DEC-3: Build on the existing `ScrollArea`, or a new overlayscrollbars integration?
**Resolution:** reuse `ScrollArea` from `@ziee/kit`
(`sdk/packages/kit/src/kit/scroll-area.tsx`, overlayscrollbars ^2.16.0 /
overlayscrollbars-react ^0.5.6), copying the in-popover recipe already used at
`kit/dropdown.tsx:80-84` (`axis="y" autoHide="leave"`, the ScrollArea owns the cap AND
the inner padding, the popup gets `p-0`).
**Basis:** codebase + brief — the brief says use the existing deps and check for a shared
wrapper first. There are five overlayscrollbars wrappers in the tree; `ScrollArea` is the
canonical public one. `scripts/lint-native-scroll.mjs` exists to stop a sixth
hand-rolled scroller.

### DEC-4: Use `cmdk` / the unexported shadcn `Command`, or compose kit parts?
**Resolution:** compose kit parts (`Input` + a `role="listbox"` of `role="option"` rows).
**Basis:** codebase — `shadcn/command.tsx` is NOT exported from the kit barrel, has
exactly one importer (`kit/multi-select.tsx`), and its `CommandList` uses a native
`overflow-y-auto` with `no-scrollbar`, i.e. precisely the invisible-native-scrollbar
behaviour the user is complaining about. Adopting it would mean fighting it. The keyboard
model is instead ported from the in-repo precedent `kit/multi-select.tsx:32-166`
(`VirtualMultiList`), which already implements `role="combobox"` +
`aria-activedescendant` + wrapping arrow nav.

### DEC-5: Is the search box always shown, or only above a threshold?
**Resolution:** ALWAYS shown, except when the caller has zero items (nothing to search).
**Basis:** user — the request is "show a search box on top", unconditional. It also
removes a live defect: KB's `kbs.length > 6` threshold leaves a stale `query` in state
when the list drops back below 7, silently filtering a list with no visible search box.

### DEC-6: What are the width and height caps — and are they fixed constants or configurable?
**Resolution:** fixed constants expressed as design-system classes on the panel:
width `w-auto min-w-60 max-w-80` (240–320px), list height `max-h-64` (256px). They are
declared once in the primitive as named constants (`PICKER_PANEL_CLASSES`,
`PICKER_LIST_MAX_H`), not inlined at call sites.
**Basis:** convention + the configurable-settings rule. These are presentation metrics,
not operational tunables — there is no server, no settings row, and no operator decision
attached to how tall a dropdown is; no comparable UI metric in this repo is
admin-configurable. They are still factored as named constants so a future variant can
override them per caller without a rewrite. All four values sit on the 4px scale, and
288px/256px match the caps the kit's own `ComboboxList` and `MultiSelect` already use, so
the pickers agree with the rest of the app.

### DEC-7: How does focus reach the search box on open?
**Resolution:** rely on Base UI's default `initialFocus` ("the first tabbable element
inside the popup") by making the search input the first tabbable element. No ref effect,
no `autoFocus`, and explicitly no `setTimeout` DOM-ready hack.
**Basis:** codebase — `@base-ui/react/popover`'s `PopoverPopupProps.initialFocus`
documents that default. The kit `Popover` wrapper does not forward `initialFocus`
(`kit/popover.tsx:47` passes only `side`/`align`/`className`), so relying on the default
is the ONLY option that needs no SDK change. It is proven by mounting (TEST-4) and in a
real browser (TEST-15), never by reading the code.

### DEC-8: Escape — close the submenu only, or the whole "+" dropdown?
**Resolution:** the submenu only. The primitive stops propagation of the Escape keydown
after closing itself, so the parent "+" popover stays open.
**Basis:** convention — a submenu that dismisses its whole parent on Escape loses the
user's place; every nested-menu convention (and the sibling Export submenu's own nesting
assumption) is one-level dismissal. Asserted by TEST-7 (unit) and TEST-15 (e2e).

### DEC-9: Does selecting an item close the "+" dropdown?
**Resolution:** the CALLER decides; the primitive never closes the parent. Assistant
(single-select) keeps calling `usePlusDropdown().close()`; KB (multi-select) keeps NOT
closing.
**Basis:** codebase — that asymmetry is deliberate and pre-existing (KbMenuItem does not
even import `usePlusDropdown`). Baking close-on-select into the primitive would break
multi-select KB attachment. Asserted by TEST-17.

### DEC-10: Which testids are preserved, and are new static ones introduced?
**Resolution:** the callers keep their existing static literals —
`assistant-menu-trigger`, `assistant-menu-options`, `assistant-option-*`,
`assistant-option-none`, `kb-menu-trigger`, `kb-menu-options`, `kb-menu-empty`,
`kb-option-*`. The primitive's internal sub-elements derive their testids from the
container id (`${containerTestId}-search`, `${containerTestId}-no-matches`), which are
template strings and therefore never enter the static registry. New surfaces are selected
in tests by role/label per CLAUDE.md's selector priority.
**Basis:** codebase — `gallery.config.json:testidOut` points the generated registry at
`sdk/packages/kit/src/testIds.generated.ts` inside the `sdk` submodule, so each new
static literal costs a cross-repo commit. Deriving costs nothing and matches the kit's
documented "collection items auto-derive testids from the container's testid" rule.
**Known consequence (accepted):** the one literal that CANNOT survive this is
`kb-menu-search` — it becomes `kb-menu-options-search`, so the generated registry loses
exactly one id and must be regenerated. No spec references `kb-menu-search`
(`grep -rl kb-menu-search tests/` → nothing), so nothing breaks; see DEC-11 for how the
regen is handled.

### DEC-11: How is the `sdk`-owned `testIds.generated.ts` regen handled?
**Resolution:** SUPERSEDED by the owner — not handled in this branch at all. The
submodule pointer stays at `origin/main`'s `70576db7` and the branch touches no SDK
file. The regen commit that existed briefly (`8d13778`) was dropped via `git rebase --onto`
and then DISCARDED entirely at the owner's direction — the local `chat` branch is reset
to `origin/chat`, no local sdk branch survives, and the submodule was never pushed.
**Basis:** user — the owner verified main's staleness independently, is fixing it on
main, and asked that this branch carry only its own changes and that ONE person
sequence any submodule push. The branch's own registry delta is just two RETIRED ids
(`assistant-selector`, from the deleted component, and `kb-menu-search`, now derived
inside the primitive); both are reproduced by a single `npm run gen:testid-registry`
after rebasing onto the fixed main, so nothing is lost by dropping it.
**Sequencing (owner-directed):** a separate agent is landing a regen-parity fix on main
that regenerates BOTH `testIds.generated.ts` and `stateMatrix.generated.ts` and maps the
six `stateCoverage` keys properly. This branch then REBASES onto it (never merges) and
regenerates on top: the two retired ids come back from one `gen:testid-registry`, and the
state-matrix regen will carry only THIS feature's surfaces because main's four will
already be reconciled upstream.
**Accepted consequence until then:** `check:testid-registry` — and therefore
`npm run check` — is RED on this branch. It is red on base for the same reason, so
the branch is no worse than its base; this is recorded as-is in TEST_RESULTS.md
rather than being made green by re-absorbing the drift.

### DEC-12: How are the picker rows marked up — `role="button"` divs (as today) or a listbox?
**Resolution:** `role="listbox"` container with `role="option"` rows carrying
`aria-selected`; the search input is the `role="combobox"` that owns focus and
`aria-activedescendant`.
**Basis:** convention — this is the ARIA 1.2 pattern the in-repo `VirtualMultiList`
already uses, it is what makes arrow-key navigation meaningful, and it is axe-clean.
Today's `role="button" tabIndex={0}` divs give a picker N tab stops and no active-option
semantics. It also avoids a raw `<button>`, which the `no-raw-interactive-elements.grit`
guardrail forbids in module code.

### DEC-13: What replaces the imperative hover styling on assistant rows?
**Resolution:** Tailwind state classes owned by the primitive
(`hover:bg-accent`, `data-[active=true]:bg-accent`, `focus-visible:` ring), matching
`menuRowClasses()`'s vocabulary. The four `e.currentTarget.className = …` handlers are
deleted.
**Basis:** convention — CODING_GUIDELINES §13 forbids inline `e.currentTarget.style` /
`className` mutation for hover/focus. Keyboard navigation also cannot drive an
active-row highlight through mouse handlers, so the current code could not have
highlighted the arrow-key-active row at all.

### DEC-14: Is the dead `AssistantSelector.tsx` deleted in this change or left alone?
**Resolution:** deleted, together with its `coverage.ts` / `stateCoverage.ts` entries and
a regeneration of the two gallery registries.
**Basis:** convention — CODING_GUIDELINES §15 ("dead code = unfinished work"): it has no
production caller and no slot registration, and its coverage entry asserts something
false ("rendered within the assistant module page"). Leaving a third, divergent assistant
picker next to a newly-unified pair re-creates the exact drift this change removes. It is
an ITEM with its own test (TEST-19), not a silent drive-by.

### DEC-15: Which gallery file hosts the new story?
**Resolution:** `src-app/ui/src/dev/gallery/stories/shard1.story.tsx` (pre-created, empty,
already imported by the integrator-owned `stories/index.ts`), with every story id and
case testid prefixed `s1-` per that file's own contract. The story renders the picker
panel CLOSED-by-default where a trigger is involved, per `overlays.story.tsx`'s rule that
a story must not open on mount.
**Basis:** codebase — the shard files exist precisely so drop-in stories don't touch the
aggregator, and the overlays contract exists because an auto-opened overlay portals a
full-page backdrop over the browse canvas and breaks the other visual layers.

### DEC-16: Is anything descoped?
**Resolution:** nothing is descoped. The **Export** submenu
(`modules/chat/extensions/export/extension.tsx:203`) is the third member of this popover
family but was never in scope: it is a fixed three-row list with no scale problem, the
user's request names assistant and knowledge base only, and it is recorded as an explicit
non-goal in the design (§2.4) with the primitive built so it can adopt the shell later.
It is therefore not a PLAN ITEM at all, rather than a `[DESCOPED]` one.
**Basis:** user — the request is scoped to "selection of assistant and knowledge base".
