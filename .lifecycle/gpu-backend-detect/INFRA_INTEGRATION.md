# INFRA_INTEGRATION — gpu-backend-detect

How this change meets the surrounding infrastructure, and what it deliberately does not touch.

## Build / workspace topology

The change spans **two cargo workspaces**, which is unusual here and worth stating:

- `src-app/` (workspace, `resolver = "3"`) — the `ziee` server crate.
- `sdk/` (a separate workspace, `resolver = "2"`) — `ziee-hardware`, reached from `ziee` as a
  **cross-workspace path dependency** (`src-app/server/Cargo.toml:64`), not as a workspace
  member. `cargo check -p ziee` therefore compiles `ziee-hardware` even though it is not in
  `src-app`'s member list, and each workspace keeps its own `Cargo.lock`.

Consequences that shaped the implementation:

- The new `gpu_version` module is **not** behind the `gpu-detect` feature. `ziee-hardware`
  declares no `default` feature set, so a gated module would be invisible to a
  `--no-default-features` consumer. `ziee`'s own `default = ["gpu-detect", …]` only *adds* the
  feature.
- `ziee-hardware` has **no `[lints]` section**, so the workspace `unused_imports = "deny"` /
  `unused_mut = "deny"` policy does **not** apply there — but `src-app/server` **does** opt in
  (`Cargo.toml:10-11`). That asymmetry is why all Windows-only code sits inside
  `#[cfg(windows)]` blocks in the function body rather than behind top-level imports: an import
  unused on Linux would be a hard compile error, not a warning. It is also what caught
  `let mut collect` (DRIFT-1.5).
- **Running cargo in the `sdk/` workspace on Linux mutates `sdk/Cargo.lock`**, adding
  `webkit2gtk` to a tauri-desktop package's dependency list. It is unrelated to this change and
  reappears after every cargo invocation there. It is reverted immediately before each commit
  and re-checked; `git diff Cargo.lock` in the submodule must be empty at commit time.

## Cargo config discovery

`cargo` finds `src-app/.cargo/config.toml` by walking up from the **invocation directory**, not
from `--manifest-path`. That file supplies `ZIEE_POSTGRES_VERSION`, `POSTGRESQL_VERSION`,
`DATABASE_URL` and the libseccomp settings, and `server/build_helper/pgvector.rs` reads
`ZIEE_POSTGRES_VERSION` via `env!()` at compile time — so a bare
`cargo test --manifest-path src-app/Cargo.toml` from elsewhere fails the build script with
*"environment variable `ZIEE_POSTGRES_VERSION` not defined at compile time"*. Every cargo
command in this feature's evidence therefore passes
`--config <abs>/src-app/.cargo/config.toml` explicitly.

## Submodule / branch integration

- sdk branch `fix/gpu-version-parse` is cut from `origin/paws` (the project's sdk line) and PRs
  back into `paws`. paws `main` pins the sdk one commit behind `origin/paws`, so the pointer
  bump carries one unrelated already-on-paws commit (`8693247`) alongside this feature's.
- A **concurrent writer** (`realtime-sse`) is editing `crates/ziee-framework/` on its own branch
  off `paws`. File sets do not overlap; the **superproject submodule pointer** does. Whoever
  merges into `paws` first, the other rebases and re-pins before their paws PR can merge. Stated
  in the PR body and in the shared STATUS file, and `origin/paws` is re-checked immediately
  before requesting merge.

## What is deliberately NOT integrated

- **No OpenAPI regeneration.** Verified rather than assumed: neither touched file contains a
  `JsonSchema` derive, no handler signature or route changed, and `GPUComputeCapabilities`
  (which does derive `JsonSchema`) changes only the *value* in an existing
  `cuda_version: Option<String>`, not the type. Zero schema delta.
- **No frontend workspace file.** Confirmed against the real diff, not just intended: the branch
  touches `gpu_detect.rs`, the three `ziee-hardware` files, and the submodule pointer. This is
  what keeps the lifecycle classifying the change as backend work.
- **No migration, no permission, no route.**

## Pre-existing infrastructure breakage inherited (reported, not fixed)

- `just check` fails before reaching anything this feature touches: `justfile:73` runs
  `check-schema-sync`, which greps `src-app/sandbox-rootfs/compat.toml` — deleted when the
  rootfs build moved to the standalone repo. Phase 8 therefore runs the per-crate cargo
  commands directly and says so, rather than reporting a gate it did not actually pass.
- `llm_local_runtime::engine::download::tests::credential_is_withheld_from_untrusted_targets`
  is red on `origin/main` (proven by stashing this change and re-running).
- `.lifecycle/default-model-onboarding` is committed on `main`, so `lifecycle-check.mjs`
  requires `--dir` — which resolves against the process cwd, not `--repo`, so it must be
  absolute.
