# INFRA_INTEGRATION — the mandatory per-item walks

## ITEM-12 — the item-5 reproduction (RUN, not read)

Reproduced on a self-owned desktop instance built from this worktree
(`XDG_DATA_HOME=/tmp/paws-uipolish-1/data`, `HOME=/tmp/paws-uipolish-1/home`,
under `xvfb-run`; the owner's instance and `~/.local/share/com.ziee.chat` were
not touched). Backend on `127.0.0.1:8084`.

### Sequence driven

The literal reported sequence, on the **Add-Local-Model / download-from-
repository** path (the onboarding path's extra legs are covered separately
below):

1. Enable the built-in `Local` provider (it ships disabled).
2. Install a llama.cpp runtime (`v0.0.3-alpha`, cpu variant, 12.9 MB) and make
   it the system default.
3. Create an anonymous repository row for `https://huggingface.co/unsloth`.
4. `POST /api/llm-models/download` for `Qwen3-0.6B-GGUF` /
   `Qwen3-0.6B-Q2_K.gguf` (296 MB — a real transfer, small enough to iterate).
5. The instant the download completed, create a conversation on the new model
   and `POST /conversations/{id}/messages`.

### What happened — the defect, observed

```
00:03:25.988515  validator: enqueued model 3117c338… tier Tier2
00:03:25.988600  Model created successfully: 2 files, 296239536 total size
00:03:25.988789  Model created successfully from download: Qwen3 0.6B (repro)
00:03:25.992237  validator: enqueued model 3117c338… tier Tier2     ← TWICE, 4 ms apart
00:03:27.328860  Using runtime version: llamacpp v0.0.3-alpha        ← validation pass #1 spawns the engine
00:03:53.302001  ERROR chat: provider stream failed to start for conversation
                 88ee9813…: Provider error: missing per-instance bearer token
00:03:53.891328  Process for model 3117c338… stopped gracefully      ← pass #1 tears it down
00:03:53.911065  Using runtime version: llamacpp v0.0.3-alpha        ← pass #2 spawns it again
00:04:20.002387  Process for model 3117c338… stopped gracefully      ← pass #2 tears it down
```

`POST /messages` returned **200** (the message rows are created), and the
assistant message stayed **empty** — which is exactly the owner's "it appears
selected in the chat input, but sending a message does not work".

A send issued after validation settled started an engine with no error, and the
model's row read `validation_status = valid`, `enabled = true`,
`capabilities = {"chat": true}`.

**Both halves, side by side in ONE conversation** — same model, same request
body, same branch; the only difference is WHEN:

```
user      | ["Say hi in three words."]
assistant | []                                ← sent inside the window: empty
user      | ["Say hi in three words."]
assistant | [null,"hi in three words."]       ← sent after it closed: a real reply
```

That is the reproduction closed. It also settles the "reloading makes it work"
observation: no reload happened between those two sends.

### Root cause — a THIRD transited state, not either of the two I predicted

PLAN.md predicted the window would be the draining flag or a `running` instance
row pointing at a dead port. The observed state is neither, and the plan said a
third state becomes its own item rather than being folded in silently — so:

`LocalDeployment::stop` (`deployment/local.rs:1103-1112`) removes the model's
entry from the process-global `INSTANCE_API_KEYS` map **first**, before killing
the process and before the `llm_runtime_instances` row leaves `status='running'`.
The chat path (`proxy_handlers.rs:316-335`) reads those two in the opposite
order: it resolves `get_running_instance_base_url` (the DB row — still
`running`), then `get_instance_api_key` (the map — already cleared), and returns

```
502 engine_start_failed: "missing per-instance bearer token"
```

