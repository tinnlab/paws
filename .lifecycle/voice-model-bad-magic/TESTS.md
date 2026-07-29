# TESTS — voice-model-bad-magic

Every ITEM is covered; every `INV-N` is pinned by ≥1 `[acceptance]` test that
asserts the design's promise (not the implementation's behaviour).

**A9/A10 do not apply to this branch**: it introduces no permission (no
`X::use`/`X::read`/`X::manage` in a `modules/*/permissions.rs`, no migration
grant). The existing `VoiceAdminRead` / `VoiceAdminManage` are reused unchanged,
and their allow/deny coverage already exists in
`tests/voice/permissions_test.rs`.

The diff touches `src-app/ui/**`, so `tier: e2e` tests are mandatory — TEST-11,
TEST-11b, TEST-12 and TEST-16 satisfy the frontend gate.

**A9/A10 amendment (fix-round 4):** the branch still introduces no *permission*,
but it does introduce a new permission-GATED control (the Retry). Its allow leg
is TEST-11/TEST-11b (an admin sees and uses it) and its deny leg is TEST-16 (a
read-only voice admin does not get it) — the same allow/deny pairing A10 asks of
a new permission, applied to the new control.

## Ranked by "would this have caught the shipped bug?"

| Rank | Test | Would have caught it | Why |
|---|---|---|---|
| 1 | **TEST-8** | **YES** | Pins the real on-disk magic bytes as a literal taken from a real file. Red the instant the implementation's byte order is wrong, regardless of any other fixture. |
| 2 | **TEST-1** | **YES** | Exercises `has_whisper_magic` against real-format bytes rather than a code-derived fixture. |
| 3 | **TEST-4** | **YES** | Drives the full download path against a mirror serving real-format bytes — the integration analogue of the shipped failure. |
| 4 | **TEST-9** | **YES (as a class)** | Asserts the page-level invariant over the whole catalog; would have failed on any model, not just `base-q5_1`. |
| 5 | **TEST-12** | **YES (as a class)** | The rendered-page assertion; the only test that sees what the owner saw. |
| 6 | TEST-7 | YES (upload arm) | A real-format upload is rejected today; this catches that arm. |
| 7 | TEST-2, TEST-3, TEST-5, TEST-6, TEST-10, TEST-11 | No | These cover the message quality, the 0-byte distinction, and the presentation — real requirements (INV-4/5/6), but they do not detect the byte-order cause. Listed honestly as *not* gap-closing for the root cause. |

## Tests

### The cause

- **TEST-1** (tier: unit) [covers: ITEM-1] file: `src-app/server/src/modules/voice/model.rs` — asserts: `has_whisper_magic` accepts the little-endian `GGML_FILE_MAGIC` byte sequence (a real whisper ggml file head), accepts `GGUF`, accepts the big-endian `ggml` ordering, and rejects HTML, a zip header, a 3-byte truncated head, and empty input.
- **TEST-8** (tier: unit) [acceptance] [invariant: INV-7] [covers: ITEM-8, ITEM-1] file: `src-app/server/src/modules/voice/model.rs` — asserts: the exact 4-byte prefix of a real whisper.cpp ggml model, written as the literal `[0x6c, 0x6d, 0x67, 0x67]` transcribed from an actual `ggerganov/whisper.cpp` file (BUG_ANALYSIS E3) and independently as `GGML_FILE_MAGIC.to_le_bytes()`, is accepted — a value derived from the FORMAT, never from `has_whisper_magic`'s own definition, so a byte-order regression turns it red even if every other fixture were rewritten to match the regression.
- **TEST-2** (tier: unit) [covers: ITEM-2] file: `src-app/server/src/modules/voice/model.rs` — asserts: the three download rejection conditions map to three distinct error codes/messages — an empty response body, a wrong-magic body, and a head shorter than 4 bytes are each named for what they are, and an empty body is NOT reported as a magic failure.
- **TEST-5** (tier: unit) [acceptance] [invariant: INV-4] [covers: ITEM-3] file: `src-app/server/src/modules/voice/model.rs` — asserts: for each distinct rejection condition the message contains all three of (a) what was found — the observed leading bytes rendered hex + printable, (b) what was expected — a `ggml`/`GGUF` container, and (c) a corrective action; the assertion fails if a message regresses to a bare "bad magic" with no found/expected/action content.
- **TEST-6** (tier: unit) [acceptance] [invariant: INV-6] [covers: ITEM-6] file: `src-app/ui/src/modules/voice/stores/downloadProgress.helpers.test.ts` — asserts: the progress-line presentation helper returns no byte text for a failed download that transferred 0 bytes (so a naked "0 Bytes" can never render), returns a labelled count for a partial download with an unknown total, and returns the `received / total` form for a complete download — 0 / partial / complete.

