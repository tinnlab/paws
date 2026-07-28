# DESIGN_FIDELITY — workflow-builder-ux

One verdict per invariant in `PLAN.md` `## Invariants`, checked against
`DESIGN.md`.

- **INV-1** — fidelity: UPHELD — ITEM-1 maps every backend `code` to person-facing
  copy at the presentation boundary, and ITEM-2 makes an unmapped code fail
  `cargo test` rather than ship. The design's reasoning (§2.1 — the backend's
  precision is correct and must be preserved; the humanisation belongs where the
  step kind is known) is realized literally: the backend keeps
  `WORKFLOW_PROMPT_MISSING` / "step has neither prompt: nor prompt_file:"
  unchanged, and the UI never renders that string. The fallback-to-raw-message
  rule is a deliberate softening for an unmapped code — but because ITEM-2 makes
  an unmapped code impossible to introduce, the fallback is a defence-in-depth
  path, not an escape from the invariant.

- **INV-2** — fidelity: UPHELD — ITEM-3 gives every finding a step name and makes
  it navigate (`store.selectStep`), and ITEM-4 marks invalid steps in the list so
  the user does not click each one. Both halves of §2.2's sentence are covered by
  separate items, so neither can be quietly dropped.

- **INV-3** — fidelity: UPHELD — ITEM-5 replaces the free-text Tool field with a
  picker enumerated from the server's real `tools/list`. The design states the
  rule GENERALLY ("an entity reference the system can enumerate", §2.3), so the
  plan pins it with a CLASS test (`noFreeTextEntityRef.test.ts`) that scans the
  builder's step forms for any free-text control bound to an enumerable field —
  not a test that "the Tool field is a select". A future step form that adds a
  free-text `model`/`assistant`/`server` field fails that test.

- **INV-4** — fidelity: UPHELD — ITEM-7 generates one typed control per declared
  property, carrying required/optional, type, default and description, from the
  tool's own `input_schema`. It reuses the app's existing JSON-Schema→control
  vocabulary rather than inventing a parallel one, so the generated fields match
  what the app already shows a user for an elicitation form.

- **INV-5** — fidelity: AT-RISK — ITEM-8 carries it, but the design's sentence
  ("a typed field must accept a reference where it would accept a literal") has a
  genuine tension with typed controls: an `InputNumber` or a `Switch` cannot hold
  `{{ inputs.n }}`. The plan's answer is a per-field switch to a template-text
  input, which satisfies the invariant only if that switch is (a) discoverable and
  (b) reversible. **Standing debt for phase 6 + the acceptance test**: the
  acceptance test must drive a `{{ … }}` reference into a NON-string typed field
  and assert it survives a save→reload round-trip, not merely that a string field
  accepts one. DEC-5 fixes the affordance before implementation.

- **INV-6** — fidelity: UPHELD — ITEM-9 makes the fallback visible and reasoned
  ("Couldn't reach {server} — enter the tool name and arguments by hand.") and
  ITEM-6's unresolvable-name path routes into it rather than rendering a silently
  empty picker. The design's "never silent" clause is the one most likely to be
  eroded in implementation (an empty options array is the lazy path), so it is
  called out as a phase-6 audit checkpoint and is pinned by its own acceptance
  test.
