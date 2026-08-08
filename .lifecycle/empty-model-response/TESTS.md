# TESTS — answerless chat turns

Fixture provenance: the `length`-truncated fixture is REAL captured bytes from
the live Qwen3.6-35B bridge (`qwen3.6-35b-a3b` @ `localhost:4000/v1`,
`max_tokens: 300`) — 299 SSE chunks, 958 chars of `reasoning_content`, 0 chars of
`content`, terminating `finish_reason: "length"`. Trimmed to a representative
head/tail (the middle is 1,500 near-identical reasoning deltas) and committed
under `src-app/server/ai-providers/tests/fixtures/`. Only the external boundary
(the upstream HTTP server) is mocked — the real `stream_chat` path runs.

## Acceptance tests (design-invariant proofs)

- **TEST-1** (tier: unit) [acceptance] [invariant: INV-2] [covers: ITEM-1] file: `src-app/server/ai-providers/tests/adapter_response_test.rs` — asserts: driving the REAL captured Qwen `length`-truncated SSE bytes through `stream_chat` yields ThinkingDeltas, ZERO TextDeltas, and a canonical terminal `finish_reason` of `length` (NOT `stop`, NOT `empty`) — i.e. the provider's real reason is produced and would fail if the adapter collapsed it.
- **TEST-2** (tier: integration) [acceptance] [invariant: INV-2] [covers: ITEM-1, ITEM-2, ITEM-3] file: `src-app/server/tests/chat/empty_completion_cause_test.rs` — asserts: a stub turn that ends `finish_reason: length` with only reasoning delivers a terminal SSE frame whose provider reason is still `length` (not overwritten to `empty`), AND the persisted message re-read over REST after the stream carries the budget-truncated completion state — proving the reason survives BOTH the wire and a reload. Fails if the guard overwrites the reason or nothing is persisted.
- **TEST-3** (tier: unit) [acceptance] [invariant: INV-1] [covers: ITEM-4] file: `src-app/ui/src/modules/chat/components/emptyCompletion.test.ts` — asserts: the notice classifier returns DISTINCT causes for a budget-truncated answerless message vs a genuinely-empty answerless message vs an aborted one, given otherwise-identical content blocks. Fails if the two cases map to one presentation.
- **TEST-4** (tier: e2e) [acceptance] [invariant: INV-3] [covers: ITEM-4] file: `src-app/ui/tests/e2e/chat/empty-completion-cause.spec.ts` — asserts: a budget-truncated turn driven through the real stack renders notice copy that names the token-budget cause and the corrective action, and does NOT render the string "Please try again"; a genuinely-empty turn renders the empty-response copy. Fails if the truncated case still shows the retry advice.
- **TEST-5** (tier: unit) [acceptance] [invariant: INV-4] [covers: ITEM-5] file: `src-app/server/src/modules/chat/core/services/streaming.rs` — asserts: for a completion budget of 4096 the resolved thinking budget is strictly less than 4096 (answer headroom remains), and for a generous completion budget the thinking budget is unchanged. Fails on the shipped configuration today, where a hardcoded 4096 thinking budget equals a 4096 `max_tokens`.

## Regression / correct-behaviour tests

- **TEST-6** (tier: unit) [covers: ITEM-4] file: `src-app/ui/src/modules/chat/components/emptyCompletion.test.ts` — asserts: the existing suppression gates still hold — no notice while `isStreaming`, `interrupted`, or `finalizing`, and no notice when a visible `text` or a `tool_use` block is present. This is the correct-behaviour case that must stay correct.
- **TEST-7** (tier: unit) [covers: ITEM-1] file: `src-app/server/ai-providers/tests/adapter_response_test.rs` — asserts: the pre-existing non-reasoning OpenAI SSE fixture still yields a `stop` finish reason and its text delta unchanged (negative control — proves TEST-1's `length` result comes from the fixture, not from a blanket change).
- **TEST-8** (tier: integration) [covers: ITEM-1] file: `src-app/server/tests/chat/stub_chat_tier2_test.rs` — asserts: the two existing empty-completion stub tests, updated for the new signal — a genuinely-empty turn (provider reason `stop`, no content) is still reported as an empty completion, distinct from the truncated case.
- **TEST-9** (tier: unit) [covers: ITEM-2] file: `src-app/server/src/modules/chat/core/services/streaming.rs` — asserts: the completion-state classifier maps provider reason + visible-content flag onto the persisted state — `length` + no-content → budget-truncated; `stop` + no-content → empty; any reason + visible content → no recorded answerless state.
- **TEST-10** (tier: integration) [covers: ITEM-2] file: `src-app/server/tests/chat/empty_completion_cause_test.rs` — asserts: a normal answered turn persists NO answerless completion state (the column stays null), so the new column cannot mislabel healthy turns.
- **TEST-11** (tier: e2e) [covers: ITEM-4] file: `src-app/ui/tests/e2e/chat/empty-completion-cause.spec.ts` — asserts: after a full page RELOAD the budget-truncated turn still renders the truncation-specific copy — proving the cause survives from persisted state rather than transient stream flags.
- **TEST-12** (tier: unit) [covers: ITEM-3] file: `src-app/server/src/openapi/emit_ts.rs` — asserts: `types_ts_parity` golden test passes, i.e. the new message field is regenerated into `types.ts` for the committed spec (guards the "forgot to regen" failure for ITEM-3).

## Coverage map

| ITEM | covering tests |
|---|---|
| ITEM-1 | TEST-1, TEST-2, TEST-7, TEST-8 |
| ITEM-2 | TEST-2, TEST-9, TEST-10 |
| ITEM-3 | TEST-2, TEST-12 |
| ITEM-4 | TEST-3, TEST-4, TEST-6, TEST-11 |
| ITEM-5 | TEST-5 |

| INV | acceptance test |
|---|---|
| INV-1 | TEST-3 |
| INV-2 | TEST-1, TEST-2 |
| INV-3 | TEST-4 |
| INV-4 | TEST-5 |

## Notes

- **Runner split (UI)**: `emptyCompletion.test.ts` is collected by `node --test`
  (`src/**/*.test.ts`), which is where the existing `emptyCompletion.test.ts`
  lives — NOT vitest (vitest collects only `*.store.test.ts` / `*.test.tsx`).
  Verified against `vitest.config.ts` and `package.json:127-128`. No mounted
  component is required, so no new `.test.tsx` is introduced.
- No new permission is introduced, so no `[negative-perm]` spec is required.
- Frontend paths are touched, so `tier: e2e` coverage is enumerated (TEST-4,
  TEST-11).
