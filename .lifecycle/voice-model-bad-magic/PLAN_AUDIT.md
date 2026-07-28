# PLAN_AUDIT — voice-model-bad-magic

Audited against the codebase at `d53db2d11` (`origin/feat/agent-core`).

## Breakage risk

**ITEM-1 widens an accept-set — it cannot reject anything it previously
accepted.** `has_whisper_magic` today accepts `{ "ggml", "GGUF" }`; after the fix
it accepts `{ lmgg (LE 0x67676d6c), "ggml" (BE), "GGUF" }`. Every input that
passed before still passes. The only behavioural change is that inputs which
*should* have passed now do. No caller can regress.

Three call sites, all verified by grep:
- `model.rs:417` — download, first-chunk head check
- `model.rs:452` — download, post-stream re-check
- `model_handlers.rs:565` — upload ingest

No fourth caller; nothing on the list/read path (this is also the proof that
hypothesis 2 in BUG_ANALYSIS is false).

**Risk actually worth naming — the accept-set is now wide enough to admit a
4-byte prefix that is not a whisper model.** `lmgg` is a weaker discriminator
than a full header parse. This is unchanged in kind from the status quo (a 4-byte
magic was always the check) and the real integrity guarantee remains the
sha256 verification against the catalog's LFS oid (`model.rs:461`, fail-closed).
Recorded, not expanded: promoting this to a full ggml header parse is a
separate change and is NOT in scope.

**ITEM-2/ITEM-3 change error *strings and codes*, not control flow.** The
existing `VOICE_MODEL_INVALID` code is referenced by
`tests/voice/model_management_test.rs` assertions; splitting it into
`VOICE_MODEL_INVALID` (wrong magic) + a new empty-body code means those
assertions must be updated in the same commit. Caught here so it is not a
surprise at Phase 8.

**ITEM-7 touches `tests/voice/mod.rs`, shared by other voice suites**
(`lifecycle_test`, `streaming_real_test`, `transcribe_test` all stage a model via
that helper). Per BASE.md this is the one genuine cross-suite surface. The staged
bytes today are `b"stub ggml model bytes"` — which never passes through
`has_whisper_magic` at all (staging writes the file directly; presence is a
non-empty filesystem check at `model.rs:105`). So changing them to real-magic
bytes is safe *and* strictly more faithful. Those suites are re-run at Phase 8.
Rule **B3** respected: the harness *shape* is untouched; only the fixture bytes
change, and the change makes the harness more realistic rather than routing
around a defect.

**ITEM-12 expands the diff to a second component.** Justified in the item text
(same page, byte-identical defect). The extraction of a shared
`DownloadFailureRow` is a two-call-site refactor, not a new abstraction layer —
consistent with §9's "duplicated logic that should be one function".

## Pattern conformance

| Item | Reference mirrored | Verdict |
|---|---|---|
| ITEM-1 | `llm_local_runtime/engine/metadata.rs:444` — named magic constant vs a fixed-width head slice | conforms |
| ITEM-2/3/4 | `voice/model.rs`'s existing `AppError::bad_request(SCREAMING_CODE, sentence)` (`VOICE_MODEL_TOO_LARGE`, `VOICE_MODEL_SHA_MISMATCH`) | conforms |
| ITEM-4 | `model_handlers.rs`'s existing `TempGuard` — preserved, not restructured | conforms |
| ITEM-5/6/12 | `AvailableVersionsCard.tsx`, which `AvailableModelsCard`'s own doc-comment names as its sibling | conforms |
| ITEM-7 | `tests/voice/model_management_test.rs`'s `FileFixture` / `default_fixtures` shape retained | conforms |

Kit-component note: the failure row must use kit primitives (`Text`, `Button`,
`Flex`) and semantic tone tokens only — no raw hue, no arbitrary color value
(`lint:colors` is in `npm run check`). An `ErrorState` is the wrong primitive
here: it is a whole-section empty/error replacement (as used at
`voice-available-models-error`), not a per-row inline message. Per-row inline
error text with `Button variant="link"`-style retry is the correct weight.

