# Realtime SSE delivery to the UI — diagnosis and required behaviour

Status: design source for `fix/realtime-sse-delivery`
Date: 2026-08-24

## The report

> "The UI does not receive realtime updates; only a reload shows them."
>
> **A.** A message sent to Claude Opus 4.8 (Anthropic, cloud) generated a
> conversation title, then spun forever. **The model DID respond — reloading the
> page shows the full answer.**
>
> **B.** A 5.68 GB Qwen model download ran to completion while the onboarding bar
> sat at **0%** and the LLM-providers view showed **"0 bytes / 0 bytes"**. Verified
> independently: the file on disk advanced 90.6% → 99.6% → complete while the UI
> showed nothing.

Both are realtime delivery to the UI failing while the underlying operation
succeeds. The brief asked for them to be investigated together and for any
divergence to be stated explicitly.

**They are two different causes.** A is a cross-origin CORS preflight rejection on
the desktop build; B is a client-side payload-shape mismatch that is independent of
transport. Neither is buffering, compression, a missing flush, or a keepalive.

## How live chat tokens actually reach the UI

This is the part that makes A possible, and it is not obvious from the endpoint
names.

`POST /api/conversations/{id}/messages` is **not** a stream. It returns JSON
immediately and the generation runs in a detached `tokio::spawn`
(`server/src/modules/chat/core/services/streaming.rs`). Live tokens reach the UI
**only** over a separate, per-user, multiplexed SSE connection —
`GET /api/chat/stream`.

That connection is **double-gated**. `publish_frame`
(`server/src/modules/chat/stream/registry.rs`) delivers a frame only to connections
whose `active_conversation == Some(conversation_id)`:

```rust
if conn.active_conversation == Some(conversation_id)
    && conn.sender.try_send(Ok(sse.clone())).is_err()
{ dead.push(*cid); }
```

`active_conversation` is initialised to `None` (`chat/stream/handler.rs:98`) and is
set by exactly one thing: `PUT /api/chat/stream/subscription`, which identifies the
connection by the **`X-Chat-Stream-Connection-Id`** request header
(`chat/stream/handler.rs:31,205`).

So: **no successful subscription PUT ⇒ a healthy, open, empty stream.** The server
logs nothing wrong, the client sees no error, and every frame is dropped at the
registry.

## Root cause A — the desktop CORS allowlist omits the subscription header

The desktop app is built with `frontendDist` (`desktop/tauri/tauri.conf.json:11`),
so the webview is served over the Tauri custom protocol while the embedded server
listens on a dynamically chosen `127.0.0.1:<port>`
(`ui/src/api-client/getBaseURL.desktop.ts` resolves it through the `get_server_port`
IPC command). **Every API call is cross-origin**, and a `PUT` carrying a custom
header requires a CORS preflight.

`desktop/tauri/src/modules/backend/mod.rs:136-151` sets an **explicit**
`allow_headers` list:

```rust
allow_headers: vec![
    "Authorization".to_string(),
    "Content-Type".to_string(),
    "Accept".to_string(),
    "Origin".to_string(),
    // … "Without this entry the browser preflight rejects every mutating
    //     request as soon as the SyncClient is connected …"
    "X-Sync-Connection-Id".to_string(),
],
```

and `create_cors_layer` (`sdk/crates/ziee-framework/src/app_builder.rs`) falls back
to `allow_headers(Any)` **only** when that list is empty or contains `*`. An
explicit list is enforced verbatim. `X-Chat-Stream-Connection-Id` is not in it.

### Measured, on the owner's live instance

A read-only preflight probe against the running app (pid 944261, port 8082):

```
$ curl -s -i -X OPTIONS http://127.0.0.1:8082/api/chat/stream/subscription \
    -H 'Origin: tauri://localhost' \
    -H 'Access-Control-Request-Method: PUT' \
    -H 'Access-Control-Request-Headers: authorization,content-type,x-chat-stream-connection-id'
HTTP/1.1 200 OK
access-control-allow-methods: GET,POST,PUT,PATCH,DELETE,OPTIONS
access-control-allow-headers: authorization,content-type,accept,origin,x-sync-connection-id
access-control-allow-origin: tauri://localhost
```

The requested header is absent from the response, so the browser refuses to send
the `PUT` at all.

### Why it presents as an infinite spinner rather than an error

