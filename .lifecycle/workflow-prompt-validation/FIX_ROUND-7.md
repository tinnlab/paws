# FIX_ROUND-7 — workflow-prompt-validation

**This round is RECORDED, not CLOSED.** Round 7 was authorized explicitly (the
6-round cap's "escalate to a human" was escalated, and the human said run it) on
the reasoning that the profile had decayed 73→12 monotonically and that round 6
had still surfaced a repro-backed HIGH. The authorization carried one condition:
*if round 7 finds another HIGH, stop and hand the decision back — do not start
round 8.* **It found two, from two independent angles, each backed by a
mutation or a real-syscall repro.** So nothing in this round is fixed here; it is
written down and handed over.

Input: two blind agents against the round-6 tree, over round 6's own diff
(`a67317c2a..HEAD` — `workflow/workspace.rs`, `workflow/validate.rs`,
`workflow_mcp/tools.rs`) — **32 rows: 16 confirmed, 16 rejected**
(`ledger-round7-{a,b}.jsonl`). Angles: (a) security / mechanism-soundness —
does the round-6 change establish the invariant it claims, under real kernel
semantics, for every producer of the paths it protects; (b) blast radius /
contract / test honesty — what does it silently break, and do its tests and
documents assert what they claim.

Both agents' verification legs were clean and identical:
`cargo check -p ziee --all-targets` exit 0, `cargo test --lib -p ziee --
workflow::` **191 passed / 1 failed** (the pre-existing
`job_kind_parses_round_trips_and_is_orthogonal`).

De-duplicated across the two ledgers, the round is **15 distinct confirmed
findings** (one pair is the same defect: `tools.rs` `dir` schema, filed LOW by
(a) and MEDIUM by (b)).

---

## HIGH-1 — the round-6 invariant does not hold: `canonicalize()` re-creates the intermediate components

`resolve_conversation_workspace_dir` constrains the `dir` **string** to a single
`Component::Normal`, then returns `candidate.canonicalize()`. Canonicalize
**expands symlinks**. So a single-component `dir` that IS a symlink to a nested
in-workspace directory returns a root with model-controlled INTERMEDIATE
components — exactly what the round-6 comment says it makes impossible:

> With a single component, the only model-controlled part of the root IS that
> final component, which the anchor open refuses to follow.

Verified against the real syscalls (verbatim replicas of the resolver's path
logic and `open_confined`'s `O_NOFOLLOW|O_DIRECTORY` anchor +
`openat2(RESOLVE_BENEATH)`), scratch `/data/pbya/ziee/tmp/r7a`:

```
setup: mkdir -p base/a/etc; echo PLANTED-DECOY > base/a/etc/passwd; ln -s a/etc base/proj
resolve("proj") ACCEPTED -> <base>/a/etc     (2 model-controlled components, not 1)
[validate-time]  read passwd = "PLANTED-DECOY\n"
[sandbox step]   mv a a.bak && ln -s / a      (the root path STRING never changes)
[dispatch-time]  read passwd = "root:x:0:0:root:/root:/bin/bash" (1373 bytes)
*** ESCAPE CONFIRMED: host /etc/passwd read through the confined open ***
control (plain non-symlink dir): refused, ENOTDIR   <- the round-6 fix DOES work here
```

No race is required: `dispatch.rs` reads `prompt_file:` per step at execution
time from `ctx.extracted_path`, `workflow_mcp/tools.rs:575` sets the ephemeral
row's `extracted_path` to this canonicalized root, and `dispatch.rs:864`
RW-bind-mounts `<workspace_root>/<conv>` as the sandbox home — so an EARLIER
sandbox step of the same run performs the swap and a LATER llm step reads the
host file.

The control leg is what makes this precise rather than a retraction: the plain
non-symlink case is genuinely closed, so round 6 is a real improvement. The
residual is the symlinked final component. The fix belongs on the RETURNED root
(refuse a symlinked final component, or require `canon.parent() == base_canon`),
not on the input string — the same "guard the value where it is used, not where
it is spelled" lesson rounds 4/5/6 each learned once.

## HIGH-2 — round 6 replaced TEST-14's false doc with an equally false doc

Round 6's own headline was *"TEST-14 claimed to guard both paths and did not"*,
and it recorded the remedy as:

> TEST-14 now drives `open_confined_fallback` DIRECTLY, plus a control that an
> ordinary root still reads through it.

The test body does not mention `open_confined_fallback`. The only occurrence of
that identifier in the region **is the comment claiming it**. Proven by mutation,
tree restored after each:

| mutation | test | result |
|---|---|---|
| `symlink_metadata` → `metadata` in `open_confined_fallback` (neuters the fallback anchor guard) | TEST-14 | **GREEN** — 43 passed / 0 failed. The doc's claim is false. |
| drop `O_NOFOLLOW` from the Linux anchor open | TEST-14 | **RED** — 42 / 1. That half of the claim holds. |
| `if normals != 1` → `if false && normals != 1` | `t1_confine_rejects_nested_dir` | **RED** — 6 / 1. That test is genuinely falsifying. |

So the fallback anchor guard — the entire non-Linux and pre-5.6 story — is still
untested, `TEST_RESULTS.md` records TEST-14 as PASS, and `FIX_ROUND-6.md` records
the gap as closed. This is the same defect class round 6 was convened to fix,
reintroduced by the fix.

## MEDIUM — the rest, in the order they matter

- **`dir: "."` / `"./"` regressed.** `normals != 1` also rejects `normals == 0`.
  `"."` previously resolved to the conversation workspace root — which is exactly
  where `write_file` writes by default, i.e. the most frictionless authoring
  flow. The security rationale does not apply there (that component is the bind
  MOUNT POINT, un-renameable from inside), and the error text misdiagnoses it as
  "a nested path". (`workspace.rs:98`)
- **The live MCP `dir` schema was not updated.** All three workspace verbs still
  advertise "relative to /home/sandboxuser" with no single-component constraint:
  the tool advertises what the code now rejects. Self-correcting in practice (the
  error text reaches the model) but the contract is wrong. (`tools.rs:239`)
- **The rule is a creation-time check on one surface.** `extracted_path` is
  persisted and re-consumed by `spawn_run` / `resume_run` / `run_for_test`
  (`POST /workflows/{id}/test`), none of which re-check. The guard is not where
  the value is used. (`runner.rs:1251`)
- **Persisted client state has no back-compat path.** `structuredContent.
  workspace_dir` lives in chat history; a run created BEFORE this change with a
  nested `dir` leaves permanently-rendered Save/Download buttons that now 400.
  `PLAN_AUDIT` reasoned only about in-tree callers.
  (`WorkflowWorkspaceRunCard.tsx:35`)
- **Both new tests use only real directories.** No test anywhere makes `dir` a
  symlink, so the suite is green against HIGH-1. The missing class is "the
  returned ROOT has one model-controlled component" — a property of the output,
  which is where the defect is. (`workspace.rs:199`)
- **`angles.json` attributes coverage that was never performed.**
  `workspace.rs` was untouched before the round-6 fix commit
  (`git diff <base>..a67317c2a -- workspace.rs` is empty) and appears as `file`
  in ZERO ledger rows in any round, yet its entry claims 7 angles "ACTUALLY
  reviewed … in the phase-6 blind audit". Six `AUDIT_COVERAGE.tsv` rows clear the
  ≥3-angle gate on that attribution. This one is an integrity defect in the
  lifecycle artifact itself, not in the product. (`angles.json:145`)
- **A recorded regression-scope claim cannot distinguish ran from self-skipped.**
  `TEST_RESULTS.md`'s "46 passed; 0 failed — including `t4_run_from_workspace_
  drives_real_llm_step` …" is leaned on by `PLAN_AUDIT.md:146` to dismiss the
  ITEM-18 concern, but all three `t4_` tests `return` immediately when
  `ANTHROPIC_API_KEY` is unset and this worktree has no `tests/.env.test`.
  (`TEST_RESULTS.md:45`)
- **The SCOPE comment asserts the false invariant** as the mechanism's
  load-bearing justification, in three places (`validate.rs:1263`,
  `workspace.rs:74-82`, and the user-facing error string). Fixing HIGH-1 must fix
  the prose with it. (`validate.rs:1263`)

## LOW

`workspace.rs:44`'s public doc omits the new rule; the two new tests write to the
real shared `/tmp/ziee-workflows` (3096 leftover dirs observed) instead of
`tempdir()`, with cleanup skipped on the panic path; no integration-tier
assertion of the narrowing (`workspace_test.rs:189`); `PLAN.md:139`'s
"Files to touch" omits both files ITEM-18 changed; the SCOPE note is Linux-only
and absent from the fallback that needs it most (`validate.rs:1352`).

The round-6 LOW backlog (`EAGAIN`, NUL-byte `rel`, the unreachable
`#[cfg(not(unix))]` arm, two stale test comments, the untested `seen` dedup /
capacity clamp / `spawn_blocking`) was excluded from this round's remit as
known-and-accepted, and is unchanged.

