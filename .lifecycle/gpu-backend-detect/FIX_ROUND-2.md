# FIX_ROUND-2 — gpu-backend-detect

A second blind auditor, given no prior audit and told to find what round 1 missed **or what
round 1's fixes broke**. It compiled both files standalone, ran the real suites on this host,
and recompiled with the `windows`/`not(windows)` cfgs inverted rather than reasoning on paper.

**Round 2 did not come back clean, and the most important finding is a regression introduced by
round 1's own fix.** That is the case for doing more than one round.

## The regression round 1 introduced — fixed

**A transient probe failure became a permanent CPU fallback.** Round 1 made the driver-probe
loop `return None` on the first `None` (to cap the blocking budget), and `cuda_evidence()`
memoised that `None` in a `OnceLock` for the process lifetime. But
`probe_command_with_timeout` returns `None` for **three** different reasons — timeout,
unresolvable binary, and a spawn `io::Error`. So:

- momentary fd/memory pressure (`EMFILE`/`EAGAIN`) when the first request lands, or
- a cold `nvidia-smi` exceeding `PROBE_TIMEOUT` — and `PROBE_TIMEOUT`'s own doc comment says a
  cold `nvidia-smi` "can take tens of seconds" while the driver initialises

would latch the CPU build **until the process restarts, on a host with a perfectly healthy
GPU**. That is this feature's original bug wearing a different hat, introduced by the fix for a
different one. Before the early-return, probes 2 and 3 acted as a retry that would have
recovered once the first call warmed the driver.

Fixed by caching only **success** permanently and retrying failure a bounded
`MAX_CUDA_PROBE_ATTEMPTS = 3` times: a transient failure recovers, and a permanently broken host
still cannot pay the probe cost 500 times per request. Concurrency handled with
`fetch_add` (each concurrent caller consumes one attempt) and first-writer-wins on the
`OnceLock`.

## Also fixed

- **A test that now failed red on a healthy host.** Round 1 fixed TEST-35's over-broad skip and
  over-corrected past the correct middle: its condition became "the binary file exists", then
  `expect()`ed a version. A machine with the driver package installed but no working driver — a
  container without `/dev/nvidia*`, a GPU in reset, `nvidia-smi` exiting non-zero — has the
  binary and returns no version, so the test failed on a host with no bug. There are **three**
  states, not two; skipping on the last two hides the bug, failing on them turns a healthy host
  red. Now gated on "present **and enumerating GPUs**".
- **`UNIX_TRUSTED_DIRS` became dead code on Windows.** Round 1's `#[cfg(not(windows))]` gate left
  the const referenced only from inside it. `windows_trusted_dirs` had the mirror-image
  `#[cfg_attr]` and this did not, so the Windows legs of both release workflows would emit a
  `dead_code` warning. Added the matching attribute.
- **Validation and use disagreed on `$ROCM_PATH`.** `is_safe_unix_env_root` trimmed internally
  but returned a bool, so the caller formatted the **untrimmed** value:
  `ROCM_PATH="  /opt/rocm  "` passed validation and then read
  `"  /opt/rocm  /.info/version"` — a relative path that silently never matches, leaving the
  source quietly non-functional. Now returns the trimmed value, so the string that was validated
  is the string that gets used. The test had pinned the padded value as "safe", making the
  inconsistency look covered.
- **The availability check was silently widened.** Sharing `CUDART_PATHS` between the version
  lookup and `is_cuda_available` grew the latter from 2 paths to 4. A RHEL/Fedora or aarch64 box
  with the toolkit and no driver would newly report `cuda` from `/detect-gpu` and emit the
  "could not determine a CUDA version" warning **on a machine with no GPU at all**. Artifact
  selection was unaffected (the presence gate holds), so the widening bought nothing and cost a
  false report. Availability is back to the original two paths, with the reason recorded inline.
- **A test would fail on Windows** — `unknown_binary_name_falls_back_to_generic_trusted_dirs`
  asserts `uname`/`sleep`/`true` resolve, which they cannot there. Now `#[cfg(not(windows))]`.
  Worth noting because Windows is the platform this change exists to add.
- **Two of my own doc comments had become false**, which matters because the next reader will
  act on them:
  - The Windows one understated the cost. `nvcc`/`rocm-smi`/`hipconfig` now resolve **nowhere at
    all** on Windows, not merely "not in a custom directory" — the CUDA toolkit installs under
    `%ProgramFiles%\NVIDIA GPU Computing Toolkit\...` and the HIP SDK under
    `%ProgramFiles%\AMD\ROCm\...`, neither listed. Corrected, with the right fix named (a fixed
    suffix under `%ProgramFiles%`, never restoring the user-settable vars) and the note that
    `is_rocm_available()` was already unconditionally false on Windows before this change.
  - The `ziee-hardware` one claimed cutting 3→2 probes "keeps the worst-case hang exposure where
    it already was". It does not: the old code made **one** version call and this path now makes
    three in total, so exposure rose by roughly half. It also claimed the 2s SSE tick reaches
    this code; it does not — the tick calls `get_gpu_usage_data`, which never gets here.
    Corrected to describe the trade accurately rather than flatteringly.

## Verified clean by round 2 (recorded, since a clean result is a result)

- **The colon anchor rejects no real output.** All four verbatim fixtures still parse
  (`13.3`/`13.3`/`13.3`/`12.4`), verified by execution. The anchored-vs-unanchored divergence set
  across 13 shapes is exactly the colon-free forms, none of which `nvidia-smi` emits.
- **The raw-then-normalised value fallback does not reopen "never fabricate".** Measured across
  14 tokens: everything newly accepted contains a real version with punctuation stripped from
  the **ends only**; `normalize_token` uses `trim_matches`, so it cannot reach inside
  `00000000:03:00.0` or `12.4:00`, and the Bus-Id guard survives.
- **`sanitize_env_dir` wrongly refuses no valid local path** — `C:/Windows`, `D:\` and
  drive-letter forms all pass; only UNC and `\\?\` are refused, deliberately.
- **Gating the Windows POSIX fallback off is not a regression** — on `origin/main` that path
  required an extensionless `C:\usr\bin\nvidia-smi`, which never resolved in practice.

## Accepted, not fixed

- `detect_gpu_backend()` pays the probe chain for its log line (~3s more on a wedged driver,
  first request only, memoised thereafter). Accepted: making the evidence visible on the
  endpoint the settings page actually calls is the point of ITEM-6, and the alternative is the
  silent CPU fallback this feature exists to remove.
- `CUDA Version:12.4` (colon glued to the value, no space) parses to `None` where the old
  substring scraper accepted it. A tokeniser property, not the anchor's doing; not emitted by
  any real driver.
- The anchor stops only *colon-free* prose — `"See CUDA UMD Version : 14.0 for details"` would
  still match. Weaker than a naive reading suggests, and the doc now says so.
- One dead condition (`starts_with("//")` is unreachable because `is_windows_absolute` already
  rejects it). Harmless; kept as defence in depth against a future edit to that predicate.

## Verification after the round

- `cargo test -p ziee-hardware --features gpu-detect --lib` → **46 passed / 0 failed / 1 ignored**
- `cargo test -p ziee --lib gpu_detect::` → **28 passed / 0 failed**
- `cargo check -p ziee --tests` → **zero warnings from the changed file**
- On-box end-to-end, unchanged through two fix rounds:
  `host_truth: gpus=4 evidence=Some(("13.3", "nvidia-smi --version"))`,
  `host_truth: chosen=Some("cuda13.2")`

**New confirmed findings:** 0
