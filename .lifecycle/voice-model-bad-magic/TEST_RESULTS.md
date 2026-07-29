# TEST_RESULTS — voice-model-bad-magic (phase 8)

**Round-3 (verification session).** Every number below was transcribed from a run
**watched in this session**, on the tree that is being committed. Nothing is
inherited from the earlier rounds' claims: the brief was "verify its claims — do
not trust them", so the root cause was re-derived from live state, every tier was
re-run, and every negative control was re-executed rather than cited. Commands
are reproducible verbatim; logs are kept in the worktree root as `*.log`
(untracked).

---

## Environment

- Worktree `/data/pbya/ziee/tmp/voice-model-wt`, branch `fix/voice-model-bad-magic`.
- Build DB: shared pgvector cluster `127.0.0.1:54321`, per-worktree namespaced
  (`ziee_build_<key>`) — `docker ps` shows `ziee-postgres-build-1` up.
- E2E: per-run Postgres container spawned by `globalSetup` (port 54375); each test
  spawns its own backend on per-worker ports. `cargo build --bin ziee` was run
  from this HEAD first (EXIT=0) so the specs ran against current code.
- Live reference instance (READ-ONLY; nothing killed, nothing deleted): app-data
  `/data/pbya/ziee/tmp/live-rig-wt/ziee-data/dev/app-data`, DB `ziee_live_view` on
  `127.0.0.1:54396`, UI `http://127.0.0.1:1530`.

---

## Root cause — re-derived from inspected state (brief item 1): **CONFIRMED**

Not read from `BUG_ANALYSIS.md`; re-observed.

**The real files.** Four catalog models, fetched live:

```
$ curl -sSL -r 0-15 https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin | xxd
00000000: 6c6d 6767 99ca 0000 dc05 0000 0002 0000  lmgg............
$ … ggml-base-q8_0.bin → 6c6d 6767 …  (lmgg)
$ … ggml-base.bin      → 6c6d 6767 …  (lmgg)
$ … ggml-tiny.en.bin   → 6c6d 6767 …  (lmgg)
```

**The pre-fix code**, read out of the base rather than the doc:

```
$ git show origin/feat/agent-core:src-app/server/src/modules/voice/model.rs | grep -n has_whisper_magic
62: pub fn has_whisper_magic(bytes: &[u8]) -> bool {
63:     bytes.len() >= 4 && (&bytes[..4] == b"ggml" || &bytes[..4] == b"GGUF")
```

`b"ggml"` is `67 67 6d 6c`. Every real file starts `6c 6d 67 67` — the
little-endian `u32` serialization of `GGML_FILE_MAGIC = 0x6767_6d6c`. **No real
whisper.cpp model has ever satisfied the pre-fix check**, so every catalog / URL /
upload install was rejected on its first chunk (pre-fix `model.rs:417`), before
`downloaded += chunk.len()` and before the progress callback — which is why the
task's `bytes_received` was still `0`. `BUG_ANALYSIS.md` is **CONFIRMED**.

**The GGUF arm is genuinely fine** (so the fix is a widening, not a swap):

```
$ curl -sSL -r 0-15 …/stories15M-q4_0.gguf | xxd
00000000: 4747 5546 0300 0000 3900 0000 0000 0000  GGUF....9.......
```

**Live instance, re-inspected read-only:**

```
$ ls -laR …/app-data/voice-models                     → empty (no file, no .tmp)
$ psql -p 54396 -d ziee_live_view -c 'select count(*) from voice_models;'  → 0
$ GET /api/voice/models                               → []
$ GET /api/voice/models/catalog                       → base-q5_1 size_bytes 59707625
                                                        (= 56.94 MB), installed:false,
                                                        NO error field on any entry
$ GET /api/voice/models/downloads                     → []   (in-memory registry; the
                                                        failed tasks the owner saw did
                                                        not survive a restart)
```

So the "0 Bytes" + "bad magic" the owner saw came from the **download-task
snapshot** the UI rendered under the row, never from the catalog payload — exactly
the composition BUG_ANALYSIS §3 describes. **No live-instance cleanup is
required** (DEC-10 re-confirmed independently).

