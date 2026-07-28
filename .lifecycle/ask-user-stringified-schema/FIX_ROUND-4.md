# FIX_ROUND-4 — convergence

## Provenance

A fourth independent agent, again with no prior context and no sight of the
earlier rounds' reasoning, was asked to decide whether the fix loop had
converged — and was told explicitly that three prior rounds each found real
defects (including defects introduced BY the previous round's fix), so that a
clean verdict would have to be earned rather than assumed. It was also told that
stylistic preferences and requests for out-of-scope coverage are not findings, so
that "converged" means converged and not "ran out of things to say".

## Verdict on the round-3 fix: SOUND

`total_after_template_clone` was verified on every point the round-3 finding
turned on, and one the fix's author had not established:

- **`created_by` is the clone's owner, and cannot be the template's.** The
  seeded template row has `created_by = NULL`, and that is STRUCTURAL — the
  table carries a `template_must_have_no_owner` CHECK. So
  `WHERE created_by = $1` is satisfied only by the clone, which makes the wait a
  true completion signal for exactly the writer it is waiting on. This is the
  property the round-2 two-equal-reads version lacked.
- **"Exactly one `is_default + enabled` template is seeded" is true**, and the
  YAML seed ADOPTS the migration-baked row rather than creating a second, so
  `>= 1` is precise rather than merely sufficient.
- **Falling through after 5s degrades in the SAFE direction.** If the clone never
  happens, nothing writes and the equality still holds (slow, not wrong). If the
  clone is merely slow, the assertion fails LOUDLY — the opposite of the round-2
  defect, which returned a pre-clone number silently at t≈50ms.
- **The admin cannot legitimately own 0 assistants**, and no second in-flight
  writer exists in that test, so the settle condition is complete.

## Re-verification

- **All 6 Rust legs discriminating**, with the exact red line named per leg, and
  the reading reconciled against the measured `0 passed; 6 failed`. Legs 3 and 6
  discriminate ONLY because of the round-2 message pins — the two strings are
  emitted by a single site each in the whole tree.
- **The e2e cannot pass vacuously**: a regex miss yields `0`, which fails `>= 2`;
  and the rejected `fields.count()` approach was re-confirmed unsound (the
  `elicitation-field-` prefix also covers options, badges, previews and
  other-input).
- **No fourth false claim.** Each of the three previous rounds found one comment
  that was factually wrong about the code; this round looked specifically for a
  fourth and found none.

## Recorded as NOT findings

Kept here so a future round does not re-derive them as defects:

1. The degraded-card assertion is REDUNDANT (the no-fields card renders zero
   `elicitation-field-*`, so the earlier field assertion times out first) —
   harmless belt-and-braces, not a defect.
2. "`ask_user` always takes the rich wizard" is IMPRECISE (a zero-property
   ask_user takes the degraded card, because the notice is evaluated first) but
   nothing asserted depends on the loose wording, and the zero-property case is
   independently excluded.

## Outstanding items deliberately NOT closed here

Neither is a defect in this diff; both are recorded rather than absorbed:

- **FIX_ROUND-2 #14** — `chat/ask-user-real-llm.spec.ts` gates on
  `ANTHROPIC_API_KEY` directly, so the chat suite holds two real-model `ask_user`
  specs with contradictory gating policies. Pre-existing; the honest fix is to
  migrate it onto the shared `TEST_LLM` seam and extend
  `control-spec-gating.spec.ts` to cover `chat/` specs that import that seam.
- **FIX_ROUND-3 #3** — the `>= 2` step assertion conflates model choice with
  mangling. Accepted tradeoff, reasoned in DEC-21.

**New confirmed findings: 0**
