# FIX_ROUND-8 — workflow-prompt-validation

Round 7 ended by handing two HIGHs back to the owner rather than fixing them.
The owner returned them as an explicit, scoped brief: fix **exactly** those two
plus two named lower-severity items, reproduce each before fixing, and do not
expand scope. This round does that, and re-audits the result from two blind
angles.

Both round-7 HIGHs were **reproduced first, through the real production code**,
before a line was changed. A fix without an observed red was not accepted.

---

## HIGH-1 (round 7) — the invariant did not survive `canonicalize()`

**Reproduced.** A test driving the real `resolve_conversation_workspace_dir` and
the real `read_prompt_file`:

```
'proj' (one component) resolved to "/tmp/ziee-workflows/<conv>/a/etc", a NESTED root;
after swapping the intermediate the confined read returned Ok("HOST SECRET")
```

Round 6 had put the rule on the `dir` **string**. `canonicalize()` expands
symlinks, so `proj -> a/etc` passes a one-component string check and still
returns a root whose INTERMEDIATE component the model controls.

→ **Fixed on the value that is RETURNED**, which is where it is decidable: the
canonical root must be a **DIRECT CHILD** of the conversation workspace root
(`canon.parent() == Some(base_canon)`). The string rule is kept as a cheap early
reject with an actionable message and is explicitly documented as *not* the
thing that establishes the confinement. This is the same lesson rounds 4/5/6
each learned once — guard the value where it is used, not where it is spelled —
applied one level further out.

The comment that asserted the false invariant is rewritten, and the premise it
rests on is now stated as a **dependency rather than a fact**: the intermediate
components are out of reach because `sdk/crates/ziee-sandbox/src/sandbox.rs`
binds `<workspace_root>/<conv>` **at** `/home/sandboxuser` (verified against the
argv builder, not the comment that describes it), so the guest never sees
`<workspace_root>`. A guest that could create its own mounts would be a failure
of a *different* boundary, and the comment now says so instead of implying this
rule covers it.

## HIGH-2 (round 7) — TEST-14's doc claimed a guard its body never ran

