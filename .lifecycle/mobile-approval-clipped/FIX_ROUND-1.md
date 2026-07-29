# mobile-approval-clipped — FIX ROUND 1

Four blind reviewers (diff-only context, no access to my reasoning) audited the
round-1 diff across correctness, security, a11y, tests-quality,
design-conformance, patterns-conformance, responsive-fidelity, modularity,
maintainability, api-friendliness, state-management, perf, i18n, error-handling
and scope. `LEDGER.jsonl` carries every finding. Two independent reviewers
converged on the two most serious ones, which is what promoted them from
"opinion" to "fix now".

## Fixed — product

- **The wizard footer reproduced the original defect INSIDE the fix** (2
  reviewers). `CardActions`' protections apply to DIRECT children, so grouping
  Back/Next in a nested `<div>` left them with the kit Button's `shrink-0
  whitespace-nowrap` and no width cap: a single over-wide nav label would still
  overflow out of the unreachable inline-start edge. Every action is now a direct
  child, with the split expressed as `me-auto` on Decline. That also fixes the
  second half of the finding — `justify-between` places a wrapped line holding
  ONE item at main-START, so the navigation group (carrying the primary action)
  would have jumped to the inline-start edge exactly when the row wrapped.
- **The `[&>*]` child rules leaked onto non-controls** (3 reviewers; one compiled
  Tailwind to confirm the emission order). A plain wrapper `<div>` was receiving
  `py-1 min-h-8`, growing that footer ~8px at EVERY width — falsifying the
  primitive's own "inert whenever the row fits" contract. Scoped to
  `:is(button,a)`.
- **A long unbroken token still clipped** (i18n). `whitespace-normal` breaks only
  at spaces, so a translated label whose longest TOKEN exceeds the line was still
  cut by the Card's `overflow-hidden` — the very failure the primitive exists to
  prevent, just in a non-English label. Added `break-words` (+ `text-center`, so
  a wrapped 2-line label is not ragged inside a flex-centred button).
- **Four more instances of the header defect in the same module** (scope). The
  cancelled/denied card — the TERMINAL state of the very card being fixed — plus
  three cards in `extension.tsx` all carried the identical
  `truncate`-beside-`whitespace-nowrap` header. All now wrap. Found by a
  reviewer searching for the PATTERN rather than the reported instance.
- **`min-w-0` on the truncating headers was a no-op** and its comment claimed
  causal weight (2 reviewers). A `truncate` element is `overflow:hidden` and so
  already has an automatic minimum size of zero — which is precisely WHY it lost
  to its nowrap siblings. Removed; the comments now name the real mechanism.
- **`data-slot` was clobberable** — written before the prop spread, so a caller
  could overwrite the only selector the row is addressed by. Moved after.

## Fixed — the guard (the more serious half)

- **`measureReach` mis-classified the clip predicate** (2 reviewers, HIGH). It
  treated an `overflow:hidden` ancestor WITH overflow as "a programmatic
  scroller, so reachable". `overflow:hidden` is not user-scrollable — no
  scrollbar, no wheel, no touch pan — and the Card root is exactly such a box, so
  the END-edge mirror of the defect under test would have measured green. Now
  `hidden`/`clip` always clips and only `auto`/`scroll` is treated as reachable.
- **TEST-5 was paper coverage** (HIGH). The elicitation footer is ~146px of a
  ~238px row, so it never overflowed at 390px and every reachability assertion
  passed identically on the pre-fix markup. It now stresses an over-wide label
  and asserts the row wraps and stays unclipped. TEST-6 got the same treatment
  plus a structural assertion that every action is a protected DIRECT child.
- **Position comparisons were scroll-dependent** (2 reviewers). TEST-3/TEST-4
  compared viewport-relative `top` values sampled across separate
  scroll-then-measure calls, so scroll drift could make an unwrapped row look
  wrapped (or fail a wrapped one). Added `measureRow`: one scroll, one
  `evaluate`, mutually comparable rects.
- **The navigation retry could launder a real regression** (2 reviewers). It
  caught EVERY error, so an intermittent product bug was indistinguishable from
  the documented environmental import failure; and its budget (3x12s + 25s)
  exceeded the 60s per-test timeout, so the saved error could never actually be
  rethrown. It now retries only when the app itself failed to arrive (loader
  console signature or the "Unknown content type" fallback), rethrows anything
  else on the FIRST attempt, and fits inside a raised, documented per-test budget.
- **TEST-8 accepted a truncated tool name** (security). The 60px floor was an
  unexplained magic number, and the name is attacker-controlled: `get_forecast…`
  reads identically for `get_forecast_daily` and `get_forecast_hourly`, so a
  partial name is MISLEADING, not merely less legible. Now requires the name to
  render in full.
- **TEST-4's order assertion was tautological** when the selector matched 0 or 1
  elements, and encoded LTR. Now asserts the control count and compares along the
  INLINE axis via the document's direction.
- **The design rationale's motivating case was untested** (2 reviewers). Every
  test drove the VIEWPORT, while the whole argument for a content-driven rule is
  that a card's container width is independent of the viewport. Added TEST-9: a
  260px-wide card at a 1280px viewport, which a `sm:` breakpoint would have
  missed.

## Fixed — documentation accuracy

- The doc claimed the child rules win by SPECIFICITY. Two reviewers compiled
  Tailwind and showed the then-unscoped `[&>*]` selectors were both (0,1,0), so
  the override won by EMISSION ORDER. Corrected — and then corrected AGAIN in
  round 2, because scoping the rules to `:is(button,a)` in this very round made
  them (0,1,1), i.e. specificity after all. A good illustration of why a comment
  asserting a mechanism has to be re-checked whenever the code it describes moves.
- The documented escape hatch ("set the height on the row via `className`") does
  not work — a row-level height cannot reach the child rules. Corrected to the
  real one (re-declare the variant).
- `KIT_MANIFEST.md` — the doc agents are told to read — described the primitive
  as "_No always-required props._" while it silently normalizes its children. The
  full child contract was moved onto the props type. NOTE: round 2 showed this
  did NOT achieve what it claimed — the manifest generator emits per-PROP rows
  only, so a type-level comment never reaches it. The comment now says so and
  points the reader at the source instead.

## Accepted, NOT fixed (recorded and reported, not silently dropped)

- **Consent-surface prominence** (security/a11y, 2 reviewers): after wrapping,
  "Approve for this conversation" renders full-width, filled and ~2 lines tall
  while Deny stays 81x32 outline — reachability is restored but relative
  prominence now favours the broadest approval. This is a genuine PRODUCT/design
  choice about a safety surface, so per the audit-vs-user-decision rule it is
  surfaced to the owner rather than unilaterally restyled. Reported.
- **Tap-target 32px < the taxonomy G5 44px mobile floor** — pre-existing, DEC-8;
  raising kit button height is an app-wide density change.
- **`CardFooter` left alone.** A reviewer correctly showed the "101 call sites"
  figure counts Drawer/Modal footers too (~37 are Card footers, ~7 hand-rolled),
  so the blast-radius argument is weaker than stated. It is still a real blast
  radius for a focused fix, and the remaining Card footers keep the latent trap —
  recommended as a follow-up, with the corrected numbers.
- **No lint forbids the hand-rolled pattern.** The durable fix is a guardrail
  rule on `footer={<div className="…justify-end…">}`; out of scope here,
  recommended.
- Two findings were REJECTED as not-a-defect and are marked `rejected` in the
  ledger with reasons (TEST-7 measuring post-fix widths; `measureRow` ignoring
  containing-block semantics for absolutely-positioned descendants — no such
  descendant exists on these surfaces).

## Round-2 verification

A fresh blind reviewer (no access to round 1's findings or my reasoning) audited
the UPDATED diff across correctness, security, tests-quality, scope and
regression risk. It found NEW real defects — see `FIX_ROUND-2.md`, which is this
round's honest result: the loop had not converged after one round.

**New confirmed findings:** 12
