# FIX_ROUND-4 — findings from the verification session's independent re-audit

This round was authored by a continuation session whose brief was explicitly
**"verify its claims — do not trust them"**: re-derive the root cause from
inspected state, prove the code compiles and the tests actually run, and treat
everything in `2ab8d9004` / `4597e1baf` / `99e327f69` plus the uncommitted
artifacts as unreviewed.

The verification results (all re-observed, none inherited) are in
`TEST_RESULTS.md`. This file records the **new** defects that verification
found. Three were confirmed and fixed; all three live in code this branch ADDED.

## Findings fixed

- **F4-1 [permission-gating] — the Retry control the branch introduced is
  ungated, while the Install button beside it is.**
  `AvailableModelRow` / `AvailableVersionRow` render the Install `Button` inside
  `<Can permission={VoiceAdminManage}>`, but render `DownloadFailureRow` —
  including its **Retry**, which calls the *same* `onDownload` — outside it.
  Reachability is not theoretical:
  - `list_active_model_downloads` (`model_handlers.rs:363`) and
    `runtime_version::list_active_downloads` (`handlers.rs:200`) are both gated
    on **`VoiceAdminRead`**, not manage;
  - the store's `loadActive()` self-gates on `VoiceAdminRead` and seeds **every**
    task into `activeByKey`, terminal ones included (it only skips
    *re-subscribing* them);
  so a user holding only `voice::admin::read` sees the failure row on page load
  — without clicking anything — with an enabled Retry that can only 403.
  Pre-fix there was no such control (the failure was a bare `<Text>`), so this is
  a regression the branch introduced.
  **Fix:** the Retry `Button` moves inside `<Can permission={VoiceAdminManage}>`
  in `DownloadFailureRow` itself — one place, so both cards inherit it and cannot
  drift. The failure MESSAGE stays ungated: a read-only admin is served the task
  under their own read permission and is entitled to know why it failed.
  **TEST-16** (e2e, `voice-model-permissions.spec.ts`), verified RED against the
  pre-fix component (see TEST_RESULTS § negative controls).

  *Why the existing permission spec did not catch it:* `voice-model-permissions.spec.ts`
  TEST-24 asserts "no manage controls" by **enumerating known test-ids**
  (`voice-model-upload-open-btn`, `voice-available-model-install-*`, …). A
  NEW manage control with a NEW test-id is invisible to an enumeration. That is
  the same shape as this branch's root defect — a passing test that certifies the
  surface as correct while the thing it should have caught is out of frame.

- **F4-2 [ui-presentation] — INV-6's catalog-side fix was applied to one card
  only.** Fix-round 1 added the `size_bytes > 0` guard to `AvailableModelsCard`
  (DRIFT-2.2) but left `AvailableVersionsCard:182` as
  `v.size_bytes != null && !v.installed` — so a release whose asset size is `0`
  renders the identical naked "0 Bytes" on the row above. `size_bytes` is
  `Option<u64>` (`runtime_version/models.rs:154`), so `Some(0)` is representable
  and `!= null` does not exclude it. ITEM-12 exists precisely so the twin cards
  cannot drift; honouring INV-6 on one of them is the drift.
  **Fix:** the same `> 0` guard on the versions card.
  **Coverage:** TEST-11b extended — the v1.1.0 fixture is seeded `size_bytes: 0`,
  so its existing "no bare 0 Bytes on the row" assertion now exercises the
  catalog side as well as the progress side. Verified RED without the guard.

- **F4-3 [cosmetic-assertion / A4] — TEST-11b's INV-6 assertion on the versions
  card was one the card can never fail.** The inherited spec asserted
  `expect(await row.innerText()).not.toMatch(/\b0 Bytes\b/)` — but
  `AvailableVersionsCard` has its **own local** `formatBytes`
  (`n < 1024 → "${n} B"`, i.e. `0 → "0 B"`), not the shared
  `@/utils/downloadUtils` one the models card uses (`0 → "0 Bytes"`). The string
  the assertion forbids is not in this card's vocabulary, so the check was inert:
  it certified INV-6 on the twin card without being able to detect a violation.
  **Found by running it**, not by reading: the F4-2 negative control removed the
  `size_bytes > 0` guard and TEST-11b still **passed**.
  **Fix:** assert the zero as this card actually renders it (`/\b0 B\b/`, keeping
  the `0 Bytes` check for the shared-formatter case), with the reason in a
  comment so the next author does not "simplify" it back. Re-verified: with the
  guard removed the spec now fails on *"the versions card renders a zero as
  \"0 B\""*; with it restored, green.
  *Not changed:* the duplicated formatter itself. Replacing the versions card's
  local `formatBytes` with the shared one would change every size string it
  renders (`"42.0 MB"` → `"42 MB"`) and ripple into sibling specs — a cleanup, not
  part of this defect (rule B3). Recorded here as the underlying drift.

## Findings examined and NOT changed

- **`InstalledModelsCard:241` renders `formatBytes(model.size_bytes)` with no
  `> 0` guard.** Left as-is deliberately: for an INSTALLED model the number is
  the recorded on-disk size, and both acquisition paths now reject a 0-byte
  artifact before a row can exist (`ModelRejection::Empty` on download and on
  upload), so a `0` there would be a genuine data anomaly worth showing rather
  than a meaningless zero to suppress. Recorded so it is a decision.
- **`UploadModelDrawer:166` renders `0 Bytes` for a 0-byte file the user
  picked.** Correct and useful there — it tells the user the file they selected
  is empty, before they upload it.
- **The e2e failure-path specs drive `page.route()` mocks rather than the real
  backend.** Inherited from the pre-existing `14-voice` harness
  (`routeVoice`/`voice-helpers.ts`), which every spec in the directory is built
  on; changing it is a harness rewrite, not a fix for this defect (rule B3). The
  REAL rejection path is covered without mocks at the integration tier by
  TEST-3/TEST-4/TEST-7, which drive the actual download/upload code against a
  mock HTTP *origin* — the external boundary — not a mocked ziee API.

**New confirmed findings:** 3
