# TEST_RESULTS — gpu-backend-detect

## Commands actually run

`just check` is **not** among them, and the reason is recorded rather than worked around: it
already fails on this tree before reaching anything this feature touches (`justfile:73` runs
`check-schema-sync`, which greps `src-app/sandbox-rootfs/compat.toml`, deleted when the rootfs
build moved to its own repo). The per-crate commands below are what was run instead.

```bash
# sdk — NOTE the explicit feature. ziee-hardware declares no default feature set and is a
# member of the sdk workspace only, so `cargo test --workspace` from src-app does NOT run
# these, and without --features gpu-detect TEST-35/36 are not even compiled.
cargo test -p ziee-hardware --features gpu-detect --lib
  → 46 passed / 0 failed / 1 ignored

# server unit
cargo test -p ziee --lib gpu_detect:: -- --nocapture
  → 28 passed / 0 failed
# --nocapture is required, not cosmetic: the self-skipping tests announce skips with
# eprintln!, which cargo test discards on a passing test.

cargo test -p ziee --lib llm_local_runtime::
  → 87 passed / 1 failed (pre-existing, see below)

# server integration (tier 2/3)
cargo test -p ziee --test integration_tests llm_local_runtime::gpu -- --test-threads=1
  → 2 passed / 0 failed

# what CI runs
cargo check --workspace --all-targets   → exit 0
cargo check -p ziee --tests             → zero warnings from the changed file
```

All cargo invocations pass `--config <abs>/src-app/.cargo/config.toml`, because cargo discovers
that file from the **invocation directory** and `build_helper/pgvector.rs` reads
`ZIEE_POSTGRES_VERSION` via `env!()` at compile time — without it the build script fails.

## The bug, before and after

| | before | after |
|---|---|---|
| `parse_cuda_smi_version(610 banner)` | `None` | `13.3` |
| selected artifact | `Some("cpu")` | **`Some("cuda13.2")`** |

RED captured before any fix (`evidence-RED-before-fix.log`):
`left: None, right: Some((13, 3))` and `left: Some("cpu"), right: Some("cuda13.2")`.

GREEN on this host (`evidence-GREEN-host-truth.log`), zero GPU memory allocated, nothing
downloaded, the owner's running instance untouched:

```
host_truth: gpus=4 evidence=Some(("13.3", "nvidia-smi --version"))
host_truth: chosen=Some("cuda13.2")
```

And from a **real booted server** during the integration run
(`evidence-integration-gpu.log`) — the decision and its evidence now reach the log on the
`/detect-gpu` path the settings page actually calls, which is what INV-2 is for:

```
INFO gpu_detect: CUDA runtime version detected (driver-reported) cuda_version=13.3 source="nvidia-smi --version"
INFO Detected NVIDIA GPU (CUDA available) cuda_version=13.3 source="nvidia-smi --version"
```

## Results

- **TEST-1**: PASS
- **TEST-2**: PASS
- **TEST-3**: PASS
- **TEST-4**: PASS
- **TEST-5**: PASS
- **TEST-6**: PASS
- **TEST-7**: PASS
- **TEST-8**: PASS
- **TEST-9**: PASS
- **TEST-10**: PASS
- **TEST-11**: PASS
- **TEST-12**: PASS
- **TEST-13**: PASS
- **TEST-14**: PASS
- **TEST-15**: PASS
- **TEST-16**: PASS
- **TEST-17**: PASS
- **TEST-18**: PASS
- **TEST-19**: PASS
- **TEST-20**: PASS
- **TEST-21**: PASS
- **TEST-22**: PASS
- **TEST-23**: PASS
- **TEST-24**: PASS
- **TEST-25**: PASS
- **TEST-26**: PASS
- **TEST-27**: PASS
- **TEST-28**: PASS
- **TEST-29**: PASS
- **TEST-30**: PASS
- **TEST-31**: PASS
- **TEST-32**: PASS
- **TEST-33**: PASS
- **TEST-34**: PASS
- **TEST-35**: PASS
- **TEST-36**: PASS
- **TEST-37**: PASS

Acceptance tests, one per invariant, all PASS: TEST-1 (INV-1), TEST-24 (INV-2), TEST-6 (INV-3),
TEST-8 (INV-4), TEST-27 (INV-5).

### Where each test lives, and why the A11 gate initially refused these passes

