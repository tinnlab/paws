# mobile-approval-clipped — DECISIONS

All resolved up front, nothing deferred. None of these are product choices about WHAT the
feature does (the feature is "the existing controls remain pressable"), so none is
escalated as a picker; each is resolved by codebase precedent or by measurement.

### DEC-1: Is the responsive rule breakpoint-driven (viewport) or content-driven (wrap)?
**Resolution:** content-driven — `flex-wrap` on the action row plus a per-child
width cap. Explicitly NOT the `sm:flex-row` viewport breakpoint that the kit's own
`DialogFooter` uses.
**Basis:** codebase — measured. The approval card is **270px wide inside a 390px
viewport** (`denyclip-siblings-before.log`: card box `[60,330]`, footer content box
238px), because the message row is indented in the virtualized list. The same card
also renders in split panes and side panels at desktop viewport widths. A viewport
breakpoint would therefore report "wide" while the container is narrow and
re-introduce the exact bug. `flex-wrap` is self-tuning: it is inert whenever the
row fits (so desktop is byte-identical), and engages exactly when it does not.

### DEC-2: Where does the fix live — the call sites, the kit's `CardFooter`, or a new kit primitive?
**Resolution:** a new additive kit primitive, `CardActions`, adopted by the four
approval-family footers. `CardFooter` is left alone.
**Basis:** convention + measurement. Four call sites need the identical
six-utility incantation, so repeating it is the `affordance-parity / reuse`
anti-pattern the audit angles flag. Changing `CardFooter` itself would hit **101**
`footer=` call sites (`grep -rn "footer=" --include=*.tsx src-app/ui/src
src-app/desktop/ui/src | wc -l`), many passing non-action content, for a focused
layout fix — disproportionate. An additive export mirrors the kit's existing
`DialogFooter`/`AlertDialogFooter` role without any blast radius, and lets the
other 101 adopt it later.

### DEC-3: How does an action WIDER than the whole line behave?
**Resolution:** it is capped to the line (`max-w-full`) and its LABEL wraps
(`whitespace-normal`, with `h-auto` + `min-h-8` + `py-1` so the control grows
instead of spilling). It is never truncated and never ellipsised.
**Basis:** convention — the approval card's sibling contract from the
`chat-ui-robustness` lifecycle (INV-3, "never truncated/summarized — poisoning
hides in truncation") applies to the whole consent surface, not only the tool
description. `flex-wrap` alone does not cover this case, because a kit `Button`
carries `shrink-0 whitespace-nowrap` (`sdk/packages/kit/src/shadcn/button.tsx:7`)
and so cannot shrink; measured, `Approve for this conversation` is 251px against a
238px line.

### DEC-4: The child-constraint selector out-specifies a child's own size utility. Accept or work around?
**Resolution:** accept, and document it in the primitive's JSDoc. `CardActions`
normalizes children to `min-height: 32px` (`size="default"`); a caller wanting a
taller control sets it on the row via `className`.
**Basis:** convention — `[&>*]:min-h-8` generates `.row > *` (specificity 0,2,0),
which beats a child's own `.min-h-9` (0,1,0). All four current call sites use
`size="default"`, so there is no live regression. The alternatives (a `:where()`
wrapper that relies on Tailwind's layer ordering, or per-size variants on the row)
add fragility for a case with no consumer. Documenting the contract is the
api-friendliness answer; a future `size="lg"` caller is told what to do.

### DEC-5: The `deep-chat-elicitation-no-fields` gallery surface does not render the no-fields card. Add a cell, or scope the claim?
**Resolution:** scope the claim. TEST-5 asserts only what that surface genuinely
renders (measured: `elicitation-decline` present, `elicitation-accept-no-values`
ABSENT), and the no-fields variant's coverage is stated honestly in TEST_RESULTS
rather than claimed. No new gallery cell.
**Basis:** convention — writing a spec against a slug that does not render the
component under test is precisely the "phantom leg / paper-9/9" failure the audit
angles call out. The no-fields footer still receives the fix (it is the same file
and the same primitive); what is not claimed is a rendered proof of it. Adding a
seeded no-fields cell is real gallery work, out of proportion to this branch.

### DEC-6: Does the fix change the ORDER or prominence of the decision controls?
**Resolution:** no. DOM order stays Deny → Approve once → Approve for this
conversation, and visual order matches it (no `flex-col-reverse`), so Deny is
first on the first line at every width; tab order and visual order stay identical.
**Basis:** convention + safety. The kit's `DialogFooter` uses `flex-col-reverse`
(primary on top when stacked), but that convention is for a dialog whose primary
action is the confirm. On a consent surface the safe action must not be visually
demoted below two approvals — and inverting visual order relative to DOM order
would also split tab order from reading order, an a11y regression
(CODING_GUIDELINES §13).

### DEC-7: Is any operational tunable introduced (settings row vs constant)?
**Resolution:** none. This change adds no limit, threshold, retention, toggle, cap
or timeout — it is a pure CSS layout rule with no runtime configuration surface,
so the configurable-settings rule has nothing to bind to.
**Basis:** convention — the mandatory configurable-settings DEC is answered
explicitly rather than by omission.

### DEC-8: Tap-target size (32px, under the taxonomy G5 44px floor) — fix here or not?
**Resolution:** not here. Recorded in PLAN.md `## Out of scope` with the taxonomy
class, and reported to the orchestrator.
**Basis:** convention — `G5 [G] tap-target >= 44px on mobile for primary actions`
(`DEFECT_TAXONOMY.md:77`) is a distinct class the rig did not raise on this
surface, and raising button height would change every kit action row's density.
Bundling it would make a focused, verifiable fix into an unbounded visual change.

### DEC-9: A second 390px defect was found on the same card mid-implementation. Fix here, or report and defer?
**Resolution:** fix here (ITEM-6). The approval card's header starves the TOOL
NAME to a rendered width of 0 at 390px; the card reads "(Acme Weather) — needs
approval" with no indication of which tool. Fixed in the same branch, in all
three approval headers, and pinned by TEST-8.
**Basis:** convention — it is the same taxonomy class (B2 failure-to-wrap) on the
same surface at the same viewport, and the fix is the same single utility, so it
is within this branch's thesis rather than an expansion of it. Contrast DEC-8
(tap-target), which is a DIFFERENT class needing an app-wide density change and
is therefore correctly deferred. The deciding question is not "did the rig report
it" but "does this branch's claim — the mobile approval card works — hold
without it"; here it does not.

### DEC-10: The disclosure fix stopped converging. Keep iterating, or split it out?
**Resolution:** SPLIT IT OUT. Revert the round-3/4/5 disclosure escalation, keep
the converged reachability + anti-starvation work, and hand the disclosure
problem over with its measurements for its own lifecycle.
- DESCOPED: ITEM-6-disclosure — a name/label LONGER than the wrapped line still
  ellipsises. Three attempts inside this branch each shipped a worse defect and
  the audit profile went flat (12, 9, 7, 9, 9), so the phase-7 validator required
  an abort rather than another round. [approved: phase-7 convergence gate,
  2026-07-28 — "fix loop is NOT CONVERGING and must be ABORTED, not continued …
  Re-scope instead"]
**Basis:** convention — the gate's own rule, and the ledger supports it: rounds
1-2 (reachability) decayed 35 → 15 → 9 and went quiet, while rounds 3-5
concentrated 2 → 3 → 6 findings in the one file carrying the disclosure work,
with two of them being regressions introduced by the previous round's fix. The
reverted state is strictly better than base on every axis, so splitting costs
nothing that was already working.