**Blast radius re-checked** (`grep -rn 'b"GGUF"\|b"ggml"\|0x67676d6c' --include=*.rs`):
the only other magic comparison in the tree is
`llm_local_runtime/engine/metadata.rs:444` (`if magic != b"GGUF"`), which the real
GGUF head above proves correct. The byte-order bug is contained to the one fixed
function.

---

## Negative controls — run in THIS session, not cited

The failure mode this branch exists to close is a *passing test that certifies the
broken behaviour*. Each new test was therefore proven to fail without its fix.

| Control | Command | Observed |
|---|---|---|
| **Rust unit** — `has_whisper_magic` restored to the pre-fix body | `cargo test --lib -p ziee voice::model::` | **FAILED. 12 passed; 3 failed** — `accepts_the_real_on_disk_whisper_ggml_magic` (*"a REAL whisper.cpp ggml file (head [6c, 6d, 67, 67]) must be accepted"*), `whisper_magic_accepts_ggml_and_gguf_rejects_junk` (`assert!(has_whisper_magic(b"lmgg....."))`), `rejection_classify_distinguishes_…` (`left: Some(BadMagic), right: None`) |
| **Rust integration** — same pre-fix body | `cargo test --test integration_tests voice::model_management_test::bad_magic_fix` | **FAILED. 1 passed; 2 failed** — `bad_magic_fix_real_format_catalog_install_succeeds`, `bad_magic_fix_upload_rejected_at_ingest_with_clear_message` (*"a real-format upload must succeed"*) |
| **Frontend unit** — `progressByteLabel`'s failed-and-zero guard removed | `node --test downloadProgress.helpers.test.ts` | **pass 9 / fail 1** — `actual: '0 Bytes / 56.93 MB', expected: null` — i.e. the shipped symptom, verbatim |
| **e2e (F4-1)** — Retry's `<Can>` gate removed | `playwright -g "read-only voice admin sees a failed install"` | **1 failed** — the read-only user gets the Retry |
| **e2e (F4-2)** — versions-card `size_bytes > 0` guard removed | `playwright -g "runtime-VERSIONS card"` | **1 failed** — *"the versions card renders a zero as \"0 B\""* |

After each control the file was restored and verified byte-identical
(`git diff --quiet …` → RESTORED CLEAN), then the suite re-run green.

**The F4-2 control is also how F4-3 was found:** on the FIRST attempt it did
*not* go red. The inherited assertion looked for `"0 Bytes"`, a string
`AvailableVersionsCard` cannot produce (it has its own local `formatBytes`, where
`0 → "0 B"`). The assertion was corrected to the string the card really renders,
and only then did the control go red. A negative control that is merely *cited*
would have shipped that inert assertion. See FIX_ROUND-4 F4-3.

Fixture hygiene re-verified: `grep -rn 'b"ggml"' --include=*.rs src-app/` returns
only doc-comments and two *guard* assertions (`assert_ne!(…, *b"ggml")`). No
fixture anywhere still encodes the wrong constant.

---

## Tier 1 — Rust unit

```
cd src-app/server && cargo test --lib -p ziee voice::
test result: ok. 63 passed; 0 failed; 0 ignored; 0 measured; 1338 filtered out   EXIT=0
```

- **TEST-1**: PASS — `voice::model::tests::whisper_magic_accepts_ggml_and_gguf_rejects_junk`
- **TEST-2**: PASS — `voice::model::tests::rejection_classify_distinguishes_empty_truncated_and_bad_magic`
- **TEST-5**: PASS — `voice::model::tests::rejection_messages_state_found_expected_and_action` (+ `describe_head_renders_hex_and_printable`)
- **TEST-8**: PASS — `voice::model::tests::accepts_the_real_on_disk_whisper_ggml_magic`
- **TEST-13**: PASS — `voice::model::tests::magic_constants_are_derived_from_one_source`
- **TEST-14**: PASS — `voice::model::tests::a_failed_publish_leaves_neither_a_partial_model_nor_a_temp`
- **TEST-15**: PASS — `voice::model::tests::sweep_reclaims_orphan_temps_and_never_touches_a_model_file`

## Tier 1 — frontend unit (node:test runner)

