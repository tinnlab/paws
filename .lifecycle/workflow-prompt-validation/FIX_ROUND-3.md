# FIX_ROUND-3 — workflow-prompt-validation

Input: three blind agents against the round-2 tree — **68 rows: 48 confirmed,
20 rejected** (`ledger-round3-{a..c}.jsonl`). Two of the three ran MUTATIONS
rather than reasoning about the tests, which is what produced the round's two
most valuable results.

---

## The confinement was still defeatable, and `O_NOFOLLOW` did not close it

Round 2's `read_prompt_file` resolved the path THREE times — `canonicalize()`,
`metadata()`, `open()` — with no shared descriptor. `O_NOFOLLOW` refuses a symlink
at the FINAL component only; every intermediate component is re-walked and
followed on each call. And the attacker exists: `run_from_workspace` /
`validate_from_workspace` pass the conversation's code_sandbox workspace as the
bundle root, and that directory is bind-mounted **read-write into the sandbox**.

The concrete sequence: the model writes a real regular file `prompts/passwd` (so
canonicalize + `starts_with` pass), then races
`mv prompts prompts.bak; ln -s /etc prompts`. The server — outside the sandbox,
as the server uid, on the host view — opens `/etc/passwd`; `O_NOFOLLOW` is
satisfied because `passwd` itself is not a symlink. The contents flow into the
LLM prompt and the step's prompt log. The same race also restores the FIFO
denial-of-service that round 2's stat-before-open was added to remove.

→ **Fixed with a single kernel-confined resolution.** `open_confined` uses
`openat2(2)` with `RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS | RESOLVE_NO_MAGICLINKS`
against a directory fd of the root, plus `O_NONBLOCK` so a FIFO returns instead of
parking the thread. Everything afterwards interrogates the **file descriptor** —
`fstat` for the type and size, then a bounded read — so no check can be
invalidated by a rename between two path lookups. `EXDEV`/`ELOOP` map to
`Escape`; `ENOSYS` (pre-5.6 kernels) falls back to the previous
canonicalize+confine+`O_NOFOLLOW` path, which is documented as weaker. macOS and
Windows take the same fallback — the sandbox itself is Linux on all three host
platforms, so the exposed surface is covered.
→ Pinned by a new matrix cell (`escapedir/outside.md`, an INTERMEDIATE symlink;
the matrix is now 120 cells) and an explicit assertion in TEST-6.

## The only security controls in the change had no test at all

The design-conformance agent deleted the type check, BOTH size checks and the
bounded read in one mutation and the entire suite stayed green — 53/53. Round 2
had added the guards and no test for them, which is the same "present and
untested" shape the audits keep finding.

→ **TEST-12** exercises each against a real file of the offending kind: a real
`mkfifo` FIFO (the test RETURNING is itself the proof — a hang is the
regression), a directory, one byte over the cap, exactly at the cap (still
readable), and an ordinary file. **TEST-13** covers the shape rejects nothing
pinned, including the two non-Unix ones (`C:` drive prefix, any backslash) that
exist because a bundle authored on one OS is validated on another.

## My CI fix turned a never-running job into an always-failing one

Round 2 added `submodules: recursive` so the visual job could install. The agent
then ran what the job actually runs and found the step has NO spec filter — it
executes all 26 files under the visual `testDir`, of which **5 fail
deterministically** for reasons unrelated to any PR. The job had been dying at
`npm ci` for so long that nobody had seen them.

→ The step now runs the CURATED `visualSpecs` list from `gallery.config.json` —
the same list `npm run gate:ui` runs — so CI and the local gate agree instead of
diverging, and the job can pass. This is not a narrowing: the unfiltered
invocation had never executed a single spec, so this takes the job from 0 specs
actually run to 6. The 5 long-red specs are reported onward, not silenced.
→ The sibling `visual-snapshots.yml` had the same missing `submodules: recursive`
and got the same fix.

## Dead code that re-created the duplication the branch removes

- `StepConfig::prompt_source()` had ZERO callers (rustc warned) while its doc told
  callers to prefer it over the free function with two adjacent same-typed
  arguments — and both real call sites used the raw form. Now used by the
  validator, and pinned in the matrix by an assertion that the step-level
  accessor equals the free function, so it cannot silently diverge from the shape
  production uses.
- `PromptFileError::code()`/`layer()` were dead AND a second encoding of the
  mapping `prompt_file_finding` states in literals — precisely the
  two-places-decide-separately shape this branch exists to delete, reintroduced by
  round 1's own fix. Removed, with the reason recorded where a maintainer adding a
  variant will look.
- The doc block for `prompt_fields()` had slid onto `prompt_source()`, leaving the
  live accessor undocumented and the other one described twice. Reattached.

## Smaller confirmed fixes

- The Rust↔TS drift guard's doc implied it was bidirectional. It catches the
  client drifting from the rule; the Rust side is pinned by TEST-2. Both stated.
- `VALIDATION_CODES`' doc still described it as private after the `pub(crate)` bump.
- DESIGN §1's table gained the two REJECTIONS this fix adds (the 1 MiB cap and
  the platform-independent shape check) — they re-verdict definitions that used to
  install, so they belong in the design, not only in the plan.
- TESTS.md gained a "known limits" section stating plainly which assertions are
  contract statements rather than falsifiable guards (TEST-4 #1/#3), that TEST-1's
  implication cannot catch a rule deleted from the SHARED function (the `ran_ok`
  floor and TEST-2/3/6 are what pin the rules), and which addon branches TEST-7
  does not reach because no consumer renders them.

## Explicit rejections

- **"The four `validate_for_install` callers do blocking I/O on tokio workers."**
  Real, and pre-existing in shape (`is_dir`/`canonicalize` were always there).
  After ITEM-16 the read is bounded at 1 MiB, cannot block on a FIFO, and cannot
  follow a symlink — so the residual is a bounded read on a worker thread, not an
  unbounded or indefinite one. Moving `validate_for_install` off the async path is
  a signature change across five call sites and belongs in its own commit.
- **"`read_prompt_file` belongs in `file_io.rs`, not the validator."** Defensible,
  but the validator is where the `WorkflowDef` vocabulary and every other
  `check_*` live, and the runner already depends on `validate::` for `StepConfig`
  itself. Moving it would widen the diff without changing who depends on whom.
- **"TEST-3 has two assertions green before and after."** True — they document the
  endpoint contract for the state the builder's remedy produces. Kept, and now
  labelled as such rather than counted as proof.
- **The 5 pre-existing red visual specs** (chat-scroll-stability ×3,
  tabular-viewer clipboard, user-profile-label tooltip) and the pre-existing red
  `workflow::models::job_kind_parses_round_trips_and_is_orthogonal` (`subagent`
  vs `sub_agent`; `models.rs` and `job_kind.rs` are byte-identical to the base) —
  neither is this branch's, both reported onward, neither silenced.

**New confirmed findings:** 48
