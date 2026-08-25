# DRIFT-1 — gpu-backend-detect (implementation round 1)

Every place the implementation diverged from `PLAN.md`, and how it was reconciled.

- **DRIFT-1.1** — verdict: impl-wins — **ITEM-9's scope changed.** The plan said the NVML/smi semantic mismatch would be *reported, not fixed*. The phase-2 audit proved that made ITEM-9 dead code on the motivating host: `detect_nvidia_gpus_nvidia_smi` runs only in the `Err(_)` arm of `Nvml::init()` (`detection.rs:178-183`), and NVML initialises fine on an H200 box, so the user-visible "CUDA ✓ (9.0)" — the SM compute capability in a field named `cuda_version` — would have survived the fix untouched. Escalated to the owner with three options and approved (DEC-6). The NVML path now sources `cuda_version` from the existing `get_cuda_version()` helper. Verified on hardware: `device=NVIDIA H200 NVL cuda_version=13.3`, cross-checked against `nvidia-smi` by TEST-36.
- **DRIFT-1.2** — verdict: resolved — **`parse_version_token` was far more permissive than the plan implied.** As first written it skipped any leading non-digit run, so `x86_64`, `H200` and `12GB` all parsed as versions; only the label match stood between that and a fabricated version. Tightened to digit-led (with at most a single `V`/`v` prefix) plus a terminator rule. The first tightening used a *denylist* of alphanumerics and `_`, which the new negative test caught still admitting the Bus-Id `00000000:03:00.0` as major `0`; replaced with an **allowlist** of value terminators. Covered by TEST-13 and TEST-14.
- **DRIFT-1.3** — verdict: resolved — **`find_labeled_version` tokenised the whole buffer, not per line.** A key window could straddle a newline and adopt the next line's number. Not realisable on any of the three real driver-610 surfaces, but INV-4 should not rest on that. Now matches per line; TEST-15 pins both halves (a split key, and a value on the following line).
- **DRIFT-1.4** — verdict: resolved — **the plan under-specified the name-aware resolver's default.** Left as an exhaustive allowlist it would have stopped resolving `sleep`/`true`, and *silently*: both probe-timeout regression tests are written `let Some(x) = … else { return }`, so they would have gone green while testing nothing. Per-binary Windows policy is now strictly additive over the generic trusted-dir scan (DEC-4), pinned by TEST-30.
- **DRIFT-1.5** — verdict: resolved — **`unused_mut = "deny"` broke the build**, exactly as the audit predicted for this crate (`src-app/server/Cargo.toml:10-11`). A closure declared `let mut collect` needed no `mut`. Fixed. The related `unused_imports = "deny"` hazard was avoided by design: the only Windows-specific code sits behind `#[cfg(windows)]` inside the function body, so no top-level import is unused on Linux.
- **DRIFT-1.6** — verdict: resolved — **`gpu_detect.rs`'s `test_parse_cuda_smi_version` was deleted, not updated.** `parse_cuda_smi_version` no longer exists in that file — it moved to the shared crate — so the test had nothing to call. Its coverage did not vanish: the legacy-550 assertion it carried is now `cuda_version_from_550_banner_still_works` (TEST-6) and the prose-rejection assertion is `parse_cuda_smi_version_rejects_prose` (TEST-7), both in `gpu_version.rs`. Recorded explicitly because "a test disappeared" is exactly the shape of an unnoticed coverage regression.
- **DRIFT-1.7** — verdict: none — **two PLAN.md citations were wrong and were corrected in place**: the shipping artifact tags are at `engine/download.rs:1589-1596`, not `:1416-1460`; and `recommend_backend` has **three** hot call sites, not two (`voice/binary_manager.rs:140` was missed). Neither changed the design.
- **DRIFT-1.8** — verdict: none — **a pre-existing test failure was found and proven not mine.** `engine::download::tests::credential_is_withheld_from_untrusted_targets` fails on `http://[::1]:41234`. Verified by stashing the entire server-side change and re-running: it fails identically on the base tree, so it is red on `origin/main` already. Reported, not fixed — `download.rs` is outside this feature and another worker may own it. With it excluded, `cargo test -p ziee --lib llm_local_runtime::` is **84 passed / 1 pre-existing failure**.

## Verification at this point

- `cargo test -p ziee-hardware --features gpu-detect --lib` → **44 passed, 0 failed, 1 ignored** (the ignored one is a pre-existing occupancy test that documents its own `--test-threads=1` requirement).
- `cargo test -p ziee --lib gpu_detect::` → **25 passed, 0 failed**.
- On-box end-to-end (TEST-37, `--nocapture`):
  `host_truth: gpus=4 evidence=Some(("13.3", "nvidia-smi --version"))` /
  `host_truth: chosen=Some("cuda13.2")`. Captured in `evidence-GREEN-host-truth.log`.
- RED before the fix, captured in `evidence-RED-before-fix.log`: `parse_cuda_smi_version` →
  `left: None, right: Some((13, 3))` and the selector → `left: Some("cpu"), right:
  Some("cuda13.2")`.

**Unresolved drifts:** 0
