# PLAN — answerless chat turns present as an unactionable "empty response"

## Design source

Realizes `docs/design/empty-completion-diagnosis.md` — the whole document
(measured reality, root cause, "Required behaviour"). That design is itself
derived from evidence captured on the live rig: raw upstream SSE bytes, the rig
server log, and the `ziee_rig` message corpus (680/5792 = 11.7% of assistant
turns affected).

## Invariants

Lifted verbatim from `docs/design/empty-completion-diagnosis.md` § "Required
behaviour":

- **INV-1**: A budget-truncated turn and a genuinely-empty turn MUST NOT present identically to the user.
- **INV-2**: The provider's terminal finish reason MUST survive to the client and across a page reload; the empty-completion guard MUST NOT destroy it.
- **INV-3**: The user-facing message for an answerless turn MUST name the actual cause and an action the user can take. "Please try again" is refused for a cause that an identical retry reproduces.
- **INV-4**: A configured thinking budget MUST be strictly less than the completion budget, so an answer remains possible by construction.

## Items

- **ITEM-1**: Stop destroying the provider's terminal finish reason in the empty-completion guard (`chat/core/services/streaming.rs`). Keep the canonical provider reason (`length` / `stop` / `content_filter` / …) intact on the wire, and carry the "produced no visible answer" fact as a SEPARATE signal rather than by overwriting the reason with `"empty"`.
- **ITEM-2**: Persist the terminal completion state on the assistant message so the cause survives a reload (the notice is computed at render time from persisted state). New nullable column on `messages` + a chat-module migration, written in the same transaction that persists the turn's content blocks.
- **ITEM-3**: Surface the persisted state on the message read model (`MessageWithContent`) through the API + regenerated OpenAPI/TS types, so the frontend can branch on cause.
- **ITEM-4**: Differentiate the frontend notice by cause with actionable copy — budget-truncated ("used its entire token budget on reasoning… raise max tokens / lower reasoning effort") vs genuinely empty vs aborted — replacing the single unconditional "Please try again" string. Keep the existing suppression gates (streaming / interrupted / finalizing) intact.
- **ITEM-5**: Clamp the configured thinking budget strictly below the request's completion budget in `thinking_config_for` / `apply_model_params`, so a hardcoded 4096 thinking budget can never equal or exceed a 4096 `max_tokens` and leave zero answer headroom.

## Files to touch

- `src-app/server/src/modules/chat/core/services/streaming.rs` (ITEM-1, ITEM-2, ITEM-5)
- `src-app/server/src/modules/chat/migrations/202607200400_message_completion_state.sql` (ITEM-2 — new; max existing server prefix is `202607200300`, verified no collision)
- `src-app/server/src/modules/chat/core/types/streaming.rs` (ITEM-1 — wire type)
- `src-app/server/src/modules/chat/` models/repository for the message read model (ITEM-2, ITEM-3)
- `src-app/ui/openapi/openapi.json` + `src-app/ui/src/api-client/types.ts` (regen, ITEM-3)
- `src-app/desktop/ui/openapi/openapi.json` + `src-app/desktop/ui/src/api-client/types.ts` (regen, ITEM-3)
- `src-app/ui/src/modules/chat/components/emptyCompletion.ts` (ITEM-4 — predicate + cause classifier)
- `src-app/ui/src/modules/chat/components/ChatMessage.tsx` (ITEM-4 — render the cause-specific notice)
- `src-app/server/ai-providers/tests/adapter_response_test.rs` (regression fixture over real captured bytes)

## Patterns to follow

- **Migration**: mirror the existing chat-module migrations (`src-app/server/src/modules/chat/migrations/202607140110_chat_schema.sql`) — timestamp prefix above `202607200300`, nullable column with no backfill (pre-existing rows legitimately have no recorded state).
- **Finish-reason vocabulary**: reuse `ai_providers::FinishReason::canonicalize` / `ProviderFamily` (`ai-providers/src/models/chat.rs:457-518`) — do NOT invent a parallel string vocabulary.
- **Budget-exhaustion detection**: mirror the existing in-repo precedent `chat/extensions/title/title.rs::is_budget_exhausted` (`title.rs:224-226`) rather than writing a new predicate shape.
- **Frontend notice predicate**: extend the already-extracted, already-tested pure module `ui/src/modules/chat/components/emptyCompletion.ts` — keep the logic out of the component so it stays unit-testable (existing precedent: `emptyCompletion.test.ts`, node:test).
- **Server/client mirror**: `is_visible_answer` (`streaming.rs:1269-1277`) and `isVisibleAnswerBlock` (`emptyCompletion.ts`) are a deliberate mirrored pair — any change to one updates the other in the same commit.
- **Raw-SSE fixture**: mirror `ai-providers/tests/adapter_response_test.rs` (`spawn_once` one-shot TCP server returning verbatim bytes, driving the real `stream_chat`) — no network, no API key.
- **OpenAPI regen**: `just openapi-regen` regenerates BOTH `ui/` and `desktop/ui/` ([[project_openapi_regen_both_binaries]]).

