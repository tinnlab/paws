# DRIFT-2 — implementation vs plan, rounds authored after the WIP commit

DRIFT-1 covered the original authoring session (which ended at a session limit
with everything uncommitted; the work survives as `2ab8d9004`). This round covers
everything authored afterwards: the inherited fix-round-1 commit `4597e1baf` and
the fix-round-2 commit made by the continuation session, each checked against
BOTH `PLAN.md` and BUG_ANALYSIS's invariants.

- **DRIFT-2.1** — verdict: none — ITEM-2/ITEM-3's `truncated` fixture was added
  to `default_fixtures` by the WIP but never driven by a test, so
  `ModelRejection::Truncated` had unit coverage only. Fix-round 1 drove it
  through the real download path inside TEST-3. Within the item; no scope change.

- **DRIFT-2.2** — verdict: impl-wins — ITEM-6/INV-6 was written as a
  *progress-line* obligation. Fix-round 1 found the mirror-image case on the
  row's own metadata line: a source that advertises `size_bytes: 0` rendered a
  naked `0 Bytes` from the catalog side, with no failed download involved at all.
  `AvailableModelsCard` now suppresses the catalog size when it is 0. The
  invariant is "no meaningless zero next to a real size", and honouring it only
  on the progress line would have left the same defect reachable from the other
  direction. **PLAN.md is not amended**: this is the same INV-6, not a new item.

- **DRIFT-2.3** — verdict: plan-wins — **PLAN's `Files to touch` lists
  `src-app/ui/src/modules/voice/gallery.tsx` (ITEM-5/ITEM-6 gallery states), and
  the UI-surface checklist promises "the gallery gains a *failed install* cell …
  so the design-critic pass reviews the real failure layout, not an empty card".
  The WIP never implemented it and DRIFT-1 did not record the omission** — an
  unrecorded drift, found in the phase-6 re-audit (`plan-fidelity` angle). Closed
  in fix-round 2 by adding the `seeded-available-models-failed-install` surface,
  mirroring `llm-local-runtime`'s `seeded-s3-available-versions-failed-row`
  precedent, seeded with the exact live shape (nothing installed, one terminal
  failed task, `bytes_received: 0`, no total). The plan wins; the gap is closed
  rather than retro-justified.

- **DRIFT-2.4** — verdict: plan-wins — TESTS.md TEST-11 states the failed-install
  presentation is asserted "in BOTH the models card and the runtime-versions
  card" (ITEM-12's whole reason for existing). The spec only ever drove the
  models card, so the twin that carried the byte-identical defect was never
  exercised — the spec's own title said "(models + versions cards)". Closed in
  fix-round 2 with TEST-11b plus a `failVersionDownloadWith` mock hook mirroring
  `failModelDownloadWith`.

- **DRIFT-2.5** — verdict: impl-wins — **INV-3 is broader than PLAN's reading of
  it.** PLAN's *Patterns to follow* asserts temp-then-move + cleanup are "already
  correct in `voice/model.rs` … Preserve both; do not restructure." The phase-6
  `resource-lifecycle` angle found two exits where the property does NOT hold:
  (a) `finalize_download`'s cross-device copy fallback returns via `?` **before**
  removing the temp, and a copy that dies part-way leaves a *truncated*
  `ggml-<name>.bin` that `installed_model_path` (exists + non-empty) reports as
  an installed model; (b) nothing ever reclaims a `*.tmp` orphaned by a
  SIGKILL/OOM-kill, which is invisible (the library list is DB-backed) and
  permanent, at up to 5 GiB each. Both are exactly INV-3's "a failed acquisition
  must not leave a broken artifact behind", so fixing them is *inside* the
  invariant even though PLAN predicted no change here. Landed as
  `finalize_download` cleanup + `model::sweep_stale_temps` (called from
  `voice::VoiceModule::init`, 6h min-age guard), with TEST-14/TEST-15.
  **TESTS.md amended** with TEST-14/TEST-15.

- **DRIFT-2.6** — verdict: none — the D2 obligation was re-verified **by running**
  in the continuation session rather than inherited from DRIFT-1.9's claim.
  Reverting `has_whisper_magic` to the pre-fix `b"ggml"` comparison turned 3 unit
  tests RED and the integration test `bad_magic_fix_real_format_catalog_install_succeeds`
  RED with the shipped message verbatim; restoring returned 15/15 unit green.
  TEST-14 was given the same treatment against the pre-fix `finalize_download`
  body (RED: "the temp must not leak on a failed publish").

- **DRIFT-2.7** — verdict: resolved — BUG_ANALYSIS §4 claimed the post-stream
  rejection site emitted the same `bad magic` sentence. Verified against the
  pre-fix source: it emitted `"download produced no valid whisper model bytes"`.
  The substantive claim (empty body folded into the same rejection **and the same
  `VOICE_MODEL_INVALID` code**) holds. The sentence was corrected in place with
  the correction marked, rather than silently rewritten.

- **DRIFT-2.8** — verdict: none — accepted residuals, recorded so they are
  decisions rather than oversights: (a) the upload path still streams the whole
  (≤5 GiB, capped) body to its temp before the magic check, because aborting the
  request-body read early surfaces to a browser as a connection reset instead of
  the 400 + actionable message — worse UX for the case being improved; (b) a
  failed download that transferred nothing still renders a 0%-width error-toned
  progress bar with no text, which reads as a failure indicator, not as a byte
  count.

- **DRIFT-2.9** — verdict: impl-wins — **the branch's own corrective action was
  an ungated mutation.** ITEM-5/ITEM-12 replaced a passive `<Text>` with an
  interactive Retry, and neither PLAN nor DRIFT-1/2 noticed that the sibling
  Install button it re-issues is `<Can permission={VoiceAdminManage}>`-gated
  while the new control was not — reachable by any `voice::admin::read` holder,
  because the download-task list endpoints are read-gated and `loadActive()`
  seeds terminal tasks. Fix-round 3 saw the same fact ("rendered outside the
  `<Can>` wrapper") and recorded it as *no finding*, reading it only as a gallery
  convenience. **PLAN.md amended** with **INV-8** + **ITEM-13**; TESTS.md gains
  **TEST-16** (and the A9/A10 note now covers the new control's allow/deny legs).
  Landed as the `<Can>` wrapper inside `DownloadFailureRow` — one place, so both
  cards inherit it. FIX_ROUND-4 F4-1.

- **DRIFT-2.10** — verdict: plan-wins — ITEM-12's "the two cards cannot drift
  apart again" was not fully honoured: fix-round 1's INV-6 catalog-side guard
  (`size_bytes > 0`, DRIFT-2.2) went into `AvailableModelsCard` only, leaving
  `AvailableVersionsCard` able to print the identical naked "0 Bytes" for a
  release whose asset size is `Some(0)`. Closed in fix-round 4 with the same
  guard and a TEST-11b arm that seeds `size_bytes: 0`. FIX_ROUND-4 F4-2.

**Unresolved drifts:** 0
