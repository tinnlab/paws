# PLAN — realtime SSE delivery to the UI

## Design source

Realizes `docs/design/realtime-sse-delivery.md` — the diagnosis written for this
branch — specifically its *Root cause A*, *Root cause B* and **§ Required
behaviour** (items 1-4, lifted verbatim as the invariants below). It is written in
the shape of the existing `docs/design/empty-completion-diagnosis.md`, which is this
repo's precedent for a diagnosis-as-design-source.

Upstream report: the owner's task brief
`/data/khoi/home-workspace/paws-worker-tasks/realtime-sse.md` ("the UI does not
receive realtime updates; only a reload shows them"), plus the existing documented
contract in `CLAUDE.md` § *Realtime Sync* and the module doc-comments on
`server/src/modules/chat/stream/{handler,registry,event}.rs`.

## Invariants

- **INV-1**: A custom request header the API reads must be accepted by the API's own CORS preflight, in every deployment shape, without a config file having to remember it.
- **INV-2**: A chat turn's tokens must reach the client that is viewing the conversation, while the turn is generating — not only on reload.
- **INV-3**: A download's progress, as RENDERED by the UI, must advance while the transfer runs.
- **INV-4**: A realtime delivery failure must not present to the user as "still working".

## Items

- **ITEM-1**: [sdk] Add `create_cors_layer_with(config, always_allow: &[&str])` to `ziee-framework`'s `app_builder`. When the config supplies an EXPLICIT `allow_headers` list, the always-allow headers are UNIONED into it (case-insensitively deduped) instead of being droppable by omission; the wildcard / empty-list `Any` branches are unchanged. `create_cors_layer(config)` keeps its exact signature and delegates with the framework's OWN custom request header (`X-Sync-Connection-Id`), so nothing that calls it today changes behaviour except to become correct.
- **ITEM-2**: [server] Introduce ONE canonical list of the custom request headers ziee's API reads — sourced from the real constants, not re-spelled string literals — and make `ziee::create_cors_layer` a thin wrapper that feeds it to `create_cors_layer_with`. `chat::stream::handler::CHAT_STREAM_CONNECTION_HEADER` becomes `pub` for this. All four existing call sites (`main.rs`, `lib.rs`, `desktop/tauri/src/lib.rs`, `server_boot.rs`) are unchanged.
- **ITEM-3**: [desktop] Extract the desktop `CorsConfig` construction out of `BackendModule::init(&mut self, app: &mut App)` into a pure `desktop_cors_config(port) -> ziee::CorsConfig`, and add `X-Chat-Stream-Connection-Id` to its explicit list. Today that config can only be exercised by launching Tauri, which is why the missing header survived; a pure function is testable.
- **ITEM-4**: [config] `src-app/server/config/dev.example.yaml`'s `server.cors.allow_headers` gains both custom headers, so an operator copying the example does not inherit the same silent break.
- **ITEM-5**: [ui/chat] `ChatStreamClient.putSubscription` treats a REJECTED fetch (network / CORS-preflight refusal) exactly like the already-handled non-2xx: drop the connection id and abort the live stream so the connect loop reconnects and re-PUTs. After `SUBSCRIPTION_FAILURE_LIMIT` consecutive failures it reports once through a new optional `onSubscriptionError(message)` handler and logs at `error`, instead of swallowing every failure in a `console.warn`.
- **ITEM-6**: [ui/chat] The pane's chat store wires `onSubscriptionError` to the EXISTING error banner (`ConversationPane`'s `chat-conversation-error-alert`, which already has a gallery cell) and clears the flags that otherwise wedge the turn (`sending`, `isStreaming`, `finalizingTurn`), so an undeliverable turn reaches a terminal, actionable state instead of a permanent spinner.
- **ITEM-7**: [ui/llm-provider] The download SSE `update` handler rebuilds `progress_data` from the delivered FLAT fields, falling back per field to the previous value (the server sends them as `Option`, so a null must not blank a figure already on screen), and the `as DownloadInstance` cast that hid the mismatch from `tsc` is removed. The wire format is unchanged — it is shared, and the mismatch is the client's to absorb.
- **ITEM-8**: [server] `GET /api/llm-models/downloads/subscribe` gets `KeepAlive::default()`, matching every other SSE route in the tree (it is the only one without it) and keeping the stream alive over the ngrok tunnel path this app supports.
- **ITEM-9**: [repo] Move the `sdk` submodule pointer to the `paws`-line commit carrying ITEM-1, per the owner's standing sdk policy (branch from `origin/paws`, PR into `paws`; never `chat`/`main`).

