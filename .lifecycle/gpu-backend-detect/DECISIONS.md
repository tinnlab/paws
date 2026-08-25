# DECISIONS — gpu-backend-detect

Nothing is left open. Every question raised during planning and the phase-2 audit is resolved
here before implementation continues.

### DEC-1: Where does the shared parser live, given two crates need it?

**Resolution:** A new, non-feature-gated module `sdk/crates/ziee-hardware/src/gpu_version.rs`,
consumed by both `ziee-hardware::detection` and ziee's
`llm_local_runtime::utils::gpu_detect`.
**Basis:** codebase. `ziee` already depends on `ziee-hardware` by path
(`src-app/server/Cargo.toml:64`), so the direction allows it; the reverse would not. Leaving it
outside the `gpu-detect` feature matters because `ziee-hardware` has **no** `default` feature
set — a gated module would be invisible under `--no-default-features`.

### DEC-2: Hand-rolled parsing or `regex`?

**Resolution:** Hand-rolled, no new dependency.
**Basis:** codebase. `regex` is a direct dep of `ziee` (`server/Cargo.toml:89`) but **not** of
`ziee-hardware`, and the sdk workspace catalog is deliberately near-empty — adding it would
introduce a direct dependency and lockfile churn across two separate workspaces to replace
whitespace tokenisation over a handful of short lines. It also matches the file's existing
zero-dep parser style (`parse_rocm_version_str`, `parse_backend_version`).

### DEC-3: Does `recommend_backend_for` change?

**Resolution:** No. Signature and semantics stay byte-identical; `MajorMinor::as_pair()` lowers
to the `(u32, u32)` it already takes.
**Basis:** codebase + convention. It ignores the host CUDA minor (`Some((host_major, _))` at
`gpu_detect.rs:346` and `:357`), which is **correct** under CUDA 11+ minor-version
compatibility — a `cuda13.2` build runs on any 13.x driver. Tightening it to compare minors
would be a regression that rejects `cuda13.2` on a 13.0 driver where it actually works. It is
also the function most likely to conflict on the upstream `ziee-ai/ziee` port, and it already
has six passing tests that would need rewriting for zero behavioural delta. Explicitly endorsed
by the lead.

### DEC-4: What does a name-aware `resolve_system_binary` do with an UNKNOWN binary name?

**Resolution:** Falls back to the generic TRUSTED_DIRS scan. Per-binary candidate lists are
*additive* — they never turn the function into an exhaustive allowlist.
**Basis:** codebase. Raised by the phase-2 audit as close to BLOCKED. `resolve_system_binary` is
called with `uname`, `sysctl`, `system_profiler`, `nvidia-smi`, `rocm-smi`, and — in tests —
`sleep` and `true`. An allowlist would stop resolving the last two, and **silently**: both
timeout regression tests are written `let Some(x) = … else { return; }`
(`gpu_detect.rs:601`, `:615`), so they would go green while no longer testing the timeout at
all. TEST-30 pins the fallback so this cannot regress unnoticed.

### DEC-5: How are Windows-only imports handled without breaking the Linux build?

**Resolution:** `#[cfg(windows)]`-scoped `use` statements, or fully-qualified paths at the use
site. No top-level `use` consumed only by Windows code.
**Basis:** codebase. `src-app/server/Cargo.toml:10-11` opts into the workspace lint
`unused_imports = "deny"` (`src-app/Cargo.toml:60-62`), so an import unused on Linux is a **hard
compile error**, not a warning.

### DEC-6: The `ziee-hardware` NVML path writes compute capability into `cuda_version`. Fix or report?

**Resolution:** **Fix.** Source the NVML path's `cuda_version` from the CUDA driver version via
the existing `get_cuda_version()` helper (`detection.rs:757`, already using
`sys_cuda_driver_version()`) instead of `device.cuda_compute_capability()`.
**Basis:** user. Escalated to the owner at phase 2 with the alternatives, and approved.

The audit established that the originally-planned ITEM-9 fix was **dead code on the motivating
host**: `detect_nvidia_gpus_nvidia_smi` runs only in the `Err(_)` arm of `Nvml::init()`
(`detection.rs:178-183`), and NVML initialises fine on this box. The value users actually see
comes from `detection.rs:155-158` → `"9.0"`, the SM compute capability, rendered by
`HardwareSettings.tsx:321-322` as "CUDA ✓ (9.0)". Corroborated by the recorded gallery cassettes
(`crawl.json:403,417,431,445`).

Consequences accepted, stated plainly: this is a **user-visible value change** (the card will
read 13.3, not 9.0), and compute capability stops being surfaced. It is not data loss — it was
mislabelled, never presented as compute capability — and re-adding it properly needs a new
`JsonSchema` field plus a UI change, which would pull in the frontend gate chain the owner
explicitly scoped out. Recorded as a follow-up instead. No test breaks: the only e2e touching
this (`gpu-rendering-variations.spec.ts:24-34`) `page.route`s `GET /api/hardware` wholesale, so
its `'12.4'` fixture is client-side and no backend value reaches it.

### DEC-7: What is the blast radius on macOS and Windows?

**Resolution:** macOS — no intended behavioural change; Windows — a real, intended, and
**unverified** change from "CUDA never detected" to "CUDA detected".
**Basis:** codebase. Recorded because it is the owner's direct question and the answer is not
symmetrical.

