# TESTS — realtime SSE delivery

Every ITEM is covered; every `INV-N` is pinned by an `[acceptance]` test that
asserts the DESIGN's promise (`docs/design/realtime-sse-delivery.md` § Required
behaviour), not merely what the code happens to do.

No permission is introduced by this branch, so no `[negative-perm]` spec is
required (A10 not engaged).

**ITEM-5 / ITEM-6 (the loud-fail) and their tests TEST-6 / TEST-7 / TEST-11 were
DESCOPED** with the owner's approval after five audit rounds — see DEC-17 and
`FIX_ROUND-5.md`. INV-4 is withdrawn with them.

## Enumerated tests

- **TEST-1** (tier: unit) [acceptance] [invariant: INV-1] [covers: ITEM-1, ITEM-2, ITEM-9] file: `src-app/server/src/core/app_builder.rs` — asserts: a `CorsConfig` whose explicit `allow_headers` OMITS `X-Chat-Stream-Connection-Id` still produces a layer whose real `OPTIONS` preflight (driven through the tower service) reports that header as allowed — i.e. no config file has to remember a header the API reads. Compiling this test at all also proves the `sdk` gitlink points at an sdk commit carrying `create_cors_layer_with` (ITEM-9).
- **TEST-2** (tier: unit) [covers: ITEM-1] file: `sdk/crates/ziee-framework/src/app_builder.rs` — asserts: `create_cors_layer_with` unions the always-allow headers into an explicit list, does not duplicate one the config already lists in different case, and leaves the `*`-wildcard and empty-list `Any` branches unchanged.
- **TEST-3** (tier: unit) [covers: ITEM-3] file: `src-app/desktop/tauri/src/modules/backend/mod.rs` — asserts: `desktop_cors_config(port)` lists BOTH connection-id headers, and a preflight for `PUT /api/chat/stream/subscription` from `tauri://localhost` requesting `x-chat-stream-connection-id` is allowed by the layer built from it. This is the exact request the owner's live instance refused.
- **TEST-4** (tier: unit) [covers: ITEM-4] file: `src-app/server/src/core/app_builder.rs` — asserts: the shipped operator examples `config/dev.example.yaml` and `config/prod.example.yaml`, parsed as real config, list every required custom request header in `server.cors.allow_headers`, so an operator copying an example does not inherit the reported break.
- **TEST-5** (tier: integration) [acceptance] [invariant: INV-2] [covers: ITEM-2] file: `src-app/server/tests/chat/chat_stream_incremental_test.rs` — asserts: a consumer that subscribes to `GET /api/chat/stream` and scopes itself with the subscription PUT observes a `content` frame carrying a real delta at least 150 ms BEFORE the terminal `complete` frame of a 400 ms-paced generation, and receives the reply as MULTIPLE content frames rather than one batch — tokens reach the viewing client while the turn is generating, not only after it finishes; plus a negative control that an UNSUBSCRIBED connection receives nothing at all while the turn still persists, which is the exact state the desktop app was stuck in.
- **TEST-8** (tier: unit) [acceptance] [invariant: INV-3] [covers: ITEM-7] file: `src-app/ui/src/modules/llm-provider/stores/llmModelDownload/subscribeToDownloadProgress.store.test.ts` — asserts: after successive flat `DownloadProgressUpdate` frames the store row's `progress_data.current`/`total`/`speed_bps` — the exact fields `DownloadItem`/`DownloadProgress`/`ModelHubCard` render — ADVANCE rather than staying at zero (and the percent a view computes reaches 91%); that a null progress field does not blank a figure already on screen; that the flat wire keys are NOT left on the row; that a row with no progress yet stays WITHOUT `progress_data` when given the frame the server REALLY emits for a queued download (every optional figure null, `phase: 'created'`), so it does not render "0 Bytes / 0 Bytes"; that a server-side clear of `error_message` is observable; and that neither an unrecognised status nor a prototype-chain name (`toString`, `constructor`) is accepted as a status.
- **TEST-9** (tier: unit) [covers: ITEM-7] file: `src-app/server/src/modules/llm_model/handlers/downloads.rs` — asserts: `DownloadProgressUpdate::from(&DownloadInstance)` emits `current`/`total`/`speed_bps`/`eta_seconds`/`message`/`phase` at the TOP level (the flat wire shape the consumer maps from); that when the row has NO `progress_data` those optional figures serialise as explicit `null`s rather than zeros, while `phase` is REQUIRED and defaults to `created` — the asymmetry the consumer's guard depends on; and that `error_message`/`model_id` are likewise always present as `null` when unset, which is what makes a server-side CLEAR observable rather than indistinguishable from "unknown".
- **TEST-10** (tier: integration) [covers: ITEM-8] file: `src-app/server/tests/llm_model/download_stream_keepalive_test.rs` — asserts: a client subscribed to `GET /api/llm-models/downloads/subscribe` receives an SSE keep-alive comment frame while no download is active, so an idle stream is not left silent for a proxy to reap.
- **TEST-12** (tier: e2e) [covers: ITEM-7] file: `src-app/ui/tests/e2e/llm/download-progress-sse-render.spec.ts` — asserts: with the real `/api/llm-models/downloads/subscribe` route serving a `connected` handshake plus one FLAT `update` frame, a download row seeded at the reported zeros renders 91% (5,147,144,752 of 5,680,522,464 — the figure measured on disk while the UI showed 0%) instead of 0%, through the real store, transport and `DownloadItem`; a positive control in the same spec serves the handshake ALONE and asserts the same row still reads 0%, so the assertion measures DELIVERY rather than the widget's ability to render a number.
## Coverage map

