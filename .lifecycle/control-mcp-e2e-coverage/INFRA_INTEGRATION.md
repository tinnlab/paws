# INFRA_INTEGRATION — the per-item walks (phase 5)

## User-experience walk

The two bugs are the UX. (1) A user types "create a new project please" and the
assistant, instead of doing it, makes two identical `describe_capability` calls, a
spurious `list_citations`, and finally asks a clarifying question — because its
search returned nothing. After the fix the same sentence produces an approval card
naming the write, and Approve creates the project. (2) Every conversation in the
sidebar reads as an untitled placeholder, forever, so a user cannot find anything
they said yesterday. After the fix a first exchange names the conversation.

Nothing else in the diff is user-facing: no page, drawer, card, panel, store or
route changes, so the UI-surface checklist is N/A (recorded in PLAN).

## Infrastructure-integration walk

| subsystem | interaction | handled |
|---|---|---|
| **control MCP tool dispatch** | `list_capabilities` result ordering is now relevance-first. The model reads `operations[]` in order, and `MAX_LIST_RESULTS` truncates at 200 — so ordering also decides WHAT SURVIVES truncation. Relevance-first strictly improves that: the most relevant ops are now the ones that survive, where alphabetical order truncated arbitrarily. | yes |
| **per-user permission filter** | unchanged and still applied BEFORE scoring, so ranking can never surface an op the user may not run. Verified by the untouched `list_capabilities_filters_by_permission` + the new negative-perm e2e. | yes |
| **approval flow** | untouched. `control_call_needs_approval` → `policy::is_mutating` still forces every mutating invoke through the card; the e2e asserts the card appears in a FRESH (auto-approve) chat for all four operations exercised. | yes |
| **MCP tool-call history** | used as the assertion surface for "the model discovered the op". Recording is fire-and-forget (`tokio::spawn`), so the spec polls rather than reading once. | yes |
| **chat streaming / agent-core host** | the title write happens in `after_llm_call`, reached on the legacy host via `StreamingService::finalize` and on the agent-core host via `RegistryBridge::after_round`. The real-LLM title test polls the conversation rather than racing the terminal `complete` frame, so it is correct on BOTH hosts. | yes |
| **title retry budget** | the escalated retry is bounded to ONE extra call, and the pre-existing per-conversation `TITLE_RETRY_MESSAGE_LIMIT` still caps cross-turn retries — a pathological model costs a handful of calls, not one per turn forever. | yes |
| **provider adapters** | `thinking: Disabled` is inert for the OpenAI adapter (it only suppresses a `reasoning_effort` that was never set) and an existing, tested mode for Anthropic/Gemini. No adapter gains a new required field. | yes |
| **test harness (StubChat)** | gained an additive `STUB_TITLE_BUDGET_ONCE` mode; existing modes byte-identical (the old `stream_response`/`json_response` delegate to the new `*_with_finish` forms with `None`). See DRIFT-1.2 for the B3 weighing. | yes |
| **e2e port/lock isolation** | the control specs were run on a private lock dir + port bases (55000 vite / 56000 backend / 62000 pg), never touching the two live instances. | yes |
| **sync / notifications / workflow runner / settings** | not touched — no new entity, no new emit site, no new settings row (DEC-6). | n/a |

## Entity-lifecycle walk

The diff introduces NO entity, NO surface that holds one, and NO cache. The
entities the tests CREATE (projects, assistants, a memory-settings row) live only
inside a per-test database that the harness drops at teardown, so add / remove /
delete / mutate / access-loss have no new code path to cover. The one piece of
state the feature reads across a lifecycle is `conversations.title`, whose
single-shot guard (`has_title`) and cross-turn retry bound were already covered by
the existing unit tests and are unchanged by this diff.
