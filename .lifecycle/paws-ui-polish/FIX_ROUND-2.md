# FIX_ROUND-2 — paws-ui-polish

Fixed round 1's single new finding, then re-audited **round 2's own diff**
(`correctness`, `design-conformance`, `tests-quality`).

## Fixed from round 1

- **`LocalDeployment::start()`'s bare `contains_key` bricked a model after an
  out-of-band engine death.** A dead child's stale map entry refused every
  restart with `Model instance already running`; because `ensure_running` counts
  a failed start as a crash, a few retries tripped the flap cap and marked the
  model `failed`. Now the entry is reaped with `try_wait()` and replaced when the
  child has exited. Pinned by `g2b_…`, verified RED against the revert
  (reproduced `marked failed (flap protection)`).

## New confirmed findings in round 2's diff

**1 — a misleading `WARN` on the exact failure path this branch is about.**
`status()` reaps an exited child (that is how it stops reporting a zombie as
running), and `do_start`'s fail-fast calls `status()` and then `stop()`. Killing
an already-reaped child fails with `InvalidInput`, which `stop()` logged as
`Failed to kill process for model …` — a warning that reads like the teardown
went wrong, on the one path where the engine had already exited cleanly on its
own. Since that path IS the corrupt-model case, the misleading line would land in
exactly the logs someone reads while diagnosing it. `stop()` now asks
`try_wait()` first and returns early with an informational line instead.

**2 — two settings tests asserted the retired 30s default.**
`settings_test::{get_returns_defaults, partial_patch_preserves_other_fields}`
both hard-coded `auto_start_timeout_secs == 30`. This is a real consequence of
DEC-14, not a flake: they were updated to 180 with a comment naming the migration
and the measurement behind it, so the next reader does not "fix" them back.

A sweep for other places assuming 30 found none: every remaining
`auto_start_timeout_secs: 30` in the tree belongs to the **voice** module's own
separate whisper-runtime settings, and the `600s` ceiling references (and the
660s client timeout that must exceed it) are unaffected by moving the default.

## Considered and NOT recorded as findings

- **`status()` now takes a write lock where it took a read lock.** Deliberate —
  `try_wait()` needs `&mut Child`, and there is no honest liveness answer without
  reaping. Assessed rather than assumed: the critical section is a `HashMap`
  lookup plus a non-blocking `waitpid`, both microseconds, and every caller
  follows it with an HTTP health check or a DB query that dominates it by orders
  of magnitude. Recording this as a defect would be manufacturing a finding.

## Suite state

`llm_local_runtime::` — **80 passed, 2 failed**, both Category A per CLAUDE.md's
known environment floor and unrelated to this diff:
`model_files_real_test::real_hf_download_creates_model` (`tests/.env.test`
contains no `HUGGINGFACE_API_KEY` at all — verified, not assumed) and
`gold_smoke::real_release_download_and_infer` (env-gated on a real
`llama-server` + GGUF). `lifecycle_test::provider_instances_lists_running` failed
once under `--test-threads=4` and passed in isolation and on re-run — a
parallel-run artifact, named rather than silently re-run.

**New confirmed findings:** 2
