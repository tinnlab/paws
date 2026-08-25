# BASE — gpu-backend-detect

## Refs this branch was cut from

| repo | ref | commit |
|---|---|---|
| paws superproject (`tinnlab/paws`) | `origin/main` | `1e6d93449` — *Merge pull request #10 from tinnlab/feat/default-model-onboarding* |
| sdk submodule (`ziee-ai/sdk`) | `origin/paws` | `8693247` — *chore(kit): regen testId registry after paws removed the assistant-templates page* |
| agent-kit submodule | `main` | `f9ffa599f793e13ba5622742b61bd21e0d0ba168` |
| pgvector submodule | `v0.8.2` | `cab9da72c04353f143bb06b42ab70a403daac64a` |

Branches: paws `fix/gpu-backend-detect`; sdk `fix/gpu-version-parse`.
Worktree: `/data/khoi/home-workspace/paws-wt-gpu-detect`.

## Base corrections applied before cutting

- The first plan draft named `b6cebdb15` as `origin/main`. That was **stale** — PR #10 landed
  in the interim. Re-fetched and cut from `1e6d93449`.
- The sdk line for this project is the dedicated **`paws`** branch on `ziee-ai/sdk`, not `main`
  and not `chat` (`chat` belongs to another platform). The sdk branch is cut from `origin/paws`
  and will be PR'd back into `paws`.
- paws `main` pins the sdk at `c38e9fc`, which is exactly **one** commit behind `origin/paws`.
  The submodule pointer bump in this branch's PR therefore carries one unrelated,
  already-on-paws commit (`8693247`) in addition to this feature's sdk commit. Recorded here so
  it is not read as scope creep.

## Concurrent writer on the same submodule

The `realtime-sse` worker is modifying the sdk in this same window — it adds
`create_cors_layer_with` to `sdk/crates/ziee-framework/src/app_builder.rs`, also branching from
`paws`. **File sets do not overlap**: this branch touches `sdk/crates/ziee-hardware/**` only.
The **submodule pointer in the paws superproject does** overlap. Ordering rule agreed with the
lead: whichever sdk PR merges into `paws` first, the other rebases its sdk branch onto the
updated `paws` and **re-pins the pointer** in its paws PR before that PR can merge.
`origin/paws` is re-checked immediately before requesting merge; it is not assumed static.

## Environment gate

`bash .claude/lifecycle/preflight.sh --repo /data/khoi/home-workspace/paws-wt-gpu-detect`
→ **OK — environment ready** (7/7). Two blockers were fixed first: the hub-seed build seed was
absent (copied from the primary clone; `build.rs` panics without it, unlike every other build
helper) and the root `node_modules` hoist was missing (`npm install` at the repo root).
`config/dev.yaml` was auto-seeded by preflight with a generated `jwt.secret`.

## Host facts (read-only capture; zero GPU memory allocated)

4× NVIDIA H200 NVL, compute capability 9.0, 143771 MiB each. Driver/KMD **610.43.02**,
CUDA UMD **13.3**, toolkit **13.3.33** (`/usr/local/cuda` → `/etc/alternatives/cuda` →
`/usr/local/cuda-13.3`), cudart **13.3.29**. `nvidia-smi` at `/usr/bin/nvidia-smi`, `nvcc` at
`/usr/local/cuda/bin/nvcc`. No `/opt/rocm` — this box is NVIDIA-only, so every ROCm change here
is **unverifiable against hardware** and is labelled as such.

GPUs 1–3 hold other workloads (GPU 2 essentially full, GPU 3 at 100% util); GPU 0 is idle.
Nothing in this feature's verification allocates GPU memory or starts an engine.