`downloadProgress.helpers.test.ts` is a `*.test.ts`, which this repo runs under
**node:test**, not vitest (`vitest.config.ts` scopes `include` to
`src/**/*.store.test.ts` precisely so the two runners never double-run a file).

```
cd src-app/ui && node --import ./scripts/node-test-loader.mjs --test "src/modules/voice/stores/downloadProgress.helpers.test.ts"
ℹ tests 10   ℹ pass 10   ℹ fail 0   ℹ skipped 0   EXIT=0
```

- **TEST-6**: PASS — 5 `progressByteLabel` cases (0 / partial / unknown-total / complete) + `percentOf` + `claimSubscription`

## Tier 2/3 — Rust integration

```
cd src-app/server && cargo test --test integration_tests voice:: -- --test-threads=6
running 51 tests
test result: ok. 51 passed; 0 failed; 0 ignored; 0 measured; 2321 filtered out; finished in 27.10s   EXIT=0
```

(Run twice in this session — before and after the negative-control revert/restore
cycle — 51 passed / 0 failed both times.)

- **TEST-3**: PASS — `model_management_test::bad_magic_fix_failures_are_distinct_and_leave_no_artifact`
- **TEST-4**: PASS — `model_management_test::bad_magic_fix_real_format_catalog_install_succeeds`
- **TEST-7**: PASS — `model_management_test::bad_magic_fix_upload_rejected_at_ingest_with_clear_message`
- **TEST-9**: PASS — `model_management_test::not_installed_models_never_report_a_file_validation_error`
- **TEST-10**: PASS — `fixture_faithfulness::shared_fixtures_use_the_real_on_disk_ggml_magic`

## Tier E2E — Playwright

```
cd src-app/ui && npx playwright test tests/e2e/14-voice/voice-model-mgmt.spec.ts \
    tests/e2e/14-voice/voice-model-permissions.spec.ts --workers=1 --reporter=list
10 passed (3.1m)   EXIT=0
```

- **TEST-11**: PASS — *a failed install is labelled and offers Retry (models + versions cards)* (16.4s)
- **TEST-11b**: PASS — *the runtime-VERSIONS card on the same page presents a failed install identically* (15.8s)
- **TEST-12**: PASS — *zero installed models → no per-model validation error, no bare "0 Bytes"* (16.2s)
- **TEST-16**: PASS — *read-only voice admin sees a failed install but gets no Retry control* (17.3s)

No-regression control — the 6 pre-existing specs in the same two files also ran
green in the same command: TEST-17 (15.8s), TEST-18 (16.5s), TEST-19 (17.6s),
TEST-20 (16.2s), TEST-24 read-only (17.2s), TEST-24 negative (16.5s).

---

## Frontend workspace gates

```
cd src-app/ui && npx tsc --noEmit                       EXIT=0
cd src-app/ui && npm run check                          EXIT=0
```

`npm run check` chains 21 sub-checks; all green, notably `check:design-spec`,
`check:testid-registry`, `check:gallery-coverage`, `check:state-matrix`,
`check:overlay-registry`, `check:gallery-seed-registry`, `check:store-actions`,
`lint:colors`, `lint:guardrails`. (It went RED once during fix-round 4 —
`check:state-matrix` correctly flagged the new `<Can>` conditional — and was
resolved by `npm run gen:state-matrix`, whose regenerated output is committed.)

- `npm run check (ui)`: PASS
- `npm run check (src-app/ui)`: PASS

## A7 boot/runtime canary

The canary A7 asks for is the **runtime-health** pass — boot + console-error +
uncaught-exception/ErrorBoundary + failed-request + WCAG-AA contrast, driven over
every gallery surface × state × theme as isolated full reloads, BEFORE any spec:

```
cd src-app/ui && npm run gate:ui      # tsc → lint → runtime-health → visual
✅ tsc — clean
✅ lint — clean
• runtime-health pass … 654/654 cells
   0 surface(s) with gating HIGH findings
--- per-surface runtime verdict: 177/177 PASS ---
✅ all surfaces runtime-clean
```

- **runtime-health (ui): PASS** — 177/177 surfaces clean, 0 gating HIGH findings
- **runtime-health (src-app/ui): PASS** — same run

