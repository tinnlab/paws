# TESTS — workflow-prompt-validation

Every ITEM is covered; INV-1 and INV-2 are each pinned by an `[acceptance]`
test that asserts the DESIGN's promise, not the code's behaviour.

No permission is introduced by this branch (no `modules/*/permissions.rs` change,
no migration grant), so A9/A10 do not apply.

## Enumerated tests

- **TEST-1** (tier: unit) [acceptance] [invariant: INV-1] [covers: ITEM-1, ITEM-2, ITEM-3, ITEM-4] file: `src-app/server/src/modules/workflow/dispatch.rs` — asserts: over the FULL state matrix (`prompt` ∈ {absent, `""`, `"   "`, `"hi"`} × `prompt_file` ∈ {absent, `""`, an existing file, an existing directory, a missing path} × kind ∈ {llm, llm_map, agent}), driven through the REAL `validate::validate_collecting` against a REAL materialized bundle dir and the REAL `load_raw_prompt` against the same dir, the implication holds in BOTH directions — every state validate reports free of prompt findings resolves a prompt at run, and every state validate reports RED fails to resolve one. It fails if EITHER side changes its rule, which is what makes it a proof of the invariant rather than of the implementation.
- **TEST-2** (tier: unit) [covers: ITEM-1] file: `src-app/server/src/modules/workflow/validate.rs` — asserts: the shared `prompt_source` normalisation table directly — an empty `prompt` and an empty `prompt_file` are ABSENT, a whitespace-only `prompt` is PRESENT (the deliberate DEC-3 boundary), a non-empty pair is `Both`, and neither is `Missing`.
- **TEST-3** (tier: unit) [covers: ITEM-2, ITEM-4] file: `src-app/server/src/modules/workflow/validate.rs` — asserts: through `validate_collecting` against a real bundle, `prompt: ""` beside an existing `prompt_file:` emits NEITHER `WORKFLOW_PROMPT_BOTH` nor `WORKFLOW_PROMPT_MISSING`; `prompt_file: ""` emits `WORKFLOW_PROMPT_MISSING`; a `prompt_file:` naming a DIRECTORY inside the bundle emits `WORKFLOW_PROMPT_FILE_MISSING`; and the pre-existing `WORKFLOW_PROMPT_BOTH` / `WORKFLOW_PROMPT_FILE_UNSAFE` verdicts are unchanged.
- **TEST-4** (tier: integration) [covers: ITEM-2, ITEM-4] file: `src-app/server/tests/workflow/builder_validate_def_test.rs` — asserts: through the REAL `POST /api/workflows/validate-def` (the endpoint the builder's validation panel actually reads), a def whose `llm` step carries `prompt: ""` plus a `prompt_file:` reports no prompt finding, and a def whose step carries `prompt_file: ""` reports `WORKFLOW_PROMPT_MISSING`.
- **TEST-5** (tier: unit) [covers: ITEM-5] file: `src-app/ui/src/modules/workflow/components/builder/stepForms.test.ts` — asserts: `promptSuppliedByFile` mirrors the backend's `prompt_source` emptiness rule EXACTLY — FALSE for `prompt_file: ""` (and for a non-string), TRUE for a real path and TRUE for a whitespace-only path (the backend uses `is_empty()`, not `trim()`, so the client must not trim either) — and that `configErrors` consequently requires a prompt on exactly the steps the backend calls incomplete.
- **TEST-6** (tier: unit) [covers: ITEM-3] file: `src-app/server/src/modules/workflow/dispatch.rs` — asserts: `load_raw_prompt` returns the FILE's contents when `prompt` is `Some("")` beside a `prompt_file:` (the exact cell FIX_ROUND-8 recorded as failing the run), returns an error when `prompt` is `Some("")` with no file, and still returns an error on a genuinely-both state — with the error text checked so a silently-different failure cannot pass.
- **TEST-7** (tier: e2e) [acceptance] [invariant: INV-2] [covers: ITEM-6, ITEM-7] file: `src-app/ui/tests/e2e/visual/input-group-overflow.spec.ts` — asserts: on the backend-free gallery at 390px AND 1280px, NO `[data-slot="input-group"]` has horizontal scrollable overflow above 1px and NO `[data-slot="input-group-addon"][data-align="inline-end"]` extends past its group's border box; plus a falsifiability control that injects a negative inline-end margin and confirms the probe turns red, so the spec cannot pass vacuously.
- **TEST-8** (tier: e2e) [covers: ITEM-8] file: `src-app/ui/tests/e2e/workflows/builder-responsive.spec.ts` — asserts: the builder's own full-stack responsive spec (real server, real MCP tool catalog, 390/768/1280px) passes with `MAX_TOLERATED_OVERFLOW_PX` lowered from 4 to 1 — the exit condition INV-2 states verbatim.

## Coverage map

| ITEM | covered by |
|---|---|
| ITEM-1 | TEST-1, TEST-2 |
| ITEM-2 | TEST-1, TEST-3, TEST-4 |
| ITEM-3 | TEST-1, TEST-6 |
| ITEM-4 | TEST-1, TEST-3, TEST-4 |
| ITEM-5 | TEST-5 |
| ITEM-6 | TEST-7, TEST-8 |
| ITEM-7 | TEST-7 |
| ITEM-8 | TEST-8 |

| INV | acceptance test |
|---|---|
| INV-1 | TEST-1 |
| INV-2 | TEST-7 |

## Why there is no "run a workflow over HTTP" test for INV-1

Recorded as DEC-4. The run-side decision lives in `load_raw_prompt`, which
executes BEFORE any provider call; the only two ways to reach it through the HTTP
run path are (a) a mocked run — but `runner.rs` short-circuits a mocked step
before the dispatcher is entered (`run_mock_step`, l.767), so it never runs, or
(b) an unmocked run, which needs a live LLM provider and would therefore be a
key-gated test that does not run in the gate. TEST-1 and TEST-6 execute the REAL
`load_raw_prompt` against a REAL bundle directory on disk — the dispatch-side
decision is genuinely run, not mocked or read.
