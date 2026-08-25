# TESTS — gpu-backend-detect

Tier vocabulary note: this change is backend-only and touches no FE workspace, so no `e2e`
tier is enumerated. The load-bearing tier here is `unit`, deliberately — the whole point of the
refactor is that every real vendor-output shape becomes a pure `fn(&str) -> Option<…>` that can
be pinned by a fixture without a GPU, instead of being reachable only through a subprocess.

Fixtures are **verbatim captures** from this host (driver 610.43.02, CUDA UMD 13.3), not
hand-written approximations. That distinction is what makes them evidence.

## The bug, as a test

- **TEST-1** (tier: unit) [acceptance] [invariant: INV-1] [covers: ITEM-2] file: `src-app/server/src/modules/llm_local_runtime/utils/gpu_detect.rs` — asserts: the exact driver-610 banner from the bug report flows through the parser into `recommend_backend_for` against the real published tag set `["cpu","cuda12.9","cuda13.2"]` and selects **`cuda13.2`**. Verified RED before the fix: `left: Some("cpu")`, `right: Some("cuda13.2")` (`evidence-RED-before-fix.log`).
- **TEST-2** (tier: unit) [covers: ITEM-2] file: `sdk/crates/ziee-hardware/src/gpu_version.rs` — asserts: the driver-610 **banner** yields `13.3`. RED before the fix (`left: None`).
- **TEST-3** (tier: unit) [covers: ITEM-2] file: `sdk/crates/ziee-hardware/src/gpu_version.rs` — asserts: `nvidia-smi --version` output yields `13.3`, despite the lowercase key and the detached colon.
- **TEST-4** (tier: unit) [covers: ITEM-2] file: `sdk/crates/ziee-hardware/src/gpu_version.rs` — asserts: `nvidia-smi -q` output yields `13.3`, with the `[Deprecated; …]` suffix glued to the value stripped.
- **TEST-5** (tier: unit) [covers: ITEM-2] file: `sdk/crates/ziee-hardware/src/gpu_version.rs` — asserts: when BOTH `CUDA Version` and `CUDA UMD Version` are present (which `-q` does on R6xx), the **UMD** field wins. Today's parser returns the wrong number here, not merely nothing.

## Regression — hosts that work today must keep working

- **TEST-6** (tier: unit) [acceptance] [invariant: INV-3] [covers: ITEM-2] file: `sdk/crates/ziee-hardware/src/gpu_version.rs` — asserts: the legacy driver-550 banner `CUDA Version: 12.4` still yields `12.4`.
- **TEST-7** (tier: unit) [covers: ITEM-2] file: `sdk/crates/ziee-hardware/src/gpu_version.rs` — asserts: prose and empty input yield `None`.

## Never fabricate a version

- **TEST-8** (tier: unit) [acceptance] [invariant: INV-4] [covers: ITEM-1] file: `sdk/crates/ziee-hardware/src/gpu_version.rs` — asserts: `NVIDIA-SMI version : 610.43.02` alone yields `None`. This is the guard against the naive fix ("match any `version` label"), which would return `610.43` here.
- **TEST-9** (tier: unit) [covers: ITEM-1] file: `sdk/crates/ziee-hardware/src/gpu_version.rs` — asserts: `CUDA version : Deprecated, see "CUDA UMD version" instead` yields `None`.
- **TEST-10** (tier: unit) [covers: ITEM-1] file: `sdk/crates/ziee-hardware/src/gpu_version.rs` — asserts: an unparseable match for the key does NOT abort the scan — the real value two lines later is still found. Driver 610's actual ordering; first-match-wins would return `None`.
- **TEST-11** (tier: unit) [covers: ITEM-1] file: `sdk/crates/ziee-hardware/src/gpu_version.rs` — asserts: `CUDA Version: N/A` yields `None`.
- **TEST-12** (tier: unit) [covers: ITEM-1] file: `sdk/crates/ziee-hardware/src/gpu_version.rs` — asserts: the accepted/rejected token table — `13.3`, `13`, `13.3.29`, `V13.3.33`, `13.3]`, `13.3,` parse; `""`, `Deprecated,`, `N/A`, `Not`, `unknown`, `-` do not.
- **TEST-13** (tier: unit) [covers: ITEM-1] file: `sdk/crates/ziee-hardware/src/gpu_version.rs` — asserts: version-lookalikes that really appear in `nvidia-smi -q` are rejected — `x86_64`, `H200`, `12GB`, `86_64`, `P0`, and the Bus-Id `00000000:03:00.0`. The Bus-Id case was found by this test against a first implementation that used a denylist; it forced the switch to an allowlist of value terminators.
- **TEST-14** (tier: unit) [covers: ITEM-1] file: `sdk/crates/ziee-hardware/src/gpu_version.rs` — asserts: a `Product Name : NVIDIA H200 NVL` line is not read as a CUDA version.
- **TEST-15** (tier: unit) [covers: ITEM-1] file: `sdk/crates/ziee-hardware/src/gpu_version.rs` — asserts: a key window cannot straddle a newline, and a value on the following line is not adopted as this line's.