## Files to touch

- `sdk/crates/ziee-framework/src/app_builder.rs` — ITEM-1
- `src-app/server/src/core/app_builder.rs` — ITEM-2 (wrapper + canonical list)
- `src-app/server/src/modules/chat/stream/handler.rs` — ITEM-2 (`pub` the constant)
- `src-app/desktop/tauri/src/modules/backend/mod.rs` — ITEM-3
- `src-app/server/config/dev.example.yaml` + `config/prod.example.yaml` — ITEM-4 (DEC-10; DRIFT-1.7)
- `src-app/ui/src/modules/chat/core/stream/ChatStreamClient.ts` — ITEM-5
- `src-app/ui/src/modules/chat/core/stores/chat/index.ts` — ITEM-6 (handler wiring)
- `src-app/ui/src/modules/chat/core/stores/chat/actions/` — ITEM-6 (the reporting action)
- `src-app/ui/src/modules/llm-provider/stores/llmModelDownload/actions/subscribeToDownloadProgress.ts` — ITEM-7
- `src-app/server/src/modules/llm_model/handlers/downloads.rs` — ITEM-8
- `src-app/desktop/tauri/Cargo.toml` — a test-only `tower` dev-dependency for TEST-3 (DRIFT-1.6)
- the `sdk` gitlink (`.gitmodules` itself is NOT touched) — ITEM-9

New / extended test files (TEST-1..4 and TEST-9 are in-source `#[cfg(test)]` modules
alongside the code they cover, per DRIFT-1.1):

- `src-app/server/tests/chat/chat_stream_incremental_test.rs`
- `src-app/server/tests/llm_model/download_stream_keepalive_test.rs`
- `src-app/ui/src/modules/chat/core/stream/ChatStreamClient.subscription.store.test.ts` (DRIFT-1.2)
- `src-app/ui/src/modules/llm-provider/stores/llmModelDownload/subscribeToDownloadProgress.store.test.ts`
- `src-app/ui/tests/e2e/chat/chat-stream-subscription-failure.spec.ts`
- `src-app/ui/tests/e2e/llm/download-progress-sse-render.spec.ts`

## Patterns to follow

- **CORS layer + union (ITEM-1/2)** — mirror the existing branch structure in
  `ziee_framework::app_builder::create_cors_layer` exactly (wildcard/empty ⇒ `Any`,
  else an explicit list); the delegation shape mirrors how
  `apply_rate_limit_layer(app, config, default)` already takes an app-supplied
  default alongside the config.
- **A pure, testable config builder (ITEM-3)** — mirror
  `desktop/tauri/src/modules/backend/mod.rs`'s existing
  `create_desktop_config(&data_dir, port)`, which is already a free function called
  from `init`. `desktop_cors_config(port)` is the same shape.
- **Preflight tests (TEST-1 / TEST-2 / TEST-3)** — drive the real tower layer with
  `tower::ServiceExt::oneshot`, mirroring the sdk's own router test
  `sdk/crates/ziee-framework/tests/sync_origin_extractor.rs`. What a browser obeys
  is the response header, which only the layer produces.
- **Chat-stream consumer test (TEST-5)** — mirror
  `src-app/server/tests/chat/chat_stream_test.rs` and its `ChatStreamProbe`
  (`tests/common/chat_stream_probe.rs`) + `helpers::create_stub_model_with_delay`.
- **Store unit tests (TEST-6 / TEST-7 / TEST-8)** — mirror the existing
  `src-app/ui/src/modules/**/**.store.test.ts` vitest specs, e.g.
  `src-app/ui/src/modules/chat/core/stores/chat/sendMessage.store.test.ts`.
- **Terminal-state e2e (TEST-11)** — mirror
  `src-app/ui/tests/e2e/chat/failed-stream-error-state.spec.ts` in shape: fail
  exactly one boundary; assert the spinner stops + `chat-conversation-error-alert`
  is visible + the composer is usable; plus its positive control.
- **Download-render e2e (TEST-12)** — mirror
  `src-app/ui/tests/e2e/hub/hub-download-progress-1-bar-on-card.spec.ts` for the
  seeding/mocking idiom, and assert on the same surfaces the owner reported
  ("0 Bytes / 0 Bytes" and 0%).