## Migration collisions

**None.** Per BASE.md this branch adds no migration. Migrations on this base are
per-module (`src-app/server/src/modules/*/migrations/`); the voice module's tail
is `202607146085_voice_grant_permissions.sql` and is untouched. No new
permission, so **A9/A10 do not apply** to this branch (no new
`X::use`/`X::read`/`X::manage`, no migration grant) — the existing
`VoiceAdminRead` / `VoiceAdminManage` perms are reused unchanged.

## OpenAPI regen

**Expected: not required.** The changes are error *values* carried by existing
fields (`SSEModelDownloadFailedData.error: String`, the `AppError` JSON body) —
no new `#[derive(JsonSchema)]` type, no new/renamed field, no new route, no enum
variant. `ModelDownloadStatus` is unchanged (the `Failed` variant already
exists).

Verification obligation at Phase 5: after implementation, run `just
openapi-regen` and confirm it produces **no diff**. If it does produce one, both
binaries must be regenerated and `openapi::emit_ts::tests::types_ts_parity` must
be green before Phase 8. Recorded as a drift entry either way.

## Per-item verdicts

- **ITEM-1** — verdict: PASS — pure widening of an accept-set; 3 call sites, all verified; mirrors `metadata.rs`'s named-constant idiom; no migration, no schema change.
- **ITEM-2** — verdict: CONCERN — splitting `VOICE_MODEL_INVALID` into distinct codes requires updating the existing assertions in `tests/voice/model_management_test.rs` in the same commit. Not blocking; tracked as a Phase-5 obligation.
- **ITEM-3** — verdict: PASS — message-only change following the established `AppError::bad_request` idiom; a shared builder keeps download + upload text identical (§9 dedup).
- **ITEM-4** — verdict: PASS — same builder applied at `model_handlers.rs:565`; the `TempGuard` cleanup contract is preserved, so INV-5's "rejected at ingest, not stored and failed later" already holds structurally and stays holding.
- **ITEM-5** — verdict: PASS — replaces a bare secondary `Text` with a labelled, error-toned row + retry; mirrors the sibling card; uses kit primitives only.
- **ITEM-6** — verdict: PASS — suppressing a meaningless zero and labelling an unknown-total count; no data-model change. Confirmed the "0 Bytes" literal originates at `utils/downloadUtils.ts:12` (`if (bytes === 0) return '0 Bytes'`), which is correct in isolation and must NOT be changed — the defect is the caller rendering it unlabelled.
- **ITEM-7** — verdict: CONCERN — touches `tests/voice/mod.rs`, shared by three other voice suites. Mitigated: the staged bytes never flow through the magic check, the change is strictly more faithful, and all voice suites are re-run at Phase 8. Flagged so the Phase-8 run is scoped to `voice::` as a whole, not just the model tests.
- **ITEM-8** — verdict: PASS — an in-source `#[cfg(test)]` pinning the real on-disk byte sequence independently of `has_whisper_magic`'s own definition. This is the D2-compliant test: it is written against the *format*, so it fails if the implementation's byte order is wrong.
- **ITEM-9** — verdict: PASS — an API-level invariant test; the class of test that was missing. Asserts over the whole catalog rather than one named model, per the coordinator's "not pinned to this exact reproduction" requirement.
- **ITEM-10** — verdict: PASS — e2e in the existing `14-voice/voice-model-mgmt.spec.ts`; the diff touches `src-app/ui/**` so a `tier: e2e` test is mandatory (Phase-3 frontend gate) and this satisfies it.
- **ITEM-11** — verdict: PASS — documentation + a read-only scan; no product code. The scan's findings are reported, not fixed, which is the coordinator's explicit instruction.
- **ITEM-12** — verdict: CONCERN — scope expansion beyond the literally-reported card. Justified: identical defect, same page, same render; INV-2 is stated about the page. The shared-component extraction keeps it a net simplification. Flagged as a deliberate, recorded expansion rather than silent scope creep.

No `BLOCKED` verdicts.
