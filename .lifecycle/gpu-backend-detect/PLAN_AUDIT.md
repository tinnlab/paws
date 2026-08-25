# PLAN_AUDIT — gpu-backend-detect

Adversarial audit of `PLAN.md` **against the codebase**, run by an independent agent briefed
to find where the plan is wrong rather than to confirm it. Everything below is backed by
`file:line` evidence that was re-checked, not by the plan's own claims.

## Verdicts

- **ITEM-1** — verdict: PASS — `sdk/crates/ziee-hardware/src/lib.rs:1-24` is a doc header plus four `pub mod` lines: no `#![deny(...)]`, no `#![warn(missing_docs)]`, no crate-level attribute at all, so a new `pub mod gpu_version;` drops in cleanly. `ziee-hardware/Cargo.toml` declares `[features] gpu-detect = [...]` with **no `default = [...]`**, so the default build is feature-free and a non-gated module is reachable even under `--no-default-features` — which is exactly why leaving it un-gated is right. `sdk/Cargo.toml:2-3` sets `resolver = "2"` / workspace `edition = "2021"`, but ziee-hardware pins its own `edition = "2024"`, so 2024 idioms (let-chains) compile.
- **ITEM-2** — verdict: PASS — exactly three references to `parse_cuda_smi_version`: the definition (`gpu_detect.rs:269`), ONE production caller (`:295`, inside `detect_cuda_version`), and one test (`:522`). `detect_cuda_version` in turn has exactly one caller (`:375`). So the return-type change breaks **one** production line and needs `.map(MajorMinor::as_pair)` there. The plan's claim that the selector never reads the minor is confirmed at `:346` and `:357`, which both destructure `Some((host_major, _))`.
- **ITEM-3** — verdict: PASS — no consumer parses or string-compares the values these produce; see ITEM-9 for the one render site.
- **ITEM-4** — verdict: PASS — `--query-gpu` carries no CUDA-version field, so using it for presence only is correct. Independently re-confirmed on the host.
- **ITEM-5** — verdict: PASS — and the premise is **stronger** than the plan stated. `/usr/local/cuda/lib64/libcudart.so` exists here, so `is_cuda_available()` short-circuits true at `gpu_detect.rs:396` *without ever spawning nvidia-smi*, which makes the unmemoised `detect_cuda_version()` the ONLY nvidia-smi spawn — once per release row. The plan named two hot call sites; there are **three**: `llm_local_runtime/binary_manager.rs:287`, `:407`, and `voice/binary_manager.rs:140`. PLAN.md corrected.
- **ITEM-6** — verdict: PASS — no existing logging in `recommend_backend`/`recommend_backend_for`/`detect_cuda_version` to collide with; the four `info!` lines at `:241-261` fire only on the unrelated `/detect-gpu` path.
- **ITEM-7** — verdict: CONCERN (resolved in-plan before implementing) — three real problems the plan under-specified:
  1. It said "selection becomes name-aware internally" without stating the **default**. If that meant an exhaustive allowlist, `sleep` and `true` would stop resolving — and silently: both timeout tests are written `let Some(x) = … else { return; }` (`:601`, `:615`), so they would go **green while the timeout regression test quietly stopped running**. Resolution: an unknown name MUST fall back to the generic TRUSTED_DIRS scan. Recorded as DEC-4.
  2. `src-app/server/Cargo.toml:10-11` opts into the workspace lint `unused_imports = "deny"` (`src-app/Cargo.toml:60-62`). A top-level `use` consumed only inside `#[cfg(windows)]` code is a **hard error on Linux**, not a warning. Resolution: `#[cfg(windows)] use …` or fully-qualified paths. Recorded as DEC-5.
  3. The plan's argument that the `usr/sbin` branch is dead only covered the `/usr/bin/usr/sbin/…` shape. The audit enumerated all seven: the one non-absurd candidate is `/System/Library/usr/sbin/X`, which cannot be checked without a Mac. Deletion is behaviour-preserving anyway, because `/usr/sbin` is `TRUSTED_DIRS[1]` and is tested **earlier in the same loop**, and `/usr/sbin/system_profiler` is the real macOS location. Conclusion stands; reasoning corrected.
- **ITEM-8** — verdict: PASS — no ROCm on this host, so every added source is unreachable here and cannot regress anything; source 1 unchanged.
- **ITEM-9** — verdict: **CONCERN — the plan fixes a path that does not execute on the motivating host.** `detect_nvidia_gpus_nvidia_smi()` is called from exactly one place: the **`Err(_)` arm** of `Nvml::init()` (`detection.rs:178-183`). NVML initialises fine on this box, so the function never runs. The value that actually reaches `HardwareSettings.tsx:321-322` comes from `detection.rs:155-158` — `device.cuda_compute_capability()` → `"9.0"`, the **SM compute capability**, written into a field named `cuda_version`. Corroborated by the recorded gallery cassettes (`ui/src/dev/gallery/fixtures/recorded/crawl.json:403,417,431,445` all `"cuda_version": "9.0"`). Escalated to the owner rather than silently re-scoped; see DEC-6.
- **ITEM-10** — verdict: PASS — no code change, so nothing to break; the analysis is recorded in-file.

