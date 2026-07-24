# DRIFT-1 — implementation vs plan

Audited the implemented diff against PLAN.md / DECISIONS.md / TESTS.md.

- **DRIFT-1.1** — verdict: resolved — ITEM-1..4 implemented exactly as planned:
  ITEM-2 config OnceCell + accessor in `mod.rs` (mirrors scheduler); ITEM-3
  `resume.rs` with `resume_conversation_with_result` + `build_resume_message` +
  `should_resume` + the two consts; ITEM-1 all three descriptions + both `note`
  strings rewritten to drop polling; ITEM-4 the `tokio::spawn`ed resume in the
  `Completed` branch with the structural subagent-only gate. No divergence.

- **DRIFT-1.2** — verdict: impl-wins — TEST-6 was re-scoped from "a sandbox_exec
  completion does not inject a chat turn" to "a single sub-agent completion
  resumes EXACTLY ONCE (no runaway)". Reason: the sandbox-negative needs a live
  bwrap rootfs (would force a skip, violating the no-skip rule), whereas the
  exactly-once assertion is rootfs-free, honestly exercises ITEM-4's
  fire-once/runaway-safety property (DEC-4), and the subagent-only SEPARATION is
  already structural (the hook lives only in `execute_subagent_run`) + guarded by
  TEST-4's `should_resume` predicate. TESTS.md TEST-6 line amended; TEST-ID
  preserved (no vanish). Phase 3 re-gated green after the amend.

- **DRIFT-1.3** — verdict: none — no migration, no OpenAPI regen, no new
  permission, no frontend path (matches BASE.md + PLAN). `cargo check -p ziee`
  clean (exit 0, only pre-existing warnings).

**Unresolved drifts:** 0
