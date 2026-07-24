# INFRA_INTEGRATION — bg-push-resume (Phase-5 mandatory walks)

## User-experience walk (how a real user encounters this end-to-end)

- The user asks the assistant something that warrants a bounded background job
  ("research X while we keep talking"). The model calls `spawn_background`
  (approval-gated — the user approves the launch once), then, per the rewritten
  descriptions, ENDS its turn. The chat is immediately interactive again.
- Minutes later the detached sub-agent finishes. The user does NOT have to ask
  "is it done yet?" and the model does NOT burn turns polling. A new turn simply
  APPEARS in the same conversation: a `[Background task complete]` message
  carrying the result, followed by the assistant's continuation — streamed live
  over the SSE the user is already subscribed to. The inbox notification (existing
  behavior) still fires as a secondary signal for an away user.
- If the user had navigated away, the continuation still lands on the conversation
  (server-driven), and the run row + inbox notification + `collect_result` remain
  as the durable record. Nothing is lost if the resume can't run (idle-wait
  timeout, deleted conversation): the result still lives in the run + inbox.

## Infrastructure-integration walk (every subsystem this touches)

- **Chat streaming pipeline** — the resume calls the SAME
  `StreamingService::start_generation` the HTTP `send_message` path uses. It
  internally dispatches legacy vs agent-core via `ZIEE_CHAT_AGENT_CORE`, so BOTH
  loops are covered with no special-casing (verified: streaming.rs:817-827,
  :833-839). The continuation streams over the existing per-user
  `/api/chat/stream` SSE via `publish_frame` — no new channel.
- **Single-flight guard** — `start_generation` claims the per-conversation slot
  (`begin_generation`); the resume first WAITS for idle (`is_generating`) with a
  bounded deadline, so it never collides with a live foreground turn and never
  gets a spurious `409`. If a turn races in after the idle check,
  `start_generation` returns `409` → the resume logs + skips (result still in run
  row + inbox). Multiple completions serialize into sequential resume turns.
- **MCP tool-call + approval flow** — the resumed turn is a NORMAL foreground turn
  (NOT unattended, DEC-2), so if it uses tools the standard reviewer/approval flow
  applies (the user is present). The DETACHED sub-agent itself is unchanged
  (`UnattendedDenyGate`, `allow_delegate:false`).
- **Runner / terminal transition** — the resume is `tokio::spawn`ed from the
  `Completed` branch, so it does not block or alter the runner's terminal
  transition (`spawn_background_run` still emits `SyncEntity::WorkflowRun`). The
  `outcome` value is returned unchanged.
- **Notifications / inbox** — unchanged. `post_completion_notification` still
  fires first; the resume is additive. A resume failure never touches the run
  outcome (DEC-7), mirroring the existing notify-must-not-fail rule.
- **Sync (SSE)** — no new sync entity. The resumed turn's messages sync via the
  existing chat message/stream machinery. No `SyncEntity` variant added.
- **Permissions** — no new permission. `spawn_background` stays `background::use`;
  the resumed turn runs as the run's owner through the normal chat authz. The
  sub-agent's model access is re-checked at turn time by
  `create_provider_from_model_id` (existing).
- **Config / kill-switch** — the deployment `Config` is stashed at module init
  (mirrors scheduler). No new settings row (DEC-5). The natural gate is: the
  resume only fires when the background MCP tools were attached AND a
  conversation-bound sub-agent actually completed with output.

## Entity-lifecycle walk (the conversation the resume targets)

- **ADD** — a resume adds a user+assistant turn via the normal chat persist path;
  covered by TEST-5 (integration).
- **MUTATE / concurrent turn** — a live foreground turn is handled by the
  wait-for-idle + `start_generation`'s own single-flight (409 → skip). No replay
  buffer corruption.
- **DELETE / access-loss** — if the conversation was deleted or access revoked
  between spawn and completion, `get_conversation(cid, user_id)` returns
  `None`/error → the resume logs + returns early (DEC-7). The run is already
  terminal and its result is durable (run row + inbox), so the user loses nothing.
  This is the LOCAL + owner-scoped path; there is no cross-device sync handler to
  add (the resume is server-initiated, not a client mutation).
- **Runaway** — a completion fires the resume EXACTLY ONCE (one terminal
  transition per run); a resumed turn may legitimately spawn a NEW sub-agent
  (its own one-shot resume), but the detached sub-agent cannot spawn its own
  (`allow_delegate:false`). Covered by TEST-6 (exactly-once) + DEC-4.
