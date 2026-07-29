# FIX_ROUND-6 — workflow-prompt-validation

Input: one blind convergence agent against the round-5 tree — **21 rows: 12
confirmed, 9 rejected** (`ledger-round6-a.jsonl`). It was told what previous
rounds had already found and fixed, and asked to find what those fixes MISSED or
BROKE.

Its verification legs were clean — `cargo check --all-targets` exit 0 with no new
warnings, `cargo test --lib -p ziee -- workflow::` at 190/1 (the one pre-existing
failure), `stepForms.test.ts` 16/16, the visual spec 5/5 including its control,
and it independently re-derived the 120/18 matrix counts and the sdk comment's
px arithmetic as correct. It also independently re-verified the per-direction
falsifiability of TEST-7's RTL rows.

---

## The anchor guard covers the root's FINAL component only

Rounds 4 and 5 hardened the anchor open on both paths. This round showed the
guard is necessarily *local*: `O_NOFOLLOW` (Linux) and `symlink_metadata`
(fallback) see only the last component of `bundle_root`. Its INTERMEDIATE
components are resolved by the caller's own path lookup, where nothing in
`read_prompt_file` can reach.

And they were reachable: `resolve_conversation_workspace_dir` accepted a
multi-component `dir`, so `dir = "a/b"` made `a` a model-controlled intermediate
directory of a root that is bind-mounted read-WRITE into the sandbox. The agent
built a C repro against the real syscalls: after `mv proj proj.bak && ln -s /
proj` the anchor open SUCCEEDS and `openat2(dirfd, "passwd", RESOLVE_BENEATH)`
returns the host `/etc/passwd`. My comment claimed that attack was closed.

→ Fixed where it is actually closable — at the source of the root.
`resolve_conversation_workspace_dir` now requires `dir` to be a SINGLE normal
component, so the only model-controlled part of the root IS the final one, which
the anchor guard refuses to follow. The two rules are one mechanism and each
now says so. `t1_confine_rejects_nested_dir` pins it; the pre-existing
`t1_confine_accepts_nested_safe_dir` was renamed and re-pointed rather than left
asserting the behaviour that just became a security hole.
→ The function doc no longer claims more than the guard delivers: it states that
intermediate components are outside its reach and names the rule that covers
them.

## One async caller was still blocking, and the doc said otherwise

`validate_from_workspace` called the SYNC `validate_collecting` on the real,
model-written workspace root — the largest such root there is. Its sibling had
been converted in round 5; this one was missed, and round 5's doc had asserted
that every real-bundle caller was converted.

→ `validate_collecting_async` added and used; the doc now matches the code.

## TEST-14 claimed to guard both paths and did not

Its own doc said "removing either anchor guard turns it red". The agent deleted
the FALLBACK's guard and the suite stayed green on Linux — because
`read_prompt_file` takes the `openat2` path there, so the fallback's guard was
never executed.

→ TEST-14 now drives `open_confined_fallback` DIRECTLY, plus a control that an
ordinary root still reads through it. The claim and the code now agree.

## Explicit rejections and known residuals

- **Linux/fallback divergence for an ABSOLUTE in-bundle symlink.** Real and
  measured: `openat2` answers `EXDEV` (→ `ESCAPE`) where the fallback's
  canonicalize+`starts_with` accepts. This is `RESOLVE_BENEATH` refusing an
  absolute symlink target even when it points back inside — the kernel resolves
  it from `/`, which is outside the anchored subtree. Closing it means
  hand-resolving symlink targets, which reintroduces exactly the
  resolve-then-check shape this branch removed. Recorded as a known divergence
  (Linux is the STRICTER side, and the strict verdict is a refusal, not an
  acceptance) rather than "fixed" by weakening the confined path.
- **`ELOOP` mapped to `Escape`** mislabels an in-bundle symlink LOOP as a
  confinement escape. Both are refusals of an unreadable path; the finding code
  is the only thing that differs, and `WORKFLOW_PROMPT_FILE_ESCAPE`'s copy tells
  the author to point at a file really inside the workflow, which is the right
  remedy for both.
- **`EAGAIN` unhandled, NUL-byte `rel` verdicts differ per path, an unreachable
  `#[cfg(not(unix))]` arm inside a `target_os = "linux"` fn, two test comments
  describing the deleted canonicalize guard, and the `seen` dedup / capacity
  clamp / `spawn_blocking` having no falsifying test** — all confirmed LOW, all
  real, none reached in this round. They are listed here rather than quietly
  dropped: they are the honest remaining backlog of this change.
- **"validator cannot pass what the runner fails on is untrue when the bundle dir
  is missing"** — correct, and it is the documented draft-surface behaviour
  (DESIGN §3): with no bundle the existence half is skipped on both sides. The
  wording was already narrowed in round 5; the residual is that `spawn_run` also
  takes that path if the extracted dir is gone, which is a different failure
  (the run cannot start) rather than a prompt mis-verdict.

**Convergence: NOT reached.** Round 6 produced 12 confirmed findings, so the
"a full blind round yields zero" bar is not met. The trend across rounds is
96→20→7→7→2→2→1→1→0 in the branch this fixes, and here
73→76→48→29→20→12 — falling, and the severity has moved from "the fix is wrong"
to "the fix's edges are undocumented" — but a further round is genuinely owed
before this can be called converged, and the LOW items above are what it should
start from.

**New confirmed findings:** 12