## Toolkit-derived sources

- **TEST-16** (tier: unit) [covers: ITEM-3] file: `sdk/crates/ziee-hardware/src/gpu_version.rs` — asserts: `nvcc --version` yields `13.3` from `release 13.3, V13.3.33`.
- **TEST-17** (tier: unit) [covers: ITEM-3] file: `sdk/crates/ziee-hardware/src/gpu_version.rs` — asserts: an nvcc banner with no `release` line yields `None`.
- **TEST-18** (tier: unit) [covers: ITEM-3] file: `sdk/crates/ziee-hardware/src/gpu_version.rs` — asserts: `libcudart.so.13.3.29` yields `13.3`.
- **TEST-19** (tier: unit) [covers: ITEM-3] file: `sdk/crates/ziee-hardware/src/gpu_version.rs` — asserts: `libcudart.so.13` yields major `13` with the minor **unknown**, not `0`.
- **TEST-20** (tier: unit) [covers: ITEM-3] file: `sdk/crates/ziee-hardware/src/gpu_version.rs` — asserts: `libcudart.so`, `libcublas.so.13.3`, `libcudart.so.x` and `""` all yield `None`.
- **TEST-21** (tier: unit) [covers: ITEM-1] file: `sdk/crates/ziee-hardware/src/gpu_version.rs` — asserts: `Display` renders a known minor as `13.3` and an unknown one as `13.x`, so a log line never implies precision it does not have.
- **TEST-22** (tier: unit) [covers: ITEM-1] file: `sdk/crates/ziee-hardware/src/gpu_version.rs` — asserts: `as_pair()` fills an unknown minor with `0` at the one boundary where the selector provably never reads it.
- **TEST-23** (tier: unit) [covers: ITEM-3] file: `src-app/server/src/modules/llm_local_runtime/utils/gpu_detect.rs` — asserts: a major-only version (`minor: None`) still selects `cuda13.2` from the real tag set, proving the unknown minor cannot break the untouched selector.

## Loud failure

- **TEST-24** (tier: unit) [acceptance] [invariant: INV-2] [covers: ITEM-6] file: `src-app/server/src/modules/llm_local_runtime/utils/gpu_detect.rs` — asserts: the pure predicate driving the loud warning is TRUE both when a GPU is present with a known version but `cpu` was still selected, and when a GPU is present with NO version determined; and FALSE when there is no GPU, or when a GPU artifact was actually selected. The predicate is extracted precisely so the "never downgrade silently" guarantee is testable rather than resting on a log line nobody asserts.
- **TEST-25** (tier: unit) [covers: ITEM-4, ITEM-5] file: `src-app/server/src/modules/llm_local_runtime/utils/gpu_detect.rs` — asserts: the `--query-gpu=name --format=csv,noheader` presence output parses to a GPU count, and empty/whitespace output means "no GPU" — the gate that stops a stray toolkit install from being read as a working GPU.
- **TEST-26** (tier: unit) [covers: ITEM-5] file: `src-app/server/src/modules/llm_local_runtime/utils/gpu_detect.rs` — asserts: the ordered CUDA source chain prefers a driver-reported source over a toolkit-derived one when both answer, and reports which source won.

## Cross-platform resolution

