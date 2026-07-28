# PLAN — voice-model-bad-magic

## Design source

Realizes `.lifecycle/voice-model-bad-magic/BUG_ANALYSIS.md` §2 (root cause: the
whisper ggml magic constant is byte-order-wrong), §3 (the incoherent render), §4
(unactionable messages), §5 (blast radius), and its `## Design decisions` D-1..D-5.
That document is the research/design pass for this defect: no prior design doc
exists for the `voice-model-mgmt` feature on this base (its `.lifecycle/` was
stripped at merge), so it was written first, from observed evidence (E1–E4), and
is named here as the upstream design.

Secondary governing sources, both already binding on this repo:
- `agent-kit/docs/CODING_GUIDELINES.md` §5 (resource lifecycle / cleanup on every
  failure exit) and §6 (error handling — preserve context, never collapse to a
  bare status).
- `agent-kit/docs/CODING_GUIDELINES.md` §13 (always render `store.error`; always
  show success/error feedback after a mutation).

## Invariants

Lifted verbatim from the owner's statement of the defect and from BUG_ANALYSIS
§ "Design decisions".

- **INV-1**: A model that is not installed must not display a file-validation error.
- **INV-2**: The UI must never show "no models installed" next to a per-model file error.
- **INV-3**: Fix the CAUSE, not the display — if a failed download leaves a 0-byte file, fix the download path (temp-then-move / cleanup on every failure exit) AND clean up existing detritus.
- **INV-4**: The error must be actionable when it IS legitimate — state what was found, what was expected, and the corrective action.
- **INV-5**: A 0-byte or wrong-content upload should be rejected at ingest with a clear message, not stored and failed later.
- **INV-6**: "0 Bytes" next to a catalog size of 56.94 MB — make sure the right number appears in the right place.
- **INV-7**: The canonical valid-model bytes used by tests must be built from the documented `GGML_FILE_MAGIC` u32, so that a future byte-order regression turns them red. (BUG_ANALYSIS D-5.)

## Items

### The cause

- **ITEM-1**: Correct `has_whisper_magic` (`voice/model.rs:62`) to accept the real on-disk whisper ggml magic — the little-endian serialization of `GGML_FILE_MAGIC = 0x67676d6c`, i.e. bytes `6c 6d 67 67` — alongside `GGUF`. Introduce named constants (`GGML_FILE_MAGIC: u32`, and its LE/BE byte forms) rather than a bare literal, and document why both byte orders are accepted. Retains the `GGUF` arm unchanged (correct per spec).
- **ITEM-2**: Split the conflated rejection conditions in the download path (`voice/model.rs`) into distinct, named errors: empty response body (`downloaded == 0`), wrong magic, and truncated head (<4 bytes received). Each gets its own error code + message. Removes the `downloaded == 0 || !has_whisper_magic(&head)` conflation at `model.rs:452`.
- **ITEM-3**: Make every model-rejection message actionable per INV-4 — state what was found (the observed leading bytes, hex + printable), what was expected (`ggml`/`GGUF` container), and the corrective action (re-download, pick a different source, remove the file). One shared message builder so download + upload emit identical, consistent text.
- **ITEM-4**: Apply the same actionable rejection to the upload ingest path (`voice/model_handlers.rs:565`), including a distinct message for a 0-byte upload (today an empty upload reports "bad magic", which is false). Upload rejection must remain at ingest, before any row is written, with the existing `TempGuard` cleanup intact.

### The render

