# HUMAN_FEEDBACK — answerless chat turns

The originating request was a diagnosis task, not feedback on a running feature:

> "I saw a lot of 'The model returned an empty response and made no tool call.
> Please try again.', figure out what's going on"

with the instruction to find the real root cause rather than patch the symptom,
and — if the cause turned out to be model-side — to say so honestly and make ziee
handle it well.

**no human feedback received** — the owner has not yet reviewed the running
change. Stated explicitly rather than left ambiguous. This file becomes a live
ledger the moment they do.

When the owner reviews, the sign-off should be against the four invariants and
their acceptance tests (per the lifecycle's phase-9 rule), not against a gate
tally:

- **INV-1** (truncated ≠ empty) → TEST-3, and visible live by driving the two
  stub modes in `ui/tests/e2e/chat/empty-completion-cause.spec.ts`.
- **INV-2** (the provider reason survives, incl. across reload) → TEST-1 (real
  captured Qwen bytes) + TEST-2 (persisted, re-read over REST).
- **INV-3** (names the cause + an action; no retry advice for a deterministic
  cause) → TEST-4.
- **INV-4** (thinking budget strictly below the completion budget) → TEST-5.

## Findings the owner should decide on (raised, not silently actioned)

- **FB-1** [status: wontfix] — the
  cause of the majority of these notices is the interaction between a reasoning
  model and `max_tokens`. This branch makes the failure *legible and
  non-misleading*, and removes the guaranteed-failure configuration (INV-4). It
  deliberately does NOT auto-retry a truncated turn with a larger budget
  (DEC-7) — precedent exists in the title extension, but that spends an internal
  budget, whereas the main chat path spends the user's tokens on a paid
  provider. Auto-retry is a product call for the owner.
- **FB-2** [status: wontfix] — `ThinkingEffort::High` is forced
  unconditionally for every thinking-capable model
  (`streaming.rs::thinking_config_for`). Combined with a modest `max_tokens`
  this is what makes truncation common. Left untouched (DEC-8) because reasoning
  quality is a product choice, but the owner may want it configurable.

Both are marked `wontfix` in the lifecycle sense — deliberately NOT actioned in
this branch, with the rationale recorded — rather than `open`, because neither is
an unaddressed defect: each is a product decision surfaced to the owner instead of
being decided unilaterally. If the owner wants either, it is a new round.

## Unrelated repo defect surfaced by this work

- `justfile:87`'s `openapi-check` runs `cargo test --lib openapi::emit_ts::`,
  which selects **0 of 1519 tests** and exits 0 — `just check`'s OpenAPI gate is
  a silent no-op and would pass against a stale `types.ts`. The real tests are
  `openapi::tests::types_ts_parity{,_desktop}`. Root `CLAUDE.md` quotes the same
  dead path. Not fixed here (a shared gate belongs in its own reviewed commit);
  reported to the owner.
