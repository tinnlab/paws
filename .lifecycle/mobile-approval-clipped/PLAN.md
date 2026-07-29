# mobile-approval-clipped — PLAN

Fix a security-relevant layout defect: on a narrow viewport the MCP tool-approval
card's decision controls overflow out of the card's **inline-start** edge, where
they are clipped to zero width by the card's `overflow-hidden` and cannot be
reached by scrolling. The user can approve a tool call but cannot deny it.

## Design source

- Realizes the live-audit rig finding set
  `/data/pbya/ziee/tmp/live-ui-247/run-20260728-194516/findings.jsonl`:
  - `MEDIUM clipped-control @ rapid-double-submit (390/dark)` — "interactive
    control is fully clipped away and UNREACHABLE: its 81x32px box is cut to 0 by
    a non-scrollable overflow ancestor … anchor: button "Deny" @
    `[data-testid="tool-approval-call_51a9f8a18d2a4d488f0c5f80"]`".
  - `MEDIUM clipped-control @ sent (390/dark)` — "interactive control clipped by
    viewport edge with no horizontal scroll to reveal it (rect left=-43 right=97,
    viewport width 390)".
- Realizes the approval card's existing reachability contract, stated in-tree at
  `src-app/ui/tests/e2e/visual/approval-actions-reachable.spec.ts:20-22` and
  mirrored in the component comment
  `src-app/ui/src/modules/mcp/chat-extension/components/ToolCallPendingApprovalContent.tsx:346-351`
  (the `chat-ui-robustness` lifecycle, `INV-3` + ITEM-6). That contract is already
  the design; this branch closes the axis it was only ever enforced on
  (VERTICAL, at 1280×900) versus the axis it is broken on (HORIZONTAL, at 390).
- Realizes `src-app/ui/docs/DEFECT_TAXONOMY.md` classes **A11** (element border
  clipped by ancestor/container) and **B2** (failure-to-wrap).
- Realizes `agent-kit/docs/DESIGN_SYSTEM.md` (semantic tokens, 4px grid, logical
  direction, kit components over hand-rolled) and `agent-kit/docs/CODING_GUIDELINES.md`
  §13 (UI/UX & accessibility).
- Follows the kit's OWN precedent for a responsive action footer:
  `sdk/packages/kit/src/shadcn/dialog.tsx:136` (`DialogFooter`) and
  `sdk/packages/kit/src/shadcn/alert-dialog.tsx:91` (`AlertDialogFooter`), which
  already refuse to let a footer action row overflow. The card footer is the gap
  in that family.

## Invariants

- **INV-1**: "pushing "Deny" off screen is the cheapest way to leave "Approve" as
  the only action in view." (`approval-actions-reachable.spec.ts:21-22`, verbatim)
  — i.e. every decision control on an approval card MUST remain reachable by the
  user, not merely present in the DOM.
- **INV-2**: "failure-to-wrap — content clipped/protruding where wrap/ellipsis was
  possible" (`DEFECT_TAXONOMY.md:28`, class B2, verbatim) — the action row must
  wrap rather than clip when it does not fit.
- **INV-3**: "element border clipped by ancestor/container — a bordered box whose
  border-box reaches/exceeds a NON-scrolling clipping ancestor's (overflow
  hidden/clip) content edge" (`DEFECT_TAXONOMY.md:21`, class A11, verbatim) — no
  decision control may sit outside its non-scrolling clipping ancestor.
- **INV-4**: "FULL, EXACT advertised description (never truncated/summarized —
  poisoning hides in truncation)" (`mcpComposer/state.ts`, verbatim, via the
  `chat-ui-robustness` lifecycle INV-3) — the consent surface's disclosure must
  actually REACH the user, not merely exist in the DOM.

## Reproduction (measured, before any change)

`tests/e2e/visual/zz-repro-390.spec.ts` (scratch harness, not committed) against
the backend-free gallery at 390×844, surface `deep-chat-tool-approval`, BOTH
themes. Log: `/data/pbya/ziee/tmp/lifecycle-logs/denyclip-siblings-before.log`.

```
tool-approval-deny:         x=[-174,-93] w=81  visibleW=0   hitsSelf=false
tool-approval-approve-once: x=[-85,55]   w=140 visibleW=0   hitsSelf=false
tool-approval-approve-conv: x=[63,314]   w=251 visibleW=251 hitsSelf=true
footer inner: clientWidth=238 scrollWidth=238 flexWrap=nowrap justifyContent=flex-end
```

