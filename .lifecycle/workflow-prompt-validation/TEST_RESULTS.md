# TEST_RESULTS — workflow-prompt-validation

Every line below was observed. Logs: `/data/pbya/ziee/tmp/lifecycle-logs/wfresid-*.log`.

## Enumerated tests

- **TEST-1**: PASS — `validate_and_dispatch_agree_on_every_prompt_state`, 120 cells
  (4 prompt × 10 file × 3 kinds), `ran_ok == 18` non-vacuity floor holds.
- **TEST-2**: PASS — `prompt_source_treats_empty_as_absent_but_not_whitespace`.
- **TEST-3**: PASS — `validator_verdicts_on_the_empty_and_directory_prompt_states`.
- **TEST-4**: PASS — `validate_def_prompt_source_verdicts` (integration, real
  `POST /api/workflows/validate-def`): `2 passed; 0 failed`.
- **TEST-5**: PASS — `promptSuppliedByFile mirrors the backend emptiness rule
  exactly` + `an EMPTY prompt_file leaves the prompt requirement in force`
  (node `--test`, 16/16 in the file, 0 fail).
- **TEST-6**: PASS — `load_raw_prompt_reads_the_file_when_the_prompt_box_was_cleared`.
- **TEST-7**: PASS — `input-group-overflow.spec.ts`, **5 passed** (390px + 1280px
  × LTR + RTL, plus the falsifiability control).
- **TEST-8**: PASS — `builder-responsive.spec.ts` full-stack e2e with
  `MAX_TOLERATED_OVERFLOW_PX = 1`: **1 passed (20.6s)**.
- **TEST-9**: PASS — `client_prompt_file_predicate_mirrors_prompt_source`.
- **TEST-10**: **FAIL** — see "The one gate that does not pass" below. The
  underlying fact it asserts IS observed (`gate:ui` executes the TEST-7 spec: it
  appears in the visual leg and passes there), but `gate:ui` as a whole exits
  non-zero, so this is recorded FAIL rather than PASS.
- **TEST-11**: PASS — the whole `workflow::` lib suite, unfiltered:
  **190 passed; 1 failed**, the one failure being the pre-existing
  `models::tests::job_kind_parses_round_trips_and_is_orthogonal` (see below).
  `validation_codes_are_registered_and_humanised` — the guard round 1 broke and a
  scoped filter hid — is green.
- **TEST-12**: PASS — `read_prompt_file_refuses_what_it_must_not_read` (real FIFO,
  directory, one byte over the cap, exactly at the cap, ordinary file).
- **TEST-13**: PASS — `prompt_file_shape_refuses_every_absolute_and_traversing_form`.
- **TEST-14**: PASS — `read_prompt_file_refuses_a_bundle_root_that_became_a_symlink`.

`npm run check (ui): PASS`

## Acceptance tests (design-invariant proofs)

- **TEST-1** [acceptance, INV-1]: PASS.
- **TEST-7** [acceptance, INV-2]: PASS.

Both are proven FALSIFIABLE by mutation, not merely green:

| mutation | result |
|---|---|
| `load_raw_prompt` back to a raw `match (prompt, prompt_file)` | TEST-1 + TEST-6 RED |
| drop `check_prompt_file_shape` from `read_prompt_file` | TEST-1 RED |
| validator back to an `is_file()` existence proxy | TEST-1, TEST-3 RED |
| `prompt_source` stops normalising an empty inline prompt | TEST-1/2/3/6 RED |
| drop the `Empty` rejection (a SHARED change) | caught by the `ran_ok == 18` floor |
| drop the backslash + drive-letter shape clauses | TEST-13 RED |
| `promptSuppliedByFile` back to `typeof pf === 'string'` | TEST-9 (Rust) + TEST-5 (TS) RED |
| revert the anchor `O_NOFOLLOW\|O_DIRECTORY` | TEST-14 RED |
| cfg-disable `openat2` so the fallback serves every call | TEST-14 RED |
| kit addon back to the negative margin | TEST-7 LTR rows + control RED |
| group root clearance back to physical `pl/pr-1.5` | TEST-7 RTL rows RED |

## The one gate that does not pass — `gate:ui`

**Observed: `gate:ui exit=1`.** Recorded as observed; not dressed up.

- `tsc`: PASS. `lint`: PASS.
- `visual`: 4 failed — **all four in `chat-collapse-borders.spec.ts`**, which this
  branch does not touch.
- `runtime-health`: 178/179 surfaces PASS; the one failure is
  `seeded-file-rag-error`, a surface unrelated to workflows or the kit.

**Attribution, measured rather than asserted.** Same spec, same parallel
configuration, back to back:

```
kit at THIS branch : 7 passed (4.4s)
kit at the base    : 5 passed, 2 failed
```

i.e. the spec fails MORE often with the branch's kit reverted. Run serially with
this branch's kit it passes 3/3 and 7/7. It is flaky under parallel load, and the
direction of the evidence rules this branch out as the cause.

**Baseline.** `gate:ui` was run on a pristine `origin/feat/agent-core` worktree
(parent `9363976a2`, sdk `675a8ac`): **19 visual failures across 5 specs**
(`chat-collapse-borders`, `layout`, `form-label-starvation`, `overlays`,
`states`) and `runtime-health — 0 surfaces clean`. So the gate does not pass on
the base either, by a wider margin than on this branch.

I am not claiming the branch makes `gate:ui` green. I am claiming it is red for
reasons that predate it, and that the branch's own surfaces are green: `tsc`,
`lint`, 178/179 runtime surfaces, and the spec this branch adds (5/5).

## Pre-existing failure, not this branch's

`modules::workflow::models::tests::job_kind_parses_round_trips_and_is_orthogonal`
— `unknown variant 'subagent', expected one of 'workflow', 'sandbox_exec',
'sub_agent'`. `models.rs` and `job_kind.rs` are **byte-identical** to the base
blob (`diff <(git show origin/feat/agent-core:<file>) <file>` → empty for both),
and the failure is a `JobKind` serde variant-name mismatch with no relation to
prompts. Reported onward; not silenced, not `#[ignore]`d.

## Reported onward (not fixed here)

- The five long-red Layer A visual specs, named in a comment in
  `visual-tests.yml` so the path back to gating them is explicit.
- `job_kind_parses_round_trips_and_is_orthogonal` (above).
- ITEM-12 / ITEM-14 / ITEM-15 — the descoped items, each with an approved
  disposition in `DECISIONS.md`.
- Three pre-existing `.lifecycle/…` citations in production source from OTHER
  branches (`mcp/chat_extension/helpers.rs`, `voice/model.rs` ×2). `merge-gate`
  C5 strips that directory, so those references will dangle. This branch removed
  its own three.
