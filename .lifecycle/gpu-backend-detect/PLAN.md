# PLAN — gpu-backend-detect

## Design source

`/data/khoi/home-workspace/paws-worker-tasks/gpu-detect.md` (the owner's task), plus the
owner's framing quoted in it:

> *"We have to make it dynamic here, as it should work for Mac and Windows as well."*

and its explicit bar:

> *"When detection is uncertain, fail loudly rather than silently downgrading. The worst
> property of this bug is that CPU fallback is indistinguishable from a correct choice."*

Scope decisions taken with the owner before implementation: **backend + logs only** (no
`src-app/ui/**`, no wire-type change); **both copies of the parser fixed sharing one
implementation**; **on-box proof via a self-skipping host-truth test + the Linux debug build**
(no second server, no GPU allocation).

Supporting evidence captured on the live host is in `BASE.md`.

## Problem

`src-app/server/src/modules/llm_local_runtime/utils/gpu_detect.rs:270`:

```rust
let idx = stdout.find("CUDA Version:")?;
```

Driver 610.43.02 prints `CUDA UMD Version: 13.3` in the banner and never the literal
`CUDA Version:`. So `parse_cuda_smi_version` → `None` → `detect_cuda_version()` → `None` →
`recommend_backend_for` skips its CUDA branch → `cpu`. Four H200s sit idle while a 9B model
runs on CPU, with no error and no warning.

The defect class is broader than the literal, and that breadth is the scope:

1. **Brittle by construction** — one vendor tool's human-readable banner, in which NVIDIA has
   already marked both `Driver Version` and `CUDA Version` *"will be removed in CUDA 14.0"*.
2. **Silent** — nothing logs the selection decision at all; ROCm has the identical
   "available but versionless → cpu" hole.
3. **Not only Linux** — on Windows `resolve_system_binary` has Unix-only paths and no `.exe`,
   so `nvidia-smi` never resolves and CUDA is never detected at all.
4. **Duplicated** — `sdk/crates/ziee-hardware/src/detection.rs:201` repeats the same scrape,
   unvalidated, and renders the raw token to the user.

### One premise of the task corrected by measurement

The task suggests `nvidia-smi --query-gpu=... --format=csv` as a machine-readable **version**
source. It is not one: `--help-query-gpu` shows no CUDA-version field; the only version it
offers is `driver_version`. The genuine machine-readable source is `nvidia-smi --version`
(`CUDA UMD version : 13.3`). `--query-gpu` is used here for GPU **presence** instead — which is
what prevents a stray toolkit install from being mistaken for a working GPU.

## Items

- **ITEM-1**: New shared, dependency-free pure-parser module `sdk/crates/ziee-hardware/src/gpu_version.rs` exporting `MajorMinor { major, minor: Option<u32> }`, `parse_version_token`, and a case-insensitive whitespace-**token-subsequence** matcher `find_labeled_version`. Not behind the `gpu-detect` feature, so `ziee` can use it unconditionally. Token-subsequence rather than substring or `split_once(':')` because the legacy 550 banner packs three `key: value` pairs into one pipe cell, so the first `:` belongs to `Driver Version`.
- **ITEM-2**: Rewrite `parse_cuda_smi_version` over that matcher so ONE parser covers all three `nvidia-smi` surfaces — bare banner, `--version`, `-q` — tolerating the adjacent-colon (`CUDA UMD Version: 13.3`), detached-colon (`CUDA UMD version    : 13.3`) and bracket-suffixed (`13.3 [Deprecated; …]`) shapes, preferring key `cuda umd version` over the legacy `cuda version`, and **continuing the scan** past a key match whose value fails to parse (driver 610 prints the prose `see "CUDA UMD version" instead` two lines *above* the real value).
- **ITEM-3**: Toolkit-derived parsers `parse_nvcc_version` (`release 13.3,`) and `parse_cudart_soname` (`libcudart.so.13.3.29` → 13.3; `libcudart.so.13` → major-only), plus `parse_rocm_dir_name` (`rocm-6.1.2` → 6.1).
- **ITEM-4**: NVIDIA **presence** probe via `nvidia-smi --query-gpu=name --format=csv,noheader`, memoised. Gates whether toolkit-derived evidence may be trusted: `is_cuda_available()` currently returns true from `libcudart.so` existence alone with no driver check, so without this gate a stray toolkit install would newly (and wrongly) select a CUDA artifact.
- **ITEM-5**: Ordered evidence-carrying CUDA probe chain — `nvidia-smi --version` → banner → `-q` → (presence-gated) `nvcc --version` → `libcudart` soname — carrying a `CudaVersionSource` and memoised in a `OnceLock`. Memoisation also fixes a real defect: `recommend_backend` is called per release row inside `.map()` at **three** hot sites — `llm_local_runtime/binary_manager.rs:287`, `:407`, and `voice/binary_manager.rs:140` (up to 500 rows each) — and `detect_cuda_version()` is currently unmemoised, so `nvidia-smi` is re-spawned once per row per request. *(Corrected at phase 2: the first draft named only two sites. The audit also established the premise is stronger than stated — `/usr/local/cuda/lib64/libcudart.so` exists here, so `is_cuda_available()` short-circuits true at `gpu_detect.rs:396` without spawning nvidia-smi at all, which makes the unmemoised `detect_cuda_version()` the ONLY spawn.)*
- **ITEM-6**: Decision logging. `INFO` naming the detected version **and its source**; `WARN` when a GPU is present but no version could be read, listing every source tried; `WARN` (once, atomic latch) when a GPU is present and the `cpu` artifact was still selected, printing the detected versions and the published tag list so the parser-bug case and the legitimate "only `cuda14` published" case are distinguishable; `DEBUG` carrying the full per-row decision.
- **ITEM-7**: Cross-platform `resolve_system_binary` — append `std::env::consts::EXE_SUFFIX`; derive Windows dirs from **environment** (`%SystemRoot%\System32`, `%ProgramW6432%`/`%ProgramFiles%\NVIDIA Corporation\NVSMI`, `%CUDA_PATH%\bin`, `%HIP_PATH%\bin`) with absolute-path and no-`..` validation; scope the attacker-plausible `CUDA_PATH`/`HIP_PATH` to `nvcc`/`rocm-smi`/`hipconfig` only so the authoritative `nvidia-smi` probe cannot be redirected; delete the dead `dir/usr/sbin/name` branch (it builds `/usr/bin/usr/sbin/…`, which can never exist) and the duplicated `/usr/local/bin`. Signature unchanged; selection becomes name-aware internally.
- **ITEM-8**: ROCm fallback chain with the existing `/opt/rocm/.info/version` **first and byte-identical**, then `.info/version-dev`, `fs::canonicalize("/opt/rocm")` → dir name, `rocm-smi --version`, `hipconfig --version`, `$ROCM_PATH`. Memoised and logged like CUDA. **No major is ever guessed** when every source is silent: `recommend_backend_for` requires an exact ROCm major match, so a wrong guess loads a broken build — strictly worse than CPU. The correct output for that state is the warning.
- **ITEM-9**: `sdk/crates/ziee-hardware/src/detection.rs` uses the shared parser instead of its duplicate scrape, and **validates** the value before it reaches `HardwareSettings.tsx:320`, which renders it verbatim today.
- **ITEM-10**: Metal — record the analysis in a comment; **no behavioural change**. `is_metal_available_uncached` returns `true` on both arms inside `#[cfg(target_os = "macos")]` (the Intel arm's `system_profiler` probe falls through to `return true` regardless), so swapping compile-time `#[cfg(target_arch)]` for runtime `host_arch()` has zero behavioural delta — and no Darwin toolchain exists here to compile it. The Rosetta hazard that actually matters, picking an x86_64 artifact slice on Apple Silicon, is already handled by `host_arch()`'s runtime `sysctl hw.optional.arm64` probe.

## Invariants

- **INV-1**: On a host whose `nvidia-smi` reports a CUDA version in ANY of its published output formats, detection MUST recover that version, and MUST NOT select the `cpu` artifact when a compatible `cuda` artifact is published.
- **INV-2**: Detection MUST NOT silently downgrade. Whenever a GPU is present and either no version could be determined or the `cpu` artifact was selected anyway, the decision and the evidence behind it MUST be logged at a level the user can find.
- **INV-3**: Hosts that work today MUST keep working. The legacy `CUDA Version:` banner and the existing `/opt/rocm/.info/version` source remain first-class and are tried before anything new.
- **INV-4**: Detection MUST NOT fabricate a version. A non-numeric or deprecated-placeholder field, or a bare driver version, must never be read as a CUDA version; a ROCm major must never be guessed when every source is silent.
- **INV-5**: The no-`$PATH` binary-resolution property (audit finding 08-llm-local-runtime F-14) MUST hold on every platform, and the authoritative `nvidia-smi` probe MUST NOT be redirectable by any user-settable environment variable.

## Files to touch

| file | change |
|---|---|
| `sdk/crates/ziee-hardware/src/gpu_version.rs` | **new** — shared pure parsers + `MajorMinor` + their unit tests (ITEM-1, ITEM-3) |
| `sdk/crates/ziee-hardware/src/lib.rs` | `pub mod gpu_version;` |
| `sdk/crates/ziee-hardware/src/detection.rs` | replace the duplicate `"CUDA Version:"` scrape with the shared parser (ITEM-9) |
| `src-app/server/src/modules/llm_local_runtime/utils/gpu_detect.rs` | probe chain, presence probe, memoisation, decision logging, cross-platform `resolve_system_binary`, ROCm chain, Metal comment, tests (ITEM-2, 4, 5, 6, 7, 8, 10) |

Explicitly NOT touched: **any frontend workspace file** (neither the web UI workspace nor the
desktop UI workspace — no component, store, spec or fixture); the `GpuDetectionResponse` wire
type; `recommend_backend_for`'s signature or semantics; any migration or permission. So the
lifecycle continues to classify this as backend work and no OpenAPI regeneration is required.
Verified against the real diff, not just asserted: `git status --porcelain` shows only
`gpu_detect.rs` and the `sdk` submodule pointer.

## Patterns to follow

- `probe_trusted` / `probe_command_with_timeout` / `PROBE_TIMEOUT` (`gpu_detect.rs:52-79`) —
  the existing 3s-capped, no-`$PATH` probe. Every new subprocess goes through it, including in
  `ziee-hardware` where no timeout currently exists.
- `OnceLock` memoisation in exactly the shape `is_cuda_available()` uses (`gpu_detect.rs:381`).
- The zero-dependency pure-parser style of `parse_rocm_version_str` (`:281`) and
  `parse_backend_version` (`:306`). **No new dependencies** — `regex` is a direct dep of `ziee`
  but *not* of `ziee-hardware`, and adding it there would touch two lockfiles for parsing that
  is whitespace tokenisation over ≤20 lines.
- `recommend_backend_for` (`:329`) is left **untouched**, deliberately. It ignores the host CUDA
  minor (`Some((host_major, _))`, filter `maj <= host_major`), which is *correct* under CUDA 11+
  minor-version compatibility — a `cuda13.2` build runs on any 13.x driver — so tightening it
  would be a regression that rejects `cuda13.2` on a 13.0 host. `MajorMinor::as_pair()` lowers
  `minor: None` to `0` at that single boundary, where the selector provably never reads it.
  Keeping this function byte-identical also keeps the upstream `ziee-ai/ziee` port clean.
- Real artifact tags from `engine/download.rs:1589-1596` (`cpu`, `cuda12.9`, `cuda13.2`,
  `rocm5.7`, `metal`, `windows…cuda12.4`) — tests assert against the **shipping** vocabulary,
  not the current fixture's invented `cuda12.6`/`cuda13.0`. *(Corrected at phase 2: the first
  draft cited `:1416-1460`, which is the release-mirror env-var and symlink-safety tests.)*
- `tracing::{info,warn,debug}`; never `println!`.

## Known-unverifiable, stated up front

- **macOS / Metal** — no Darwin toolchain here; hence ITEM-10 changes no code.
- **Windows** — no Windows host. The change can only fail to improve it, never regress it: an
  unresolved binary yields `None`, which is exactly today's behaviour.
- **AMD / ROCm** — no AMD hardware and no `/opt/rocm` on this box. Source 1 is unchanged, and
  every added source is parse-or-skip, so the worst case is today's behaviour plus a warning.
- Any driver predating `nvidia-smi --version` — cannot be exercised; mitigated by falling
  through to the banner on a non-zero exit, but the fall-through itself is untested on real old
  hardware.