## The one thing this round CHANGED

Nothing in the product. The single edit is `angles.json`'s `workspace.rs` entry
and its provenance comment, because committing a coverage attribution I now know
to be false is not an option: the list is narrowed to the five angles that
genuinely reported on that file (all in round 7), and the comment says so.
`AUDIT_COVERAGE.tsv` regenerated from it (82 hunks). Every other finding above —
including both HIGHs — is left exactly as found, for the owner.

## Explicit rejections worth recording

Both agents rejected more than they confirmed, and several rejections close off
plausible-looking follow-ups:

- **`Path::components()` counting has no hole.** 22 spellings tested against real
  Rust (`proj/.`, `./proj`, `proj//x`, trailing separator, backslash, `C:proj`,
  `//proj`, unicode, TAB). The string-level rule does what it says; the defect is
  downstream of it.
- **`validate_collecting_async` is wired correctly** — `is_dev` preserved,
  `JoinError`→`internal_error` right, cancellation identical to its sibling. The
  two remaining sync `validate_collecting` calls (`dev.rs:107/954`) are fine: a
  nonexistent tmp root, `check_prompt_files` gates on `is_dir()` and reads
  nothing. Round 6's sweep claim holds this time (it did not in rounds 4 and 5).
- **Installed (non-ephemeral) bundle roots are not attackable** — the workflow
  mount is `StageMode::ReadOnly` and lives outside the RW home bind. HIGH-1 is
  confined to the workspace surfaces.
- **Nothing in-tree is broken by the narrowing**: every committed `dir` value is
  single-component and the traversal test's asserted codes are unchanged. (The
  breakage is `"."` and persisted history — recorded above, not here.)

## Profile

`73 → 76 → 48 → 29 → 20 → 12 → 16`.

Recorded as measured. Round 7 ran **two** agents where round 6 ran one, so the
raw count is not directly comparable to its predecessor — but it did not fall,
and the two HIGHs are not reviewer noise: one is a host-file read demonstrated
against the live kernel, the other is a mutation that leaves a security test
green. The honest reading is that the previous round's decay was partly an
artifact of reviewer count, and that this diff's edges are still moving.

**New confirmed findings:** 16