### The download + upload paths (integration)

- **TEST-4** (tier: integration) [covers: ITEM-1, ITEM-2, ITEM-7] file: `src-app/server/tests/voice/model_management_test.rs` — asserts: a catalog install driven end-to-end against the mock HF mirror serving **real-format** ggml bytes completes, writes the file to `voice-models/`, and creates a `voice_models` row — the path that fails in production today.
- **TEST-3** (tier: integration) [acceptance] [invariant: INV-3] [covers: ITEM-2, ITEM-3] file: `src-app/server/tests/voice/model_management_test.rs` — asserts: a mirror serving an EMPTY 200 body fails the download with the empty-body error (not the magic error), leaves no file and no `.tmp` in `voice-models/`, and creates no row; a mirror serving HTML fails with the magic error and likewise leaves nothing behind.
- **TEST-7** (tier: integration) [acceptance] [invariant: INV-5] [covers: ITEM-4] file: `src-app/server/tests/voice/model_management_test.rs` — asserts: a 0-byte upload and a wrong-content (HTML) upload are each rejected at ingest with their own clear message — no `voice_models` row is created, no file lands in `voice-models/`, and no `.upload-*.tmp` is left — while a real-format upload succeeds; i.e. rejection happens at ingest, never "stored and failed later".
- **TEST-9** (tier: integration) [acceptance] [invariant: INV-1] [covers: ITEM-9] file: `src-app/server/tests/voice/model_management_test.rs` — asserts: over the WHOLE catalog listing (every entry, not a named model), any model reported `installed: false` carries no file-validation error anywhere in its payload, and the installed set is consistent with what is actually on disk — the invariant test, unpinned from `base-q5_1` so a different model or a different cause cannot slip through.
- **TEST-10** (tier: integration) [covers: ITEM-7] file: `src-app/server/tests/voice/mod.rs` — asserts: the shared staged-model fixture used by the other voice suites writes bytes that begin with the real ggml magic, and the three suites that stage a model (`lifecycle_test`, `transcribe_test`, `streaming_real_test`) still resolve and activate it.

### Cleanup on every failure exit (added in fix-round 2 — see DRIFT-2.5)

- **TEST-14** (tier: unit) [acceptance] [invariant: INV-3] [covers: ITEM-2] file: `src-app/server/src/modules/voice/model.rs` — asserts: a failed publish leaves neither a partial destination nor a temp — `finalize_download` into an unreachable directory (the observable stand-in for an ENOSPC/EIO copy) returns a context-preserving error, removes the temp, and leaves no `ggml-<name>.bin` that `installed_model_path`'s exists + non-empty check would report as an installed model; the success path still moves the file and clears the temp. Verified RED against the pre-fix body.
- **TEST-15** (tier: unit) [acceptance] [invariant: INV-3] [covers: ITEM-2] file: `src-app/server/src/modules/voice/model.rs` — asserts: `sweep_stale_temps` reclaims BOTH orphan shapes (the download path's `<filename>.<uuid>.tmp` and the upload path's `.upload-<uuid>.tmp`) once past the age guard, leaves a temp younger than the guard alone (a transfer may be in flight in another process), NEVER removes an installed `ggml-<name>.bin`, and treats a missing directory as a no-op.

### The rendered page (e2e)