A preflight rejection makes `fetch` **reject** — a network error, not a non-2xx
status. `ChatStreamClient.putSubscription` handles the two cases differently:

```ts
      if (!resp.ok) {            // ← never reached: there is no response
        connectionId = null
        activeAbort?.abort()     // forces a reconnect + re-PUT
      }
    } catch (error) {
      console.warn('[chat-stream] subscription update failed', error)   // ← this
    }
```

The `catch` swallows it. `connectionId` stays set, the stream stays open, nothing
retries. Downstream, `applyStreamFrame` is the only thing that clears
`isStreaming`, and `reloadOpen` bails while `isStreaming` is true — so the pane
cannot self-heal either. "Only a reload shows it" follows directly.

### Corroborating detail

The conversation **title** did appear. Titles ride the `sync` stream, whose header
**is** allowed. That asymmetry is the fingerprint of this bug rather than of a
transport failure: two SSE streams built the same way, one working and one not,
differing only in whether their control header survived preflight.

## Root cause B — the download consumer writes the wrong shape

Independent of transport, and independent of A.

`ui/src/modules/llm-provider/stores/llmModelDownload/actions/subscribeToDownloadProgress.ts:92`:

```ts
                return update
                  ? ({ ...download, ...update } as DownloadInstance)
                  : download
```

`DownloadProgressUpdate` is **flat** — the server's `From<&DownloadInstance>`
(`llm_model/handlers/downloads.rs:64-84`) flattens `progress_data` into top-level
`current` / `total` / `speed_bps` / `eta_seconds` / `message` / `phase`.
`DownloadInstance` keeps them **nested** under `progress_data`. The spread therefore
grafts stray top-level keys onto the row and leaves `progress_data` at whatever the
initial REST snapshot held — zeros for a just-started download. The
`as DownloadInstance` cast is what stopped `tsc` reporting it.

Every renderer reads the nested field:

| surface | file:line | symptom |
|---|---|---|
| LLM-providers list | `components/downloads/DownloadItem.tsx:61-69` | `formatBytes(0)` → **"0 Bytes / 0 Bytes"** |
| progress bar | `components/downloads/DownloadProgress.tsx:17` | `total > 0 ? … : 0` → **0%** |
| hub card | `modules/hub/…/ModelHubCard.tsx:582-587` | **0%** |

One store feeds every one of them, which is why the onboarding step and the
LLM-providers view were wrong together. The same handler reads the *flat* fields
correctly for status transitions (`u.status`, `u.provider_id`), which is why
completion and row-removal still worked while the bar never moved.

The sibling runtime-version store
(`modules/llm-local-runtime/stores/runtimeDownloadProgress/subscribeToKey.ts:51-63`)
maps each field explicitly and is correct — the defect is specific to
`llmModelDownload`.

## Three prior theories, disproven

**1. "The response was lost at finalize"** — the `Extension get_accumulated_content
returned 0 items` line. Two lines further on, the same log reads:

```
18:25:00 mcp::chat_extension: Message ca5bc26a… has 1 content blocks
18:25:00 mcp::chat_extension:   Content block: type='text', sequence=0
18:25:00 mcp::chat_extension: No tool uses found and stop_when_no_tool_calling=true, conversation complete
```

The answer was persisted and the turn completed cleanly. The `0 items` line refers
to *extension-accumulated* content, not the message body.

**2. "Clients keep disconnecting from the download monitor."** They do not.
`broadcast_event` (`llm_model/handlers/downloads.rs:510-526`) removes a client only
when `UnboundedSender::send` fails — i.e. when its stream is already gone. The
decisive evidence is that the log contains `Starting download monitoring service`
**once**, at 18:29:33, and **no** "stopping" line, yet broadcasts were still
running at 18:32:30 and 18:35:17. The monitor was alive and delivering progress
frames for the whole transfer. The removals correspond to the app restarts at
18:29:02 / 19:01:29 / 19:05:14.

**3. "Compression is buffering SSE"** — re-checked as the brief asked.
`CompressionLayer` occurs exactly once in the tree
(`desktop/tauri/src/modules/backend/server_boot.rs:107-115`) and is scoped to the
`#[cfg(not(debug_assertions))]` static-file **fallback service**. `/api/*` never
traverses it in either build. The API router's own layers are a 16 MB body limit, a
660 s `TimeoutLayer` (which races the inner service future, not the response body,
so it cannot truncate an SSE stream), security headers, extensions and CORS.

