# DECISIONS — bg-push-resume

All decisions are resolved up front so implementation runs nonstop.

- DESCOPED: ITEM-7 — the system/observation-role injected turn (DEC-1) is BLOCKED on non-trivial new shared chat-pipeline + context-builder + UI plumbing (both turn-start paths hardcode MessageRole::User; System-role messages are dropped from the LLM context, so the resumed model would be blind to the result). Cut this round per the coordinator's explicit "STOP and report BLOCKED rather than force it" guardrail; the user-role interim is retained. [approved: coordinator/2026-07-24]

### DEC-1: What ROLE/appearance does the injected result take on the resumed turn?
**Resolution:** (iteration round — user chose SYSTEM/observation over the
convention default; investigated → BLOCKED for now, interim keeps user-role) The
user directed that the injected result render as a distinct SYSTEM/observation turn,
not a USER message (rationale: a user-role injection reads as if the human typed
it and pollutes history). Investigation of the chat pipeline shows this cannot be
done minimally and hits the pre-agreed BLOCKED guardrail:
- **Both turn-start paths hardcode the incoming role to `User`** — legacy
  `send_message` (`chat/core/services/streaming.rs:107`,
  `MessageRole::User.as_str()`) and agent-core
  (`chat/agent_host/dispatcher.rs:340`). Seeding any non-user role needs a new
  role parameter threaded through `SendMessageRequest` → `send_message` /
  `start_generation` AND the agent-core dispatcher — shared-pipeline plumbing.
- **`MessageRole` has only `{User, Assistant, System}`** (`models/message.rs:13`)
  — no `developer`/`observation` role — and **System messages are DROPPED from
  the LLM context** (`streaming.rs:1032` "Skip system messages" → `continue`;
  `1136`/`1674` map `System => continue`/`return`). So an injected System message
  would render distinctly but leave the resumed model BLIND to the result,
  defeating the feature's purpose. Delivering an observation message the model
  ALSO sees requires changing the shared context-builder (both paths) + a provider
  role-mapping decision + a UI renderer for the new turn kind — non-trivial new
  turn-start + context-building plumbing in wire-format-invariant-tested code.
- No existing "observation/developer/included-system" message machinery exists to
  reuse (searched).
**Interim:** keep the current USER-role delivery (with the explicit
`[Background task complete]` + run-id + untrusted-content-guard framing) so the
feature keeps working, and report Change-1 to the coordinator as a **BLOCKED
product/architecture decision** (per the coordinator's explicit instruction:
"STOP and report BLOCKED rather than forcing it — don't hack a fake role the
renderer won't handle"). A follow-up feature can add a first-class
observation-turn role (persisted + context-included + UI-rendered) across both
chat loops if the product wants it.
**Basis:** user (chose system/observation) + codebase (the pipeline can't seed a
context-visible non-user role without new shared plumbing — file:line evidence
above). Recorded as BLOCKED, not silently reverted.

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
Additionally, a resumed FOREGROUND turn CAN call `spawn_background` again (that
is legitimate — it is a normal turn), but `spawn_background` is NOT
approval-bypassed (`background_call_needs_approval("spawn_background") == true`,
tools.rs), so every hop of a resume→spawn→resume chain requires a HUMAN approval.
The chain therefore cannot run away autonomously — a human gates each new
background launch. (Blind-audit finding: two auditors flagged the absent explicit
depth cap; the approval gate on each spawn IS the bound. Recorded in code as a
comment on the resume `enable_mcp` request.)
**Basis:** codebase — one terminal transition per run (`spawn_background_run`
guarded transitions); `allow_delegate:false` depth cap on detached sub-agents;
`spawn_background` approval gate on every launch.

### DEC-5: Bounded-wait + resume-enable — fixed const or admin-configurable? (ITEM-5)
**Resolution:** (iteration round — user chose to ADD a deploy-level kill switch)
The wait bound stays a FIXED const (`RESUME_MAX_IDLE_WAIT = 5min` +
`RESUME_POLL_INTERVAL`), BUT — per the user's direction — a **deploy-level config
kill switch** now turns auto-resume OFF entirely: `background_mcp: {
resume_enabled: false }` (`Config.background_mcp: Option<BackgroundMcpConfig>`,
`resume_enabled: bool`, default TRUE). It follows the repo's `Option<XxxConfig>` +
`enabled`-bool convention (mirrors `BioMcpConfig`/`LitSearchConfig`/`JsToolConfig`)
and is checked in the resume gate: `resume_enabled_from_config()` feeds
`should_resume(resume_enabled, …)`, which is where the resume is wired (the
`Completed`-branch spawn), per CODING_GUIDELINES §16. Default preserves current
behavior (resume ON). There is intentionally NO admin/runtime settings row — this
is an OPERATOR opt-out only, so no migration / REST / sync / admin card is added
(the module's tools stay registered; only auto-resume is suppressed). Unit-tested
(TEST-8: `resume_enabled=false` disables the resume; default reads ON).
Original fixed-const rationale for the WAIT bound (unchanged):
FIXED named consts, no settings row for the timeout.
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