- **TEST-11** (tier: e2e) [covers: ITEM-5] file: `src-app/ui/tests/e2e/14-voice/voice-model-mgmt.spec.ts` — asserts: when a MODEL install fails, the row renders an explicit labelled "Install failed" message carrying the server's found/expected/action reason, `role="alert"`, and an enabled Retry that provably RE-ISSUES the install (asserted on the POST count, not on the row still being on screen) — never a bare unlabelled secondary line. The runtime-versions arm is TEST-11b; this line previously claimed both cards while exercising only this one (DRIFT-2.4).
- **TEST-11b** (tier: e2e) [acceptance] [invariant: INV-2] [covers: ITEM-12] file: `src-app/ui/tests/e2e/14-voice/voice-model-mgmt.spec.ts` — asserts: the runtime-VERSIONS card on the same page presents a failed install identically — a labelled "Install failed" line carrying the server's reason, `role="alert"`, an enabled Retry, and no bare "0 Bytes" on the row. TEST-11 claimed this arm but only ever drove the models card (DRIFT-2.4); this is the assertion that makes ITEM-12 real rather than asserted.
- **TEST-12** (tier: e2e) [acceptance] [invariant: INV-1, INV-2] [covers: ITEM-10, ITEM-5, ITEM-6, ITEM-12] file: `src-app/ui/tests/e2e/14-voice/voice-model-mgmt.spec.ts` — asserts: on `/settings/voice` with ZERO installed models, the page shows the "no models installed" empty state AND no per-model file-validation error is present anywhere on it — specifically no "bad magic" text and no naked "0 Bytes" under any catalog row whose metadata advertises a non-zero size. This is the assertion that would have failed on the owner's screenshot.

### The new control's own permission gate (added in fix-round 4 — see DRIFT-2.9)

- **TEST-16** (tier: e2e) [acceptance] [invariant: INV-8] [covers: ITEM-13] file: `src-app/ui/tests/e2e/14-voice/voice-model-permissions.spec.ts` — asserts: a user holding ONLY `voice::admin::read`, on a page whose download-task registry already holds a terminal FAILED task (the shape `loadActive()` really seeds for them, since the list endpoint is read-gated), sees the labelled failure line and its reason — and does NOT get the Retry control, exactly as they do not get the Install button. Runs under the `no-403` fixture, so rendering the failure row must also drive no unexpected 403. Written against the failure row specifically because the pre-existing TEST-24 enumerates manage controls by test-id and therefore cannot see a newly-added one.

### The test-gap analysis

- **TEST-13** (tier: unit) [covers: ITEM-11] file: `src-app/server/src/modules/voice/model.rs` — asserts: `TEST_GAP.md` exists and the blast-radius scan it records is reproducible — the scan is a grep over the sibling download paths (LLM engine, hub seed, sandbox rootfs, voice runtime binary) for fixtures whose "valid" bytes are constructed from the implementation's own constant; this test pins the one product-code invariant that came out of it, namely that the canonical magic bytes are produced by a single named constant with no second hand-written copy anywhere in `src-app/server/src`.

## Coverage map

| ITEM | Covered by |
|---|---|
| ITEM-1 | TEST-1, TEST-8, TEST-4 |
| ITEM-2 | TEST-2, TEST-3, TEST-4, TEST-14, TEST-15 |
| ITEM-3 | TEST-5, TEST-3 |
| ITEM-4 | TEST-7 |
| ITEM-5 | TEST-11, TEST-12 |
| ITEM-6 | TEST-6, TEST-12 |
| ITEM-7 | TEST-4, TEST-10 |
| ITEM-8 | TEST-8 |
| ITEM-9 | TEST-9 |
| ITEM-10 | TEST-12 |
| ITEM-11 | TEST-13 |
| ITEM-12 | TEST-11, TEST-11b, TEST-12 |
| ITEM-13 | TEST-16, TEST-11b (the versions-card 0-size arm) |

| INV | Pinned by (`[acceptance]`) |
|---|---|
| INV-1 | TEST-9, TEST-12 |
| INV-2 | TEST-12, TEST-11b |
| INV-3 | TEST-3 (no artifact left on any failure exit) + TEST-7 (upload arm) + TEST-14 (the publish exit) + TEST-15 (orphan reclamation) — see note |
| INV-4 | TEST-5 |
| INV-5 | TEST-7 |
| INV-6 | TEST-6 |
| INV-7 | TEST-8 |
| INV-8 | TEST-16 |

**INV-3 note.** INV-3's imperative half ("fix the CAUSE, not the display") is
structural and is pinned by TEST-8/TEST-1/TEST-4 — the cause tests. Its
conditional half ("if a failed download leaves a 0-byte file … clean it up") has
a verified-false antecedent (BUG_ANALYSIS E1/E2), so the acceptance obligation is
to prove the no-artifact property *holds*, which TEST-3 asserts directly on every
failure exit. TEST-3 is therefore tagged `[acceptance] [invariant: INV-3]` in the
spec.
