//! Chat module integration tests
//!
//! Comprehensive test suite for the chat module including:
//! - Permission tests (22 tests)
//! - Conversation CRUD tests (29 tests)
//! - Message operation tests (13 tests)
//! - Branch management tests (10 tests)
//! - SSE streaming tests (6 tests)
//! - Cross-user ownership tests (15 tests)
//!
//! Total: ~95 integration tests

// Helper functions used across all test files.
// `pub(crate)` so OTHER test modules (project, file) can reuse
// get_test_model_configs + create_test_model_with_config +
// parse_sse_stream for their Tier-3 real-LLM tests.
pub(crate) mod helpers;

// Test modules.
//
// `file_attachments_*` tests moved to `tests/file/`, and `mcp_*`
// tests moved to `tests/mcp/`, as part of the chat→file/mcp bridge
// extraction. What remains here tests chat's own surface only.
mod adversarial_input_test;
mod permissions_test;
mod conversations_test;
// Content search + sort on the conversation list endpoint (chat-power-features).
mod conversation_search_test;
mod nul_query_param_test;
mod conversation_sort_test;
mod messages_test;
mod branches_test;
mod streaming_test;
// ITEM-14 (activity rail): the mcpToolStart/mcpToolComplete frames carry the
// recorder's timing, so a live rail step can show a duration.
mod stream_tool_timing_test;
// Tier-2 ai-providers consumer-wiring tests on the request-capturing,
// scriptable in-process OpenAI stub (`common::stub_chat`).
mod stub_chat_tier2_test;
// TEST-2 + TEST-10 (empty-model-response): an answerless turn's CAUSE survives
// to the client (the provider's `length` is no longer overwritten) and across a
// reload (it is persisted on `messages.completion_state`); an answered turn
// persists nothing. Carries its own finish-reason-forcing OpenAI stub — see the
// file header for why neither shared harness can drive a main-path `length`.
mod empty_completion_cause_test;
// Assistant chat-extension injects the assistant's `instructions` into the LLM
// request as a labeled system message (asserted on the captured wire request),
// + the cross-user private-assistant scoping guard.
mod assistant_injection_test;
// New fire-and-forget send + per-user chat-token stream (stub-backed,
// deterministic) and the `sync:conversation` emit coverage.
mod chat_stream_test;
// INV-2: tokens must reach the viewing client DURING generation, not only on a
// reload. Asserts timing + frame count, and pins the unsubscribed connection as
// the broken case (what the desktop app was stuck in).
mod chat_stream_incremental_test;
// Per-user chat-stream connection-slot reclamation on client disconnect
// (sse-slot-leak): a reconnect storm must never permanently 429 the account.
mod stream_slot_reclaim_test;
mod agent_core_migration_test;
mod agent_core_parity_test;
mod extension_split_test;
mod sync_emit_test;
// Auto-title generation: the reasoning-model regression (empty generation must
// leave the title unset, never the raw first user message) + the non-reasoning
// cross-model guard.
mod title_test;
mod title_real_llm_test;
mod title_audience_test;
mod title_approval_test;
mod ownership_test;
mod sandbox_real_llm_test;
mod test_single_assistant_message_architecture;
mod assistant_block_grouping_test;
mod append_content_ordering_test;
mod user_providers_test;
// TEST-37 (ITEM-27): the showcase seed's activity-rail turns — a re-run stays a
// no-op, every seeded tool_use has a paired mcp_tool_calls row, and the
// gallery's guarded conversation 11111111-… survives.
mod showcase_seed_rail_test;
