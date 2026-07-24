# HUMAN_FEEDBACK — bg-push-resume

no human feedback received

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
