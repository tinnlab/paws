# TESTS — realtime SSE delivery

Every ITEM is covered; every `INV-N` is pinned by an `[acceptance]` test that
asserts the DESIGN's promise (`docs/design/realtime-sse-delivery.md` § Required
behaviour), not merely what the code happens to do.

No permission is introduced by this branch, so no `[negative-perm]` spec is
required (A10 not engaged).

## Enumerated tests

- **TEST-1** (tier: unit) [acceptance] [invariant: INV-1] [covers: ITEM-1, ITEM-2, ITEM-9] file: `src-app/server/src/core/app_builder.rs` — asserts: a `CorsConfig` whose explicit `allow_headers` OMITS `X-Chat-Stream-Connection-Id` still produces a layer whose real `OPTIONS` preflight (driven through the tower service) reports that header as allowed — i.e. no config file has to remember a header the API reads. Compiling this test at all also proves the `sdk` gitlink points at an sdk commit carrying `create_cors_layer_with` (ITEM-9).
- **TEST-2** (tier: unit) [covers: ITEM-1] file: `sdk/crates/ziee-framework/src/app_builder.rs` — asserts: `create_cors_layer_with` unions the always-allow headers into an explicit list, does not duplicate one the config already lists in different case, and leaves the `*`-wildcard and empty-list `Any` branches unchanged.
- **TEST-3** (tier: unit) [covers: ITEM-3] file: `src-app/desktop/tauri/src/modules/backend/mod.rs` — asserts: `desktop_cors_config(port)` lists BOTH connection-id headers, and a preflight for `PUT /api/chat/stream/subscription` from `tauri://localhost` requesting `x-chat-stream-connection-id` is allowed by the layer built from it. This is the exact request the owner's live instance refused.
- **TEST-4** (tier: unit) [covers: ITEM-4] file: `src-app/server/src/core/app_builder.rs` — asserts: the shipped operator examples `config/dev.example.yaml` and `config/prod.example.yaml`, parsed as real config, list every required custom request header in `server.cors.allow_headers`, so an operator copying an example does not inherit the reported break.
- **TEST-5** (tier: integration) [acceptance] [invariant: INV-2] [covers: ITEM-2] file: `src-app/server/tests/chat/chat_stream_incremental_test.rs` — asserts: a consumer that subscribes to `GET /api/chat/stream` and scopes itself with the subscription PUT observes at least one `content` frame BEFORE the terminal `complete` frame of a delay-paced generation — tokens reach the viewing client while the turn is generating, not only after it finishes.
- **TEST-6** (tier: unit) [covers: ITEM-5] file: `src-app/ui/src/modules/chat/core/stream/ChatStreamClient.subscription.store.test.ts` — asserts: a REJECTED subscription `fetch` (the CORS-preflight-refusal shape, not a status) drops the connection id and aborts the live stream so the connect loop re-PUTs, and after the consecutive-failure limit it calls `onSubscriptionError` exactly once instead of swallowing every failure in a `console.warn`.
- **TEST-7** (tier: unit) [covers: ITEM-6] file: `src-app/ui/src/modules/chat/core/stores/chat/subscriptionError.store.test.ts` — asserts: the chat store's subscription-error action sets the existing `error` field (the one `ConversationPane` renders as `chat-conversation-error-alert`) and clears `sending` / `isStreaming` / `finalizingTurn`, so a turn whose tokens can never arrive stops claiming to be generating.
- **TEST-8** (tier: unit) [acceptance] [invariant: INV-3] [covers: ITEM-7] file: `src-app/ui/src/modules/llm-provider/stores/llmModelDownload/subscribeToDownloadProgress.store.test.ts` — asserts: after two successive flat `DownloadProgressUpdate` frames the store row's `progress_data.current`/`total`/`speed_bps` — the exact fields `DownloadItem`/`DownloadProgress`/`ModelHubCard` render — ADVANCE rather than staying at zero, and a null field in a later frame does not blank a figure already on screen.
- **TEST-9** (tier: unit) [covers: ITEM-7] file: `src-app/server/src/modules/llm_model/handlers/downloads.rs` — asserts: `DownloadProgressUpdate::from(&DownloadInstance)` emits `current`/`total`/`speed_bps`/`eta_seconds`/`message`/`phase` at the TOP level (the flat wire shape the consumer maps from), so the client-side mapping cannot silently drift out of step with the server.
- **TEST-10** (tier: integration) [covers: ITEM-8] file: `src-app/server/tests/llm_model/download_stream_keepalive_test.rs` — asserts: a client subscribed to `GET /api/llm-models/downloads/subscribe` receives an SSE keep-alive comment frame while no download is active, so an idle stream is not left silent for a proxy to reap.
- **TEST-11** (tier: e2e) [acceptance] [invariant: INV-4] [covers: ITEM-5, ITEM-6] file: `src-app/ui/tests/e2e/chat/chat-stream-subscription-failure.spec.ts` — asserts: with `PUT /api/chat/stream/subscription` aborted at the network boundary (the preflight-rejection shape — a rejected request, not a status), opening a conversation reaches a VISIBLE terminal state rather than a silent one: `chat-conversation-error-alert` is visible with non-empty text matching /live updates/, the client is shown to have RETRIED (>=3 attempts, so the reconnect path really ran), no `chat-streaming-indicator` and no `[data-busy="streaming"]` remains, and the composer + send button stay enabled; a positive control in the same spec proves an unaborted subscription raises NO banner, so the assertion cannot pass by a banner that always appears.
- **TEST-12** (tier: e2e) [covers: ITEM-7] file: `src-app/ui/tests/e2e/llm/download-progress-sse-render.spec.ts` — asserts: with the real `/api/llm-models/downloads/subscribe` route serving a `connected` handshake plus one FLAT `update` frame, a download row seeded at the reported zeros renders 91% (5,147,144,752 of 5,680,522,464 — the figure measured on disk while the UI showed 0%) instead of 0%, through the real store, transport and `DownloadItem`; a positive control in the same spec serves the handshake ALONE and asserts the same row still reads 0%, so the assertion measures DELIVERY rather than the widget's ability to render a number.
## Coverage map

| ITEM | covered by |
|---|---|
| ITEM-1 | TEST-1, TEST-2 |
| ITEM-2 | TEST-1, TEST-5 |
| ITEM-3 | TEST-3 |
| ITEM-4 | TEST-4 |
| ITEM-5 | TEST-6, TEST-11 |
| ITEM-6 | TEST-7, TEST-11 |
| ITEM-7 | TEST-8, TEST-9, TEST-12 |
| ITEM-8 | TEST-10 |
| ITEM-9 | TEST-1 |

| INV | acceptance test |
|---|---|
| INV-1 | TEST-1 |
| INV-2 | TEST-5 |
| INV-3 | TEST-8 |
| INV-4 | TEST-11 |

## Why these are not tautologies (D2)

1. The INV-1 acceptance test would fail if the invariant were violated: it
   deliberately builds a config that OMITS the header, which is the exact condition
   the design says must not matter. A test that listed the header would prove
   nothing.
2. The INV-2 acceptance test asserts ORDERING (`content` before `complete`), not
   merely that frames arrive — "arrived eventually" is satisfied by a reload, which
   is the bug.
3. The INV-3 acceptance test asserts the fields the VIEWS read (`progress_data.*`),
   not the fields the server wrote. The previous round asserted the write, and the
   write was never the broken half.
4. The INV-4 acceptance test asserts the CONJUNCTION (spinner gone AND error shown
   AND composer usable); each clause alone passes while the surface is still broken.