- **Naming/logging** — `tracing::` not `println!`; no `ziee-chat` strings; no Claude
  trailers in commits.

## Non-goals (recorded, not silently cut)

Both are argued in the design doc's *Out of scope*, and neither is a `[DESCOPED]`
PLAN item because neither was ever in scope for this branch:

- A global end-to-end streaming deadline (a product decision affecting every
  provider). INV-4 is satisfied at the actual defect — the undeliverable
  subscription — not by bounding every turn.
- The download monitor's other latent fragility (self-termination on an empty first
  tick, permanent death on one transient DB error, the unreachable `remove_client`).
  Evidence that none of it fired in the observed session is in the design doc; only
  the missing `KeepAlive` is fixed (ITEM-8).

## Plan audit (phase 2)

Audited against the codebase at `origin/main` `1e6d93449`, before writing code.

### Breakage risk

- **`create_cors_layer`'s signature is NOT changed.** It stays
  `fn create_cors_layer(config: &ServerConfig) -> CorsLayer`; the new
  `create_cors_layer_with(config, always_allow)` is additive. All four ziee call
  sites (`server/src/main.rs:270`, `server/src/lib.rs:546`,
  `desktop/tauri/src/lib.rs:156`, `desktop/tauri/src/modules/backend/server_boot.rs:91`)
  go through `ziee::create_cors_layer` (re-exported at `server/src/lib.rs:400` via
  `core/app_builder.rs:18-21`), so replacing that `pub use` with a wrapper of the
  same signature is source-compatible. Verified: `create_cors_layer` has **no other
  caller in the sdk** (`grep` over `sdk/` finds only the definition and its
  doc-comment).
- **The union only widens the EXPLICIT-list branch.** The `*`/empty ⇒
  `allow_headers(Any)` branches are already maximally permissive, so unioning there
  is a no-op by construction. Widening the explicit branch is the intended
  behaviour change and is bounded to headers the server itself defines and reads.
- **Security review of the widening:** the three headers are
  `X-Sync-Connection-Id` (self-echo suppression), `X-Chat-Stream-Connection-Id`
  (stream scoping) and `X-Refresh-Cookie` (cookie-mode opt-in). None is a
  credential; each is already accepted by the handlers. Allowing them at preflight
  grants a cross-origin caller nothing it could not already do with a same-origin
  request, and origin/method allowlisting is untouched.
- **`chat/stream/handler.rs`'s constant becomes `pub`** — a visibility widening
  inside the crate's own module tree, no behaviour change. `X-Refresh-Cookie` and
  `X-Sync-Connection-Id` need no change: `ziee_auth::auth::cookie::REFRESH_COOKIE_OPTIN_HEADER`
  (`sdk/crates/ziee-auth/src/auth/cookie.rs:30`) and
  `ziee_framework::sync::extractor::SYNC_CONNECTION_HEADER`
  (`sdk/crates/ziee-framework/src/sync/extractor.rs:17`) are already `pub`.
- **Desktop `CorsConfig` extraction** removes no behaviour: `init` keeps assigning
  `config.server.cors` for BOTH branches (file-loaded config and
  `create_desktop_config`), exactly as today — only the VALUE moves into a free
  function. Deliberately not folded into `create_desktop_config`, which would stop
  the file-loaded branch being overridden and is a behaviour change beyond scope.
- **ITEM-5's failure path already exists for non-2xx** (`ChatStreamClient.ts:104-115`
  drops the connection id and aborts). Extending it to a rejected fetch means a
  transient network blip now also forces a reconnect instead of being ignored; the
  connect loop already has exponential backoff to 30 s (`ChatStreamClient.ts:24-26,
  132-133`), so the worst case is bounded and strictly more visible than silence.
- **ITEM-7 touches ONE action file.** The peer `provider-visibility` worker is in
  the same module area; confining the change keeps the collision surface minimal.
  The `default-model` worker reverted its version of this file for exactly this
  reason (`BASE.md`).
- **ITEM-8** adds a keep-alive comment frame (`:` heartbeat) every ~15 s to the
  download stream. The client parser (`sdk/packages/framework/src/api-client/core.ts:617-666`)
  dispatches only on `event: ` / `data: ` prefixes, so a comment line is ignored —
  verified by reading the parser, and by the fact that every other SSE route the
  same parser consumes already sends keep-alives.

### Pattern conformance

