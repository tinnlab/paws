# DESIGN_FIDELITY — does the plan uphold each design invariant?

One verdict per `INV-N` in `PLAN.md` § Invariants, checked against
`docs/design/paws-ui-polish.md`.

> Read this for what it is worth. The skill records that across 22 audited
> features this artifact came back 84 UPHELD / 0 DROPPED and never once fired,
> and that where it mattered it was *wrong* — an author's own verdict on whether
> they honoured the design carries no information. The load-bearing checks are
> the `[acceptance]` tests (phase 3/8) and the **blind** `design-conformance`
> angle (phase 6). These lines are a thinking aid, not evidence.

- **INV-1** — fidelity: UPHELD — ITEM-1 moves BOTH bounds onto the panel and makes the width viewport-relative (`w-[min(21.25rem,calc(100vw-2rem))]`), which is what makes the claim hold at a narrow viewport rather than only at desktop; ITEM-2 closes the second, independent overflow inside the row so the percentage cannot be pushed out even once the panel is bounded. ITEM-3 makes the state observable at all, which is the precondition for the acceptance test asserting it.
- **INV-2** — fidelity: UPHELD — ITEM-4 makes the container a single flex row for both layouts (the desktop `LeftSidebar.desktop.tsx` returns the core component verbatim off macOS and never touches slot composition, so there is one implementation, not two). The "still correct when only one is present" half is real and not incidental: the download widget self-hides whenever nothing is downloading, which is its normal state — so the one-child case is the COMMON case and is pinned by its own acceptance leg.
- **INV-3** — fidelity: UPHELD — ITEM-6 removes the source (the fresh-install half) and ITEM-7 deletes the already-synced rows (the upgraded-install half). Both are required: the design states plainly that removing the directory alone does not satisfy the invariant, because the built-in sync is insert-or-update with no prune and a built-in row is admitted by the gating query unconditionally. The acceptance test therefore has to prove the UPGRADE path, not just that a fresh sync produces N-3 skills.
- **INV-4** — fidelity: UPHELD — ITEM-8 rewrites the three surviving skills whose instructions route the user through the Hub. Note this invariant is about CONTENT, so its acceptance test must read what the model would actually be given, not merely assert the files changed.
- **INV-5** — fidelity: **AT-RISK** — and deliberately recorded as such rather than asserted UPHELD. ITEM-13/14 are the intended fix, but the cause is **not yet established** (ITEM-12 reproduces first), so "the plan upholds INV-5" is at this point a hypothesis about a defect I have not yet observed. ITEM-14 is scoped to the two states the code names today; if the reproduction surfaces a third, the plan is amended (drift `plan-wins`) rather than the invariant being quietly narrowed to what was built. This is the standing debt phase 6 and the acceptance test must resolve.

No `DROPPED` verdicts.
