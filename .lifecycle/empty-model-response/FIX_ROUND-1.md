# FIX_ROUND-1 — blind audit findings

Two blind angles were run over `git diff origin/main...HEAD`:
**design-conformance** (against the design doc's INV-1..INV-4) and
**correctness + tests-quality**. They independently reported the kit-`Alert`
defect and the "clamp is inert on the reported path" defect, which is what
promoted both to work.

## Fixed

- **HIGH (corroborated ×2, oracle-confirmed by a red e2e)** — the kit `Alert`
  destructured `...rest` and never spread it, so `data-empty-completion-cause`
  never reached the DOM and all three e2e specs were red. `rest` is now spread
  on the root, with `onClose`/`closeLabel` destructured out so they cannot leak
  to the DOM. Verified: 3 passed.
- **HIGH (corroborated ×2)** — INV-4 was VACUOUS on the reported path.
  `providers/openai.rs` never serializes `budget_tokens`, `family_thinking_style`
  never returns `"budget"`, and the rig's model row declares no thinking
  capability at all — so ziee sends no thinking config there and the clamp
  bound nothing. Resolution: the clamp is KEPT (correct for Anthropic/Gemini),
  the Anthropic adapter's `.unwrap_or(10000).max(1024)` re-raise is fixed, and
  the design doc + INV-4 are rescoped to say plainly that this is latent
  hardening and NOT a mitigation for the reported bug. `ThinkingEffort` is
  untouched (DEC-8 stands) — changing it would have been a no-op here.
- **HIGH** — a mid-stream provider error persisted `empty`. New `failed` state.
- **HIGH** — `content_filter`/`refusal` got retry advice via the catch-all
  `_ => Empty`. New `content_filtered` state; **the unit test that certified
  the wrong behaviour was removed**, not adjusted.
- **MEDIUM** — the abort flag only fired when a later chunk failed to send, so
  an abort first seen on the terminal chunk was recorded as `empty`. Now guarded
  before each chunk AND re-written after a completed finalize.
- **MEDIUM** — `agent_host/dispatcher.rs` still emits `completion_state: None`;
  deliberately deferred with a recorded rationale (DEC-14) because a partial
  wiring would emit a wire value the DB never receives — the exact reload
  divergence INV-2 forbids.
- **LOW** — honest `unknown` copy (it no longer asserts a cause it does not
  know); `aborted` copy; stale docstring; the cast that hid the generated type.

## Orchestrator-caused environment defect (not a code finding)

`node_modules` had been symlinked in from the main clone to skip an install.
The workspace links inside it are relative (`@ziee/kit -> ../../sdk/packages/kit`),
so they resolved to the MAIN repo's sdk — meaning e2e rounds 1 and 2 exercised
a kit WITHOUT the fix. Fixed with a real `npm install`; `readlink -f` now
confirms `@ziee/kit` resolves inside the worktree. All frontend measurements
were re-taken afterwards, including re-validating the `npm run check` baseline
claim against main.

**New confirmed findings:** 0
