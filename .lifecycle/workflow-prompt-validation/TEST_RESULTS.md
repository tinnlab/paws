# TEST_RESULTS — workflow-prompt-validation

Every line below was observed. Logs: `/data/pbya/ziee/tmp/lifecycle-logs/wfresid-*.log`.

> **Standing caveat — this branch is NOT READY.** `FIX_ROUND-7.md` records two
> HIGH findings that are NOT fixed: a real-syscall repro reading the host
> `/etc/passwd` through the supposedly-confined open (the round-6 workspace `dir`
> invariant does not survive `canonicalize()`), and a mutation proving TEST-14
> still does not guard the fallback path its doc claims it drives. A green test
> table below does not mean the change is correct — two of the entries are
> annotated with exactly what they fail to assert. Round 7 was authorized on the
> condition that a further HIGH ends the loop and returns the decision to the
> owner; it found two, so nothing was fixed in that round.

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
- **TEST-10**: PASS — **re-measured; this line was FAIL and the reason it was
  FAIL has been resolved by measurement, not by wording.** What TEST-10 asserts
  is that the TEST-7 guard is WIRED INTO the enforced gate rather than merely
  existing. That is now proven arithmetically from two back-to-back `gate:ui`
  runs (see "gate:ui — the baseline-controlled record" below): the visual leg
  runs **25** cases on the base and **30** on this branch, and the branch's only
  `layerASpecs` addition is `input-group-overflow.spec.ts`, whose case count is
  exactly **5** (2 viewports × 2 directions + the falsifiability control). Every
  one of those 5 is in the PASSED column. The second half of TEST-10 — that the
  result is carried by the A7 canary record — is satisfied by the
  baseline-controlled form (`branch 3 vs base 6`), which is A7's own provision
  for a shared gate that is red on the base too. `npm run check (ui)` is PASS
  (recorded below).
- **TEST-11**: PASS — the whole `workflow::` lib suite, unfiltered:
  **190 passed; 1 failed**, the one failure being the pre-existing
  `models::tests::job_kind_parses_round_trips_and_is_orthogonal` (see below).
  `validation_codes_are_registered_and_humanised` — the guard round 1 broke and a
  scoped filter hid — is green.
- **TEST-12**: PASS — `read_prompt_file_refuses_what_it_must_not_read` (real FIFO,
  directory, one byte over the cap, exactly at the cap, ordinary file).
- **TEST-13**: PASS — `prompt_file_shape_refuses_every_absolute_and_traversing_form`.
- **TEST-14**: PASS **as a run, but it does NOT assert what its doc claims — see
  FIX_ROUND-7 HIGH-2.** The test is green and the Linux half is genuinely
  falsifying (dropping `O_NOFOLLOW` turns it RED, 42/1). The FALLBACK half is
  not: neutering `open_confined_fallback`'s anchor guard (`symlink_metadata` →
  `metadata`) leaves it **GREEN at 43 passed / 0 failed**, despite the doc
  claiming the fallback "is then driven DIRECTLY". The test body never names
  `open_confined_fallback`. Left standing and flagged rather than quietly
  rewritten, because it is one of the two round-7 HIGHs handed to the owner.

- **TEST-15**: PASS — `t1_confine_rejects_nested_dir` +
  `t1_confine_accepts_a_single_safe_dir` (`workflow/workspace.rs`): a nested
  workspace `dir` is refused, a single-component one still resolves.

`npm run check (ui): PASS`

## Regression scope for the workspace-`dir` restriction (round 6)

`cargo test --test integration_tests -- --test-threads=1 workflow_mcp`:
**46 passed; 0 failed**. Nothing in the workspace flow used a nested `dir`.

**Correction (round 7):** the earlier wording of this paragraph said the 46
included `t4_run_from_workspace_drives_real_llm_step`,
`t4_llm_agentically_runs_and_saves_workflow` and
`t4_workspace_verbs_honor_approval_mode` — the real-LLM workspace verbs whose
`dir` argument the restriction narrows. **A "passed" count cannot distinguish
those from self-skipped**: all three `return` immediately when
`ANTHROPIC_API_KEY` is unset, and this worktree has no `tests/.env.test`. So they
are counted as green without having exercised the narrowed argument, and
`PLAN_AUDIT.md:146` leans on this paragraph to dismiss the ITEM-18 concern. The
claim is withdrawn to what was actually observed: 46 tests reported passed, with
the three real-LLM legs of unknown execution status.

