# DECISIONS — bg-push-resume

All decisions are resolved up front so implementation runs nonstop.

### DEC-1: What ROLE/appearance does the injected result take on the resumed turn?
**Resolution:** A USER-role message with explicit `[Background task complete]`
framing. `start_generation` (legacy path, streaming.rs) persists the request
`content` as a user-role message, so the injected result reads as a user turn
that hands the sub-agent's result back to the model with a clear machine-authored
header. No new "system/observation" role machinery is added.
**Basis:** convention — this is the exact shape the scheduler uses for its
headless prompt firing (`scheduler/dispatch.rs:377-396` builds `content` and
calls `start_generation`; it becomes a user message on the bound conversation).
The clear `[Background task complete]` header disambiguates authorship for both
the model and the human reading the thread. A distinct role is more machinery for
no MVP benefit; deferred.

### DEC-2: Is the resumed turn UNATTENDED (deny-approvals) like the scheduler?
**Resolution:** NO. The resume runs as a normal foreground turn (no
`unattended:true`, no allow-list). The conversation is the user's live chat; the
resumed continuation streams to them over the existing SSE, and if the model
needs an approval-gated tool the normal reviewer/approval flow applies.
**Basis:** codebase — `unattended:true` (scheduler) exists specifically because a
scheduled fire has NO human attached. Push-resume is the opposite: it re-engages
the SAME conversation the user is in, so the standard interactive gating is
correct. (The DETACHED sub-agent itself already ran unattended via
`UnattendedDenyGate`; that is unchanged — DEC applies only to the resumed
foreground turn.)

### DEC-3: How are MULTIPLE concurrent sub-agent completions handled?
**Resolution:** Accept sequential serialization for the MVP. Each completion
`tokio::spawn`s a resume; each resume waits-for-idle on
`is_generating(cid)` before calling `start_generation` (which itself claims the
per-conversation single-flight slot). So N completions become N sequential resume
turns on the conversation — never concurrent, never corrupting the replay buffer.
No batching/coalescing in this tranche.
**Basis:** codebase — `begin_generation`/`is_generating`
(`chat/stream/registry.rs`) already enforce at-most-one in-flight generation per
conversation; the wait-for-idle loop composes with it exactly as the scheduler's
does. Batching is a future optimization, not a correctness requirement.

### DEC-4: Resume-loop / runaway safety.
**Resolution:** Safe by construction, no extra guard needed. A resume fires
EXACTLY ONCE per sub-agent run — from the single `BackgroundOutcome::Completed`
terminal transition, which the runner reaches once. A resumed turn MAY itself
spawn a new sub-agent (legitimate chained work) → that new run completes → its own
one-shot resume. This is bounded work driven by real completions, not an
unconditional self-re-trigger: nothing in the resume path re-spawns a background
run on its own. The detached sub-agent additionally cannot spawn its OWN
sub-agents (`allow_delegate:false`, tools.rs:641, the depth cap), so a single
resume cannot fan out a tree of background runs.
**Basis:** codebase — one terminal transition per run (`spawn_background_run`
guarded transitions); `allow_delegate:false` depth cap on detached sub-agents.

### DEC-5: Bounded-wait + resume-enable — fixed const or admin-configurable? (ITEM-5)
**Resolution:** FIXED named consts, no settings row, no separate kill switch.
- `RESUME_MAX_IDLE_WAIT: Duration = Duration::from_secs(5 * 60)` — best-effort
  bound on how long a resume waits for the conversation to become idle before
  giving up (logs + returns; the result still lives in the run row + inbox
  notification, so nothing is lost).
- `RESUME_POLL_INTERVAL: Duration = Duration::from_millis(500)`.
No `<feature>::settings` table/migration/REST/sync/admin-card is added.
**Basis (why a const, per the Configurable-settings rule):** this is an INTERNAL
coordination timeout, not an operator-facing tunable — it does not bound a
resource (memory/cpu/quota), does not gate a security boundary, and has no product
meaning an admin would tune. The closest existing precedent is the SCHEDULER's own
headless-turn wait, which is a plain fixed const (`TERMINAL_WAIT`/`POLL_INTERVAL`,
`scheduler/dispatch.rs:44-45`) — mirroring the nearest pattern dictates a const
here too. The values are named consts (not inline magic numbers) so they can be
promoted to configurable later without a rewrite.
**Basis (why no separate enable/kill switch):** the feature has no independent
external surface to disable — it is a behavior on top of the background MCP tools.
It only ever fires when (a) the background MCP tools are ATTACHED to the chat
(the existing MCP-enable + `background::use` gating), (b) the model actually
SPAWNED a conversation-bound sub-agent, and (c) that run completed with output.
Those are the natural gates; a redundant toggle is the "overkill" the brief flags.
The dispatch between legacy and agent-core loops is already governed by the
existing `ZIEE_CHAT_AGENT_CORE` env flag inside `start_generation`, which the
resume calls — so both loops are covered with zero new branching.

### DEC-6: Ownership of borrowed captures in the detached `tokio::spawn`.
**Resolution:** Own every capture before the spawn — `pool.clone()` (PgPool is an
Arc-backed cheap clone), `user_id`/`conversation_id`/`model_id` (Copy),
`task.to_string()`, `final_text` (owned String extracted from `final_output`).
The spawned future is `'static`. The resume function takes owned params
(`String`) rather than borrows.
**Basis:** convention — Rust `tokio::spawn` requires `'static`; this is the same
own-then-spawn discipline `spawn_background_run`'s own driver closures use
(tools.rs:244, `move` closures capturing owned copies).

### DEC-7: What does the resume do if the conversation/model is gone or config is unset?
**Resolution:** Log at `warn` and return early — never propagate into the run
outcome (the run is already `Completed`). Specifically: `background_mcp_config()`
`None` → log + skip; `get_conversation` returns `None`/error (conversation
deleted, access revoked) → log + skip; no `active_branch_id` → log + skip;
`start_generation` `Err` (e.g. a genuine 409 if a turn raced in after the idle
check) → log + skip. The user still has the result via the inbox notification +
the run row (`collect_result` still works).
**Basis:** convention — matches `post_completion_notification`'s
notify-must-not-fail-the-run rule (tools.rs:368-372) and the project rule "a
notify/resume failure must NOT fail the run (log + continue)".