## Required behaviour

These are the non-negotiables this fix must deliver. They are lifted verbatim into
`PLAN.md`'s `## Invariants` and each is pinned to an executable acceptance test.

1. **A custom request header the API reads must be accepted by the API's own CORS
   preflight, in every deployment shape, without a config file having to remember
   it.** Today's mechanism requires every explicit `allow_headers` list (desktop's,
   `dev.example.yaml`'s, and every operator's) to independently re-list a header the
   server itself defines, and forgetting one is silent.

   **Honest limit of what this delivers.** It removes the N-places problem, not the
   remembering: a single server-side list is now the one place a header must appear,
   and no deployment can drop it. Adding a FOURTH custom header still requires
   adding it to that list, and no test can fail if someone forgets — nothing
   mechanically connects the list to the headers the client actually sends. A
   source-scanning guard was deliberately NOT written: that guard class has failed
   to converge twice in this repo (the activity rail's 20 non-converging audit
   rounds, and `gate-ui`'s port guard), and a predicate over "which headers does the
   frontend send" has exactly the unbounded evasion space those had.

2. **A chat turn's tokens must reach the client that is viewing the conversation,
   while the turn is generating — not only on reload.**

3. **A download's progress, as RENDERED by the UI, must advance while the transfer
   runs.** Asserting that the server wrote the record is not evidence; the previous
   round asserted exactly that and the write was never the broken half.

4. **A realtime delivery failure must not present to the user as "still working".**
   A subscription that cannot be established is a hard failure and must be
   surfaced, not swallowed into a `console.warn` behind a permanent spinner. It
   must also stay surfaceable: reporting once per page load is not enough, because
   the next turn clears the banner and re-enters the spinning state.

   The user-visible policy this implies, stated so it is a decision and not an
   accident: the banner appears after **3** consecutive failed subscription
   attempts (~7 s, given the client's 1s/2s/4s reconnect backoff) and re-appears
   every 5 further consecutive failures while the condition persists. A transient
   blip shorter than three attempts stays silent.

## Scope boundaries (recorded, not silently dropped)

- **The `reloadOpen` self-heal hole.** This document's own causal chain names it:
  `reloadOpen` bails while `isStreaming` is true, so the pane cannot recover on its
  own. A mid-turn stream drop that loses the `complete` frame reproduces the
  identical wedge — and reports nothing, because the post-reconnect subscription
  PUT succeeds. That is a PRE-EXISTING hole, not one this change introduces, and it
  is left alone deliberately: the `isStreaming` guard exists to stop a refetch
  clobbering a live streaming buffer, so relaxing it is a change to the streaming
  data path with its own failure modes, not a one-line fix. Escalated rather than
  attempted here. (Surfaced by the blind design-conformance audit, which was right
  that leaving it unrecorded amounted to silently dropping it.)
- **A download row that exists only on another device.** The SSE `update` handler
  merges into rows already in the store; an update for an unknown id is discarded
  and no row is created, so a download started in another tab renders nothing until
  a refetch. Pre-existing, and not a patch: the wire event does not carry the
  fields a row needs (`request_data.display_name` and friends), so materialising
  one is a feature with its own design. Recorded because INV-3 is stated
  unconditionally and this is a case it does not reach.
- **A global end-to-end streaming deadline** that flips a stalled turn to a terminal
  error. It affects every provider and every slow model and is a product decision,
  not a bugfix. Invariant 4 above is satisfied at the actual defect — the
  undeliverable subscription; a turn that streams and then stalls upstream remains
  an open question for the owner.
- **The download monitor's other latent fragility.** `start_download_monitoring`
  (`downloads.rs:410-494`) is spawned only from the subscribe handler,
  self-terminates on its first (immediate) tick if `get_all_active()` is empty, and
  dies permanently on a single transient DB error; the `remove_client` at `:389` is
  unreachable on client disconnect, so pool removal depends on a later broadcast
  failing. None of this fired in the observed session (the query at
  `repository.rs:1042` selects *every* status, so it is empty only on a virgin
  install, and the client only subscribes once a download is already in its store —
  `setupDownloadTracking.ts:14-22`). Only the missing `KeepAlive` is fixed here: it
  is one line, it matches every other SSE route in the tree, and an idle SSE
  connection with no keepalive is a real hazard over the ngrok tunnel path this app
  supports.
