# DECISIONS — voice-model-bad-magic

Every human/product input the implementation needs, resolved up front.

### DEC-1: Which byte sequences should `has_whisper_magic` accept?
**Resolution:** `GGML_FILE_MAGIC = 0x67676d6c` in BOTH byte orders — its
little-endian serialization `6c 6d 67 67` (what every real whisper.cpp ggml file
on x86_64/aarch64 begins with) and its big-endian form `67 67 6d 6c` (ASCII
`ggml`) — plus the literal ASCII `GGUF`. Expressed as named constants derived
from the single `GGML_FILE_MAGIC` u32 via `to_le_bytes()` / `to_be_bytes()`, not
as two hand-written literals.
**Basis:** codebase + upstream format. whisper.cpp declares
`GGML_FILE_MAGIC 0x67676d6c` and writes it as a native-endian `uint32`; the real
bytes are confirmed empirically in BUG_ANALYSIS E3 across all three catalog
files. Retaining the big-endian arm costs nothing and preserves the previous
accept-set exactly (PLAN_AUDIT: the change is a pure widening, so no caller can
regress). GGUF's magic really is the literal bytes `GGUF` per the GGUF spec, and
`llm_local_runtime/engine/metadata.rs:444` already checks it that way.

### DEC-2: Should the magic check be deepened into a full ggml header parse?
**Resolution:** No. Keep a 4-byte magic check.
**Basis:** convention + scope. The 4-byte check is what the code has always done
and what `metadata.rs:444` does for GGUF; the real integrity guarantee is the
fail-closed sha256 verification against the catalog's LFS oid
(`model.rs:461`). A header parse is a different change with a different risk
profile and is explicitly out of scope for a bug fix. Recorded in PLAN_AUDIT
under "Risk actually worth naming" so it is a known, deliberate limit rather
than an oversight.

### DEC-3: How many distinct rejection conditions, and what are their error codes?
**Resolution:** Three, each with its own code:
`VOICE_MODEL_EMPTY_DOWNLOAD` (the response body was empty — 0 bytes received),
`VOICE_MODEL_TRUNCATED` (fewer than 4 bytes arrived, so the container could not
be identified), and `VOICE_MODEL_INVALID` (bytes arrived but the magic is not a
whisper container). `VOICE_MODEL_INVALID` keeps its existing name so the code is
not gratuitously churned; the two new codes are added alongside.
**Basis:** convention — mirrors the existing screaming-snake codes already in
`voice/model.rs` (`VOICE_MODEL_TOO_LARGE`, `VOICE_MODEL_SHA_MISMATCH`,
`VOICE_MODEL_URL_REJECTED`). Separating them is required by INV-4: today
`model.rs:452` folds `downloaded == 0` into the magic error, so an empty HTTP 200
is reported as "bad magic", which is simply false.