## UI-surface checklist (ITEM-4)

- **Precedent**: the notice is an existing `Alert tone="warning"` inline in the message bubble (`ChatMessage.tsx:349-356`). This item changes its COPY and adds cause branching — it introduces no new surface, container, or layout, so sibling-structure/pagination/scale questions do not apply.
- **Scale / cardinality**: unchanged — one bounded inline Alert per affected assistant message; no list, no collection, no new fetch.
- **Device size / responsive**: inherits the existing `className="w-full"` Alert inside the message column; copy grows by at most one sentence. Verify no overflow at ~390px in the gallery.
- **Populated-render review**: gallery must show the notice in each cause variant (budget-truncated, genuinely-empty) with representative copy, not just the empty state.
- **User-visible progress**: n/a — terminal state, not an in-flight operation.
- **Input economy**: n/a — no input is collected.
- **JTBD**: the user has just watched a turn produce nothing. They want to know (a) did I do something wrong, (b) is it broken, (c) what do I do now. Today all three questions get one wrong answer ("try again") that, for the majority cause, deterministically fails. The job is: name the cause truthfully and give the one action that actually resolves it (raise the model's max tokens / lower reasoning effort), so the user stops retrying into the same wall.
- **Multi-instance / URL-as-view**: n/a — no navigation or per-window state.
- **Platform-provided affordances**: n/a.

## Not built here (recorded in the design's "Out of scope")

Automatic length-aware retry on the main chat path, and lowering the forced
`ThinkingEffort::High`. Both are product decisions rather than defect fixes; they
are named in the design doc and surfaced in the final report as recommendations.
They are NOT plan items, so they are not descopes.

## Item verdicts (plan audited against the codebase)

- **ITEM-1** — verdict: PASS — the override is a single, self-contained site (`streaming.rs:764-772`); the comment there already documents that the client "does NOT branch on finish_reason", so preserving the reason is additive. `FinishReason::canonicalize` already yields `length` for the OpenAiCompat family (`chat.rs:486-492`), verified live (`provider_finish_reason: length`). No existing caller depends on the literal `"empty"` other than the two stub tests named in TESTS.md, which are updated with it.
- **ITEM-2** — verdict: CONCERN — adds a migration. Verified `202607200300` is the current max server prefix and `202607200400` is free (`find … | cut -d_ -f1 | sort -n | tail`); duplicate-prefix check across `src-app` returns empty. Risk is a collision with concurrently-merging branches — re-checked by the merge-gate's C2 against real main, and recorded in BASE.md.
- **ITEM-3** — verdict: CONCERN — a new field on the message read model requires `just openapi-regen` for BOTH `ui/` and `desktop/ui/`; the `types_ts_parity` golden test fails if it is not regenerated. Budgeted.
- **ITEM-4** — verdict: PASS — extends an already-extracted pure predicate module with existing test coverage; no new component, no new route, no new permission. The three existing suppression gates are preserved, so the correct-behaviour cases (streaming, interrupted, finalizing) are unaffected.
- **ITEM-5** — verdict: CONCERN — changes request-shaping for every thinking-capable model, not just Qwen. Narrowed deliberately to a CLAMP (thinking budget strictly below completion budget) rather than a policy change to `effort`, so it only alters configurations that are already guaranteed to produce no answer. Behaviour for any model whose thinking budget already fits is byte-identical.

## Breakage risk

`"empty"` disappearing from the wire is the one behaviour change with existing
consumers. Audited: the frontend never reads `finish_reason` except
`applyStreamFrame.ts:293` (`=== 'cancelled'`), and two server stub tests assert
`"empty"` (`stub_chat_tier2_test.rs:393-435`). Both are updated; the new signal is
carried alongside rather than in place of the reason, so no consumer loses
information.

## Pattern conformance

Each item names its reference in *Patterns to follow* above; the migration,
finish-reason vocabulary, budget-exhaustion predicate, fixture harness, and the
mirrored visible-answer pair all reuse existing in-repo shapes rather than
introducing new ones.

## Migration collisions

Current max server prefix `202607200300`; chosen `202607200400`. Duplicate-prefix
scan across `src-app` is empty. Desktop sequence (`1e13` block, max
`10000000000005`) is untouched and unaffected.

## OpenAPI regen

Required (ITEM-3 adds a field to the message read model). Both binaries must be
regenerated via `just openapi-regen`; `openapi::emit_ts::tests::types_ts_parity`
is the enforcing golden test.
