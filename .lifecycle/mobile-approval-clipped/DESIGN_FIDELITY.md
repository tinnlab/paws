# mobile-approval-clipped — DESIGN FIDELITY

One verdict per invariant in `PLAN.md` → `## Invariants`.

- **INV-1** — fidelity: UPHELD — "pushing "Deny" off screen is the cheapest way to
  leave "Approve" as the only action in view." The plan restores exactly that
  property on the axis it is broken on: ITEM-1/ITEM-2 make the action row wrap so
  every decision control stays inside the card's content box at any container
  width, and ITEM-5 pins it with a test that asserts **hit-testability**
  (`elementFromPoint` at the control's centre resolves to the control), not DOM
  presence — which is the distinction the defect turns on, since all three buttons
  were present in the DOM the whole time. The plan explicitly does NOT weaken the
  invariant to "reachable at desktop": the test runs at 390px, in both themes.

- **INV-2** — fidelity: UPHELD — "failure-to-wrap — content clipped/protruding
  where wrap/ellipsis was possible". ITEM-1 makes wrapping the row's default
  behavior (`flex-wrap`), and covers the residual case the taxonomy's wording
  implies but a bare `flex-wrap` misses: a SINGLE action wider than the line, which
  cannot wrap between items and would still protrude. The plan caps such a child to
  the line width and lets its LABEL wrap, so nothing is ever clipped where wrapping
  was possible. Deliberately no ellipsis/truncation on this surface — the card's
  sibling contract (`chat-ui-robustness` INV-3) is that a consent surface never
  hides text behind truncation.

- **INV-3** — fidelity: UPHELD — "element border clipped by ancestor/container — a
  bordered box whose border-box reaches/exceeds a NON-scrolling clipping ancestor's
  (overflow hidden/clip) content edge". The fix keeps every control's border-box
  inside the card's content box, so the `overflow-hidden` clip never engages,
  rather than removing the clip (which is load-bearing for the card's rounded
  corners — see PLAN_AUDIT § Breakage risk). ITEM-5's assertion is measured against
  the real clipping-ancestor chain: it compares each control's rect to the
  intersection of every non-scrolling `overflow` ancestor, which is precisely the
  A11 predicate.

- **INV-4** — fidelity: UPHELD — "FULL, EXACT advertised description (never
  truncated/summarized — poisoning hides in truncation)". The invariant's point is
  that a consent surface's disclosure must REACH the user; a string that is in the
  DOM but rendered at zero width discloses nothing. ITEM-6 restores the tool name
  to a rendered width at 390px by wrapping the header row instead of letting two
  `whitespace-nowrap` secondary labels starve it, and TEST-8 pins it on RENDERED
  WIDTH rather than text presence — deliberately, because the pre-existing TEST-11
  asserts `toContainText('get_forecast')` and passed throughout the defect. Note
  the fix adds no truncation: `min-w-0` only lets an over-long name degrade to an
  ellipsis on its own full line, instead of to nothing.
