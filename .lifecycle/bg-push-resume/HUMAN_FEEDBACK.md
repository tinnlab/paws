# HUMAN_FEEDBACK — bg-push-resume

- **FB-1** [status: resolved] — "DEC-1: use a SYSTEM-EVENT message, NOT a user-role message. The injected sub-agent result must render as a distinct system/observation turn, not as a USER message (a user-role injection reads as if the human typed it and pollutes history)." → Initially investigated as a non-user ROLE and found BLOCKED (both turn-start paths hardcode `MessageRole::User`; `MessageRole` has no observation role; System messages are dropped from the LLM context — a role that renders but is stripped from context breaks the feature). The coordinator then supplied the provider-reality-constrained resolution: build it as a ziee-INTERNAL `observation` CONTENT TYPE that RENDERS distinctly but WIRE-serializes to `user`-role text. RESOLVED that way: `Observation` content type in the text extension (mirrors `thinking`), `process_content_for_llm → ContentBlock::Text`, message role stays `user` (context-visible on every provider), a server-internal `#[serde(skip)]` injection flag, an `ObservationContent` card + a `renderAsUser` gate so it renders full-width not as a user bubble, Edit suppressed. Covered by TEST-9 (unit wire-map + flag), TEST-5 (integration: injected block is `observation`-typed + assistant continues), TEST-10 (e2e: distinct card, not a user bubble, assistant continues). [generalizable: yes — to render a message distinctly while keeping it model-visible, DON'T invent a non-user ROLE (System is dropped from LLM context in this codebase); add a CONTENT TYPE that renders distinctly but wire-maps to a plain-text block on a user-role message · harvested@pending]
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
