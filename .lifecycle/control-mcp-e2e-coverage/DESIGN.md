# DESIGN — real coverage for the "LLM mutates the app's own state" surface

The named design this feature realizes. Authored from the owner's brief (there
was no prior design doc for this work); the non-negotiables below are quoted
VERBATIM from that brief and are lifted unchanged into `PLAN.md`'s
`## Invariants`.

## §1 The problem

The app exposes a **control MCP** (`list_capabilities` / `describe_capability` /
`invoke_capability`) letting the model create/update app entities (projects,
assistants, workflows, settings…).

Live evidence from a real user session (conversation
`d327af2e-c64b-4d39-b921-091b5a2568df` on the `:1530` instance, DB
`ziee_live_view` on PG `:54396`): the user asked "create a new project please";
the model called `list_capabilities{query:"create project"}` → **0 results**,
then flailed (two identical `describe_capability` calls plus a spurious
`list_citations`) before recovering via an `ask_user` elicitation.

Three compounding gaps, all verified:

1. `src-app/ui/tests/e2e/control/control-tool-in-chat.spec.ts` gates on
   `ANTHROPIC_API_KEY`, which is unset → in a full-suite run those tests report
   as SKIPPED. The control surface has never been e2e-verified.
2. That spec prompts the model with the literal operation name ("Call
   invoke_capability with Assistant.create"), so **`list_capabilities`
   discovery is never exercised** — precisely the broken path.
3. It covers **`Assistant.create` only**; `list_capabilities{}` returns **368
   operations**, many mutating.

## §2 Guiding rule

> **a test must fail if the feature breaks** — this area is currently "covered"
> by tests that never execute, which is how the bugs below shipped.

## §3 FIX 1 — multi-word capability search (real product bug)

`src-app/server/src/modules/control_mcp/handlers.rs:242-246` lowercases the query
and does whole-phrase `.contains(q)` against `operation_id` / `summary` / `tags`.
So `"create project"` matches nothing (0), while `"project"`→24 and
`"create"`→21.

> Make multi-word queries work: tokenize on whitespace and require ALL terms to
> match (each term may match any field), and order results by relevance so
> `Project.create` ranks first for "create project". Keep single-term behavior at
> least as good as today. Unit-test the matcher directly (including the exact
> failing query) — not just through the MCP.

## §4 FIX 2 — title generation never runs (real product bug)

On that live instance **0 of 16 conversations have a title** (`title IS NULL`),
including multi-turn ones.
`src-app/server/src/modules/chat/extensions/title/title.rs` has several
early-return gates.

> Find which gate bails and why it affects EVERY conversation, fix it, and add a
> test that fails if titles stop being generated. (Reproduce against a fresh
> conversation; the Qwen bridge at `localhost:4000` model `qwen3.6-35b-a3b` is
> available and tool-capable.)

## §5 BUILD — the e2e matrix that would have caught this

> - **Un-gate the control specs from `ANTHROPIC_API_KEY`**: run them against the
>   configured test LLM (the local Qwen bridge — `OPENAI_BASE_URL=http://localhost:4000/v1`,
>   `ZIEE_TEST_LLM_MODEL=qwen3.6-35b-a3b`, see `src-app/server/tests/.env.test`).
>   If no LLM is configured at all, the spec may skip — but it must NOT skip
>   merely because Anthropic specifically is absent.
> - **A natural-language DISCOVERY→MUTATION journey**: prompt like a user
>   ("create a new project called Foo"), and assert the full chain — the model
>   discovers the op via `list_capabilities` (do NOT name the operation id in the
>   prompt), the mutating invoke is FORCED through the approval card even in an
>   auto-approve chat, Approve → **the entity really exists via the REST API**,
>   and the chat reflects it. This single test is the one that would have caught
>   FIX 1.
> - **Table-driven across representative mutating ops** — at minimum
>   `Project.create` and `Assistant.create`, plus 1-2 more you judge
>   representative (e.g. a settings update, a workflow). For each: approval
>   forced · approve → entity exists · **deny → nothing created** · a user
>   LACKING the permission → the op is not offered/denied (mirror the A10
>   negative-perm pattern).
> - Keep the existing deny-leaves-nothing test; strengthen rather than replace.

## §6 Verified root causes (established during the phase-1 research pass)

**FIX 1** — reproduced by reading `handlers.rs:242-246`: the single
`.contains(q)` over the lowercased WHOLE query can never match, because no
`operation_id` / `summary` / `tag` contains the literal substring
`"create project"`.

**FIX 2** — reproduced live against the same bridge + model the `:1530` instance
uses (`llm_providers.base_url = http://localhost:4000/v1`, model
`qwen3.6-35b-a3b`) with the title extension's EXACT prompt and budget:

| `max_tokens` | `finish_reason` | answer text | completion tokens |
|---|---|---|---|
| 512 (shipped `TITLE_MAX_TOKENS`) | `length` | **none** | 512 (all reasoning) |
| 1024 | `length` | **none** | 1024 (all reasoning) |
| 2048 | `stop` | "Creating a New Project" | 942 |
| 4096 | `stop` | "Request to Create New Project" | 1138 |

The gate that bails is therefore NOT `should_generate_title` — it fires
correctly. It is `generate_title_with_ai`: the reasoning model spends the entire
512-token budget on `reasoning_content` (which the extension deliberately
discards), the stream ends `finish_reason: "length"` with zero text,
`clean_generated_title` returns `None` → `Err` → `title_if_needed` soft-fails and
leaves the title unset. After `TITLE_RETRY_MESSAGE_LIMIT` (6 dialogue messages)
the retry budget is exhausted, so the conversation is permanently untitled. This
affects EVERY conversation on the deployment because every conversation uses that
one reasoning model.

The existing regression tests (`tests/chat/title_test.rs`) cannot catch it: they
drive a STUB provider that always returns text, and
`title_request_carries_the_reasoning_safe_token_budget` pins the very constant
(512) that is too small — a test that passes while the feature is broken in
production. That is §2's guiding rule, violated.
