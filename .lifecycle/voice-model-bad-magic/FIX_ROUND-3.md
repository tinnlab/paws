# FIX_ROUND-3 — convergence re-audit of the round-2 diff

Round 2 changed product code (`voice/model.rs`, `voice/mod.rs`), a gallery seed,
and two e2e files, so its own diff was re-audited before the loop was declared
converged. Same angle set as phase 6; the review targeted commit `99e327f69`.

## What was re-examined, and the verdict

- **`sweep_stale_temps` selection logic** — `Path::extension() == Some("tmp")`
  matches both writers' shapes (`ggml-<name>.bin.<uuid>.tmp` and
  `.upload-<uuid>.tmp`) and excludes `ggml-<name>.bin`. `DirEntry::metadata()`
  does not traverse symlinks, so a symlinked entry fails `is_file()` and is
  skipped — conservative, which is the right direction for a deleter. A failed
  `modified()` or a future mtime yields `None` and the file is **kept**. Only
  successful removals are counted. **No finding.**
  *(Noted, not a defect: a file named exactly `.tmp` has no `extension()` and
  would not be swept. Neither writer can produce that name — both have a stem.)*

- **Init-time correctness of the sweep** — the risk was that `models_dir()` could
  resolve against an unset app-data dir at module-init time, silently making the
  sweep a no-op. Verified by reading the boot order: `main.rs` calls
  `set_app_data_dir` (:180/:186) **before** `initialize_modules` (:254), and
  `lib.rs`'s `setup_server` path runs `init_data_dir(&config)` before its
  `initialize_modules`. `get_app_data_dir` is a poison-recovering `Mutex<PathBuf>`
  with a default, so it cannot panic at boot either. **No finding.**

- **Kill-switch placement** — the sweep sits AFTER the `if !enabled { return }`
  guard, so a deploy with `voice: { enabled: false }` still touches nothing on
  disk. **No finding.**

- **`finalize_download` both branches** — rename-success returns without touching
  either path; copy-success removes the temp; copy-failure removes destination
  and temp and returns a context-preserving error. **No finding.**

- **Gallery seeded surface** — `DownloadFailureRow` is rendered outside the
  `<Can permission={VoiceAdminManage}>` wrapper, so the failure row and its Retry
  render in the gallery regardless of the seeded permission context; `holdPatch`
  holds the seed against the store's own `init` refetch (the
  `llm-local-runtime` precedent does the same). Runtime-verified by the
  `gate:ui` runtime-health pass, which drives every gallery surface. **No finding.**

- **e2e mock (`failVersionDownloadWith`)** — the early return is placed BEFORE
  the branch that marks the version installed, so the failure path cannot leave
  the state half-mutated; it mirrors `failModelDownloadWith` exactly. **No
  finding.**

- **TEST-11b assertion quality** — asserts the label, the server reason, the
  `role="alert"`, an enabled Retry, and the absence of a bare "0 Bytes" on the
  row. None of these is satisfied by the pre-fix `<Text type="secondary">`
  rendering. **No finding.**

- **A4 (cosmetic assertions) over the round-2 added lines** — every added
  assertion pins a value that differs between the fixed and unfixed code
  (`!tmp.exists()`, `== 0` vs `== 2`, `real_model.exists()`, the e2e text/attr
  assertions). **No finding.**

## Negative controls actually run this round

- **TEST-14** — reverted `finalize_download` to the pre-fix body: RED with
  *"the temp must not leak on a failed publish"*; restored: 15/15 green.
- **TEST-15** — removed the `min_age` guard: RED on the "a fresh temp must not be
  reclaimed" assertion; removed the `.tmp` extension filter: RED on "an installed
  model file must NEVER be swept". Restored: 15/15 green.

**New confirmed findings:** 0
