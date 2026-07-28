# Voice model install — "bad magic" / "0 Bytes" — root-cause analysis (design source)

This is the research/design pass for `fix/voice-model-bad-magic`. There is no
prior design doc for this defect (the `voice-model-mgmt` feature's `.lifecycle/`
was stripped at merge, per merge hygiene), so this document IS the named design
source the plan is derived from. Every claim below is backed by an observation
recorded verbatim in `## Evidence`, not by reading code.

---

## 1. The reported symptom

The owner's live instance, `/settings/voice`:

- **Available runtimes** — `v1.9.1`, tagged `latest` + `installed`.
- **Installed models** — "No models installed yet — download one above."
- **Available models** (Source: `ggerganov/whisper.cpp`), per row an **Install** button:
  - `base-q5_1` · 56.94 MB · `q5_1` · multilingual · verifiable
    → beneath the row: **"0 Bytes"** and **"file is not a whisper ggml/GGUF model (bad magic)"**
  - `base-q8_0` · 77.98 MB · `q8_0` · multilingual · verifiable → the same two lines.

The page simultaneously claims *no models are installed* and renders what reads
as a *file-validation failure* for models that are only listed as available.

## 2. Root cause — the whisper ggml magic constant is byte-order-wrong

`src-app/server/src/modules/voice/model.rs:62`

```rust
pub fn has_whisper_magic(bytes: &[u8]) -> bool {
    bytes.len() >= 4 && (&bytes[..4] == b"ggml" || &bytes[..4] == b"GGUF")
}
```

whisper.cpp's ggml container declares `GGML_FILE_MAGIC = 0x67676d6c` and writes
it as a **native-endian `uint32`**. On every little-endian host (x86_64, aarch64
— i.e. every platform ziee ships) that `u32` serializes to the byte sequence
`6c 6d 67 67`, which is ASCII **`lmgg`** — the reverse of `ggml`.

The check compares against the ASCII spelling `b"ggml"`, which **no real
whisper.cpp ggml file has ever begun with**. Therefore:

> **Every download of a genuine whisper ggml model is rejected on its first
> chunk.** The catalog Install path, the Add-from-URL path, and the Upload path
> all funnel through `has_whisper_magic` and all fail on real model files.

`GGUF` is unaffected — the GGUF spec stores its magic as the literal bytes
`GGUF`, so that arm of the check is correct. Only the legacy-ggml arm is wrong,
and `ggerganov/whisper.cpp` publishes **ggml**, not GGUF. Hence 100% failure.

The rejection happens at `model.rs:417` on the first chunk, **before**
`downloaded += chunk.len()` and before the progress callback fires — which is
exactly why the task's `bytes_received` is still `0` when the failure is
recorded, and why the UI prints "0 Bytes".

### Which of the four hypotheses held

| # | Hypothesis | Verdict |
|---|---|---|
| 1 | A failed download left a 0-byte artifact that validation now runs against | **FALSE** — `voice-models/` is empty; the temp-cleanup path works correctly |
| 2 | Validation runs against not-yet-downloaded models | **FALSE** — `has_whisper_magic` has exactly 3 call sites (`model.rs:417`, `model.rs:452`, `model_handlers.rs:565`); none is on the list path |
| 3 | The download wrote an error body and reported success | **FALSE** — the download reported *failure*, correctly; it just failed for the wrong reason |
| 4 | "installed" and "validate" use different sources of truth | **PARTIALLY TRUE, but not causal** — `installed` comes from the `voice_models` DB rows while file presence comes from a filesystem non-empty check (`model.rs:102`). The two do disagree in principle, but here both correctly said "nothing installed" |

**None of the four is the cause.** The cause is a fifth: the validator itself is
wrong, so the product's primary acquisition path has never worked.

## 3. Why the incoherent render

Two independent presentation defects turn a failed *install attempt* into what
looks like a *file-validation error on an installed file*:

- `AvailableModelsCard.tsx:269` renders the task error as a bare
  `<Text type="secondary">{progress.error}</Text>` — no "install failed" framing,
  no error tone, no corrective action. It reads as row metadata.
- `AvailableModelsCard.tsx:304` renders `formatBytes(recv)` unconditionally, and
  `formatBytes(0)` returns the literal string `'0 Bytes'`
  (`utils/downloadUtils.ts:12`). With `total_bytes` unknown the `/ total` half is
  suppressed, leaving a naked **"0 Bytes"** directly under a row that advertises
  a 56.94 MB catalog size — reading as "the on-disk file is empty".

So the backend never claimed the model was installed-and-corrupt; the UI
composed that impression out of a failed-attempt error and an unlabelled zero.

## 4. Why the message is unactionable even when legitimate

