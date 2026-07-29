# TEST_GAP — why the test suite did not catch the "bad magic" defect

A bug that reached a live screenshot passed every test we have. This is the
analysis of that blind spot. It is the more valuable finding than the fix,
because the same blind spot is silently protecting other bugs right now.

---

## 1. What tests existed over this path

Coverage was **not** absent. The voice-model surface was, on paper, one of the
better-tested areas in the module — which is exactly what makes this instructive.

| Layer | File | What it covered |
|---|---|---|
| unit | `src/modules/voice/model.rs` `#[cfg(test)]` — `whisper_magic_accepts_ggml_and_gguf_rejects_junk` | `has_whisper_magic` accepts/rejects |
| unit | same module — pin table, URL building, hex, SSRF policy | 8 further tests |
| unit | `src/modules/voice/model_download_task.rs` `#[cfg(test)]` | cancel semantics |
| integration | `tests/voice/model_management_test.rs` (~1,300 lines, TEST-6…TEST-33) | catalog download + list + dedup, unverified-URL download, **bad-magic rejection**, SSRF rejection, upload success + rejection, activate, delete, cancel, sync emits, permission gating, offline catalog |
| integration | `tests/voice/model_test.rs` | model status + download admin surface |
| integration | `tests/voice/lifecycle_test.rs`, `transcribe_test.rs`, `streaming_*_test.rs` | staged model → runtime → transcription |
| integration | `tests/voice/real_repo_test.rs` | a REAL, un-mocked download against the actual `ziee-ai/whisper.cpp` GitHub release |
| e2e | `ui/tests/e2e/14-voice/voice-model-mgmt.spec.ts` (TEST-17…TEST-20) | catalog pagination, Install → progress → complete, upload drawer, 390px |
| e2e | `14-voice/{voice-settings-admin,admin-empty-state,visual-states}.spec.ts` | the settings page's other states |

There was even a test literally named for this failure mode
(`ggml-badmagic.bin` → "the download's magic check rejects it"). It passed. It
was asserting the *rejection* worked; nothing asserted the *acceptance* worked
against a real file.

## 2. Why they passed — the specific mechanism

The coordinator asked which culprit applies rather than a list. The answer is
**one** of the listed candidates, in its purest form:

> **The fixtures were derived from the implementation's assumption instead of
> from the real data format, at EVERY tier simultaneously.**

Concretely — `tests/voice/model_management_test.rs:100-106` (pre-fix):

```rust
// A valid ggml body: the 4-byte magic + deterministic filler ...
let ggml = |tag: &str, fill: usize| {
    let mut v = Vec::with_capacity(4 + fill);
    v.extend_from_slice(b"ggml");        // ← the implementation's wrong constant
```

and `src/modules/voice/model.rs:632` (pre-fix):

```rust
assert!(has_whisper_magic(b"ggml....."));   // ← the same wrong constant
```

The implementation checked for `b"ggml"`. The unit test asserted `b"ggml"` is
accepted. The mock HuggingFace mirror **served** `b"ggml"`. The e2e mocked the
HTTP layer above even that. So at every tier the "valid model" was defined as
*whatever the implementation accepts* — and a real whisper.cpp file, which
begins `6c 6d 67 67` (`lmgg`, the little-endian `u32` serialization of
`GGML_FILE_MAGIC`), never appeared anywhere in the test suite.

