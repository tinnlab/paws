# FIX_ROUND-2 — findings from the continuation session's phase-6 re-audit

The phase-6 audit was re-run from scratch over the **whole** `origin/feat/agent-core...HEAD`
diff (61 hunks, 16 angles — see `LEDGER.jsonl` / `AUDIT_COVERAGE.tsv`), treating
the inherited work as unreviewed. Four findings were confirmed and fixed.

## Findings fixed

- **F2-1 [resource-lifecycle] — `finalize_download` leaks the temp AND can leave
  a partial destination that reads as an installed model.** The cross-device copy
  fallback was `std::fs::copy(tmp, dest).map_err(...)?` followed by
  `remove_file(tmp)` — the `?` returns before the removal. Worse, a copy that
  dies part-way (ENOSPC/EIO) leaves a *truncated* `ggml-<name>.bin`, and
  `installed_model_path` resolves the first file that `is_file() && len() > 0`,
  so the runtime would load it. This is exactly the failure class the brief names
  ("a failed download leaves a 0-byte artifact"), on the one failure exit the WIP
  did not close — and PLAN had explicitly predicted no change was needed here
  ("already correct … do not restructure").
  **Fix:** both sides removed before the error propagates, with the rationale in
  the doc-comment. **TEST-14**, verified RED against the pre-fix body
  (`the temp must not leak on a failed publish`).

- **F2-2 [resource-lifecycle] — no reclamation of `*.tmp` orphaned by a kill.**
  Every error exit removes its own temp and the upload path has a `TempGuard`,
  but a SIGKILL/OOM-kill/power-loss mid-transfer can run neither. Nothing else
  ever deletes them: the library list is DB-backed and `installed_model_path`
  only matches `ggml-<name>.{bin,gguf}` — so an orphan is invisible as well as
  permanent, at up to 5 GiB each (the cap is enforced as bytes arrive).
  `CODING_GUIDELINES` §5 requires startup orphan-reclamation.
  **Fix:** `model::sweep_stale_temps(dir, min_age)` called from
  `voice::VoiceModule::init`, with a 6h `STALE_TEMP_MIN_AGE` guard so a transfer
  genuinely in flight in another process sharing the data dir is never touched.
  **TEST-15** covers both orphan shapes, the age guard, the never-touch-a-model
  property, and the missing-directory no-op.

- **F2-3 [plan-fidelity] — PLAN's gallery failed-install cell was never built,
  and DRIFT-1 did not record the omission.** PLAN lists
  `src-app/ui/src/modules/voice/gallery.tsx` under *Files to touch* and its
  UI-surface checklist promises the cell exists "so the design-critic pass
  reviews the real failure layout, not an empty card". The WIP commit contains no
  `gallery.tsx`.
  **Fix:** added the `seeded-available-models-failed-install` seeded surface,
  mirroring `llm-local-runtime`'s `seeded-s3-available-versions-failed-row`
  precedent, seeded with the exact live shape (nothing installed, one terminal
  failed task, `bytes_received: 0`, no total). Recorded as **DRIFT-2.3**.

- **F2-4 [test-coverage-claims] — TEST-11 claimed an arm it never exercised.**
  TESTS.md says the failed-install presentation is asserted "in BOTH the models
  card and the runtime-versions card" (ITEM-12's entire purpose), and the spec
  title said "(models + versions cards)" — but the spec only ever drove
  `voice-available-model-*` testids. The twin card that carried the
  byte-identical defect had no failure-row assertion anywhere.
  **Fix:** **TEST-11b** plus a `failVersionDownloadWith` mock hook mirroring
  `failModelDownloadWith`; TEST-11's own wording corrected to what it actually
  asserts. Recorded as **DRIFT-2.4**.

## Findings confirmed but deliberately NOT changed

Recorded so they are decisions, not oversights (also in `LEDGER.jsonl`):

- **The upload path streams the whole (≤5 GiB, capped) body to its temp before
  the magic check.** Aborting the request-body read as soon as the 4-byte head is
  known would, for an HTTP client, typically surface as a connection reset rather
  than the 400 + actionable message — worse UX for exactly the case this branch
  improves. INV-5's requirement ("rejected at ingest, never stored and failed
  later") is already met: rejection happens before any row is written and inside
  the `TempGuard` scope.
- **A failed download that transferred nothing still renders a 0%-width,
  error-toned progress bar with no text.** It reads as a failure indicator, not
  as a byte count; INV-6 is about the numeric label, which is now suppressed.
- **`has_whisper_magic` still accepts the big-endian `ggml` ASCII ordering**,
  which no real little-endian file carries. Keeping it makes the corrected check
  a pure widening of the pre-fix accept-set, so no input that used to pass can
  now fail.

## Documentation correction

- **BUG_ANALYSIS §4** claimed the post-stream rejection site emitted the same
  "bad magic" sentence. Verified against the pre-fix source: it emitted
  `"download produced no valid whisper model bytes"`. The substantive claim (an
  empty body folded into the same rejection *and the same `VOICE_MODEL_INVALID`
  code*) holds. Corrected in place, with the correction marked rather than
  silently rewritten. Recorded as **DRIFT-2.7**.

**New confirmed findings:** 4
