# FIX_ROUND-4 — workflow-prompt-validation

Input: two blind agents against the round-3 tree — **42 rows: 29 confirmed,
13 rejected**.

**Artifact gap, recorded rather than papered over:** this round's two per-agent
ledger files were overwritten by the round-5 agents (both rounds wrote to the same
scratch filenames) before they were copied into this directory, so unlike rounds
1-3 and 5 there is no `ledger-round4-*.jsonl` and `LEDGER.jsonl` does not contain
its rows. The findings themselves are recorded below and every one of them is
either fixed in the diff or listed under rejections; what is lost is the
machine-readable form. The scratch filenames are now round-scoped.

Both agents ran mutations rather than reasoning, and between them they found
that the kernel confinement round 3 added was **anchored on a lookup the
attacker owns**, and that the guards it added had **no test**.

---

## The anchor was swappable, so the confinement meant nothing

`open_confined` passed `RESOLVE_BENEATH`, but the directory it resolved beneath
came from `std::fs::File::open(root)` — which FOLLOWS symlinks. For the workspace
surfaces the LAST component of `root` sits inside the directory bwrap
bind-mounts read-write at `/home/sandboxuser`, so a sandbox step doing
`mv flow flowbak && ln -s / flow` re-anchors every later resolution at `/`.
`prompt_file: "etc/passwd"` then reads the host file — no race, and it walks
straight through the absolute-path ban, because "relative to `/`" is not spelled
absolutely. The agent verified it against the live 6.8 kernel with a C probe
using the exact flag/resolve combination.

→ The anchor open now uses `O_NOFOLLOW | O_DIRECTORY`. **TEST-14** pins it and is
proven falsifiable twice over: reverting the anchor flags turns it red, and
cfg-disabling `openat2` so the fallback serves every call ALSO turns it red —
which incidentally closes the other agent's separate "nothing pins the 45 lines
of openat2" finding.

## `RESOLVE_NO_SYMLINKS` was making the two platforms disagree

It refused symlinks that stay INSIDE the bundle, which the non-Linux fallback
accepts. A bundle using an in-bundle symlink would install on macOS and be told
on Linux that it "resolves outside bundle" — a false security verdict.
`RESOLVE_BENEATH` is the confinement and the kernel enforces it on symlink
targets, so `NO_SYMLINKS` was strictly extra strictness with a wrong message.
Dropped.

## The guards had no test, and two of them cannot be told apart

The agent deleted the type check, both size checks and the bounded read in one
mutation: **52 passed, 0 failed**.

→ **TEST-12** exercises each against a real file of the offending kind (a real
`mkfifo` FIFO — the test RETURNING is the proof, a hang is the regression; a
directory; one byte over the cap; exactly at the cap). **TEST-13** covers the
shape rejects, including the two non-Unix ones nothing pinned.
→ Honest limit, measured and now stated in the test's own doc: for a STATIC file
the fstat size reject and the post-read size reject are **mutually redundant** —
delete either alone and the other still refuses. They guard different things and
only a file that changes size mid-read separates them, which a unit test cannot
construct. The test claims the property (nothing over the cap is returned), not
that each guard is individually falsifiable.
→ `Vec::with_capacity(meta.len())` trusted a file-reported size for an
allocation; clamped.

## Blocking reads on the tokio runtime

`check_prompt_files` reads up to 1 MiB per step with `std::fs`, and
`validate_for_install` was called straight from `async fn spawn_run` /
`resume_run`. The dispatch side had been carefully wrapped in `spawn_blocking`;
the validator side had not.

→ `validate_for_install_async` added; both runner sites converted. The draft
handlers pass a non-existent bundle root and read nothing, so they stay sync.
(Round 5 found five MORE async callers this missed — see FIX_ROUND-5.)

## Smaller confirmed fixes

- Three production comments cited `.lifecycle/…` paths. `merge-gate.mjs` C5 does
  `git rm -r .lifecycle` on the way to main, so those citations would dangle in
  shipped source. Rewritten to carry the reasoning themselves.
- `PromptFileError::Unsafe`'s message always said "without '..'" even for a
  backslash or drive letter; it now names the actual rule, and the author-facing
  copy for the code was widened to match (`HUMAN_COPY` REPLACES the backend
  message, so anything only the backend says is never seen).
- `TooLarge` had no test driving the VALIDATOR to a verdict — only
  `read_prompt_file`'s error. Added to TEST-3.
- `StepConfig::prompt_source()` was dead while its doc told callers to prefer it;
  now used by the validator and pinned in the matrix by an equality assertion
  against the free function.
- `PromptFileError::code()`/`layer()` were dead AND a second encoding of
  `prompt_file_finding`'s mapping — the duplication this branch exists to
  delete, reintroduced by round 1's own fix. Removed.
- Two test comments claimed more than they proved: the `escapedir` fixture is
  caught by the fallback too (what it pins is that the confined path agrees), and
  the visual spec's RTL rows catch the group-root revert while the LTR rows catch
  the addon revert — each direction catches a different half, which was measured.

## Explicit rejections

- **"The CI narrowing drops 17 Layer A specs."** Recorded as a coverage finding
  and answered in the workflow with a named follow-up listing the specs that must
  go green before they can be re-added — not silently dropped. The alternative
  was a job that cannot pass for anyone.
- **`prompt_source(&Option, &Option)`'s swap hazard.** Real, and the reason
  `StepConfig::prompt_source()` exists; the free function stays because
  `dispatch` legitimately holds the two values separately (the `llm_map` path
  clones them out of the config before the loop).
- **`read_prompt_file` belongs in `file_io.rs`.** Defensible; the validator owns
  the `WorkflowDef` vocabulary and every other `check_*`, and the runner already
  depends on `validate::` for `StepConfig` itself.

**New confirmed findings:** 29
