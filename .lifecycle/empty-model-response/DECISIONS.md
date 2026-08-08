# DECISIONS — answerless chat turns

### DEC-1: Carry the answerless fact by overwriting `finish_reason`, or as a separate signal?
**Resolution:** A separate signal. The canonical provider reason (`length`/`stop`/`content_filter`/…) stays intact on the wire; the "produced no visible answer" fact travels as its own field alongside it.
**Basis:** convention — INV-2 forbids destroying the reason, and `ai_providers::FinishReason` (`chat.rs:457-518`) is an established canonical vocabulary that `"empty"` is not a member of. Overloading it is what created the defect.

### DEC-2: What shape is the persisted state — a raw `finish_reason` string, or a classified enum?
**Resolution:** A classified, nullable `completion_state` text column on `messages`, NULL for every healthy turn, written only when a turn ends answerless. Values are a closed set (`budget_truncated`, `empty`, `aborted`).
**Amended (DRIFT-1.2):** originally two values. `aborted` was added once the corpus showed 315 of the 320 zero-block affected messages are branch-terminal aborted streams — the server already emits `finish_reason: "cancelled"` on the wire (`streaming.rs:983`) but persists nothing, so the frontend's live `interrupted` suppression silently stops working after a reload. Without the third value, ~47% of the reported notices would keep mis-reporting a cancelled turn as an empty model response.
**Basis:** convention — mirrors how the codebase stores closed vocabularies as text with a `from_str` + default (§4 of CODING_GUIDELINES: never `unwrap()` on a DB enum string). Persisting the raw provider string instead would push per-provider vocabulary knowledge into the frontend; classifying server-side keeps the mirror pair (`is_visible_answer` ⇄ `isVisibleAnswerBlock`) as the single place that decides.

### DEC-3: Backfill the new column for the 680 existing answerless rows?
**Resolution:** No backfill. The column is nullable; pre-existing rows keep NULL and render the current generic copy.
**Basis:** codebase — the cause is not recoverable for historical rows (the provider reason was overwritten and never persisted), so any backfill would be a guess. A nullable-no-backfill migration is the established chat-module pattern.

### DEC-4: Is the notice copy per-cause, and what does the budget-truncated case say?
**Resolution:** Per-cause. Budget-truncated: names that the model spent its whole token budget on reasoning without reaching an answer, and points at the two corrective actions (raise the model's max tokens, or lower reasoning effort). Genuinely empty: keeps the existing "returned an empty response" framing. Neither says "Please try again" for a deterministic cause.
**Basis:** user — INV-3 in the named design doc is explicit that "Please try again" is refused for a cause an identical retry reproduces, and the measured data shows that is the majority cause (~53%).

### DEC-5: Should the notice be dismissible / should it link to the model settings page?
**Resolution:** Neither. It stays a non-dismissible inline `Alert tone="warning"` with plain corrective text, exactly as today.
**Basis:** convention — the existing notice is a non-dismissible inline Alert (`ChatMessage.tsx:349-356`); adding a deep link to model settings would be a new affordance requiring its own permission reasoning (a non-admin user cannot edit model params), and gating it is out of proportion to a copy fix.

### DEC-6: Is the thinking-budget clamp a fixed constant or an admin-configurable setting?
**Resolution:** A fixed, derived RATIO expressed as a named constant — the thinking budget is clamped to a fraction of the request's completion budget, strictly below it. Not a new settings row.
**Basis:** convention — the Phase-4 configurable-settings rule defaults to admin-configurable for operational tunables, but this is explicitly the documented exception: it is a correctness floor (an invariant that an answer must remain possible), not an operator preference. Weakening it below "strictly less than the budget" re-creates the defect by construction, so it must not be operator-settable. It is a named constant rather than an inline magic number precisely so it can be promoted later without a rewrite. The already-configurable knobs (`max_tokens` on the model row, reasoning effort) remain the operator's levers.

### DEC-7: Auto-retry a budget-truncated turn with a larger budget?
**Resolution:** No — not in this branch. Recorded in the design doc's "Out of scope" and surfaced as a recommendation in the final report.
**Basis:** user — precedent exists (`title.rs:237-250` retries on `length`), but the title extension spends its own small internal budget, whereas the main chat path spends the USER's tokens on a paid provider. Silently re-billing a user is a product decision, not a defect fix. This is not a descoped plan item; it was never planned.

### DEC-8: Change the unconditional `ThinkingEffort::High`?
**Resolution:** No. Left exactly as-is.
**Basis:** user — reasoning quality is a product choice. INV-4's clamp removes the guaranteed-failure configuration without overriding that choice, so the two are independent. Recorded in the design doc's "Out of scope".

### DEC-9: Which runner takes the new frontend predicate tests?
**Resolution:** `node --test` via the existing `src/**/*.test.ts` glob — the new assertions are appended to the existing `emptyCompletion.test.ts`. No vitest file is added.
**Basis:** codebase — verified `vitest.config.ts` collects only `src/**/*.store.test.ts` and `src/**/*.test.tsx`, and `package.json:127` runs `node --import ./scripts/node-test-loader.mjs --test "src/**/*.test.ts"`. The predicate is pure, so no component mount is needed; the globs are disjoint by extension so nothing double-runs.

### DEC-10: How is the e2e budget-truncated turn driven without a real Qwen?
**Resolution:** Through the existing chat stub's `budget_once` arm (`server/tests/common/stub_chat.rs:329-333`), which already forces `finish_reason: "length"`.
**Basis:** codebase — that arm exists precisely for this and is the established way the suite forces a length termination; no shared-harness change is needed (B3).
