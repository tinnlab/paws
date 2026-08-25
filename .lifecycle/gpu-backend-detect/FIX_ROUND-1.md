# FIX_ROUND-1 — gpu-backend-detect

Two blind auditors, briefed independently and told not to read `.lifecycle/`, audited
`origin/main...HEAD` plus the sdk diff across seven correctness categories and nine
security/test-quality categories.

**They earned their keep.** The round produced **two HIGH findings, both defects this change
introduced**, one of which is a security regression and one a build break on a platform that
has no CI coverage here. Neither was visible from inside the work.

## HIGH — fixed

- **`C:\usr\bin` binary planting (Windows).** `resolve_system_binary`'s `#[cfg(windows)]` block
  only `return`ed on a hit and then fell through to `UNIX_TRUSTED_DIRS`. On Windows those POSIX
  paths are not inert: `PathBuf::from("/usr/bin").join("nvidia-smi.exe")` resolves against the
  current drive as `C:\usr\bin\nvidia-smi.exe`, and the default `C:\` DACL lets an unprivileged
  user create that directory and own its contents. The server would execute an attacker-planted
  binary as its own user and parse its stdout as the host CUDA version. **Newly reachable —
  adding `EXE_SUFFIX` is precisely what armed it**, since the old resolver joined a bare,
  unlaunchable name. It also bypassed the `USER_SETTABLE` split entirely, needing no environment
  control at all. Fixed: the Unix scan is now `#[cfg(not(windows))]` and the Windows branch
  `return`s `None`, with the reasoning in the doc comment so it is not undone.
- **macOS Rust build break.** `get_cuda_version()` is defined only under
  `#[cfg(not(target_os = "macos"))]`, but the compute-capability fix calls it from
  `detect_nvidia_gpus`, which is gated on the `gpu-detect` **feature** with no OS gate. The
  `aarch64-apple-darwin` / `x86_64-apple-darwin` legs of `desktop-release.yml` would fail to
  compile, and **macOS CI runs no Rust at all** (it is TypeScript-only), so this would first
  surface at a release tag. Fixed by adding the macOS counterpart returning `None`.
  ⚠ **Verified by construction, not by compilation** — both `cfg` arms now exist with identical
  signatures, but no Darwin target is installed and a macOS build is out of scope per the
  owner's standing constraint. What would actually verify it is
  `cargo check --target aarch64-apple-darwin`, which needs a target std not present here.

## MEDIUM — fixed

- **A user-settable env var could execute code.** The `name != "nvidia-smi"` split protected
  which *answer* was trusted, not which *binary* was executed. `rocm-smi` is spawned
  unconditionally from `detect_all()` on Windows, so `%HIP_PATH%\bin\rocm-smi.exe` was arbitrary
  code execution for anyone able to set one environment variable — the same class F-14 closed.
  Fixed by removing `CUDA_PATH`/`HIP_PATH`/`ROCM_PATH` from executable resolution entirely. The
  cost is named rather than hidden: a Windows `nvcc` in a custom toolkit directory is no longer
  found; `nvidia-smi` lives in `%SystemRoot%\System32` and is the primary source, so CUDA
  detection is unaffected.