Final `workflow::` lib suite: **191 passed; 1 failed** (the pre-existing
`job_kind` case).

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

## `gate:ui` — the baseline-controlled record

`gate:ui (ui): branch 3 vs base 6`

**`gate:ui` exits non-zero on BOTH legs.** That is recorded as observed and not
dressed up; the comparative form is A7's own provision for exactly this case, and
it is a controlled comparison, not a lowered bar — it passes only because the
branch is measurably no worse than the base it branched from.

### The controlled pair (round 7 — the earlier attempt is retracted below)

Two runs, **same box, back to back, same invocation**
(`CHOKIDAR_USEPOLLING=1 GALLERY_PORT=<unique> npm run gate:ui`, distinct ports so
neither run's vite could serve the other), on a quiet box:

| leg | tree | runtime-health gating surfaces | visual failed | visual passed |
|---|---|---|---|---|
| **base** | pristine detached worktree at `9363976a2` (the branch's merge-base), sdk `c6f5d8c` | **1** — `seeded-s5-project-form-loading` | **5** | 20 |
| **branch** | `c5f38ad46`, sdk `e0abf06` | **1** — `seeded-hardware-monitor-error` | **2** | 28 |

`branch 3 vs base 6` counts failing units on each leg (gating runtime surfaces +
failed visual cases): branch `1 + 2 = 3`, base `1 + 5 = 6`.

Logs: `/data/pbya/ziee/tmp/lifecycle-logs/wfresid-gateui-BASE-1.log` and
`…/wfresid-gateui-r7-2.log`. Verbatim tails:

```
base   ❌ runtime-health — 1 surface(s) with HIGH findings
       ❌ visual — 5 failed          (20 passed)
       ❌ GATE FAILED — runtime-health, visual
branch ❌ runtime-health — 1 surface(s) with HIGH findings
       ❌ visual — 2 failed          (28 passed)
       ❌ GATE FAILED — runtime-health, visual
```

### Why the branch is no worse, itemised

- **Visual — strictly better, and it is the SAME spec on both legs.** The base's
  5 failures are all in `chat-collapse-borders.spec.ts`; the branch's 2 are a
  literal SUBSET of them (`TEST-3` light + dark). The branch does not touch that
  spec or the chat surface. Three cases that fail on the base (`TEST-2`,
  `TEST-8` light, `TEST-8` dark) pass on the branch.
- **Visual — the branch also ADDS 5 passing cases.** 25 total cases on the base,
  30 on the branch; the only `layerASpecs` addition is
  `input-group-overflow.spec.ts` (4 parameterised + 1 control = 5). The
  arithmetic closes exactly: `20 + 3 recovered + 5 new = 28`. This is the
  execution proof TEST-10 asks for.
- **runtime-health — one gating surface on each leg, and it is a DIFFERENT
  surface each time** (`seeded-s5-project-form-loading` on the base,
  `seeded-hardware-monitor-error` on the branch, and neither is related to
  workflows or the kit). A single flaky surface, not a branch attribute.
- `tsc` and `lint` are PASS on both legs.

### Retracted: the round-6 measurement of this same gate

The earlier record in this file claimed "19 visual failures across 5 specs" on
the base and "4 failed / 178-of-179 surfaces" on the branch. **Those numbers are
withdrawn as uncontrolled**, and so is a first round-7 branch run
(`wfresid-gateui-r7-1.log`) which reported **6** gating runtime surfaces, 4627
findings and 183 enumerated surfaces. That run was concurrent with two
cargo-building audit agents at a load average of ~140; the base leg was not.
Re-run on a quiet box the same tree gives 1 gating surface, 489 findings and 171
surfaces. The lesson is recorded rather than hidden: on this box a `gate:ui`
number is only meaningful against a control taken under the same load, which is
why the pair above was run back to back and why the earlier pair is not cited.

I am not claiming the branch makes `gate:ui` green. I am claiming, with a
same-box control, that it is red for reasons that predate it and that the branch
moves the number DOWN.

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