- **TEST-27** (tier: unit) [acceptance] [invariant: INV-5] [covers: ITEM-7] file: `src-app/server/src/modules/llm_local_runtime/utils/gpu_detect.rs` — asserts: a hostile `CUDA_PATH`/`HIP_PATH` contributes NO candidate directory for `nvidia-smi`, which resolves only from OS-set locations. The authoritative probe must not be redirectable by a user-settable variable.
- **TEST-28** (tier: unit) [covers: ITEM-7] file: `src-app/server/src/modules/llm_local_runtime/utils/gpu_detect.rs` — asserts: Windows candidate dirs are built from injected env (`SystemRoot=D:\Windows`, `ProgramFiles=D:\Program Files`, `CUDA_PATH=D:\CT\CUDA\v13.3`) and contain no hardcoded `C:\`; an all-`None` env yields an empty list without panicking.
- **TEST-29** (tier: unit) [covers: ITEM-7] file: `src-app/server/src/modules/llm_local_runtime/utils/gpu_detect.rs` — asserts: relative and `..`-containing env values are rejected outright.
- **TEST-30** (tier: unit) [covers: ITEM-7] file: `src-app/server/src/modules/llm_local_runtime/utils/gpu_detect.rs` — asserts: a binary name with NO per-binary allowlist still resolves via the generic trusted-dir scan (`sleep`, `true`, `uname`). Without this the two existing timeout regression tests would silently stop running — they are written `let Some(x) = … else { return }`, so they would go green while testing nothing.

## ROCm (unverifiable against hardware — no AMD GPU on this host)

- **TEST-31** (tier: unit) [covers: ITEM-8] file: `sdk/crates/ziee-hardware/src/gpu_version.rs` — asserts: `rocm-6.1.2`, `/opt/rocm-6.1.2` and a trailing-slash form yield `6.1`; `rocm`, `rocm-` and `/opt/rocm` yield `None`.
- **TEST-32** (tier: unit) [covers: ITEM-8] file: `sdk/crates/ziee-hardware/src/gpu_version.rs` — asserts: a `ROCM-SMI-LIB version: 6.1.2` line parses to `6.1`. String shape is UNVERIFIED against real hardware and labelled as such in the test.
- **TEST-33** (tier: unit) [covers: ITEM-8] file: `src-app/server/src/modules/llm_local_runtime/utils/gpu_detect.rs` — asserts: when ROCm is available but EVERY version source is silent, no major is invented — the recommendation stays `cpu` and the loud-warning predicate is true. Guessing here would load a build that cannot run, which is strictly worse than CPU.

## Metal

- **TEST-34** (tier: unit) [covers: ITEM-10] file: `src-app/server/src/modules/llm_local_runtime/utils/gpu_detect.rs` — asserts: `is_metal_available()` is `false` off macOS. This is the only Metal property observable from this host, and it documents that the `cfg(target_os = "macos")` gate is what makes the two untestable macOS arms unreachable here. No macOS behaviour is claimed.

## ziee-hardware telemetry copy

- **TEST-35** (tier: unit) [covers: ITEM-9] file: `sdk/crates/ziee-hardware/src/detection.rs` — asserts: the nvidia-smi fallback path's CUDA-version extraction goes through the shared parser and yields a **validated** `"13.3"` for driver-610 output, and `None` (never a raw token like `N/A`) for junk. Today it renders whatever token follows the label, verbatim, to the user.
- **TEST-36** (tier: unit) [covers: ITEM-9] file: `sdk/crates/ziee-hardware/src/detection.rs` — asserts: the NVML path's `cuda_version` is sourced from the CUDA driver version, NOT `cuda_compute_capability()`. Today an H200 reports `"9.0"` — its SM compute capability — in a field named `cuda_version`, which the UI renders as "CUDA ✓ (9.0)". Owner-approved scope addition at phase 2; this is the test that pins the corrected meaning.

## Host truth — the on-box end-to-end proof

- **TEST-37** (tier: unit) [covers: ITEM-5, ITEM-6] file: `src-app/server/src/modules/llm_local_runtime/utils/gpu_detect.rs` — asserts: on a host where `nvidia-smi` resolves and succeeds, a CUDA version MUST be recoverable (a working `nvidia-smi` that yields no version is precisely the reported bug), and with the real published tag set the selection MUST NOT be `cpu`. Self-skips with an explicit log line where no NVIDIA GPU is present, so it stays honest on other machines rather than passing vacuously. Run with `--nocapture` so the detected version, its winning source, and the chosen tag are captured as phase-8 evidence. Allocates zero GPU memory and downloads nothing.

## Coverage

Every ITEM-1..ITEM-10 is covered by at least one TEST above; every INV-1..INV-5 has exactly one
`[acceptance]` test (TEST-1, TEST-24, TEST-6, TEST-8, TEST-27 respectively). Nothing is
descoped.

## Deliberately NOT claimed

No test here proves macOS, Windows, or AMD behaviour. TEST-27..TEST-30 test the Windows
*candidate-list construction* as a pure function with injected environment — they do not prove
a binary is found on a real Windows host, because none was available. TEST-31/32/33 encode
documented ROCm string shapes, not observed ones.
