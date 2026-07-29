# FIX_ROUND-5 — workflow-prompt-validation

Input: two blind agents against the round-4 tree — **37 rows: 20 confirmed,
17 rejected** (`ledger-round5-{a,b}.jsonl`).

Round 5 is where the curve turned: the design-conformance agent walked DESIGN §1's
whole table and found **every row genuinely closed**, ran nine mutations and had
**eight of them caught**, and confirmed §3's out-of-scope list holds. What it and
the security agent still found were the far side of the same fix — the FALLBACK
path, and one over-strict flag.

---

## The fallback had no anchor guard, so the fix only held on Linux ≥ 5.6

Round 4 hardened the `openat2` anchor. `open_confined_fallback` — used on every
non-Linux host and on Linux without `openat2` — still computed
`root_canon = root.canonicalize()` at read time, so a swapped root made `canon`
and `root_canon` BOTH resolve under the attacker's target and `starts_with`
passed. My own doc argued this was acceptable "because the untrusted writer runs
on a Linux kernel on all three host platforms" — which the agent correctly called
a non-sequitur: the confinement is performed by the SERVER's kernel, not the
sandbox guest's. The proof it was unguarded rather than merely undocumented:
TEST-14 is `#[cfg(unix)]`, so on macOS it would not have guarded the fallback, it
would have FAILED against it.

→ The fallback now refuses a non-directory or symlinked anchor first
(`symlink_metadata`, which does not follow the last component). TEST-14 now
guards both resolution paths, which is why cfg-disabling `openat2` leaves it
green while removing EITHER anchor guard turns it red.
→ The doc no longer argues the gap away: it states which window remains (a racing
INTERMEDIATE swap, which nothing short of a single confined resolution closes).

## `O_NOFOLLOW` in `how.flags` was a third undisclosed re-verdict

Both agents found it independently, one with a syscall-level probe: it applies to
the FINAL component, so ANY final-component symlink — including one pointing at a
file inside the bundle — returned `ELOOP`, mapped to `Escape`, and told the author
their prompt file "ends up outside the workflow". False, and the non-Linux
fallback still accepted the same bundle. DESIGN §1 lists exactly two introduced
re-verdicts "so they are part of the design rather than a side effect"; this was
a third, unlisted one.

→ Removed. `RESOLVE_BENEATH` is the confinement and covers symlink targets, so
Linux and the fallback now agree about what a valid bundle is.

## Docker's seccomp profile would have failed every prompt file

Only `ENOSYS` fell back. A seccomp filter that does not list `openat2` — Docker's
default profile predates it — answers `EPERM`, which would have refused every
`prompt_file:` in such a deployment with copy blaming the author's file.

→ `EPERM` falls back too.

## The per-file cap was defeated by pointing N steps at one file

`check_prompt_files` read per STEP. Fifty steps pointing at one 1 MiB file bought
fifty megabytes of reads — on every install AND every launch — reinstating a 50×
multiple of the work `MAX_PROMPT_FILE_BYTES` exists to bound, from ~1 KB of
authored YAML.

→ Reads are memoized per path within a validation. The verdict is identical
either way, so this removes amplification and nothing else.

## Five more async callers were still blocking

Round 4's doc claimed only `spawn_run`/`resume_run` passed a real bundle. Wrong:
hub install, both dev handlers, and `workflow_mcp`'s two workspace verbs — which
carry the LARGEST such root of all, the conversation's sandbox workspace — all
still called the blocking sync form from `async fn`.

→ All converted; the wrapper's doc now enumerates them correctly and states what
is deliberately left on the sync form (the draft handlers, which read nothing).

## `WORKFLOW_PROMPT_FILE_UNSAFE`'s copy had not followed its own widening

The same round that widened the shape check to backslashes and drive letters left
its author-facing copy saying only "a location elsewhere on the machine". Because
`HUMAN_COPY` REPLACES the backend message, `PromptFileError::message`'s
explanation never reached the author — the exact defect ITEM-13 fixed on the
sibling code, left open on the code that round widened.

→ Copy widened, with the reasoning recorded beside it.

## Explicit rejections

- **"V3: reverting `inline-start` + `command.tsx` to physical is not caught."**
  True and already disclosed in the spec's own header: the gallery renders no
  `inline-start` addon with a button child and no `kbd` addon, because no consumer
  in this tree does. The probe is written over both aligns so those cells are
  measured the moment such a consumer appears. Fixing it properly means adding a
  kit consumer, which is a kit change outside this branch.
- **"`ran_ok == 18` is the load-bearing guard, not the implication."** Correct, and
  it is now stated in TESTS.md's known-limits section rather than left implied.
  Deleting a rule from the SHARED function leaves both sides agreeing — that IS
  what the invariant says; the rules themselves are pinned by TEST-2/3/6/12/13.
- **`pub` wider than any consumer on the new items.** They sit beside
  `validate_collecting` and `parse_workflow_yaml`, which are `pub` for the same
  in-crate reasons; consistency with the file beat a narrowing with no caller
  change.
- **`job_kind_parses_round_trips_and_is_orthogonal`** — `models.rs` and
  `job_kind.rs` are byte-identical to the base blob; the failure is a `JobKind`
  serde variant-name mismatch (`subagent` vs `sub_agent`) with no relation to
  prompts. Pre-existing on the integration line, reported onward, not silenced.

**New confirmed findings:** 20