- `create_cors_layer_with` mirrors the existing
  `apply_rate_limit_layer(app, config, default_when_absent)` shape already in the
  same file (`sdk/crates/ziee-framework/src/app_builder.rs:137`): config plus an
  app-supplied value the framework cannot know.
- `desktop_cors_config(port)` mirrors `create_desktop_config(&data_dir, port)`
  (`desktop/tauri/src/modules/backend/mod.rs:547`), a free function called from
  `init` that already has in-source `#[cfg(test)]` coverage at `:811-853`.
- The preflight tests mirror `sdk/crates/ziee-framework/tests/sync_origin_extractor.rs`,
  which already drives a real layer with `tower::ServiceExt::oneshot`.
- The chat-stream consumer test mirrors `server/tests/chat/chat_stream_test.rs` +
  `tests/common/chat_stream_probe.rs`.
- The e2e specs mirror `tests/e2e/chat/failed-stream-error-state.spec.ts` (fail one
  boundary, assert the terminal state + a positive control) and
  `tests/e2e/hub/hub-download-progress-1-bar-on-card.spec.ts` (seeding idiom).
- ITEM-6 REUSES the existing `store.error` banner (`ConversationPage.tsx:1003-1005`,
  testid `chat-conversation-error-alert`) which already has a gallery cell
  (`chat/gallery.tsx:1158`) — no new render state, so `check:state-matrix` and
  gallery coverage are unaffected.

### Migration collisions

**None — this branch adds no migration and edits none.** Highest in use at base:
server `202607210200`, desktop `10000000000005` (see `BASE.md`). PR #10's
`server/tests/migration_immutability.rs` guard is therefore not engaged.

### OpenAPI regen

**Not required.** No `JsonSchema` type, handler signature, route, permission or
`SyncEntity` variant changes. `KeepAlive` is transport-only; `pub` on a constant
changes no type. Both `openapi.json` files and both `api-client/types.ts` are
expected to regenerate byte-identically (the merge-gate's C3 re-checks this for
`ui/` AND `desktop/ui/`).

### Per-item verdicts

- **ITEM-1** — verdict: PASS — `create_cors_layer` at `sdk/crates/ziee-framework/src/app_builder.rs:201` has no sdk-internal caller; additive `_with` variant is source-compatible. `HeaderName::from_str` lowercases, so case-insensitive dedup is the natural comparison.
- **ITEM-2** — verdict: PASS — `core/app_builder.rs:18-21` re-exports by `pub use`; swapping to a same-signature wrapper leaves `lib.rs:400` and all four call sites untouched. Both non-chat constants are already `pub` in the sdk.
- **ITEM-3** — verdict: PASS — mirrors the existing `create_desktop_config` free-function pattern in the same file, which already has in-source tests.
- **ITEM-4** — verdict: PASS — `config/dev.example.yaml:94-103` already lists `X-Refresh-Cookie` with a rationale comment; adding the two connection-id headers follows that shape. `dev.yaml` is gitignored, so no operator file is rewritten.
- **ITEM-5** — verdict: CONCERN — extending the abort-and-reconnect path to a REJECTED fetch means a transient offline blip now forces a reconnect where it was previously ignored. Accepted: the loop already backs off exponentially to 30 s, and silence is what produced the reported bug. Recorded as DEC-3.
- **ITEM-6** — verdict: PASS — `createChatStreamClient` already takes an optional handlers object (`ChatStreamClient.ts:46-49`, wired at `stores/chat/index.ts:631-634`); adding a third optional handler is additive and legacy callers keep the fallback path.
- **ITEM-7** — verdict: PASS — verified the defect is present at base: `subscribeToDownloadProgress.ts:92` still does `{ ...download, ...update } as DownloadInstance`, and `DownloadProgressUpdate` (`api-client/types.ts:1636`) is flat while `DownloadInstance.progress_data` is nested. Server side confirmed flat at `llm_model/handlers/downloads.rs:64-86`.
- **ITEM-8** — verdict: PASS — `Sse` is already imported at `downloads.rs:10`; only `KeepAlive` needs adding to that `use`. Every other SSE route in the tree already calls `.keep_alive(KeepAlive::default())`.
- **ITEM-9** — verdict: CONCERN — the gitlink move also carries one unrelated intervening sdk commit (`8693247`, a testId-registry regen) because `origin/paws` is one ahead of the pin. It is a generated-file regen on the paws line, not a code change; recorded in `BASE.md` and DEC-6 so it is not a surprise at review.
