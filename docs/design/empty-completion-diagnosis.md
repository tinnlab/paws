# Answerless chat turns — diagnosis and required behaviour

Status: design source for `fix/empty-model-response`
Date: 2026-08-08

## The report

> "I saw a lot of 'The model returned an empty response and made no tool call.
> Please try again.', figure out what's going on"

That string is rendered by the frontend
(`src-app/ui/src/modules/chat/components/ChatMessage.tsx`, predicate in
`emptyCompletion.ts`) for a finalised assistant turn that persisted no visible
answer block. Nothing errors server-side; the turn completes **successfully**
with only a `thinking` block, or with nothing at all.

## Measured reality (live rig, `ziee_rig` @ 54396)

| population | count | share |
|---|---|---|
| assistant messages, total | 5792 | — |
| render the notice (no text, no tool call) | **680** | **11.7%** |
| ├ thinking-only (reasoning persisted, no answer) | 360 | 6.2% |
| └ zero blocks persisted | 320 | 5.5% |

Reasoning length, thinking-only vs answered turns:

| population | n | median reasoning chars | mean |
|---|---|---|---|
| answerless (thinking-only) | 360 | **16,025** | 20,523 |
| answered (thinking + text) | 7,380 | **810** | 2,069 |

A **20x separation in median reasoning length**. Turns that produce no answer
are precisely the turns whose reasoning ran long.

Of the 320 zero-block messages, **315 are the last message in their branch** —
consistent with aborted/abandoned streams (the exploration rig navigates away
mid-turn), not with budget truncation.

## Root cause (confirmed at three layers)

The rig's model row (`qwen3.6-35b-a3b`) carries `max_tokens: 4096`.
Qwen3.6 is a reasoning model that emits its entire chain of thought in the
OpenAI-compatible `reasoning_content` delta channel — **billed against that same
4096-token completion budget**. On a non-trivial prompt the reasoning consumes
the whole budget and the stream terminates having emitted zero `content` deltas.

1. **Raw upstream bytes.** Requesting `qwen3.6-35b-a3b` at `max_tokens: 300`
   yields 958 chars of `reasoning_content`, **0 chars of `content`**, and
   `finish_reason: "length"`. (At the default budget the same prompt yields 5,127
   reasoning chars and 14 content chars — a 366:1 ratio.)
2. **Live ziee server log**, from an end-to-end reproduction through the rig's
   own chat API:
   `chat turn completed with no user-visible content and no tool call (empty
   completion), … provider_finish_reason: length`
3. **Persisted state** for that same message: exactly one `thinking` block
   (13,282 bytes), no text block, no tool call.

Hypothesis (a) — reasoning-stream mis-parsing — is **disproven**: the OpenAI
adapter routes `reasoning_content` → `ThinkingDelta` and `content` → `TextDelta`
correctly, and there is no `<think>` tag handling anywhere in the tree to
mis-close. The content genuinely never arrives.

### ziee then destroys the evidence

`chat/core/services/streaming.rs` — the empty-completion guard **overwrites** the
provider's real terminal reason:

```rust
if !turn_produced_visible_content {
    tracing::warn!(…, provider_finish_reason = %final_finish_reason, "…");
    final_finish_reason = "empty".to_string();
}
```

So a `length`-truncated turn reaches the client as `"empty"`. The real reason
survives only in a server log line. Nothing about *why* a turn was answerless is
persisted (there is no `finish_reason` column), so on reload the UI re-derives
"empty" from the blocks alone and cannot tell the cases apart even in principle.

### A contributing ziee-side defect

`thinking_config_for` sets `effort: ThinkingEffort::High` unconditionally, and in
the `budget` arm sets `budget_tokens: Some(4096)` — a hardcoded thinking budget
**equal to the rig's entire completion budget**. A thinking budget that is not
bounded below the completion budget guarantees a configuration in which no answer
tokens can exist.

## Why the current message is wrong

Three distinct causes present as one identical string:

| cause | share of notices | is "Please try again" correct? |
|---|---|---|
| reasoning exhausted the token budget (`length`) | ~53% | **No** — an identical retry re-truncates deterministically |
| stream aborted / abandoned | ~46% | No — the turn was cancelled, not empty |
| genuine empty stop | residual | Yes |

"The model returned an empty response" is also factually wrong for the truncation
case: the model returned a great deal, and was cut off mid-flight.

## Required behaviour

- **INV-1**: A budget-truncated turn and a genuinely-empty turn MUST NOT present
  identically to the user.
- **INV-2**: The provider's terminal finish reason MUST survive to the client and
  across a page reload; the empty-completion guard MUST NOT destroy it.
- **INV-3**: The user-facing message for an answerless turn MUST name the actual
  cause and an action the user can take. "Please try again" is refused for a
  cause that an identical retry reproduces.
- **INV-4**: A configured thinking budget MUST be strictly less than the
  completion budget, so an answer remains possible by construction.

## Out of scope (recorded, not built here)

- Automatic retry with a larger budget on the main chat path. Precedent exists
  (`chat/extensions/title/title.rs` `should_retry_with_larger_budget`), but
  silently re-billing a user's tokens is a product decision, not a bugfix.
- Lowering the forced `ThinkingEffort::High`. That is a reasoning-quality product
  choice; INV-4 fixes the guaranteed-failure configuration without overriding it.
