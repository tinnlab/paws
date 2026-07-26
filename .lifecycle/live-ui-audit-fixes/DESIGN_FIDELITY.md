# DESIGN_FIDELITY — live-ui-audit-fixes

One verdict per invariant in `PLAN.md` §Invariants.

- **INV-1** — fidelity: UPHELD — ITEM-7 does not weaken the responsive contract:
  it re-measures the reported 390 px overflow on a correct build, names the
  mechanism, and (TEST-9) leaves an executable 390 px `body.scrollWidth <=
  innerWidth` + no-clipped-control guard on the conversation view so the
  invariant becomes machine-checked rather than merely observed once. No
  `overflow-hidden` masking is used anywhere in this feature.
- **INV-2** — fidelity: UPHELD — ITEM-1+ITEM-3 remove the burst at its source:
  the client stops issuing one templated request per conversation and the server
  answers the whole set in ONE `= ANY($1)` query, so the "many ids on one
  endpoint template" pattern cannot form on either side. The fix is a batch, not
  a suppression: every conversation still gets its true membership answer.
- **INV-3** — fidelity: UPHELD — ITEM-4+ITEM-5 collapse the three independent
  `GET /api/llm-models` callers onto one coalesced fetch, so "same url+method
  ≥2× in a step" is structurally impossible for that endpoint within a load
  burst; the callers still each receive the full, correctly-filtered list.
- **INV-4** — fidelity: UPHELD — ITEM-6 makes the accent swatch render the
  preset's value FOR THE RESOLVED THEME, which is precisely what "bypass the
  accent + dark-mode system" forbids: today the dark-mode swatch paints a
  light-mode value on a dark surface. The inline `style` stays (with its
  `data-allow-custom-color` opt-out) because a color-preset swatch is the
  documented genuinely-dynamic exception — the defect is the WRONG variant, not
  the mechanism.
  Standing debt (tracked, not dropped): even after the fix, the 7 NON-selected
  swatches still paint colors that are not the live `--primary`, so the audit's
  palette-drift detector will keep flagging them. That is inherent to a color
  PICKER and is exactly the case the repo's own lint carves out via
  `data-allow-custom-color`; the runtime detector does not read that marker.
  Reported as a detector false-positive class in TEST_RESULTS.md rather than
  "fixed" — and the audit skill is NOT edited to hide it (that would be routing
  around shared infra, `feature-lifecycle` B3).
- **INV-5** — fidelity: UPHELD — ITEM-8 is the whole point of the feature: the
  same battery, same flags, same backend, same seeded data, run before and
  after, with the per-finding signal recorded both ways. ITEM-7's non-reproducing
  findings are reported WITH their own measurement and root cause (the 27 KB
  partial CSS bundle at `:1520`), never as a claimed fix.