### DEC-4: What exactly must an actionable rejection message contain?
**Resolution:** Three components, in one sentence each: **found** (the observed
leading bytes as hex plus their printable rendering, e.g. ``got `3c 21 44 4f`
("<!DO")``), **expected** (a whisper `ggml` or `GGUF` container), and **action**
(what the user should do — re-download, check the source URL points at the raw
file rather than an HTML page, or remove the file and re-install). The same
builder produces the text for the download path and the upload path so the two
can never drift.
**Basis:** convention — CODING_GUIDELINES §6 ("preserve error context … don't
collapse to a bare status") and the api-friendliness angle ("errors that tell the
caller how to fix them"). The observed-bytes rendering is what makes an
HTML-error-page response self-diagnosing, which is the single most likely real
cause of a legitimate magic failure.

### DEC-5: Is the model-file size cap / any new tunable admin-configurable?
**Resolution:** No new tunable is introduced. `MAX_MODEL_BYTES` stays a fixed
constant at its current value, unchanged by this branch.
**Basis:** convention + existing rationale. The Configurable-settings rule
applies to tunables a feature *introduces*; this branch introduces none. The
existing cap already carries its documented fixed-constant rationale at
`model.rs:50-54` ("Whisper model files are upstream-bounded, so this is a safety
ceiling, not a per-deployment tunable (DEC-6)") — a prior, recorded decision that
this fix does not reopen.

### DEC-6: How should a failed install render — inline row message, or a global alert?
**Resolution:** An inline, error-toned row message directly beneath the failing
row: a labelled "Install failed — <reason>" line plus a Retry control on the same
line. Not a page-level `ErrorState`, and not a transient `message.error` toast.
**Basis:** convention + precedent. `ErrorState` is used in this very file for a
whole-section failure (`voice-available-models-error`, when the catalog itself is
unreachable) — the wrong weight for one row among ten. A toast is wrong because
the failure is durable state replayed from the SSE task registry on reload, not a
momentary event. The inline form also keeps the reason adjacent to the model it
concerns, which is what makes INV-1/INV-2 hold by construction.

### DEC-7: Retry — re-invoke the same download, or send the user elsewhere?
**Resolution:** Retry re-invokes the same `startDownload` call for that model,
identical to pressing Install again. No new endpoint, no confirmation step.
**Basis:** convention — the store action `startDownload` is already idempotent at
the registry level (`model_download_task.rs::start_or_join` prunes a terminal
task for the key and spawns a fresh runner), so a retry is exactly a second
Install. Adding anything more would be inventing a flow the backend does not have.

### DEC-8: A1 (`.lifecycle/` may carry exactly ONE feature dir) cannot pass on this base — accept?
**Resolution:** Accept as a known, inherited failure. `origin/feat/agent-core`
already carries 17 sibling `.lifecycle/` feature dirs before this branch adds its
first, so A1 is unsatisfiable for any feature branched off this base without
deleting 17 unrelated features' artifacts — which the brief explicitly forbids
(`git diff --diff-filter=D --name-only origin/feat/agent-core...HEAD --
.lifecycle` must be empty). Every per-phase gate (`--phase 1..9`) passes on its
own; only the phase-0 global check fails, and only on this count.
**Basis:** codebase — the sibling `hook-lint-guardrails` branch on this same base
recorded and accepted the identical situation as its own DEC-8
(`.lifecycle/hook-lint-guardrails/TEST_RESULTS.md:157-165`). Following the
established precedent rather than inventing a different disposition.

### DEC-9: Does fixing the sibling `AvailableVersionsCard` belong in this branch?
**Resolution:** Yes — ITEM-12. It carries the byte-identical defect
(`AvailableVersionsCard.tsx:215`) on the same page, and the fix is a shared
component extraction rather than a duplicated edit.
**Basis:** convention — INV-2 is stated about the page ("the UI must never show
'no models installed' next to a per-model file error"), and CODING_GUIDELINES §9
treats duplicated logic that should be one function as a finding. Recorded as a
deliberate, audited scope expansion (PLAN_AUDIT ITEM-12 verdict: CONCERN) rather
than silent creep.

### DEC-10: Should the detritus on the owner's live instance be cleaned up?
**Resolution:** There is none to clean. Report the verified state to the
orchestrator and take no action against the live instance.
**Basis:** codebase + observation. BUG_ANALYSIS E1 shows
`<app-data>/voice-models/` is empty (no 0-byte file, no leaked `.tmp`) and E2
shows `voice_models` has zero rows. The brief's instruction — "if cleanup of
detritus there is part of the fix, report it and let the orchestrator decide" —
is satisfied by reporting that it is not.

### DEC-11: Fix the sibling download paths found by the blast-radius scan?
**Resolution:** No — scan, document, and report only. ITEM-11 records the
findings in `TEST_GAP.md`; no sibling module is modified on this branch.
**Basis:** user — the coordinator's instruction is explicit: "You do not have to
fix them — but the owner should know the blast radius, and if a scan is cheap, do
the scan." Widening a bug-fix branch into four other download subsystems would
also make the blind audit's diff-coverage obligation disproportionate to the
defect.

### DEC-12: Does the gallery need a new state cell for the failed-install row?
**Resolution:** No new cassette-driven gallery cell. The failed state is driven
by the SSE download store, not by an API cassette, so it is not expressible in
the gallery's cassette model; the conditional branch itself already exists in the
code today (`{failed && progress?.error && …}`) and is therefore not a
newly-introduced render state. Coverage for the failed presentation comes from
TEST-6 (unit, the presentation helper) and TEST-11 (e2e, the real rendered row).
**Basis:** codebase — `modules/voice/gallery.tsx` seeds only `Voice.*` API
responses; there is no store-seeding mechanism for the download-progress store in
it. `npm run check:state-matrix` is green on the baseline (verified: full
`npm run check` exits 0 before any edit) and must stay green — re-verified at
Phase 8. If `check:state-matrix` flags the branch, a gallery cell is added then;
the check, not this decision, is authoritative.
