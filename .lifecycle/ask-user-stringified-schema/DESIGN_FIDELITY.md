# DESIGN_FIDELITY — ask-user-stringified-schema

One verdict per invariant in PLAN.md's `## Invariants`, against
`.lifecycle/ask-user-stringified-schema/DESIGN.md`.

- **INV-1** — fidelity: UPHELD — the plan does not stop at the reported call
  site. ITEM-3 fixes `ask_user.schema`; ITEM-7 fixes the elicitation ingress
  shared with three external-server sites; ITEM-9 fixes all three
  `invoke_capability` object arguments; ITEM-11..15 fix every remaining
  object/array argument the codebase audit found (citations, background_mcp,
  workflow_mcp, knowledge_base, lit_search). PLAN_AUDIT enumerates the descriptor
  line for each, so "every such argument" is a checked claim, not an aspiration.
  ITEM-1 makes it ONE helper rather than 13 copies, which is what makes the
  "every" enforceable.

- **INV-2** — fidelity: UPHELD — ITEM-1's rules decode only, and only into the
  DECLARED shape: a decoded value that is not the requested `ArgShape` is an
  `ArgError`, never the argument. Critically the plan does NOT fall back to the
  default on a bad decode — `ask_user`'s `{"type":"object"}` default (ITEM-3) is
  reached only when the argument is genuinely ABSENT or `Null`, never when a
  supplied argument failed to decode. That distinction is the whole of INV-2 and
  is the easiest thing to get wrong, so it is called out here and pinned by an
  acceptance test.

- **INV-3** — fidelity: UPHELD — ITEM-1 fixes the bound as the compile-time
  constant `MAX_STRING_UNWRAPS = 2` and structures the unwrap as a bounded
  repetition, not a `while let`. Exceeding the bound is one of ITEM-2's four
  named error causes, so the bound is observable to the model rather than a
  silent truncation. ITEM-4's ordering (reject an oversized RAW value before
  parsing it) is the allocation half of the same invariant: a 2 MB string is
  never handed to `serde_json::from_str` at all.

- **INV-4** — fidelity: UPHELD, with a documented reachability note — ITEM-4
  measures the RAW value first and the DECODED value second, both against
  `MAX_STRUCTURED_CONTENT_BYTES` and both before `cap_requested_schema`, so the
  existing comment's reasoning survives verbatim and a payload over the limit in
  EITHER form is refused. PLAN_AUDIT's ITEM-4 verdict records that the decoded
  leg is provably unreachable for JSON (`len(encoded) >= len(decoded)` always),
  so the plan deliberately does NOT fabricate an "inflating" test input that
  cannot exist; it pins the leg with the ordering invariant plus a real
  oversized-encoded rejection. The guard itself is still implemented, because
  correctness should not depend on that argument holding.

- **INV-5** — fidelity: UPHELD — ITEM-2 puts the received/expected/example triple
  in the helper, so it is structurally impossible for a call site to ship a
  weaker message; ITEM-5 additionally rewrites `ask_user`'s PRE-EXISTING
  rejections (empty `message`, oversized schema) to the same shape, which is what
  the design demands ("every rejection path — new and pre-existing"). ITEM-10
  does the same for `invoke_capability`'s pre-existing bare
  `"request body must be a JSON object"`. TESTS.md must assert the TEXT, not just
  `isError`, or this invariant is unproven.

- **INV-6** — fidelity: UPHELD — ITEM-7 fixes the order explicitly as
  raw-size-cap → decode → marker-strip, so the decode lands BEFORE the strip and
  a string-encoded schema carrying a forged `x-ziee-askuser` has that key removed
  exactly as an object-encoded one would. ITEM-6 leaves `stamp_ask_user_marker`
  and its after-the-cap position untouched. The existing
  `cap_requested_schema_strips_forged_ask_user_marker` test stays green and a new
  test covers the string-encoded forgery — the new attack surface this change
  creates.

- **INV-7** — fidelity: UPHELD — ITEM-17 replaces the empty `<form>` + working
  Submit with an explicit no-fields state, placed BEFORE the rich/flat branch so
  both the wizard and the legacy form are covered; ITEM-16 surfaces the server's
  `x-ziee-error` reason, which the frontend today mints and then throws away.
  ITEM-16 also removes the `new Set(3)` render crash, which is the most extreme
  form of "a card that lies" (the card, and the rest of the chat tree, vanish).

- **INV-8** — fidelity: UPHELD — the helper returns an already-correct shape
  unchanged (ITEM-1), so a well-formed object schema is byte-identical; ITEM-3
  keeps the absent-schema default `{"type":"object"}` on the absent/`Null` path
  only. ITEM-13 preserves `coerce_inputs`' existing `Object`/`Null` outputs
  exactly. TESTS.md pins byte-identity and the absent-schema default as explicit
  acceptance legs rather than trusting the reading.

**No `DROPPED` verdicts.** Two invariants carry a standing debt into phase 6:
INV-4 (the unreachable-leg note — the phase-6 tests-quality angle must confirm
the substituted test is not hollow) and INV-6 (the untrusted-ingress change of
ITEM-7 — the phase-6 security angle must confirm the ordering).