**Reproduced.** With `symlink_metadata` → `metadata` in `open_confined_fallback`
(neutering the fallback's anchor guard), TEST-14 was **GREEN**. The test body
never named `open_confined_fallback`; only the comment claiming it did.

→ **Fixed.** TEST-14 now calls `open_confined_fallback` **by name**, with a
positive control that an ordinary root still reads through the same call. The
same mutation is now **RED**:

```
the fallback opened a bundle root that is now a symlink; it read "HOST SECRET"
```

## Lower-severity item 1 — `dir: "."` — **RECORDED, deliberately NOT fixed**

The brief said "fix if cheap, else record". It was implemented, then **reverted**
on evidence. Re-allowing `.` makes the ephemeral row's `extracted_path` the
entire conversation workspace, and `handlers::delete_user_workflow` runs
`remove_dir_all(&wf.extracted_path)` — so deleting one throwaway workflow would
`rm -rf` every file the user authored in that conversation plus every prior run's
outputs. Two independent blind angles flagged the blast radius. Restoring a
pre-existing hazard is not a cheap fix, so the rule is now *stricter* than round
6's: the resolved root must be a **strict** direct child, and the workspace root
is refused by both spellings — including `proj -> .`, which the string rule
cannot see. Authors create a subdir; the tool description says so.

## Lower-severity item 2 — the rule was not re-checked where the value is USED

→ **Fixed.** `check_persisted_workspace_root` (a pure depth check on
`extracted_path` below the workspace root, never a re-resolution — that would be
TOCTOU) is called at the top of `spawn_run` and `resume_run`, **before** their
validate pass reads any `prompt_file:`, and in `preflight`, which is what covers
`run_for_test`.

Its first draft was wrong in three ways, all caught by this round's own audits
and all fixed — see below.

---

## What the round-8 blind audits found in THIS round's fix

Two angles, both against the working diff: (a) security / mechanism soundness,
(b) blast radius / contract / test honesty. They converged independently on the
same three defects in the new `check_persisted_workspace_root`:

- **It was keyed on the wrong identifier.** `preflight`'s
  `conversation_id.unwrap_or(run_id)` is *not* the conversation that owns the
  stored path — `spawn_run` takes an optional **client-supplied**
  `conversation_id` and `scheduler/dispatch.rs` passes `None` unconditionally.
  A caller sending `conversation_id: null` made the guard inert for exactly the
  legacy rows it existed to refuse. → Re-keyed on the workspace **root**; the
  conversation id is now irrelevant to the shape, and TEST-27 pins that with
  rows under unrelated conversation ids.
- **It was inert under a symlinked workspace root.** `extracted_path` is stored
  canonicalized; `workspace_root` is rebuilt raw, so on any host where the root
  contains a symlink (macOS `/var → /private/var` — and `temp_dir()` is under
  `/var` there) `strip_prefix` matched nothing and the guard passed by doing
  nothing. → The server-controlled root side is normalized; a dedicated test
  fails if that normalization is removed.
- **It fired one confined-read pass too late.** `spawn_run`/`resume_run` run
  `validate_for_install_async` — which reads **every** `prompt_file:` through
  the very confinement this shape is what makes sound — *before* `preflight`.
  → Hoisted ahead of the validate pass. TEST-28 pins the ordering observably:
  removing the early check leaves a `workflow_runs` row behind, and the test
  fails on that, not on the error code.

Angle (b) mutation-checked every test this round added or changed and found
**no dishonest test**: all four original claims were load-bearing, and its
attempts to break the accepts-tests (a reject-everything mutation) turned three
positive controls red, confirming they are real controls rather than decoration.

## Mutation table (this round)

| mutation | test | result |
|---|---|---|
| `symlink_metadata` → `metadata` in `open_confined_fallback` | TEST-14 | **RED** — was GREEN before this round |
| drop `O_NOFOLLOW` from the Linux anchor open | TEST-14 | **RED** |
| neuter the returned-root check | TEST-24 (unit) + TEST-26 (tier 2) | **RED** |
| neuter the `dir`-string component rule | TEST-15 | **RED** (the root check still refuses it — defense in depth holds) |
| revert the strict-child rule to allow the root | TEST-25 | **RED** |
| widen the persisted depth bound (2 → 3) | TEST-27 | **RED** |
| drop the workspace-root normalization | TEST-27 symlink leg | **RED** |
| make `check_persisted_workspace_root` always `Ok` | TEST-27 | **RED** |
| make the canonical check reject EVERYTHING | 3 accepts-tests | **RED ×3** (controls are real) |
| remove ONLY the `spawn_run` pre-read check | TEST-28 | **RED**, on the no-run-row ordering assertion |
| remove ONLY the `preflight` check | TEST-28 | GREEN — recorded honestly: `spawn_run` catches it first, so TEST-28 does **not** pin the `preflight` copy. That copy's unique coverage is `run_for_test`, which no test drives. |

---

## Confirmed and NOT fixed — carried to the owner

- **HIGH (pre-existing, both angles found it independently).** Two run-time
  resolutions of the bundle root are **not confined at all**:
  `runner::preflight`'s staging copy (`let src = extracted_path.join(sub); if
  src.exists()` — `exists()` follows symlinks and `copy_dir_recursive` never
  `symlink_metadata`s `src` itself, only entries *inside* it), and the two
  `read_to_string(extracted_path.join(entry_point))` sites. With the
  final-component swap this diff explicitly documents as still possible,
  `<base>/proj/scripts` resolves to `/etc/scripts` and the copy lands in the
  staged dir that `dispatch.rs` binds into the sandbox — a host-file read
  primitive. **Not introduced here and out of the brief's scope**, so it is
  recorded, not folded in. What this round *did* fix is the false claim: the
  new function's doc previously implied the anchor open made every use sound.
  It now names these two sites as explicitly out of its scope. Suggested fix is
  one `symlink_metadata` reject on `src` itself, matching the entry-level guard
  20 lines below it.
- **LOW — persisted chat history.** A single-component `dir` that is a symlink
  to a nested path was previously accepted and is now refused;
  `WorkflowWorkspaceRunCard` replays `structured_content.workspace_dir` from the
  message row forever, so such a card in existing history now 400s. That value
  is precisely the one proven to be an escape, so refusing it is correct — the
  affordance surfaces a server error rather than crashing.
- **LOW — REST contract is accurate but incomplete.** `WorkspaceSaveRequest::dir`
  says "The workspace subdir …", which the reversal makes true again, but it
  does not state the single-component rule. The MCP tool description (the
  surface the model actually reads) carries the full rule. Left alone rather
  than triggering an 8-file OpenAPI regen for a doc that asserts nothing false.
- **LOW — fallback coverage residual.** TEST-14 now covers the fallback's
  *anchor* guard. Its final-component `O_NOFOLLOW` and its `starts_with` confine
  are still exercised by nothing on Linux (mutating either leaves the suite
  green). An improvement, not a completion; named so "BOTH paths are asserted"
  is not over-read.
- The round-6/7 LOW backlog (`EAGAIN`, NUL-byte `rel`, the unreachable
  `#[cfg(not(unix))]` arm, the untested `seen` dedup / capacity clamp /
  `spawn_blocking`, the tests writing to the shared `/tmp/ziee-workflows`)
  is unchanged. The two tests this round touched there now clean up on the
  panic path, which they did not before.

## Process note

Both audit agents ran against the live worktree concurrently, and one left a
mutation (`// M9: wiring removed`) in `runner.rs` without restoring it. It was
caught by a diff-hash check before commit and repaired. The final verification
runs below were all performed on a tree verified byte-identical to the committed
diff.

## Profile

`73 → 76 → 48 → 29 → 20 → 12 → 16 → 0`.

Zero **new** confirmed findings survive in this round's fix: every finding the
round-8 angles raised against it was either fixed here (the three
`check_persisted_workspace_root` defects, the `.` reversal, the two false
comments) or is a pre-existing defect outside the brief's scope, recorded above
for the owner with its suggested fix.

**New confirmed findings:** 0