Identical in light and dark. **Worse than the rig reported**: TWO of the three
controls are unreachable, and the single survivor is the BROADEST approval
("Approve for this conversation"). `scrollWidth === clientWidth` (238 === 238) is
the proof that the overflow is unreachable: a flex row overflowing its
inline-START edge creates no scrollable region, so there is no gesture that
reveals it.

**Root cause — ONE defect, two rig symptoms.** The footer's action row is
`<div className="flex w-full justify-end gap-2">` — a NON-wrapping flex row whose
children (kit `Button` carries `shrink-0 whitespace-nowrap`) cannot shrink. Their
intrinsic total (81 + 140 + 251 + 2×8 gap = 488px) exceeds the 238px content box.
Because the row is `justify-end`, the 250px of overflow is pushed out of the
inline-START edge, where (a) the kit `Card` root's `overflow-hidden`
(`shadcn/card.tsx:15`) clips it to zero, and (b) no scroll can reach it. The rig's
two findings are that same row seen through two detectors in two states —
ancestor-clip vs viewport-clip — not two defects.

## Items

- **ITEM-1**: Add a `CardActions` primitive to the kit — the single definition of
  a card-footer action row that CANNOT clip: content-driven wrapping (`flex-wrap`,
  so it is a no-op whenever the row fits), plus child constraints that cap an
  over-wide single action to the line width and let its label wrap instead of
  overflowing. Export from the kit barrel; regenerate `KIT_MANIFEST.md`.
- **ITEM-2**: `ToolCallPendingApprovalContent` — replace the hand-rolled
  `flex w-full justify-end gap-2` footer row with `CardActions`. This is the
  measured defect.
- **ITEM-3**: `ElicitationFormContent` — both card footers (the no-fields variant
  and the fields variant) adopt `CardActions`. Same pattern; the no-fields
  variant's `Decline` + `Accept without values` pair is over the 238px line and is
  not covered by a gallery cell today, so it is a latent instance of the same bug.
- **ITEM-4**: `AskUserWizardContent` — the `justify-between` footer adopts
  `CardActions` (justification overridden via `className`), and its nested
  right-hand button group wraps too.
- **ITEM-5**: Regression coverage — extend
  `tests/e2e/visual/approval-actions-reachable.spec.ts` with a 390px reachability
  test, in BOTH themes, asserting every decision control on the approval card and
  on the sibling approval footers is **visible AND hit-testable** (centre-point
  `elementFromPoint` resolves to the control), not merely present in the DOM. This
  closes the axis the existing TEST-10b never checked (it asserts only `y` bounds
  at 1280×900), which is why a passing suite shipped an unreachable Deny.

- **ITEM-6**: The SAME failure class on the approval card's HEADER row, found by
  inspecting the fixed render at 390px. The header is `flex items-center gap-2`
  with a `truncate` tool name followed by two `whitespace-nowrap` secondary
  labels ("(Acme Weather)" 97px + "— needs approval" 108px = 205px of a 238px
  row). On one line the nowrap siblings starve the tool NAME to a **rendered
  width of 0** (measured `w=0, scrollWidth=98` at 390px; `w=98` at 1280px), so
  the mobile card reads "(Acme Weather) — needs approval" and the user cannot see
  WHICH tool they are approving. Fix by wrapping the header row (`flex-wrap`)
  and giving the name `min-w-0` so `truncate` degrades to an ellipsis rather than
  to nothing. Applied to all three approval headers, which share the pattern
  verbatim.

## Files to touch

- `sdk/packages/kit/src/kit/card.tsx` — add `CardActions` (ITEM-1)
- `sdk/packages/kit/src/index.ts` — barrel export (ITEM-1)
- `sdk/packages/kit/src/KIT_MANIFEST.md` — regenerated (ITEM-1)
- `src-app/ui/src/modules/mcp/chat-extension/components/ToolCallPendingApprovalContent.tsx` (ITEM-2)
- `src-app/ui/src/modules/mcp/chat-extension/components/ElicitationFormContent.tsx` (ITEM-3)
- `src-app/ui/src/modules/mcp/chat-extension/components/AskUserWizardContent.tsx` (ITEM-4)
- `src-app/ui/tests/e2e/visual/approval-actions-reachable.spec.ts` (ITEM-5, ITEM-6)
  — the three header rows edited for ITEM-6 live in the same three component
  files already listed above.

