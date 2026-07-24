# DRIFT-2 — iteration round (kill switch + DEC-1 BLOCKED)

Audited the iteration delta against the amended PLAN/DECISIONS/TESTS.

- **DRIFT-2.1** — verdict: resolved — ITEM-6 (deploy kill switch) implemented as
  planned: `Config.background_mcp: Option<BackgroundMcpConfig>` +
  `resume_enabled: bool` (default true, mirroring `BioMcpConfig`); read via
  `resume_enabled_from_config()`; gated into `should_resume(resume_enabled, …)`;
  the `Completed`-branch spawn passes the flag. TEST-8 covers it. No divergence.

- **DRIFT-2.2** — verdict: resolved — ITEM-7 (system/observation role) is
  [DESCOPED] this round with an approved DECISIONS disposition (BLOCKED on
  non-trivial shared-pipeline plumbing; user-role interim retained). No code
  shipped, consistent with the descope. The plan-coverage gate is satisfied via
  the `[DESCOPED]` + `DESCOPED: ITEM-7 … [approved: …]` disposition.

- **DRIFT-2.3** — verdict: none — no migration, no OpenAPI regen (Config is
  deployment YAML, not an API type — not serialized into `openapi.json`), no new
  permission, no frontend path. `cargo check -p ziee` clean (exit 0). The prior
  ITEM-1..5 code is unchanged except `should_resume`'s signature (a new leading
  `resume_enabled: bool` param) + the one call site.

**Unresolved drifts:** 0
