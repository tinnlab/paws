# FIX_ROUND-1

Three blind angles ran against `git diff main...HEAD`, with no author context:
**design-conformance** (required — audited against `docs/design/composer-picker-popover.md`
and INV-1..5, not against PLAN.md), **tests-quality / test-reality**, and
**correctness + ux-a11y + responsive-fidelity**. 28 ledger rows.

## What the round found

**Three HIGH defects, all corroborated by two independent angles, all in the new
primitive, and all invisible to the tests that shipped with it:**

1. **The "No assistant" clear row was filtered away by the search box.** The filter had
   no exemption for action rows. Adding search — the feature's headline — is what
   created the regression: the old picker had no search, so the row was always
   reachable. Fixed with a `pinned` flag; locked by TEST-26.
2. **Clicking a row moved DOM focus off the search input.** Rows are non-focusable and
   the Base UI popup is `tabIndex=-1`, so the first click stranded every later keystroke
   and left `aria-activedescendant` pointing from an unfocused element. This was the
   DEFAULT flow for the multi-select KB picker, which stays open by design. The e2e had
   MASKED it, because Playwright's `fill()` re-focuses the input before typing. Fixed
   with `mousedown` preventDefault; locked by TEST-24.
3. **The no-matches state emitted `aria-expanded="true"` + a dangling `aria-controls`**
   for a listbox that is not rendered — an axe `aria-valid-attr-value` violation at
   critical impact, reachable from the gallery surface this branch itself adds. Fixed;
   locked by TEST-27.

**One prediction did NOT survive contact.** An angle argued from four code paths that
Enter on the trigger would double-toggle (the row's own handler plus Base UI's button
emulation) and the picker would never open by keyboard. A mounted probe driving the REAL
`PlusMenuItem` shows it opens. Recorded `rejected-not-reproducible` — and rather than
just dismissing it, the case is now pinned by TEST-25 (unit, real trigger) and a
real-browser keyboard-open leg in TEST-15, so the claim is settled by execution in both
environments.

**One hypothesis in my own brief was wrong, and the audit corrected it.** I asked whether
overlayscrollbars wraps between the listbox and its options; it does not (its host sits
ABOVE the listbox). The wrapper that DID sit between them was my own per-item `<div key>`,
which I had already found with a DOM probe. One angle called it a gate failure; the other
verified axe does not flag it (`getOwnedRoles` recurses through role-less nodes). The
accurate verdict is the second one: an AT-quality defect, not a gate failure. Fixed
regardless — a listbox whose children are not options is wrong on the spec's own terms.

**The tests-quality angle was the highest-yield on this diff.** Beyond TEST-13 (which the
first e2e run had already turned red), it found that scroll-reachability was VACUOUS —
Playwright's `toBeVisible()` is true for a row clipped inside an overflow scroller, so
deleting the scroll step left both tests green — that TEST-16's parity comparison was
true by construction and would survive deleting BOTH caps, that TEST-18 never measured
the icon size it claimed and hid its cross-item comparison behind an `if (isVisible())`,
that TEST-9's kit-import assertions passed vacuously on an empty list, and that TEST-20
claimed `gate:ui` coverage for gallery STORIES at 390px when `runtime-health` enumerates
only pages/overlays/deep/seeded and is hardcoded to 1280×900. Each is now either a real
assertion or corrected prose; the four picker states moved from story-only into
`OverlayEntry`s so they are genuinely gate-driven, and TEST-22 adds the missing 390px
leg against the real popover.

**Dead code removed:** `ComposerPickerItem.disabled` had no production, gallery or test
caller, making its guard, its `aria-disabled` attribute and two utility classes
unreachable (CODING_GUIDELINES §15).

## Not fixed, and why

- **`stateCoverage.ts` reconciliation of five unrelated surfaces** — flagged as scope
  creep, and it is. Accepted and documented as ITEM-12: `origin/main` is ALREADY red on
  this gate in a fresh worktree, so the branch cannot record a green `npm run check`
  without absorbing it. Kept in its own commit so it can be split off.
- **KB rows lost per-row `tabIndex` + Enter/Space** — accepted by design. The ARIA
  combobox/listbox model deliberately replaces N tab stops with one focused input plus
  `aria-activedescendant`. It is only sound *because* the focus-retention fix landed;
  without that, this would have been a keyboard dead end.
- **The `scrollable-region-focusable` axe question** — left `deferred-to-gate`. It was
  explicitly UNVERIFIED in the report and is settled by running `gate:ui` in phase 8,
  not by argument.

## Verification

Every fix was proven by RUNNING it, not by reading. The focus-loss and ARIA-parentage
defects were each reproduced with a throwaway mounted probe FIRST (both went red), then
fixed, then locked by a permanent test. Component suite: 18/18. `npm run check`: exit 0
in both workspaces. The full enumerated set runs once in phase 8.

**New confirmed findings:** 0
