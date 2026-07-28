# DESIGN_FIDELITY — workflow-prompt-validation

One verdict per invariant in `PLAN.md` `## Invariants`, checked against the plan.

- **INV-1** — fidelity: UPHELD — the plan does not patch the one reported cell;
  it removes the ability of the two sides to disagree at all. ITEM-1 introduces
  ONE rule, ITEM-2 makes `validate.rs` derive its verdict from it and ITEM-3
  makes `dispatch.rs::load_raw_prompt` derive its arm from it, so "validate green
  ⇒ run ok" holds by construction rather than by two matching hand-written
  matches. ITEM-4 closes the two remaining cells where validate answered a
  filesystem question it gets wrong (empty `prompt_file`, and a `prompt_file`
  naming a directory) — both of which are validate-GREEN/run-RED today, i.e. the
  same invariant, not a different one. The second half of the invariant ("RED
  must not quietly succeed with a degenerate prompt") is upheld by ITEM-3's one
  deliberate tightening: `prompt: ""` alone stops resolving to `Ok("")`. ITEM-5
  extends the same single rule to the client so the builder cannot disagree
  either. The invariant is pinned executably by TEST-1, which asserts the
  IMPLICATION over the whole state matrix through the real `validate_collecting`
  and the real `load_raw_prompt` — so it fails if EITHER side drifts, which is
  what makes it a proof of the design rather than of the code.

- **INV-2** — fidelity: UPHELD — ITEM-6 removes the CAUSE (the negative margins)
  rather than compensating for it, and does so with grid-aligned
  logical-direction padding, which is what "on-system, not a magic offset"
  requires; ITEM-8 performs the exit condition the invariant states verbatim
  ("Lower this to 1 once the kit addon is fixed"). ITEM-7 adds the missing
  permanent guard: the builder spec only ever TOLERATED the defect, so without a
  probe that asserts zero overflow the invariant would rest on a tolerance
  constant nobody has to re-examine. The invariant is pinned executably by TEST-7
  (gallery, 390px, zero overflow + addon inside its group) and re-proven at
  full-stack scale by TEST-8.
