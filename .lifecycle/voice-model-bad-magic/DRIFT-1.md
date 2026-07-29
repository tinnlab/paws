# DRIFT-1 — implementation vs plan + design invariants

Reconciled per ITEM as each landed (not backfilled). Each entry checks the code
against BOTH PLAN.md and BUG_ANALYSIS's invariants.

- **DRIFT-1.1** — verdict: none — ITEM-1 landed as planned. `has_whisper_magic`
  now accepts `GGML_MAGIC_LE` / `GGML_MAGIC_BE` / `GGUF_MAGIC`, all derived from
  the single `GGML_FILE_MAGIC: u32` via `to_le_bytes()` / `to_be_bytes()` (no
  second hand-written literal), with the byte-order rationale in the doc-comment.
  Pure widening as PLAN_AUDIT predicted.

- **DRIFT-1.2** — verdict: resolved — ITEM-2/3 were planned as "split the
  conditions" + "one shared message builder". The implementation folded both into
  a single `ModelRejection` enum (`classify` / `code` / `message` / `to_error`)
  rather than three free functions. Same behaviour, fewer moving parts, and it
  makes the download and upload sites structurally identical
  (`ModelRejection::classify(head, len)`), which is what INV-4 actually needs.
  Recorded as a shape refinement within the item, not a scope change.

- **DRIFT-1.3** — verdict: none — ITEM-4 landed as planned. `model_handlers.rs`
  now calls `ModelRejection::classify(&upload.head, upload.size)`, still ahead of
  the row write and still inside the `TempGuard` scope, so INV-5's
  "rejected at ingest, never stored and failed later" is preserved rather than
  re-derived.

- **DRIFT-1.4** — verdict: none — ITEM-5/12 landed as planned via the shared
  `DownloadFailureRow`, wired into both `AvailableModelsCard` and
  `AvailableVersionsCard`. Carries `role="alert"`, a `tone="destructive"`
  "Install failed" label, the server's reason, and a Retry that re-invokes the
  same install action (DEC-7).

- **DRIFT-1.5** — verdict: impl-wins — ITEM-6 was planned as an inline change to
  each card's `DownloadProgressLine`. The implementation extracts a pure
  `progressByteLabel()` into `downloadProgress.helpers.ts` instead, returning
  `null` when nothing should render. Reason: the byte-line logic was duplicated
  across the two cards (§9), and a pure helper is directly unit-testable, which
  is what TEST-6 needs — an inline JSX ternary is not. **PLAN.md amended**:
  `downloadProgress.helpers.ts` added to *Files to touch* and TESTS.md's TEST-6
  already targets that file, so no test re-mapping was needed. Phases 1–3
  re-run green after the amendment.

- **DRIFT-1.6** — verdict: resolved — ITEM-7 planned "all 7 sites"; the actual
  count was **8** (7 × `b"ggml".to_vec()` plus the `default_fixtures` closure).
  All now route through the shared `super::ggml_bytes` / `GGML_MAGIC` in
  `tests/voice/mod.rs`; `grep -c 'b"ggml"' model_management_test.rs` → 0.
  Count corrected in TEST_GAP.md.

- **DRIFT-1.7** — verdict: plan-wins — TEST-10 was first written as
  `#[cfg(test)] mod fixture_faithfulness` inside `tests/voice/mod.rs`. That is
  **wrong for an integration-test target**: `cfg(test)` is not set there, so the
  module (and the guard) would have been compiled out and silently never run —
  a paper test, exactly the failure class this branch exists to fix. Corrected by
  removing the attribute, with a comment recording why. Caught during
  implementation, before any gate.

- **DRIFT-1.8** — verdict: none — ITEM-8/9 landed as planned.
  `accepts_the_real_on_disk_whisper_ggml_magic` pins
  `REAL_WHISPER_GGML_FILE_HEAD = [0x6c,0x6d,0x67,0x67]` transcribed from a real
  file, and `not_installed_models_never_report_a_file_validation_error` iterates
  the WHOLE catalog rather than a named model.

- **DRIFT-1.9** — verdict: none — the **D2 property was verified by running**,
  not asserted. The corrected check was temporarily reverted to the original
  `b"ggml"` comparison and the suite re-run: TEST-8, TEST-1 and TEST-2 went RED
  with the defect's exact signature (*"a REAL whisper.cpp ggml file (head
  [6c, 6d, 67, 67]) must be accepted"*), then green again on restore. This is the
  evidence that the new tests would have caught the shipped bug; without it the
  claim would be inference (rule B7).

- **DRIFT-1.10** — verdict: resolved — PLAN_AUDIT's `## OpenAPI regen` predicted
  no regen would be required. Verified by running `--generate-openapi`: the
  emitted `openapi.json` differs from the committed one by 144 insertions / 144
  deletions, but a sorted-content comparison shows a **zero** content delta —
  a purely positional (key-order) diff, exactly the case the lifecycle skill
  documents. The no-op regen churn was reverted so the branch diff carries no
  generated noise, and no desktop regen is needed either. Prediction held.

- **DRIFT-1.11** — verdict: none — ITEM-11 landed as `TEST_GAP.md`, including the
  blast-radius scan (DEC-11: scan and report, fix nothing). The scan found the
  byte-order bug contained to the one fixed function; `metadata.rs`'s `b"GGUF"`
  is correct per the GGUF spec. The generalised finding — digest-anchored
  download paths are inherently protected, self-defined-format paths are not — is
  recorded for the owner.

**Unresolved drifts:** 0
