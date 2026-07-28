# FIX_ROUND-5 — convergence re-audit of the round-4 diff

Round 4 changed product code (`DownloadFailureRow.tsx`, `AvailableVersionsCard.tsx`),
two e2e specs, and the regenerated state-matrix artifacts, so its own diff
(commit `31a0189cc`) was re-audited before the loop was declared converged. Same
angle set as phase 6; the review targeted only what round 4 introduced.

## What was re-examined, and the verdict

- **`<Can>`'s render shape when the permission is DENIED.** The risk was that
  wrapping the Retry changes the failure row's layout for a read-only admin (the
  row is `Flex justify="between"`, so an empty wrapper element would push the
  message). `@ziee/framework/permissions`' `Can` is
  `<>{allowed ? children : fallback}</>` with `fallback = null` — it contributes
  **no DOM node** when denied, so the row simply has one child. **No finding.**

- **Whether gating the Retry hides the design-critic surface.** The gallery seeds
  `useAuthStore` with `adminUser` (`is_admin: true`) unless a surface opts into
  `auth: 'limited'` (`dev/gallery/galleryConfig.ts:83-88`), and `hasPermissionNow`
  short-circuits on `is_admin` — so `seeded-available-models-failed-install` still
  renders the Retry for the vision review. Runtime-verified: the `gate:ui`
  runtime-health pass drives every gallery surface and reported 177/177 clean.
  **No finding.**

- **Hardcoding `Permissions.VoiceAdminManage` inside a shared component.**
  `DownloadFailureRow` lives in `modules/voice/components/` and has exactly two
  consumers, both voice cards whose Install buttons carry the same permission, so
  the constant is correctly scoped rather than a hidden coupling. A future
  non-voice consumer would need the permission lifted to a prop — recorded as a
  note, not a defect, because no such consumer exists (and inventing the prop now
  would be unused generality, §15). **No finding.**

- **The `size_bytes > 0` guard's other arms.** For an installed version the size
  was already suppressed (`!v.installed`), and `Some(n>0)` is unchanged; only
  `Some(0)` changes behaviour, which is the whole intent. `None` was and remains
  suppressed by the `!= null` arm. **No finding.**

- **A4 (assertions that cannot fail) over the round-4 added lines.** Every added
  assertion was proven to distinguish the fixed from the unfixed code by RUNNING
  it: TEST-16 red without the `<Can>`; TEST-11b's `0 B` assertion red without the
  size guard. The one assertion that could NOT have failed was found and fixed in
  the same round (F4-3) — the reason this angle was run against the code rather
  than read. **No finding.**

- **TEST-16's mock fidelity.** The spec seeds `state.modelDownloads` with a
  terminal `failed` snapshot rather than clicking Install (which a read-only user
  has no button for). That matches the real path: `loadActive()` fetches
  `GET /voice/models/downloads` — gated `VoiceAdminRead` — and seeds every task,
  skipping only the SSE re-subscribe for terminal ones, so no 403 is provoked.
  The spec runs under the `no-403` fixture, which would have caught it otherwise.
  **No finding.**

- **Regenerated artifacts.** `STATE_MATRIX.md` + `stateMatrix.generated.ts` carry
  only line-number shifts plus the widened `v.size_bytes … > 0` condition string;
  no new required-state key was introduced, so no gallery entry or allow-list
  change is owed. `npm run check` (21 sub-checks incl. `check:state-matrix`,
  `check:gallery-coverage`, `check:gallery-seed-registry`) re-run on the committed
  tree: **EXIT=0**. **No finding.**

- **Rust side untouched.** Round 4 changed no `.rs` file
  (`git show 31a0189cc --stat` lists none), so the backend tiers needed no re-run
  beyond the ones already recorded. **No finding.**

## Negative controls actually run this round

Both were run in round 4 itself and are recorded in `TEST_RESULTS.md`; neither is
inherited:

- **TEST-16** — `<Can>` removed from `DownloadFailureRow`: RED (the read-only user
  gets the Retry). Restored: green.
- **TEST-11b** — `size_bytes > 0` removed from `AvailableVersionsCard`: RED with
  *"the versions card renders a zero as \"0 B\""*. Restored: green, and the full
  two-file e2e run is **10 passed / 0 failed**.

**New confirmed findings:** 0
