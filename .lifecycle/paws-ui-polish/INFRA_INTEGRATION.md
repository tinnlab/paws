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
