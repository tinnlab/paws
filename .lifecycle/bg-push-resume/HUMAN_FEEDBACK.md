# HUMAN_FEEDBACK — bg-push-resume

- **FB-1** [status: wontfix] — "DEC-1: use a SYSTEM-EVENT message, NOT a user-role message. The injected sub-agent result must render as a distinct system/observation turn, not as a USER message (a user-role injection reads as if the human typed it and pollutes history)." → INVESTIGATED and found to hit the pre-agreed BLOCKED guardrail, so NOT implemented this round: both turn-start paths hardcode `MessageRole::User` (`streaming.rs:107`, `dispatcher.rs:340`), `MessageRole` has only `{User,Assistant,System}` with no observation role, and System-role messages are DROPPED from the LLM context (`streaming.rs:1032/1136/1674`) — so a System injection would render distinctly but leave the resumed model BLIND to the result, defeating the feature. Delivering a context-visible observation turn needs new shared-pipeline + context-builder + provider-role-mapping + UI-renderer plumbing across BOTH chat loops. Per the coordinator's explicit "STOP and report BLOCKED rather than force it" instruction, reported as a BLOCKED product/architecture decision and DESCOPED this round (approved disposition in DECISIONS.md); the user-role interim (with `[Background task complete]` + run-id + untrusted-content-guard framing) is retained so the feature keeps working. A follow-up feature can add a first-class observation-turn role. [generalizable: yes — when a requested UX change requires a context-visible non-user message role, first verify the chat context-builder INCLUDES that role (System is dropped in this codebase); a role that renders but is stripped from LLM context silently breaks any feature that needs the model to see it]
- **FB-2** [status: resolved] — "DEC-5: add a DEPLOY-LEVEL KILL SWITCH that turns auto-resume OFF entirely (operator opt-out, no settings UI); keep the fixed 5-min wait; follow the repo's module kill-switch convention; guard belongs in should_resume / the Completed-branch spawn; default enabled; add a unit test." → Implemented: `Config.background_mcp: Option<BackgroundMcpConfig>` with `resume_enabled: bool` (default true), mirroring `BioMcpConfig`/`LitSearchConfig`; read via `resume::resume_enabled_from_config()` and gated into `should_resume(resume_enabled, …)` at the `Completed`-branch spawn; no admin/runtime row, no migration. TEST-8 asserts `resume_enabled=false` disables the resume and the default reads ON. (DEC-5 updated.)

---

Original autonomous-run note (pre-iteration): no human feedback had been received;
the two decisions below were surfaced and the coordinator subsequently reviewed
them and chose differently (see FB-1/FB-2 above).

This feature was implemented autonomously under the enforced feature-lifecycle.
The design was user-decided up front (detached + push-to-resume; the
blocking-vs-detached question was explicitly closed by the user before
implementation and not re-opened). No running-feature human review has occurred
yet; this ledger will record any verbatim feedback when it does.

Decisions the user may want to confirm (surfaced, not blocking — resolved by
convention/precedent in DECISIONS.md):

- **DEC-1** injected result is a USER-role message with `[Background task
  complete]` framing (mirrors the scheduler's headless prompt). Alternative was a
  distinct system/observation role (more machinery) — deferred.
- **DEC-5** the idle-wait bound is a fixed const (`RESUME_MAX_IDLE_WAIT = 5min`)
  with NO admin settings row / kill switch, justified as an internal coordination
  timeout mirroring the scheduler's fixed-const wait. If an operator toggle is
  wanted later, it can be promoted without a rewrite (named const, not inline).