So the failing window is **between the bearer being dropped and the DB row being
updated**. It is the same hazard `validator.rs:316-321` warns about by hand ("a
later chat would see already_running=true and forward to a dead port") — the
failure just lands one step EARLIER, on the token rather than on the socket.

The double enqueue does not create the window; it **doubles how long it is
open**, since each pass is a full spawn → health-probe → teardown cycle
(≤90 s each, serialized server-wide). Two passes ran here across ~55 s.

### What this corrects in the brief's framing

The task framed this as the "state correct on the server, never reaches the
client" family. **It is not that.** The evidence against:

- Download completion publishes BOTH `LlmModel` and `UserLlmProvider` with
  `origin = None`, and `ModelPicker` reloads on `sync:user_llm_provider` — which
  is why the model correctly APPEARS selected.
- The composer's rendered model and the send path's `model_id` come from the
  same `selectedByConversation` map, and there is no client-side readiness gate.
- The failure is a server-side 502 from the local proxy, reproduced with no
  browser in the loop at all.

"Reloading the page makes it work" is therefore **incidental**: by the time the
user reloads and re-sends, the validation passes have finished. Nothing about
the reload fixes anything. This is stated in the PR rather than quietly
reframed.

Two real emission/subscription defects were still found on the way and are
fixed on their own merits (ITEM-15, ITEM-16) — but neither is the cause of the
reported symptom, and the PR says so.

### The onboarding path

The onboarding default-model step adds three legs before the same download:
enable the Local provider, assign it to a group, install a runtime. All three
were performed by hand here, so the reproduced sequence covers the same end
state. The step then calls the identical
`downloadLlmModelFromRepository` action, reaching the identical
`initiate_repository_download_internal` → `create_model_with_files` path — so
the double enqueue and the teardown window are common to both paths, not
specific to either. The only onboarding-specific difference is that it hardcodes
the 5.68 GB model, which lengthens the transfer but not the window.

## Entity-lifecycle walk — the sidebar bottom row (ITEM-4 / ITEM-5)

The row holds slot ENTRIES, not domain entities, but the same question applies:
what happens when one goes away?

- **Removed (download finishes / is cleared)** — `DownloadIndicatorWidget`
  returns `null`, so the row drops from two children to one. Verified by
  running it: TEST-5's first leg loads the app with no downloads and asserts the
  lone bell still sits inside the row. This is the COMMON state, not an edge
  case.
- **Added (a download starts)** — the widget appears beside the bell. Verified
  by seeding a `download_instances` row and reloading.
- **Both absent** — the container is `bottomWidgets.length > 0`-guarded and
  renders nothing; the footer separator below is unaffected.
- **Permission loss** — `bottomWidgets` is filtered by `isAllowed`, so a user
  without `llm_models::downloads::read` never mounts the download widget (and
  never fires its fetch). Unchanged by this work.
- **Icon-only sidebar** — the row is still suppressed (`!isIconOnly`), unchanged.

## Infrastructure walk — what ITEM-6/7 touch

- **Chat pipeline** — the skill chat extension (order 15) injects the
  available-skill listing as `messages[0]` of every tool-capable chat. Removing
  three built-ins shortens that listing; nothing else in the pipeline reads the
  skill set.
- **skill_mcp** — `load_skill` / `read_skill_file` resolve through
  `find_accessible_by_name`, which enforces `enabled = TRUE` plus the scope
  union. A pruned row is gone from both.
- **Permissions** — unchanged; the migration grants nothing and revokes nothing.
- **Sync** — `sync:skill` is emitted by the REST mutation handlers, not by the
  boot sync or by a migration. A pruned row therefore does NOT push a live
  update to an already-open client; the removal takes effect for that client at
  its next skill fetch or reload. Stated rather than glossed: it is a one-shot
  data migration, so this is correct behaviour, not a gap.
- **Hub seed** — `resources/hub-seed/` is the tracked source that
  `build_helper/hub_seed.rs` copies into `binaries/hub-seed/` for `include_dir!`.
  Verified live: the boot log reads `skill: synced 10 built-in capability
  skill(s)` (was 13), and `GET /api/skills` returns exactly the ten survivors
  with none of the three removed.
  (Note for the PR: CLAUDE.md still describes the hub seed as "fetched fresh
  from the ziee-ai/hub GitHub release on every cargo build". That is stale —
  the helper's own header documents the Pages-migration rewrite to a tracked
  in-repo snapshot. Not corrected here; recorded as a follow-up.)

---

## ITEM-5 — final empirical verification (2026-08-26, redesign per owner option (b))

Instance: `/tmp/paws-uipolish-2`, port 8126, own `XDG_DATA_HOME`, embedded PG :50001.
Fresh first-run setup, so `auto_start_timeout_secs` came from the SHIPPED default —
verified `row=180 / coldefault=180` straight after boot, NOT hand-set. The owner's
requirement ("either ship the changed default or demonstrate the fix at the value
that actually ships") is therefore met by the fresh-install path itself.

### What the repro sequence was

Real repository download (unsloth `Qwen3-0.6B-GGUF`, `Qwen3-0.6B-Q2_K.gguf`,
296,238,784 bytes — size asserted each run), then a chat send issued while
`llm_models.validation_status` still read `processing`. That state was read from
the DB at send time and is quoted in each run below, so "inside the window" is
evidence, not assumption.

### Run log — four runs, three of which FAILED, and why that matters

| run | build | validation at send | result |
|---|---|---|---|
| 1 | de-dup + drain only | processing | `Model instance already running already exists`, empty message |
| 2 | + `Liveness::Starting`, 180s default | processing | `did not become healthy in time` — **invalid run**, see below |
| 3 | + fail-fast + honest `status()` | processing | engine ran, chat processed, **0 content blocks** |
| 4 | + validation hand-off | processing | **ANSWER RETURNED, no reload** |

**Run 2 proved nothing and is not counted as evidence.** Its model file was a
134-byte git-LFS POINTER, not a GGUF — a defect in MY repro setup (re-downloading
the same repo reused the git cache, whose working tree held the pointer). The
engine died in 27ms with `invalid magic characters: 'vers', expected 'GGUF'`.
Subsequent runs wipe `cache/git` first and assert the 296 MB size before sending.
Recording this rather than quietly re-running it: a green-after-N-tries claim with
the failures elided is not a verification.

Run 2 was still USEFUL — it surfaced two real defects (below) that a clean run
would have hidden.

### The four defects this sequence found, in the order they were exposed

1. **Double Tier-2 enqueue** (`uploads.rs:347` + `:1365`). Fixed earlier; run 4's
   log shows `validator: enqueued` exactly ONCE.

2. **The single-flight was not cancellation-safe.** `tokio::sync::OnceCell`'s init
   future ran inline in whichever caller arrived first. The validator wraps its
   `ensure_running` in an OUTER `timeout`; when that fired it DROPPED the future,
   cancelling init mid-spawn while the child kept running. `OnceCell` handed init
   to the next waiter — the chat — which re-entered `do_start` and collided with
   the live child. Run 1's collision landed **90s after the spawn, to the second**,
   exactly the old flat `TIER2_HEALTH_DEADLINE_SECS = 90`. Fixed by running the
   leader in a detached `tokio::spawn` with waiters observing a `watch` channel,
   and by deriving the validator's outer deadline from `auto_start_timeout_secs`
   so it can never again be shorter than the bound it wraps.

3. **`status()` reported a zombie as running.** `Child::id()` keeps returning
   `Some` for a child that exited but was never waited on. Observed directly: the
   engine sat as `Z (defunct)` while the server polled `/health` for the full
   180s. This ALSO defeated the new `Liveness::Starting` arm, which would have
   read a dead engine as "still loading" — strictly worse than the old behaviour.
   Fixed by making `status()` use `try_wait()` under a write lock, which reaps the
   zombie as a side effect.

4. **Validation tore down the engine its own waiter was waiting for.** Draining
   closed the window where a send was already forwarding, but not the one before
   it: a chat inside `ensure_running` holds an in-flight guard and has not issued
   its request, so the drain waits on a counter its own waiter holds, times out,
   and kills the engine at the instant the waiter is told it is ready. Run 3
   measured `stopped gracefully` at `19:27:16.946319` and `Finalize called` at
   `19:27:16.946730` — **0.4ms apart**, assistant message empty, and no error
   logged anywhere. Fixed by making validation HAND OFF: if `inflight > 0` it
   leaves the healthy engine running and lets the idle reaper own eviction.

### Run 4 — the passing run, in full

```
19:36:45  validator: enqueued model 9c1d7017… tier Tier2        <- ONCE
19:36:47  Using runtime version: llamacpp v0.0.3-alpha          <- ONE spawn
19:37:09  validator: model 9c1d7017… validated and has 1 in-flight
          request(s) — leaving the engine running for them;
          the idle reaper will evict it                          <- hand-off
19:39:32  Finalize called for message_id=e5693c33…               <- answered
```

Assistant message content: `"</think>\n</think>"`. That is garbage TEXT, and it is
supposed to be — a 0.6B model at Q2_K produces nonsense. The claim being verified is
that a response streams back at all without a reload, which is what failed before.
Absent from run 4's log: `already exists`, `stream failed to start`,
`did not become healthy`, and any `stopped gracefully` during the chat.

### Follow-up NOT fixed here (deliberately out of scope)

A model created from a 134-byte LFS pointer is accepted as a valid model
(`Model created successfully: 2 files, 886 total size`). Tier-2 validation does
flag it (`validation_warning`), and chat does not consult validation status before
attempting a send — arguably correct, since a warning is not a block. Recording it
because it was observed, not asserting it is a bug. This branch is already HEAVY;
it is not growing further for it.
