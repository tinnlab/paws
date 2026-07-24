# HUMAN_FEEDBACK — e2e-speedup

No human feedback received. This feature (build + e2e-harness speedups) was
implemented autonomously through the 8-phase lifecycle; it has no user-facing UI
surface for a human to review, and the brief authorized the full implementation.
The measured proof (build-timing 62s→0.6s; 15/15 e2e via the new harness path with
template cloning) is recorded in TEST_RESULTS.md.

Candidate generalizable rules surfaced during this feature (for the orchestrator to
consider harvesting into the lifecycle/lints):

- **[generalizable: yes — a build script that writes into a `cargo:rerun-if-changed`
  path MUST write content-stably (create-if-missing + write-on-diff + delete-removed;
  never wipe-and-recopy), or it self-invalidates its own fingerprint and forces a
  spurious full recompile every build.]** This was the ITEM-1 root cause; worth a lint
  or a documented build.rs rule.
- **[generalizable: yes — an e2e harness config generated for a throwaway/secondary
  server boot must mirror the SAME required config fields as the primary per-test
  config; duplicating config YAML across two builders silently drifts (the template
  boot failed on a missing `access_token_expiry_hours` the per-test config had). Prefer
  a shared minimal-config builder or a required-field checklist.]** Caught only by
  RUNNING the real path (B7).