## The four required audit dimensions

- **Breakage risk** — one production line (`gpu_detect.rs:375`) and one test (`:522`) need updating for the return-type change. No other caller exists. `gpu-rendering-variations.spec.ts` is immune: `mockHardware()` (`:24-34`) `page.route`s `GET /api/hardware` wholesale, so its `'12.4'` at `:61` is client-side fixture data that no backend value reaches.
- **Pattern conformance** — PASS. No `clippy.toml` in the repo. Lint policy is `src-app/Cargo.toml:60-68` and `sdk/Cargo.toml:10-17` (`unused_imports = "deny"`, `unused_mut = "deny"`, `dead_code = "warn"`), opted into by `src-app/server` but **not** by `ziee-hardware` (no `[lints]` section there). Per-item `#[allow(dead_code)]` is already the house style (`gpu_detect.rs:168`, `:186`); only a NEW module-level `#![allow(dead_code)]` blanket would fail `just check-deadcode-blankets`. This change adds no blanket.
- **Migration collisions** — NONE. Neither touched file is `.sql`; no new prefix in either sequence.
- **OpenAPI regen** — NOT required, and this was verified rather than assumed. `grep JsonSchema` on both touched files returns nothing; `GpuDetection` (`gpu_detect.rs:199`) derives only `Debug, Clone`; `GpuDetectionResponse` lives in `handlers.rs:685` and is untouched; no handler signature or route changes. `GPUComputeCapabilities` (`types.rs:32`) does derive `JsonSchema`, but only the *value* in `cuda_version: Option<String>` changes, not the type — zero schema delta.

## Base build

`cargo check -p ziee-hardware` from the worktree's `sdk/`: **exit 0, 8.8 s**, 3 pre-existing
warnings (`detection.rs:99` unused `mut`; `:9` and `:33` "never used", both live only under
`gpu-detect`/`#[cfg(test)]`). With `--features gpu-detect --tests`: **exit 0, 7.0 s, zero
warnings**. The crate builds clean before any edit.

## Findings acted on immediately

Three defects the audit found in already-written code, all fixed and covered by new tests
before this gate was taken:

1. **`find_labeled_version` tokenised the whole buffer**, so a key window could straddle a
   newline and adopt the next line's number. Not realisable on the three real driver-610
   surfaces, but "never fabricate a version" should not rest on that. Now matches **per line**;
   `a_key_window_does_not_straddle_a_newline` pins it.
2. **`parse_version_token` was far too permissive** — it skipped any leading non-digit run, so
   `x86_64`, `H200` and `12GB` all parsed. Now: digit-led (with at most a single `V`/`v`
   prefix), and the numeric run must end the token modulo a closing punctuation mark. The first
   attempt used a *denylist* of alphanumerics and `_`, which the new test caught still letting
   the Bus-Id `00000000:03:00.0` through as major `0`; replaced with an **allowlist** of value
   terminators. `parse_version_token_rejects_lookalikes_from_real_smi_output` and
   `product_name_line_is_not_read_as_a_cuda_version` pin it.
3. **`sdk/Cargo.lock` had picked up an unrelated `+ "webkit2gtk"`** line from running cargo in
   the sdk workspace on Linux. Reverted. Must be re-checked immediately before the sdk commit,
   since any cargo invocation there can reintroduce it.

## Process honesty

The audit correctly observed that **implementation began before this phase-2 gate passed**
(`gpu_version.rs` was created at 18:07 while the audit was still running). That is a genuine
lifecycle-ordering violation on my part, recorded rather than hidden. Mitigation: the audit was
briefed on and read the *base* tree, so its ITEM-1 finding is not contaminated by my edit; and
every defect it found in that early code has been fixed above before taking the gate. No audit
finding was waved through on the grounds that code already existed.

## Pre-existing breakage inherited, not caused

- `just check` **already fails** in this worktree: `justfile:73` runs `check-schema-sync` first,
  which greps `src-app/sandbox-rootfs/compat.toml` — a file deleted when the rootfs build moved
  to the standalone repo (per `CLAUDE.md`). This will be hit at the phase-8 gate. Not caused by
  this feature; the per-crate cargo commands are used instead and this is reported.
- `.lifecycle/default-model-onboarding` is committed on `main` (PR #10 bypassed the merge-gate's
  C5 strip). Not removed here — validator gate A1 fails a branch that deletes an inherited
  feature dir.
- PLAN.md cited `engine/download.rs:1416-1460` for the shipping artifact tags; the correct
  range is `download.rs:1589-1596`. Corrected in PLAN.md.
