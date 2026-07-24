# FIX_ROUND-5 — iteration round convergence

After FIX_ROUND-4's single fix (decouple TEST-8 from the global config OnceCell),
re-reviewed the changed test + the kill-switch path:

- TEST-8 now asserts only the pure, deterministic gate — `should_resume(false,
  cid, "answer") == false` and `should_resume(true, cid, "answer") == true` — with
  no dependency on process-global state. Verified passing (5/5 resume unit tests).
- The default-ON behavior of `resume_enabled_from_config()` when `background_mcp`
  config is absent remains covered end-to-end by the integration tests TEST-5/6
  (the test server runs `init()` which sets the cell, with no `background_mcp`
  YAML section → resume ON → those tests inject the turn).
- No production code changed in this round (only the test assertion).

No remaining findings.

**New confirmed findings:** 0
