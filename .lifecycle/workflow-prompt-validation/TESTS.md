# TESTS — workflow-prompt-validation

Every ITEM is covered; INV-1 and INV-2 are each pinned by an `[acceptance]`
test that asserts the DESIGN's promise, not the code's behaviour.

No permission is introduced by this branch (no `modules/*/permissions.rs` change,
no migration grant), so A9/A10 do not apply.

## Enumerated tests

- **TEST-1** (tier: unit) [acceptance] [invariant: INV-1] [covers: ITEM-1, ITEM-2, ITEM-3, ITEM-4] file: `src-app/server/src/modules/workflow/dispatch.rs` — asserts: over the FULL state matrix (`prompt` ∈ {absent, `""`, `"   "`, `"hi"`} × `prompt_file` ∈ {absent, `""`, an existing file, a directory, a missing path, a ZERO-BYTE file, a NON-UTF-8 file, a `..` path, a symlink OUT of the bundle} × kind ∈ {llm, llm_map, agent} — 108 cells), driven through the REAL `validate::validate_collecting` against a REAL materialized bundle dir and the REAL `load_raw_prompt` against the same dir, the implication holds in BOTH directions — every state validate reports free of prompt findings resolves a prompt at run, and every state validate reports RED fails to resolve one. It fails if EITHER side changes its rule, which is what makes it a proof of the invariant rather than of the implementation. It additionally asserts a non-vacuity floor (18 cells must legitimately RUN) so the implication cannot hold because nothing validates clean, and is paired with `prompt_codes_list_covers_every_prompt_verdict_the_validator_emits`, which fails if the validator gains a `WORKFLOW_PROMPT_*` code the matrix stops covering.
- **TEST-2** (tier: unit) [covers: ITEM-1] file: `src-app/server/src/modules/workflow/validate.rs` — asserts: the shared `prompt_source` normalisation table directly — an empty `prompt` and an empty `prompt_file` are ABSENT, a whitespace-only `prompt` is PRESENT (the deliberate DEC-3 boundary), a non-empty pair is `Both`, and neither is `Missing`.
- **TEST-3** (tier: unit) [covers: ITEM-2, ITEM-4] file: `src-app/server/src/modules/workflow/validate.rs` — asserts: through `validate_collecting` against a real bundle, `prompt: ""` beside an existing `prompt_file:` emits NEITHER `WORKFLOW_PROMPT_BOTH` nor `WORKFLOW_PROMPT_MISSING`; `prompt_file: ""` emits `WORKFLOW_PROMPT_MISSING`; a `prompt_file:` naming a DIRECTORY inside the bundle emits `WORKFLOW_PROMPT_FILE_MISSING`; a ZERO-BYTE and a NON-UTF-8 `prompt_file:` each emit `WORKFLOW_PROMPT_FILE_MISSING`; the one pre-existing verdict that deliberately MOVED (`prompt:` beside an EMPTY `prompt_file:` was `WORKFLOW_PROMPT_BOTH`, now clean — DEC-5) is pinned; and the pre-existing `WORKFLOW_PROMPT_BOTH` / `WORKFLOW_PROMPT_FILE_UNSAFE` verdicts are unchanged.
- **TEST-4** (tier: integration) [covers: ITEM-2, ITEM-4] file: `src-app/server/tests/workflow/builder_validate_def_test.rs` — asserts: through the REAL `POST /api/workflows/validate-def` (the endpoint the builder's validation panel actually reads), a def whose `llm` step carries `prompt: ""` plus a `prompt_file:` reports no prompt finding, and a def whose step carries `prompt_file: ""` reports `WORKFLOW_PROMPT_MISSING`.
- **TEST-5** (tier: unit) [covers: ITEM-5] file: `src-app/ui/src/modules/workflow/components/builder/stepForms.test.ts` — asserts: `promptSuppliedByFile` mirrors the backend's `prompt_source` emptiness rule EXACTLY — FALSE for `prompt_file: ""` (and for a non-string), TRUE for a real path and TRUE for a whitespace-only path (the backend uses `is_empty()`, not `trim()`, so the client must not trim either) — and that `configErrors` consequently requires a prompt on exactly the steps the backend calls incomplete.
- **TEST-6** (tier: unit) [covers: ITEM-3] file: `src-app/server/src/modules/workflow/dispatch.rs` — asserts: `load_raw_prompt` returns the FILE's contents when `prompt` is `Some("")` beside a `prompt_file:` (the exact cell FIX_ROUND-8 recorded as failing the run), returns an error when `prompt` is `Some("")` with no file, and still returns an error on a genuinely-both state — with the error text checked so a silently-different failure cannot pass; plus the cells the phase-6 audit found (a `..` path and an absolute path are refused BY THE RUNNER, not merely upstream, and a zero-byte `prompt_file` does not ship an empty prompt).
- **TEST-7** (tier: e2e) [acceptance] [invariant: INV-2] [covers: ITEM-6, ITEM-7, ITEM-9, ITEM-11] file: `src-app/ui/tests/e2e/visual/input-group-overflow.spec.ts` — asserts: on the backend-free gallery at 390px AND 1280px, in LTR **and RTL**, NO `[data-slot="input-group"]` has horizontal scrollable overflow above 1px and NO inline addon (BOTH `inline-start` and `inline-end`, measured in the writing direction) extends past its group's border box; with two anti-vacuity guards (at least one group, and at least one addon carrying the `> button` child the reverted rule keyed on) and a falsifiability control that re-injects the EXACT conditional rule that was removed (`:has(> button)`, not a blanket margin) and confirms the probe turns red.
- **TEST-8** (tier: e2e) [covers: ITEM-8] file: `src-app/ui/tests/e2e/workflows/builder-responsive.spec.ts` — asserts: the builder's own full-stack responsive spec (real server, real MCP tool catalog, 390/768/1280px) passes with `MAX_TOLERATED_OVERFLOW_PX` lowered from 4 to 1 — the exit condition INV-2 states verbatim.

- **TEST-9** (tier: unit) [covers: ITEM-10] file: `src-app/server/src/modules/workflow/validate.rs` — asserts: the BACKEND suite fails if `stepForms.ts`'s `promptSuppliedByFile` stops rejecting the empty string, or starts trimming — the Rust↔TypeScript drift guard for the prompt-source rule, in the same read-the-TS-at-runtime shape this file already uses for `validationCopy.ts`.
- **TEST-10** (tier: e2e) [covers: ITEM-11, ITEM-13] file: `src-app/ui/tests/e2e/visual/input-group-overflow.spec.ts` — asserts: `npm run gate:ui` (the repo's stated UI exit condition) actually RUNS the TEST-7 spec, proven by EXECUTION and recorded as the `gate:ui (ui): PASS` line — i.e. the guard is wired into the enforced gate rather than merely existing — and that `npm run check (ui)` still passes with the reworded author-facing copy.

- **TEST-11** (tier: unit) [covers: ITEM-16, ITEM-17] file: `src-app/server/src/modules/workflow/validate.rs` — asserts: the whole `workflow::` lib suite (NOT a hand-picked filter) passes, so the module's own crate-wide `validation_codes_are_registered_and_humanised` drift guard — which round 1 broke by passing computed layer/code arguments, and which lives in a sibling module a scoped filter skipped — is green, together with `prompt_codes_list_covers_every_prompt_verdict_the_validator_emits` rebased onto the canonical `VALIDATION_CODES` registry.

- **TEST-12** (tier: unit) [covers: ITEM-16] file: `src-app/server/src/modules/workflow/validate.rs` — asserts: `read_prompt_file`'s RESOURCE guards, against real files of each offending kind — a real FIFO is refused (and the test RETURNING at all is the proof that the `O_NONBLOCK` open plus fd-type check works; a hang is the regression), a directory is refused, a file one byte over `MAX_PROMPT_FILE_BYTES` is `TooLarge` while one exactly at the cap still reads, and an ordinary file still reads.
- **TEST-13** (tier: unit) [covers: ITEM-16] file: `src-app/server/src/modules/workflow/validate.rs` — asserts: `check_prompt_file_shape` refuses every traversing and ABSOLUTE form on every platform — `..`, a leading `/`, a `C:`/`c:` drive prefix and any backslash — while ordinary bundle-relative paths (including one with a space) pass.

- **TEST-14** (tier: unit) [covers: ITEM-18] file: `src-app/server/src/modules/workflow/validate.rs` — asserts: a bundle root that became a SYMLINK is refused as an anchor on BOTH resolution paths — through whichever path is live (`openat2` on Linux) via `read_prompt_file`, and through `open_confined_fallback` CALLED BY NAME, since on Linux nothing else ever executes the fallback's guard — each with a positive control that an ordinary root still reads through the same call.

- **TEST-15** (tier: unit) [covers: ITEM-18] file: `src-app/server/src/modules/workflow/workspace.rs` — asserts: `resolve_conversation_workspace_dir` refuses a NESTED `dir` and still accepts a single-component one — the rule that makes the final component the only part of a workspace bundle root the model can swap, which is what the anchor guard in `read_prompt_file` is able to refuse.

- **TEST-24** (tier: unit) [covers: ITEM-18] file: `src-app/server/src/modules/workflow/workspace.rs` — asserts: the rule is a property of the RETURNED ROOT, not of the `dir` STRING — a single-component `dir` that is a symlink to a nested path (`proj -> a/etc`) is refused, because `canonicalize` expands symlinks and would otherwise hand back a root with a model-controlled INTERMEDIATE component; on failure the test performs the intermediate swap and reports what the confined read actually returned, so the escape is evidence rather than an assertion about it.

- **TEST-25** (tier: unit) [covers: ITEM-18] file: `src-app/server/src/modules/workflow/workspace.rs` — asserts: the resolved root is never the conversation workspace ROOT itself, by either spelling — `.`/`./` (caught by the string rule) and a symlink `proj -> .` that canonicalizes back to the root (which the string rule cannot see) — because a root returned here becomes the ephemeral row's `extracted_path`, which `delete_user_workflow` `remove_dir_all`s.

- **TEST-26** (tier: integration) [covers: ITEM-18] file: `src-app/server/tests/workflow_mcp/workspace_test.rs` — asserts: the same narrowing at the surface that consumes it — `validate_from_workspace` and `run_from_workspace` both refuse a symlinked single-component `dir` reaching a nested root with `WORKFLOW_WORKSPACE_ESCAPE`, with a control that the identical bundle IS valid when reached the legitimate way.

- **TEST-27** (tier: unit) [covers: ITEM-18] file: `src-app/server/src/modules/workflow/workspace.rs` — asserts: `check_persisted_workspace_root` accepts exactly `<workspace_root>/<conv>/<dir>` and refuses anything deeper, the conversation root itself, and the bare workspace root — under ANY conversation id (it is keyed on the root, not on `preflight`'s client-supplied `conversation_id.unwrap_or(run_id)`) — plus a leg proving a symlinked workspace root does not make the check silently inert.

- **TEST-28** (tier: integration) [covers: ITEM-18] file: `src-app/server/tests/workflow_mcp/workspace_test.rs` — asserts: the USE-time half, on a persisted row — a legacy ephemeral row whose `extracted_path` is nested (a shape the resolver no longer mints) is refused by the real `POST /workflows/{id}/run` with `WORKFLOW_WORKSPACE_ESCAPE`, **and no `workflow_runs` row is created**, which is the observable proof that the refusal precedes the validate + `insert_run` pass rather than landing in `preflight` after it; with a control that a direct-child `extracted_path` does not trip the rule.

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
| ITEM-9 | TEST-7 (RTL legs), TEST-1 (`prompt_fields` drives the matrix's field extraction) |
| ITEM-10 | TEST-9 |
| ITEM-11 | TEST-7, TEST-10 |
| ITEM-12 | [DESCOPED] — see DECISIONS |
| ITEM-13 | TEST-10 |
| ITEM-14 | [DESCOPED] — see DECISIONS |
| ITEM-15 | [DESCOPED] — see DECISIONS |
| ITEM-16 | TEST-1, TEST-3, TEST-6, TEST-11, TEST-12, TEST-13 |
| ITEM-17 | TEST-7, TEST-10, TEST-11 |
| ITEM-18 | TEST-14, TEST-15, TEST-24, TEST-25, TEST-26, TEST-27, TEST-28 |

| INV | acceptance test |
|---|---|
| INV-1 | TEST-1 |
| INV-2 | TEST-7 |

## Known limits of these tests, stated rather than left to be found

- **TEST-4's first and third assertions are CONTRACT statements, not falsifiable
  guards.** `/validate-def` has no bundle, so "an empty prompt beside a
  `prompt_file:` yields no prompt finding" was already true before this change,
  and "a genuine both-state is still refused" is a control. Only the second
  assertion (`prompt_file: ""` ⇒ `WORKFLOW_PROMPT_MISSING`) reddens on a revert.
  They are kept because the endpoint's contract is what the builder's panel
  renders, but they are not what proves the fix.
- **TEST-1's implication cannot catch a rule deleted from the SHARED function**,
  only a rule that drifts between the two sides — deleting the emptiness reject
  leaves both sides agreeing. That is the correct meaning of the invariant; the
  `ran_ok == 18` floor and TEST-2/TEST-3/TEST-6 are what pin the rules themselves.
- **The Rust↔TypeScript drift guard is one-directional** (it catches the client
  drifting from the rule). The Rust side is pinned by TEST-2 instead.
- **TEST-7 covers the `has-[>button]` and bare branches of the addon variants**,
  because those are the only shapes any consumer in this tree renders; the
  `has-[>kbd]` branch and an `inline-start` addon with a button child have no
  consumer to measure.

## Why there is no "run a workflow over HTTP" test for INV-1

Recorded as DEC-4. The run-side decision lives in `load_raw_prompt`, which
executes BEFORE any provider call; the only two ways to reach it through the HTTP
run path are (a) a mocked run — but `runner.rs` short-circuits a mocked step
before the dispatcher is entered (`run_mock_step`, l.767), so it never runs, or
(b) an unmocked run, which needs a live LLM provider and would therefore be a
key-gated test that does not run in the gate. TEST-1 and TEST-6 execute the REAL
`load_raw_prompt` against a REAL bundle directory on disk — the dispatch-side
decision is genuinely run, not mocked or read.