`"file is not a whisper ggml/GGUF model (bad magic)"` states neither what was
found, nor what was expected, nor what the user should do. A genuinely different
condition is also folded into the same *rejection*: `model.rs:452` is
`if downloaded == 0 || !has_whisper_magic(&head)`, so an empty HTTP 200 exits
through the wrong-container branch and carries the same `VOICE_MODEL_INVALID`
code. (Correction, verified against the pre-fix source during phase-6 re-audit:
that site emits a *different sentence* — `"download produced no valid whisper
model bytes"` — not the `bad magic` string quoted above, which comes from the
first-chunk site at `model.rs:417`. The conflation being fixed is of the
*condition and the code*, not of the literal message.)

## 5. Blast radius

- **All three model-acquisition paths are broken in production**: catalog
  Install, Add-from-URL, and Upload. A real user cannot install a whisper model
  by any supported route. The only path that works is manually pre-staging a
  file into `voice-models/` (the air-gap route), which bypasses validation
  entirely — which is how the feature's own integration tests stage models
  (`tests/voice/mod.rs:155`) and therefore why transcription tests still pass.
- **Not affected**: `llm_local_runtime/engine/metadata.rs:444` checks `b"GGUF"`,
  which is correct for GGUF; the LLM engine path has no legacy-ggml arm.

---

## Evidence

### E1 — on-disk state of the owner's live instance (hypothesis 1 refuted)

```
$ ls -laR /data/pbya/ziee/tmp/live-rig-wt/ziee-data/dev/app-data/voice-models
voice-models:
total 75
drwxr-xr-x 2 pbya pbya 2 Jul 27 21:46 .
drwxr-xr-x 9 pbya pbya 9 Jul 27 21:45 ..
```

Empty. No 0-byte artifact, no `.tmp` leak. **No cleanup of detritus is required
on the live instance.**

### E2 — DB state (hypothesis 4 refuted as causal)

```
$ psql -h 127.0.0.1 -p 54396 -U postgres -d ziee_live_view -c "select * from voice_models;"
 id | name | filename | source | source_url | size_bytes | sha256 | verified | created_at
----+------+----------+--------+------------+------------+--------+----------+------------
(0 rows)
```

Zero rows. The "no models installed" claim is truthful; nothing is mid-state.

### E3 — the actual first bytes of the real catalog files (the proof)

```
$ curl -sSL -r 0-15 https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin | xxd
00000000: 6c6d 6767 99ca 0000 dc05 0000 0002 0000  lmgg............

$ curl -sSL -r 0-15 .../ggml-base-q8_0.bin | xxd
00000000: 6c6d 6767 99ca 0000 dc05 0000 0002 0000  lmgg............

$ curl -sSL -r 0-15 .../ggml-base.bin | xxd
00000000: 6c6d 6767 99ca 0000 dc05 0000 0002 0000  lmgg............
```

All three files — including `base`, the row that was cut off in the screenshot —
begin `6c 6d 67 67` (`lmgg`). The implementation requires `67 67 6d 6c`
(`ggml`). Every catalog model fails.

### E4 — the test fixtures encode the same wrong constant

`tests/voice/model_management_test.rs:100-106`

```rust
// A valid ggml body: the 4-byte magic + deterministic filler ...
let ggml = |tag: &str, fill: usize| {
    let mut v = Vec::with_capacity(4 + fill);
    v.extend_from_slice(b"ggml");
```

Seven fixture sites in that file (`:104, :588, :640, :642, :793, :885, :1109,
:1111`) build "valid" model bytes as `b"ggml" + filler`. The mock HF mirror
therefore serves bytes that a real HuggingFace never would, and the integration
suite validates the bug instead of catching it.

The unit test does the same (`model.rs:632`):

```rust
assert!(has_whisper_magic(b"ggml....."));
```

Both fixtures were derived from the implementation's assumption rather than from
a real file — a tautological test in the sense of lifecycle rule **D2**: flipping
the invariant off would not turn either test red, because the fixture flips with
it.

---

## Design decisions this analysis fixes

- **D-1 — accept the real on-disk magic.** `has_whisper_magic` must accept the
  little-endian serialization of `GGML_FILE_MAGIC` (`6c 6d 67 67`) — what real
  files are — while continuing to accept `GGUF`. The ASCII `ggml` ordering is
  retained defensively (a big-endian-authored file) and documented as such.
- **D-2 — distinguish the failure conditions.** An empty response body, a
  wrong-magic body, and a size-cap breach are three different user situations
  and must produce three different messages.
- **D-3 — every rejection states found / expected / corrective action.**
- **D-4 — a failed install renders as a failed INSTALL, never as a file error.**
  Explicit "Install failed" framing, error tone, a Retry affordance, and no bare
  byte count for a download that never transferred anything.
- **D-5 — the fixtures must come from the real format, not from the code.** The
  canonical valid-model bytes used by tests must be built from the documented
  `GGML_FILE_MAGIC` u32, so that a future byte-order regression turns them red.
