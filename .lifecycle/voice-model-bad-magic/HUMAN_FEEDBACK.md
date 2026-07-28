# HUMAN_FEEDBACK — voice-model-bad-magic

The branch was driven headlessly (`drive.sh voice-fix`), so **no human feedback
was received** during implementation: there was no interactive reviewer to
critique the work in-session.

What the owner DID supply is the original defect report, which was treated as
binding input rather than as feedback-to-be-resolved. It is recorded here so the
merge reviewer can see it was answered point-for-point; each item traces to an
invariant, an item, and a test.

- **FB-1** [status: resolved] — *"The whisper settings page shows 'Installed
  models: No models installed yet' while two Available-models rows each render
  '0 Bytes' and 'file is not a whisper ggml/GGUF model (bad magic)'. A
  file-validation error cannot coherently apply to a model that was never
  installed."*
  **Resolution:** confirmed and root-caused (byte-order-wrong ggml magic ⇒ every
  real install rejected on its first chunk; the UI then rendered the failed
  attempt as row metadata). INV-1/INV-2 → ITEM-1/ITEM-5/ITEM-12 → TEST-9,
  TEST-11, TEST-11b, TEST-12. [generalizable: yes — see TEST_GAP §5.3: every
  "the system is empty/idle" UI state deserves one composed-page assertion that
  no contradictory error renders simultaneously.]

- **FB-2** [status: resolved] — *"Fix the CAUSE, not the display. If a failed
  download leaves a 0-byte artifact, fix the download path (temp-then-move,
  cleanup on EVERY failure exit) and clean the detritus."*
  **Resolution:** the cause is fixed (ITEM-1), not hidden. The conditional half
  was checked against the live instance and its antecedent is FALSE — no
  detritus exists (BUG_ANALYSIS E1/E2, re-verified independently: `voice-models/`
  empty, `voice_models` 0 rows). The *property* was then made to actually hold on
  every exit: the phase-6 re-audit found two exits where it did not
  (`finalize_download`'s copy fallback, and kill-orphaned temps) and both were
  closed — FIX_ROUND-2 F2-1/F2-2, TEST-14/TEST-15.
  [generalizable: yes — "cleanup on every failure exit" must include the
  *publish* exit and the *process-death* exit, not just the transfer exits.]

- **FB-3** [status: resolved] — *"A not-installed model must NEVER render a
  file-validation error, whatever the cause. When the error IS legitimate, the
  text must say what was found, what was expected, and what to do."*
  **Resolution:** INV-1/INV-4 → `DownloadFailureRow` (always framed as a failed
  *install attempt*, `role="alert"`, Retry) + `ModelRejection::message` (found /
  expected / action, with the observed bytes rendered hex + printable).
  TEST-5 fails the build if any message regresses to a bare "bad magic".

- **FB-4** [status: resolved] — *"Check the Upload and Add-from-URL/HuggingFace
  paths for the same latent bug."*
  **Resolution:** all three paths funnel through the same `has_whisper_magic`, so
  all three were broken and all three are fixed by ITEM-1. Upload additionally
  routes through `ModelRejection::classify` at ingest (ITEM-4, TEST-7): a 0-byte
  upload is now reported as EMPTY, not as bad magic, and nothing is written to
  the library. Add-from-URL shares the download path with the catalog install.

- **FB-5** [status: resolved] — *"Verify the size display: '0 Bytes' beside a
  catalog size of 56.94 MB suggests on-disk and catalog sizes are mixed in one
  row."*
  **Resolution:** they are two independent numbers, not a mix — the row's
  metadata line shows `model.size_bytes` (catalog), the progress line showed
  `progress.bytes_received` (transfer). The transfer number is now suppressed
  when a failure transferred nothing (INV-6, TEST-6), and fix-round 1 closed the
  mirror-image case where a source advertising `size_bytes: 0` printed the same
  meaningless zero from the catalog side (DRIFT-2.2).

- **FB-6** [status: resolved] — *"Test-gap analysis: why did the tests not catch
  this? What CLASS was missing? Look first for a PASSING test that asserts the
  broken behaviour as correct."*
  **Resolution:** that is exactly what was found, and it is recorded in
  `TEST_GAP.md`: the fixtures were derived from the implementation's assumption
  at EVERY tier simultaneously (8 sites in `model_management_test.rs`, the unit
  test, and `stage_model`), so the suite proved `has_whisper_magic` self-
  consistent — a property nobody needed. Blast radius scanned (LLM engine, hub
  seed, sandbox rootfs, voice runtime binary): the byte-order bug is contained,
  and the generalisable rule is that digest-anchored download paths are
  inherently protected while self-defined-format paths are not.
  [generalizable: yes — TEST_GAP §5 lists four candidate fleet-level rules.]

## Round-3 additions (the verification session)

The brief for the verification round added two instructions beyond the original
report, both answered:

- **FB-7** [status: resolved] — *"Verify its claims — do not trust them.
  Re-derive the root cause from inspected state; verify the WIP code compiles and
  its tests actually run; report OBSERVED test counts."*
  **Resolution:** the root cause was re-derived from live state (four real file
  heads, the pre-fix source, the live API + DB + filesystem) and is CONFIRMED;
  every tier was re-run and every negative control re-executed rather than cited.
  All counts in `TEST_RESULTS.md` are from watched runs. Re-verification found
  **three new defects in code this branch had ADDED** — an ungated Retry control,
  an INV-6 fix applied to only one of the twin cards, and an assertion that could
  not fail — all fixed in FIX_ROUND-4.
  [generalizable: yes — a negative control must be RUN, not cited: running the
  F4-2 control is the only reason F4-3 was found. An inherited "verified RED"
  claim is not evidence.]

- **FB-8** [status: resolved] — *"If something cannot honestly be made green, say
  so plainly rather than weakening a check."*
  **Resolution:** two things are reported red rather than worked around —
  `cargo check --workspace --tests` (an inherited `agent-core` test-compile
  break, proven untouched by this branch) and the phase-0 **A1** gate (18
  inherited `.lifecycle/` dirs; satisfying it would mean deleting 17 other
  features' artifacts). The one `gate:ui` visual failure was investigated by A/B
  against the base rather than muted, and is recorded as an unreproducible flake
  with the evidence for that verdict.

## Open items

None. Awaiting human review at merge.