## Patterns to follow

- **Responsive action footer** — mirror the kit's own `DialogFooter`
  (`sdk/packages/kit/src/shadcn/dialog.tsx:136`) and `AlertDialogFooter`
  (`shadcn/alert-dialog.tsx:91`): the kit, not the call site, owns the rule that a
  footer action row does not overflow. `CardActions` is the card-shaped sibling of
  those two, so all three read the same way.
- **Kit component shape** — mirror the existing `sdk/packages/kit/src/kit/card.tsx`
  `Card`: a thin, `cn()`-composed wrapper over a `data-slot`-tagged div, props
  typed as `React.ComponentProps<'div'>` minus the style-gated ones, className
  merged last so a call site can override.
- **Reachability spec** — mirror the existing
  `tests/e2e/visual/approval-actions-reachable.spec.ts`: drive the backend-free
  gallery deep-state (the REAL `ConversationPage` through the production chat
  path), so the card under test is the real component in its real virtualized,
  clipping container and the spec needs no LLM bridge.
- **Design system** — semantic tokens only (this change adds no color), the 4px
  grid (`gap-2`), and logical-direction utilities only. Note the defect itself is a
  logical-direction one: overflow goes out the *inline-start* edge, which is the
  RIGHT edge under RTL — the fix must not encode a physical side.

## UI-surface checklist

- **Precedent** — the twin is the kit's `DialogFooter`/`AlertDialogFooter` action
  row. `CardActions` adopts its role (a footer action cluster that must not
  overflow) with a content-driven rather than breakpoint-driven rule, because a
  card's action row lives in containers whose width is independent of the viewport
  (split panes, side panels, a virtualized message list indented 60px at 390px).
- **Scale / cardinality** — bounded: at most 3 actions per approval card.
- **Device size / responsive** — at 390px the row wraps to two lines
  (Deny + Approve once, then Approve for this conversation on its own capped
  line); at desktop width it is byte-identical to today (a single right-aligned
  row — `flex-wrap` is inert when the content fits). Verified by measurement in
  both themes, before and after.
- **Populated-render review** — the gallery cells `deep-chat-tool-approval`,
  `deep-chat-elicitation`, `deep-chat-ask-user-wizard` are all seeded, populated
  renders; the fix is reviewed against those, at 390px and at desktop.
- **User-visible progress** — unchanged (the card's loading state is the existing
  per-button `loading` prop).
- **Input economy** — unchanged; no new input.
- **JTBD** — "A tool wants to run and I do not trust it. I want to say NO." The
  user is on a phone, reads the tool name, destination host, description and
  arguments, and must be able to press **Deny**. Today the only pressable control
  is the broadest approval. After the fix all three decisions are reachable at any
  container width, with Deny keeping its leading position in both DOM order (tab
  order) and visual order (first on the first line).
- **Multi-instance** — the approval card renders inside split panes; a
  content-driven (not viewport-driven) rule is what keeps it correct in a narrow
  pane at a wide viewport.
- **Platform-provided affordances** — n/a.

## Out of scope (assessed, not changed)

- `JsToolApprovalContent` — its Approve/Deny group is a kit `<Space>`
  (`inline-flex flex-row`, `justify-content: normal`), so any overflow goes out the
  reachable inline-END edge, NOT the unreachable inline-start edge. The root-cause
  predicate (`justify-end` inside an `overflow-hidden` card footer) does not hold
  there. It has no dedicated gallery surface (`coverage.ts` marks it `kind: 'via'`),
  so it is not runnable in the gallery harness; changing it would be an untested
  prophylactic edit.
- `ToolCallPendingApprovalCancelContent` — informational only, renders no controls.
- The 54 other `justify-end` flex rows app-wide — a global sweep is a separate
  effort; most live in dialogs, which already use the responsive `DialogFooter`.
- Tap-target size: the decision buttons are 32px tall, under the taxonomy's
  `G5 [G] tap-target ≥ 44px on mobile for primary actions`. Real, but a distinct
  class the rig did not raise here; changing button height app-wide is not this
  branch's blast radius.