| ITEM | covered by |
|---|---|
| ITEM-1 | TEST-1, TEST-2 |
| ITEM-2 | TEST-1, TEST-5 |
| ITEM-3 | TEST-3 |
| ITEM-4 | TEST-4 |
| ITEM-5 | [DESCOPED] — DEC-17, owner-approved |
| ITEM-6 | [DESCOPED] — DEC-17, owner-approved |
| ITEM-7 | TEST-8, TEST-9, TEST-12 |
| ITEM-8 | TEST-10 |
| ITEM-9 | TEST-1 |

| INV | acceptance test |
|---|---|
| INV-1 | TEST-1 |
| INV-2 | TEST-5 |
| INV-3 | TEST-8 |
| INV-4 | **withdrawn with ITEM-5/6 (DEC-17)** — not delivered by this branch |

### INV-2's acceptance is a CONJUNCTION — stated because one test cannot span it

The blind design-conformance audit made a fair hit: TEST-5 passes with the entire
fix deleted, because `reqwest` performs no CORS preflight. It is a regression guard
on server-side incrementality, and by itself it is NOT a proof of INV-2.

No single test can span the promise, because the failure lived in a **browser
policy that no same-origin harness enforces**. What proves INV-2 is the
conjunction, and each part is separately red-able:

| half | test | goes red when |
|---|---|---|
| the server really streams during the turn | TEST-5 | frames are batched to the end |
| a browser is ALLOWED to scope its stream | TEST-1, TEST-3 | the header is dropped from the preflight |
| a browser really issues + completes the PUT | **no repo test** — out-of-band only | — |

The third row was TEST-11's positive control until the loud-fail was descoped
(DEC-17); that spec is deleted, so **no test in this repo holds that half**, and
saying so is the point of this table. It is held out of band instead, recorded in
`TEST_RESULTS.md`: the same preflight driven through the real engine the app ships
(webkit2gtk 2.50.4 via MiniBrowser), denied vs allowed, plus a live `curl -N`
consumer on the running desktop build observing content frames 1.2 s before
`complete`.

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
4. INV-4 has no acceptance test because it is no longer delivered here — ITEM-5
   and ITEM-6 were descoped after five audit rounds (DEC-17). Leaving a test
   behind for an invariant the branch does not deliver would be the exact
   false-certification this file exists to prevent.