**macOS.** Metal is untouched (DEC-8). The only shared surface is `resolve_system_binary`, which
macOS uses for `system_profiler`, `sysctl` and `uname`. Two guards make it safe: DEC-4's generic
fallback, and the fact that deleting the dead `usr/sbin` branch cannot change macOS resolution
because `/usr/sbin` is `TRUSTED_DIRS[1]`, tested **earlier in the same loop**, and
`/usr/sbin/system_profiler` + `/usr/sbin/sysctl` are the real macOS locations. The deleted
branch only ever constructed impossible paths (`/System/Library/usr/sbin/X`,
`/usr/bin/usr/sbin/X`). `EXE_SUFFIX` is `""` on macOS, a no-op. The new CUDA sources are inert
there: `recommend_backend_for` short-circuits on `os == "macos"` before the CUDA branch, and
`nvidia-smi`/`libcudart` do not exist on a modern Mac.
**⚠ This is an argument from the code, not a test result — there is no Darwin toolchain here, so
the macOS path is not even compiled.**

**Windows.** Today CUDA detection is not merely mis-parsed, it is **impossible**: TRUSTED_DIRS
holds only Unix paths and `.exe` is never appended, so `nvidia-smi` cannot resolve and every
NVIDIA Windows user silently receives the `cpu` build. After this change Windows gets a working
path for the first time. The failure mode is asymmetric and worth stating: if the directory
guesses are **wrong**, resolution yields `None` — exactly today's behaviour, so no regression is
possible; if they are **right**, a Windows user begins receiving a CUDA artifact where they
previously received CPU. That is the intended fix but it is **unverified** (no Windows host),
and a non-functional GPU build fails louder than a slow CPU one.

### DEC-8: Does Metal change?

**Resolution:** No code change. Record the analysis in a comment.
**Basis:** codebase. `is_metal_available_uncached` is `#[cfg(target_os = "macos")]` throughout
and returns `true` on **both** arms — the Intel arm's `system_profiler` probe falls through to an
unconditional `return true` (`gpu_detect.rs:435-448`), making it decorative. Swapping the
compile-time `#[cfg(target_arch)]` for a runtime `host_arch()` therefore has **zero**
behavioural delta, and no machine here can compile it. The Rosetta hazard that actually
matters — selecting an x86_64 artifact slice on Apple Silicon — is already handled by
`host_arch()`'s runtime `sysctl hw.optional.arm64` probe (`:138`). Changing untestable code for
no measurable gain is the wrong trade. Explicitly endorsed by the lead.

### DEC-9: May toolkit-derived evidence (nvcc, libcudart) select a CUDA artifact on its own?

**Resolution:** Only when a GPU presence probe confirms a real NVIDIA device. Otherwise the
version stays unknown and the loud warning fires.
**Basis:** codebase. `is_cuda_available()` returns true from `libcudart.so` existence alone,
with **no driver check** (`gpu_detect.rs:394-402`). Without this gate the fix would newly and
wrongly recommend a CUDA build on a box that has the toolkit installed but no working driver —
trading a silent downgrade for a loud-but-wrong upgrade. Presence uses
`nvidia-smi --query-gpu=name --format=csv,noheader`, the stable machine-readable interface.

### DEC-10: Is `nvidia-smi --query-gpu` a CUDA-version source?

**Resolution:** No. It is a presence/identity source only.
**Basis:** codebase/measurement. The task proposed it as a preferred machine-readable version
source, but `nvidia-smi --help-query-gpu` on this host shows **no CUDA-version field** — the
only version offered is `driver_version`. The genuine machine-readable source is
`nvidia-smi --version` (`CUDA UMD version : 13.3`). Recorded because it corrects a premise of
the task itself.

### DEC-11: May a ROCm major be guessed when every version source is silent?

**Resolution:** Never. Report `None` and warn.
**Basis:** codebase. `recommend_backend_for` requires an **exact** ROCm major match
(`gpu_detect.rs:357-359`, `maj == host_major`), unlike CUDA's `<=`. A wrong guess therefore
selects a build that cannot load — strictly worse than the CPU build it replaced. The correct
output for "available but versionless" is the loud warning, not a number. Explicitly endorsed by
the lead.

### DEC-12: How is the "loud failure" made testable rather than resting on an unasserted log line?

**Resolution:** Extract the trigger condition as a pure predicate and unit-test it (TEST-24);
the `tracing` call is thin glue over it.
**Basis:** convention. The repo has no log-capture test harness, and an invariant that only
exists inside a `warn!` cannot be regression-tested. INV-2 is the whole point of the task, so it
gets a real assertion.

### DEC-13: How is the per-process warning kept from emitting up to 500 identical lines?

**Resolution:** Memoise the probes in `OnceLock` and emit the detection log inside the init
closure; latch the "GPU present but CPU chosen" warning with an `AtomicBool`.
**Basis:** codebase. `recommend_backend` is called once per release row inside `.map()` at three
sites (`llm_local_runtime/binary_manager.rs:287`, `:407`, `voice/binary_manager.rs:140`), with
`per_page` up to 500. The accepted cost: the latch can mask a second, differently-caused
occurrence later in the same process; the per-row `debug!` carries that detail when needed.

### DEC-14: What is done about the two pre-existing breakages the audit found?

**Resolution:** Report only; touch neither.
**Basis:** user. `just check` already fails here (`justfile:73` → `check-schema-sync` greps the
deleted `src-app/sandbox-rootfs/compat.toml`), so phase 8 uses per-crate cargo commands and says
so. `.lifecycle/default-model-onboarding` is committed on `main` because PR #10 bypassed the
merge-gate C5 strip; removing it would fail the validator's own A1 gate, which refuses a branch
that deletes an inherited feature dir.

### DEC-15: Was the lifecycle phase order violated?

**Resolution:** Yes — `gpu_version.rs` was written before the phase-2 gate passed. Recorded in
`PLAN_AUDIT.md` rather than concealed; no audit finding was waived because code already existed,
and all three defects the audit found in that early code were fixed before the gate was taken.
**Basis:** convention. Noting it because the alternative — quietly re-dating the work — is the
failure mode these artifacts exist to prevent.