- **ITEM-5**: In `AvailableModelsCard.tsx`, render a failed install as an explicit, error-toned **"Install failed — <reason>"** line with a **Retry** action, instead of the current bare `<Text type="secondary">{progress.error}</Text>`. This is what makes INV-1/INV-2 hold structurally: a failure on a not-installed row can only ever read as a failed install attempt, never as a file error on an installed file.
- **ITEM-6**: Fix the byte-count display (INV-6): suppress the progress byte line entirely for a `failed` download that transferred nothing, and label the count when the total is unknown, so a naked "0 Bytes" can never sit under a row advertising a catalog size. Keep the catalog size where it belongs (the row's metadata line).
- **ITEM-12**: Apply the same failed-download presentation fix to the sibling `AvailableVersionsCard.tsx` (the runtime-binary card rendered directly above, on the SAME page), which carries the byte-identical defect at `:215` (`{failed && progress?.error && <Text type="secondary">{progress.error}</Text>}`) and the same unlabelled-zero progress line. INV-2 is a statement about the page, not about one card; leaving the twin unfixed knowingly ships the identical incoherence one card higher. Extract the shared failure-row presentation so the two cards cannot drift apart again.

### The test gap (equal weight to the fix — see TEST_GAP.md)

- **ITEM-7**: Replace the tautological fixtures. Build the tests' canonical valid-model bytes from the documented `GGML_FILE_MAGIC` u32 via a single shared helper (`ggml_magic_bytes()`), used by the unit tests, the mock-HF-mirror fixtures in `tests/voice/model_management_test.rs` (all 7 sites), and the upload fixtures — so the format, not the implementation, is the source of truth (INV-7).
- **ITEM-8**: Add a real-format regression test that pins the exact on-disk byte sequence a real whisper.cpp ggml file begins with, independent of `has_whisper_magic`'s own definition — the test that would have caught this before it shipped.
- **ITEM-9**: Add the missing CLASS of test at the API level: an invariant test asserting that a model which is not installed never reports a file-validation error, whatever the model and whatever the cause (not pinned to `base-q5_1`).
- **ITEM-10**: Add the missing e2e: the voice settings page with zero installed models shows no per-model validation error; and a failed install renders as a labelled install failure with a retry, not as a file error.
- **ITEM-11**: Write `TEST_GAP.md` — the written test-gap analysis (what existed, why it passed, what class was missing, where else the blind spot applies), and scan the sibling download paths (LLM engine, hub, sandbox rootfs, voice runtime binary) for the same fixture-derived-from-implementation pattern. Report the blast radius; fixing siblings is out of scope for this branch.

## Files to touch

- `src-app/server/src/modules/voice/model.rs` — ITEM-1, ITEM-2, ITEM-3, ITEM-7, ITEM-8 (in-source `#[cfg(test)]`)
- `src-app/server/src/modules/voice/model_handlers.rs` — ITEM-4
- `src-app/server/tests/voice/model_management_test.rs` — ITEM-7, ITEM-9
- `src-app/server/tests/voice/mod.rs` — ITEM-7 (shared staged-model fixture helper)
- `src-app/ui/src/modules/voice/components/AvailableModelsCard.tsx` — ITEM-5, ITEM-6
- `src-app/ui/src/modules/voice/components/AvailableVersionsCard.tsx` — ITEM-12
- `src-app/ui/src/modules/voice/components/DownloadFailureRow.tsx` (new) — ITEM-5, ITEM-6, ITEM-12 shared presentation
- `src-app/ui/src/modules/voice/gallery.tsx` — ITEM-5/ITEM-6 gallery states (failed-install cell)
- `src-app/ui/tests/e2e/14-voice/voice-model-mgmt.spec.ts` — ITEM-10
- `.lifecycle/voice-model-bad-magic/TEST_GAP.md` — ITEM-11

No migration. No backend type change is expected (the error strings are payload
values, not schema); if any `#[derive(JsonSchema)]` shape changes, `just
openapi-regen` for BOTH binaries is required — tracked in PLAN_AUDIT.

## Patterns to follow

- **Magic/format constants** — mirror `llm_local_runtime/engine/metadata.rs:444`
  (`if magic != b"GGUF"`): a named constant compared against a fixed-width slice
  read from the file head, with the format documented in a doc-comment.
- **Error construction** — mirror the existing `AppError::bad_request(CODE, msg)`
  usage already in `voice/model.rs` (`VOICE_MODEL_TOO_LARGE`,
  `VOICE_MODEL_SHA_MISMATCH`): a screaming-snake code plus a human sentence that
  preserves context (§6).
- **Temp-then-move + cleanup** — already correct in `voice/model.rs`
  (`tmp` + `finalize_download`, `remove_file` on every error exit) and
  `model_handlers.rs`'s `TempGuard`. Preserve both; do not restructure.
- **Failed-state UI row** — mirror the sibling `AvailableVersionsCard.tsx`, which
  is the runtime-binary twin of this card, for how a failed download is presented
  and retried. `AvailableModelsCard`'s own doc-comment already declares it
  "Mirrors the sibling AvailableVersionsCard".
- **Error tone + retry affordance** — use the kit's existing `ErrorState` /
  `Text type` + `Button` idiom already used elsewhere in this same file
  (`voice-available-models-error`).
- **Mock HF mirror fixtures** — keep the existing `FileFixture` / `default_fixtures`
  structure in `tests/voice/model_management_test.rs`; change only how the valid
  bytes are produced (ITEM-7), not the harness shape (rule B3: do not restructure
  shared test infrastructure to route around a defect).

## UI-surface checklist

Only one existing surface changes (`AvailableModelsCard`, on `/settings/voice`);
no new page/drawer/panel is added.

- **Precedent** — `AvailableVersionsCard.tsx`, the runtime-binary twin rendered
  in the same page directly above this card. Failure presentation and the retry
  affordance mirror it.
- **Scale / cardinality** — unchanged: the catalog list already pages at
  `PAGE_SIZE = 10` via `ListPagination`, the settings-page idiom. This change
  adds no unbounded collection.
- **Device size / responsive** — the row is a `Flex … wrap` with a `Space wrap`
  metadata line; the added failure line is a full-width block beneath it, so it
  stacks rather than competing for the row's horizontal space at ~390px. Verified
  in the gallery's narrow-viewport state at Phase 8.
- **Populated-render review** — the gallery gains a *failed install* cell (a
  populated catalog with one row in the failed state) so the design-critic pass
  reviews the real failure layout, not an empty card.
- **User-visible progress** — the existing SSE-driven progress bar is retained;
  this change only corrects what is shown when that progress terminates in
  failure (labelled reason + retry) and suppresses a meaningless zero.
- **Input economy** — unchanged; no new input.
- **JTBD** — the user's job on this card is *"get a working speech model
  installed"*. Today every attempt fails with a message that neither explains nor
  suggests anything, and the failure is styled as if it were row metadata. After
  this change: attempts succeed (ITEM-1); when one legitimately fails the user is
  told what was found, what was expected, and what to do, and can retry in place
  without re-navigating (ITEM-3, ITEM-5).
- **Multi-instance / URL-as-view-into-focus** — not applicable; a settings card.
- **Platform-provided affordances** — not applicable.