A11 exists to stop a PASS nobody earned. It credits a `TEST-N` only when the ID or its declared
`file:` appears in `git diff origin/main...HEAD`. **Twenty-three of these tests live inside the
`sdk` submodule**, where that diff shows only a gitlink — the validator cannot traverse into a
submodule, so it correctly refused to credit them rather than trusting my word.

They are not unearned; they are unreachable to the gate. The split, so a reader can check
rather than take this on faith:

| tests | file | run by |
|---|---|---|
| TEST-1, TEST-23..TEST-30, TEST-33, TEST-34, TEST-37 | `src-app/server/…/utils/gpu_detect.rs` (in this branch's diff) | `cargo test -p ziee --lib gpu_detect::` → 28 passed |
| TEST-2..TEST-22, TEST-31, TEST-32 | `sdk/crates/ziee-hardware/src/gpu_version.rs` | `cargo test -p ziee-hardware --features gpu-detect --lib` → 46 passed |
| TEST-35, TEST-36 | `sdk/crates/ziee-hardware/src/detection.rs` | same |

The sdk-side commits are `9951ab8` and `3ac7efb` on branch `fix/gpu-version-parse`, pinned by
this branch's submodule gitlink. `git -C sdk log --oneline c38e9fc..HEAD` shows them, and
`git -C sdk show --stat <sha>` shows the test files.

A pointer to this split is now in `gpu_detect.rs`'s module header, because "the parser's tests
are in a different crate, in a different workspace, behind a feature flag that is off by
default" is exactly the kind of fact that gets lost — and it is what made these passes invisible
to the gate in the first place.

Tests added during the audit rounds beyond the phase-3 enumeration, all PASS:
`prose_containing_the_key_is_not_read_as_a_version`,
`value_glued_to_a_table_border_still_parses`, `unc_paths_are_refused`,
`build_pending_release_is_not_a_cpu_fallback`, `unix_env_root_rejects_relative_and_dotdot`.

## Frontend

Not applicable, and verified rather than assumed: `git diff origin/main...HEAD --stat` touches
`gpu_detect.rs`, the sdk submodule pointer, and `.lifecycle/` only. No workspace file under
either UI tree is modified, so no `npm run check`, `gate:ui` or e2e tier is required. The one
frontend-adjacent check that *is* affected by the submodule pointer was run explicitly:

```
npm --prefix <abs>/src-app/ui run check:testid-registry
  → testIds.generated.ts up to date (1799 ids)
```

This is why the sdk branch is based on `c38e9fc` rather than `origin/paws`'s tip: at the tip
that check goes **stale/red**, because paws `main` still declares 7 distinct
`template-assistants-*` testids (8 call sites, one id duplicated) that the tip commit removes
from the registry. Measured both ways before choosing.

## The one failure, and why it is not this change

`llm_local_runtime::engine::download::tests::credential_is_withheld_from_untrusted_targets`
fails on `http://[::1]:41234`. **Proven pre-existing** by stashing the entire server-side change
and re-running: it fails identically on the base tree. `download.rs` is outside this feature and
is not touched by the diff. Reported, not fixed.

## Stated plainly as NOT verified

- **macOS.** No Darwin toolchain exists here and a macOS build is out of scope per the owner's
  standing constraint. The macOS build-break fix (both `cfg` arms of `get_cuda_version` now
  present with identical signatures) is verified **by construction, not by compilation**. What
  would actually verify it is `cargo check --target aarch64-apple-darwin`, which needs a target
  std not installed. This is worth CI attention independently: `desktop-release.yml` builds
  Darwin at tag time while macOS CI runs **no Rust at all**, so any macOS-only Rust break
  reaches a release tag unseen — which is exactly how this one would have.
- **Windows.** No Windows host. The env→candidate-dir policy is tested as a pure function with
  injected environment; the real `#[cfg(windows)]` branch of `resolve_system_binary` — including
  `EXE_SUFFIX` appending and candidate ordering — is compiled by no test and executed by none.
  The change cannot regress Windows (an unresolved binary yields today's `None`), but "CUDA now
  detected on Windows" is reasoned, not observed.
- **AMD / ROCm.** No AMD hardware and no `/opt/rocm` on this box. Source 1 is unchanged and every
  added source is parse-or-skip, so the worst case is prior behaviour plus a warning — but the
  added string shapes are documented, not observed.
- Any driver predating `nvidia-smi --version`.
- The published `rocm` artifacts being 12.3 MB — the same size as the `cpu` build — was flagged
  in the task as worth a sceptical look. Not verifiable from this repo; carried forward as a
  finding for whoever owns the release matrix.