This is lifecycle rule **D2** ("a test must assert the DESIGN's promise, not the
code's behaviour") failing in the field: *flipping the invariant off would not
have turned any test red, because the fixtures flip with it.* The tests were
tautological. They proved `has_whisper_magic` is self-consistent, which is not a
property anyone needed.

### Ruling out the other candidates, explicitly

- **"It mocked the exact boundary where the bug lives."** Close, but not the
  root: mocking HTTP was reasonable and necessary. The defect is that the mock's
  *payload* was wrong, not that a mock existed. A faithful mock would have caught
  it — which is why the fix is a faithful fixture, not "stop mocking".
- **"Happy path only; the bug is a failure state."** Inverted here. The happy
  path WAS tested — but with a fake definition of "happy". The failure paths
  (bad magic, SSRF, cap) were the well-covered ones.
- **"Layers tested in isolation; the bug is in the interaction."** No. The bug is
  inside a single 1-line function. `installed` (DB rows) and file presence
  (filesystem non-empty check, `model.rs:105`) genuinely are two sources of
  truth, and that is a latent wart — but both correctly reported "nothing
  installed" here, so it is not the cause.
- **"Tests always set up clean state, so leftover detritus is unreachable."** Not
  applicable — there is no detritus (BUG_ANALYSIS E1/E2). The temp-then-move +
  cleanup path is correct.
- **"Asserted on a status code / `isError` flag rather than what the user sees."**
  This one is a genuine SECONDARY finding. No test ever asserted the composed
  page. `admin-empty-state.spec.ts` checks the empty state; `voice-model-mgmt`
  checks a successful install. Nothing asserted "empty state AND no per-model
  error, simultaneously" — the contradiction the owner spotted in one glance.

### Why `real_repo_test.rs` did not save us

The suite *does* contain an un-mocked, real-network test — and it still missed
this, which is worth understanding. `real_repo_test.rs` downloads the **whisper
runtime BINARY** from `ziee-ai/whisper.cpp` GitHub Releases. It never downloads a
**MODEL** from HuggingFace. The one place the suite touched reality, it touched
the wrong artifact. There was no real-network test of the model path at all.

### Why the transcription tests did not save us

`lifecycle_test` / `transcribe_test` / `streaming_*` all obtain their model via
`tests/voice/mod.rs::stage_model`, which writes bytes **directly to disk**,
bypassing `has_whisper_magic` entirely (presence is a non-empty filesystem check).
Pre-fix those bytes were `b"stub ggml model bytes"` — not a model at all, and
never validated. So the end-to-end transcription tests were green while the only
supported way for a real user to obtain a model was 100% broken. **The
air-gap/pre-stage path is the one acquisition route that works in production
today, and it is the only one the tests exercised.**

## 3. The CLASS of test that was missing, and what was added

The missing class is: **a test whose fixture is derived from the DATA FORMAT
rather than from our code** — an external-reality anchor. Plus its UI analogue:
**a test that asserts the composed page, not one component's props.**

Added (ranked by whether each would have caught THIS bug — the coordinator's
ranking requirement; the full ranked table is in TESTS.md):

| Test | Tier | Would have caught it | What makes it gap-closing |
|---|---|---|---|
| **TEST-8** `accepts_the_real_on_disk_whisper_ggml_magic` | unit | **YES** | Pins `[0x6c,0x6d,0x67,0x67]` as a hand-transcribed literal from a real file, asserted independently of `has_whisper_magic`'s own definition. **Verified red/green**: restoring the original check made it fail with *"a REAL whisper.cpp ggml file (head [6c, 6d, 67, 67]) must be accepted"*. |
| **TEST-1** (rewritten) | unit | **YES** | Asserts the real LE ordering is accepted, not only the ASCII one. Verified red under the original check. |
| **TEST-4** `…real_format_catalog_install_succeeds` | integration | **YES** | Drives the full install against a mirror serving real-format bytes, and *asserts the fixture itself carries the real magic* — so the fixture can't silently regress. |
| **TEST-10** `shared_fixtures_use_the_real_on_disk_ggml_magic` | integration | **YES (prevents recurrence)** | Guards the shared fixture builder: asserts `GGML_MAGIC != b"ggml"`, so re-introducing the ASCII spelling fails immediately. |
| **TEST-9** `not_installed_models_never_report_a_file_validation_error` | integration | **YES (as a class)** | Asserts the invariant over the **whole catalog** — every not-installed entry, any cause. Deliberately NOT pinned to `base-q5_1`: a test asserting "base-q5_1 shows no bad magic" would let the next variant through. |
| **TEST-12** | e2e | **YES (as a class)** | The composed-page assertion: zero installed models AND no per-model validation error AND no bare "0 Bytes" on any row. This is the assertion that would have failed on the owner's screenshot. |
| TEST-7 | integration | YES (upload arm) | A real-format upload succeeds; 0-byte/HTML rejected at ingest. |
| TEST-2, TEST-3, TEST-5, TEST-6, TEST-11 | mixed | **No** | These close INV-4/5/6 (message quality, the empty-vs-magic conflation, the byte display). Real requirements, but honestly reported: they would **not** have detected the byte-order cause. |

Also changed, and arguably the single most important line: all **8** fixture
sites in `model_management_test.rs` plus `stage_model` now build their bytes
through one shared `ggml_bytes()` helper anchored on `GGML_MAGIC`, so there is no
second hand-written copy of the constant anywhere in the test tree.

## 4. Blast radius — where else does this blind spot apply?

**Scanned, not fixed** (per DEC-11 / the coordinator's instruction). Findings:

### 4a. Format-magic constants — CLEAN elsewhere

`grep -rn 'b"ggml"\|b"GGUF"\|0x67676d6c' --include=*.rs src-app/` after the fix:

- `src/modules/llm_local_runtime/engine/metadata.rs:444` — `if magic != b"GGUF"`.
  **Correct.** The GGUF spec really does store the magic as literal ASCII bytes
  `GGUF`; there is no legacy-ggml arm in the LLM engine path. Its fixture
  (`tests/llm_local_runtime/test_helpers.rs:493`) writes `b"GGUF"`, which is
  faithful. **No action.**
- No other magic-byte comparison in the server tree.

So the *specific* byte-order bug is contained to the one function now fixed.

### 4b. The GENERALISED blind spot — "fixture derived from our own code"

This is the part the owner should know about. The pattern to worry about is not
"magic bytes"; it is **any test fixture whose notion of 'valid' comes from the
code under test rather than from the external system it stands in for.** The
sibling download paths were checked for it:

| Path | Verifies content? | Fixture faithfulness | Assessment |
|---|---|---|---|
| **LLM engine download** (`llm_local_runtime/engine/download.rs`, `MockReleaseServer`) | sha256 + archive extraction; GGUF magic parsed in `metadata.rs` | `test_helpers.rs:493` writes real `b"GGUF"` | **Lower risk.** The magic is correct, and extraction is a structural check a fake payload can't fake as easily. |
| **Hub seed** (`build_helper/hub_seed.rs`, `hub_manager.rs`) | sha256 + cosign keyless | Fixtures are generated tarballs; verification is cryptographic, not format-semantic | **Lower risk.** A sha256/cosign check cannot be satisfied by a self-consistent fake — the digest comes from upstream, which IS an external anchor. |
| **Sandbox rootfs** (`code_sandbox/version_manager.rs`, `runtime_fetch.rs`, `mirror_fixture.rs`) | sha256 + cosign + a `.ziee-sandbox-rootfs-schema` file | The schema-version file's *content contract* is defined in our own code and mirrored into the fixture | **Worth a look.** Same shape as this bug: an in-house content contract with a self-defined fixture. Not proven broken; the real rootfs is built by our own CI (so "upstream" is us), which materially reduces the risk. |
| **Voice runtime binary** (`runtime_version/`, `MockReleaseServer`) | mandatory `.sha256` sidecar | `real_repo_test.rs` hits the REAL release | **Lowest risk** — it is the one path with a real-network test. |

**The structural lesson:** paths verified by a **digest supplied by the upstream
source** (hub, rootfs, runtime binary, and the model download's own oid check)
are inherently protected — the digest is an external anchor a self-consistent
fake cannot satisfy. Paths verified by a **format assertion we wrote ourselves**
(the magic check) have no such anchor and need a fixture transcribed from real
data. That is the rule worth generalising.

**A note on the sha256 pin that did NOT save us here:** `model.rs` *does*
fail-closed verify the downloaded bytes against the catalog's LFS oid — a genuine
external anchor. It never got the chance: the magic check runs on the **first
chunk**, so the download aborted long before any digest was computed. A correct
check placed ahead of a strong one still gates everything behind it.

## 5. Recommended fleet-level rules (candidates to harvest)

1. **A fixture standing in for an external system must be transcribed from that
   system, not written from our parser.** Where practical, record a real
   response/file head once and pin it as a literal with provenance. (Implemented
   here as `GGML_MAGIC` + `REAL_WHISPER_GGML_FILE_HEAD`, both carrying an
   `xxd` transcript in their doc-comments.)
2. **For every format/protocol assertion, test the ACCEPT case against real data,
   not just the REJECT case against junk.** Rejection tests are easy to write and
   were the only ones present; they cannot detect an over-strict check.
3. **Every "the system is empty/idle" UI state deserves one composed-page
   assertion** that no contradictory error is simultaneously rendered. Component
   tests cannot see a contradiction that only exists in the composition.
4. **If a feature has multiple acquisition paths, make sure the tests exercise
   the one users actually use.** Here every end-to-end test used the air-gap
   pre-stage path — the one route almost no user takes — while all three real
   routes were broken.
