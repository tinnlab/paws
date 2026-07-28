# DESIGN_FIDELITY — does the plan uphold DESIGN.md's invariants?

- **INV-1** — fidelity: UPHELD — ITEM-1 resolves every `#/components/schemas/…`
  reference through all container and composition keywords, and every cut it makes
  (cycle / depth / budget / size) rewrites to `#/$defs/…` with the target emitted
  into a sibling `$defs` — so no output path can leave a pointer the recipient
  cannot dereference. TEST-1..5 pin the resolution; TEST-10/11 pin that the
  fallback forms still contain no `#/components/` pointer.
- **INV-2** — fidelity: UPHELD — ITEM-2 makes the budget explicit
  (`MAX_DEPTH` / `MAX_EXPANSIONS` / `MAX_SCHEMA_BYTES`) and degrades in two
  ordered steps that both emit valid, self-contained JSON Schema: first the
  compact `$defs` form (each schema exactly once), then, only past a hard cap,
  named-but-elided `$defs` entries carrying a `$comment`. Nothing is cut
  mid-structure, and the outcome is reported (`schema_form`,
  `schema_truncated`) rather than hidden. TEST-9/10/11 pin it.
- **INV-3** — fidelity: UPHELD — ITEM-1 detects a cycle by the resolution STACK,
  not by a depth heuristic, so a self-referential or mutually recursive component
  is cut at its first re-entry and expressed as a real `$defs` self-reference
  (the standard way to write a recursive JSON Schema). TEST-7/8 are the
  self-recursive and mutual-recursion termination proofs.
- **INV-4** — fidelity: UPHELD — ITEM-5 reads the permission from the 403 response
  example, which `with_permission` attaches and which no later `.description()`
  can overwrite; the description marker stays the primary source, so nothing
  regresses for the 207 operations that still carry it. TEST-13/14 pin the unit
  behaviour, TEST-22 pins the real `Project.create` end to end, and TEST-23 proves
  it is not cosmetic — the restored permission actually gates a limited user.
- **INV-5** — fidelity: UPHELD — ITEM-6 + ITEM-7 put the rule in BOTH channels the
  model reads (the `describe_capability` / `invoke_capability` descriptors and the
  per-turn control nudge), name `ask_user` explicitly, and name the schema keys
  that make the form good — including `default`, which the wizard honours but the
  `ask_user` descriptor never mentions, so "pre-filled with sensible defaults" is
  actionable rather than aspirational. TEST-17/18 guard the text; TEST-25 is the
  executable proof that a real model faced with a vague request renders the form
  instead of a prose questionnaire.
- **INV-6** — fidelity: UPHELD — ITEM-4 walks the request body RECURSIVELY
  (`parent.child`, `items[].child`) so nested shape is visible in the digest, and
  ALWAYS appends the exact inlined JSON Schema so the digest can never be the
  model's only view. TEST-16 asserts a nested inner field name reaches the digest;
  TEST-24 asserts the schema block is present alongside it.