The new `seeded-available-models-failed-install` gallery cell (the failed-install
row + Retry) is among the surfaces driven, and is runtime-clean.

**The `gate:ui` composite still exits 1**, on its 4th stage (the visual layer),
and that is reported rather than hidden — see "Known-failing, NOT caused by this
branch" §2 below for the base A/B that establishes it is pre-existing.

---

## Known-failing, NOT caused by this branch

### 1. `cargo check --workspace --tests` — inherited base breakage

`cargo check -p agent-core --tests` exits **101** (run in this session):

```
error[E0063]: missing fields `isolate_children` and `schedule` in initializer of `AgentCore`
   --> agent-core/tests/real_llm_loop.rs:143:16   (and :221:16)
error: could not compile `agent-core` (test "real_llm_loop") due to 2 previous errors
```

Proof it is inherited, not introduced:

- `git diff --name-only origin/feat/agent-core...HEAD` lists **no** file under
  `agent-core/` (verified in this session — the branch's non-`src-app/ui` files
  are the 9 `.lifecycle/` docs plus 5 `modules/voice/**` files).
- `agent-core` depends on the SDK crates, not on the `ziee` server crate where
  `modules/voice/**` lives, so a voice change cannot reach it.

Reported as a base defect for the orchestrator, **not** worked around here. Every
crate this branch does touch compiles: the `ziee` lib, its unit tests, and the
`integration_tests` target all built and ran.

### 2. `gate:ui`'s visual layer — pre-existing on the base

Every `gate:ui` run in this session ends:

```
PASS tsc | PASS lint | PASS runtime-health | FAIL visual
❌ 2 failed — tests/e2e/visual/chat-collapse-borders.spec.ts:358
   "TEST-3: every card's ring renders while COLLAPSED" (light + dark)
   → "<testid>: LEFT border is not painted while collapsed (issue #183)"
   (15 passed)
```

This was NOT accepted on the "we didn't touch chat" argument. It was measured, in
this same worktree, by checking `src-app/ui` out at the base and back:

| Run | `src-app/ui` at | Result |
|---|---|---|
| `npm run gate:ui` (reused 12h-old dev server) | HEAD | visual **2 failed / 15 passed** |
| `npm run gate:ui` (freshly booted dev server) | HEAD (+ fix-round 4) | visual **2 failed / 15 passed** |
| **`npm run gate:ui`** | **`origin/feat/agent-core`** | visual **2 failed / 15 passed** — *the identical two cells* |
| whole `playwright --config=playwright.visual.config.ts` (154 tests) | HEAD | **5 failed / 95 passed** — chat-scroll-stability ×3, tabular-viewer ×1, user-profile-label ×1; chat-collapse-borders **passes** |
| whole visual suite (154 tests) | **base** | **5 failed / 95 passed** — *the identical five* |
| `chat-collapse-borders.spec.ts` alone (7 tests) | HEAD | **7 passed** |
| `chat-collapse-borders.spec.ts` alone | base | **7 passed** |

Conclusions, stated as measured:

1. **The gate:ui visual failure reproduces byte-for-byte on the base** with this
   branch's UI removed, so it is **not caused by this branch** — which touches no
   chat file at all (`git diff --name-only … | grep -i chat` → empty).
2. The full visual suite likewise has the **same 5 pre-existing failures** at base
   and at HEAD — this branch adds none and fixes none.
3. `chat-collapse-borders` TEST-3 passes when its own file is run directly and
   fails only inside `gate:ui`'s filtered visual run, i.e. it is order/state
   dependent within that run — a base-side flake worth a separate ticket.

Nothing was skipped, muted, or re-baselined to make this green. The A7 canary is
recorded on the runtime-health pass, which genuinely passes 177/177.

---

## A1 (phase-0 global) — known inherited failure

`lifecycle-check --phase N` reports phase 0 FAIL on A1: `.lifecycle/` carries 18
feature dirs. `origin/feat/agent-core` already carries **17** sibling dirs before
this branch adds its first; satisfying A1 would require deleting 17 unrelated
features' artifacts, which the brief forbids. Verified in this session:

```
git ls-tree --name-only origin/feat/agent-core -- .lifecycle/ | wc -l     → 17
git ls-tree --name-only HEAD                   -- .lifecycle/ | wc -l     → 18
git diff --diff-filter=D --name-only origin/feat/agent-core...HEAD -- .lifecycle   → (empty)
```

Nothing was deleted. Every per-phase gate (`--phase 1..9`) passes on its own.
Recorded as DEC-8, following the precedent set by the sibling
`hook-lint-guardrails` branch on this same base.

---

## Independent re-verification (second agent, fresh context)

A separate agent with no prior context re-ran a representative subset of the
PASS lines above to check they reproduce. Every figure below was observed in
this session, not copied from the rows it verifies.

| Recorded claim | Re-run result | Matches? |
|---|---|---|
| Rust unit `cargo test --lib -p ziee voice::` → `ok. 63 passed; 0 failed … 1338 filtered out`, EXIT=0 | `ok. 63 passed; 0 failed; 0 ignored; 0 measured; 1338 filtered out`, EXIT=0 | ✅ exact |
| TEST-8/13/14 present by name | `accepts_the_real_on_disk_whisper_ggml_magic … ok`, `magic_constants_are_derived_from_one_source … ok`, `a_failed_publish_leaves_neither_a_partial_model_nor_a_temp … ok` | ✅ |
| Rust integration `voice:: --test-threads=6` → `ok. 51 passed; 0 failed … 2321 filtered out` (27.10s) | `ok. 51 passed; 0 failed; 0 ignored; 0 measured; 2321 filtered out` (27.72s, and 40.53s on a second run) | ✅ exact counts |
| TEST-3/4/7/9/10 present by name | all five `… ok` (`bad_magic_fix_failures_are_distinct_and_leave_no_artifact`, `bad_magic_fix_real_format_catalog_install_succeeds`, `bad_magic_fix_upload_rejected_at_ingest_with_clear_message`, `not_installed_models_never_report_a_file_validation_error`, `fixture_faithfulness::shared_fixtures_use_the_real_on_disk_ggml_magic`) | ✅ |
| TEST-6 under node:test → `tests 10  pass 10  fail 0`, EXIT=0 | `tests 10  suites 0  pass 10  fail 0`, EXIT=0 | ✅ exact |
| E2E `voice-model-mgmt` + `voice-model-permissions --workers=1` → `10 passed (3.1m)`, EXIT=0 | `10 passed (3.1m)`, EXIT=0 | ✅ exact |
| `npx tsc --noEmit` EXIT=0 | EXIT=0 | ✅ |

**The RED claim was re-verified, not taken on trust.** The strongest assertion in
this file is the row at the top: that with `has_whisper_magic` reverted to the
pre-fix accept-set the suite goes `FAILED. 12 passed; 3 failed`. Reproduced by
temporarily dropping `GGML_MAGIC_LE` from the `matches!` arm:

```
test result: FAILED. 12 passed; 3 failed; 0 ignored; 0 measured; 1386 filtered out
  accepts_the_real_on_disk_whisper_ggml_magic ... FAILED
  rejection_classify_distinguishes_empty_truncated_and_bad_magic ... FAILED
  whisper_magic_accepts_ggml_and_gguf_rejects_junk ... FAILED
EXIT=101
```

Identical counts and identical test names to the recorded row. `model.rs` was
restored immediately (`git diff` against HEAD empty). This is the evidence that
TEST-8 is a genuine format-derived regression test rather than a tautology —
the specific defect the ledger's `cosmetic-assertions` angle flagged elsewhere.

Also checked in passing:
- Node's `test:unit` script globs `src/**/*.test.ts`, so TEST-6's
  `downloadProgress.helpers.test.ts` is genuinely wired into the suite and not
  an orphan. (It is correctly NOT matched by `vitest.config.ts`'s
  `src/**/*.store.test.ts` include — the two runners deliberately don't overlap.)
- The branch diff adds no `#[ignore]`, `.skip(`, `.only(`, or `todo!` anywhere.
- The branch touches no chat file, corroborating the pre-existing-visual-failure
  finding above.
- `routeVoice` (the SSE/API mocking helper) pre-existed on the base at
  `voice-helpers.ts:488`; this branch only extended it additively.