- **UNC paths were accepted — and a test asserted they should be.** `\\attacker\share` is
  absolute and `..`-free, so `sanitize_env_dir` passed it, yielding a remote binary executed
  over SMB with NTLM authentication to the attacker's host. TEST-29 positively asserted
  `\\server\share` was accepted, **pinning the worst case instead of guarding against it** —
  the failure mode where a test entrenches a defect. Fixed: UNC and `\\?\` forms refused, and
  the test inverted to assert refusal.
- **The loud warning fired on a false positive and then went silent.** A build-pending release
  row (no assets for this platform) yields `available=[]` → `chosen=None`, which the predicate
  read as a CPU fallback. It emitted a factually wrong warning (nothing was selected) **and
  spent the one-shot latch**, silently swallowing the genuine occurrence later in the process —
  defeating INV-2 outright. Since `recommend_backend` runs once per catalogue release, this
  fired routinely. Fixed: an empty published set is not a verdict.
- **Blocking budget on an async handler grew ~3×.** On a wedged `nvidia-smi`, the driver-probe
  loop paid `PROBE_TIMEOUT` once per flag variant before moving on — ~18s of a wedged tokio
  worker versus ~6s before, on the exact host this feature targets, and these calls are made
  synchronously from `async fn` with no `spawn_blocking`. Fixed: a probe returning `None`
  (spawn failure or timeout) now aborts the remaining `nvidia-smi` variants, because retrying
  the same unusable binary with different flags cannot succeed.
- **ROCm read a library version as if it were the release version.** Source 4 tried
  `rocm-smi-lib version` before `rocm version`; `ROCM-SMI-LIB` is decoupled from the ROCm
  release (ROCm 6.x ships `librocm_smi64.so.7`), so a ROCm 6 host would report major 7. Harmless
  only until a `rocm7.*` artifact exists, at which point it installs a build that cannot load —
  the exact outcome DEC-11 refuses to risk. Fixed by dropping the lib key entirely rather than
  demoting it.
- **`Nvml::init()` once per GPU.** The hoisted-out-of-the-loop mistake: an 8-GPU host performed
  9 NVML initialisations per `GET /api/hardware/info`, request-synchronously. Fixed.
- **Three unbounded `nvidia-smi` spawns where there had been one.** `ziee-hardware` has no
  timeout wrapper at all, and this path is reached from `GET /api/hardware/info` and the 2s SSE
  tick, unmemoized. Cut to two probes so the worst case is no worse than baseline. The missing
  timeout itself is pre-existing and explicitly deferred — see "open".
- **A test skipped green on the bug it guards.** TEST-35's condition collapsed "nvidia-smi
  absent" with "nvidia-smi present but no version parsed"; the second *is* the reported defect,
  so against the old parser on this host it reported a skip rather than a failure. Fixed to
  distinguish the two and `expect()` the version once the binary resolves.

## LOW — fixed

- Prose containing the key could yield a **wrong number**: an unanchored match on a future
  `... removed in CUDA version 14.0.` phrasing would return `14.0` on a 13.3 host and select a
  `cuda14.x` artifact that cannot load. CUDA keys now require a real `label : value` anchor;
  `nvcc`'s colon-free `release 13.3,` keeps the unanchored matcher.
- A value glued to a table border (`12.4|`) returned `None` where the old scraper accepted it —
  a needless regression from comparing normalised key tokens but parsing the raw value token.
  Fixed by trying both.
- `MajorMinor::to_string()` could emit `13.x` into a field the UI renders verbatim, and would
  have made TEST-35's round-trip assertion fail rather than skip. Now emits a bare major.
- TEST-37 would false-fail on an NVIDIA host with a CUDA-11 driver, where `cpu` is the correct
  answer. Now asserts non-`cpu` only when a compatible artifact is actually published.

## Rejected after verification (recorded because a clean result is a result)

- **Panics on multi-byte UTF-8**: none. `str::find` returns the byte index of the *start* of the
  matching char, so every slice in `parse_version_token` is boundary-aligned; all other indices
  are length-guarded.
- **`OnceLock` deadlock/re-entrancy**: none. The lock graph is a strict DAG with no back-edges
  and no closure re-enters its own lock — including the subtle safe case where
  `recommend_backend` calls `is_cuda_available()` and then re-enters it from inside
  `cuda_evidence`'s initialiser.

## Open — reported, deliberately not fixed here

- **`gpu-detect` is not a default feature and `ziee-hardware` is not a `src-app` workspace
  member**, so no standard command in this repo compiles or runs TEST-35/36. Confirmed with
  `cargo test -p ziee-hardware --lib -- --list`. Phase 8 therefore runs and documents the
  explicit `--features gpu-detect` invocation. Making it a default feature changes what every
  build links and belongs in its own change.
- **Skip announcements use `eprintln!`**, which `cargo test` discards on a passing test, so a
  GPU-less runner reports `ok` with no signal. Phase 8 uses `--nocapture`. A durable fix needs a
  convention this repo does not have.
- **`ziee-hardware` has no subprocess timeout**, on a path reached from a request handler and a
  2s SSE tick. Pre-existing and genuinely worth fixing; porting `probe_command_with_timeout`
  touches every probe in that file.
- The per-call `debug!` prints `Some((13, 0))` for an unknown minor, contradicting the `info!`
  line that renders `13.x`. Log-only; the fabricated minor stays unobservable in selection.
- TEST-30 is vacuous on non-Windows (what it guards is `#[cfg(windows)]`-only). Kept: it still
  serves its stated purpose of stopping the two timeout tests from silently no-op'ing.

## Verification after the round

- `cargo test -p ziee-hardware --features gpu-detect --lib` → **46 passed / 0 failed / 1 ignored**
- `cargo test -p ziee --lib gpu_detect::` → **28 passed / 0 failed**
- On-box end-to-end unchanged: `gpus=4`, `evidence=("13.3", "nvidia-smi --version")`,
  `chosen=Some("cuda13.2")`

**New confirmed findings:** 0
