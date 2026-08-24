# Phase-5 walks — UX, infrastructure integration, entity lifecycle

Recorded per item while implementing, not reconstructed afterwards.

## 1. User-experience walk

**How a real user meets ITEM-1..4 (the CORS chain).** They never see it directly.
What they see is that a reply now appears token by token instead of after a
reload. The one user-visible consequence of getting this wrong in the OTHER
direction — over-widening CORS — is nil for them and material for a security
reviewer, which is why the union is bounded to headers the server already accepts
at the handler and the origin/method allowlists are untouched.

**ITEM-5/6 (loud-fail).** The user is on a conversation whose stream cannot be
scoped. Before: a spinner forever, no explanation, and a reload is the only way
to see the answer — and nothing tells them to reload. After: within ~7 s a banner
says live updates are not arriving and that the reply is still being generated
and saved, so the correct action (reload) is discoverable. Deliberately NOT a
modal or a toast: the existing `chat-conversation-error-alert` is dismissible,
sits in the conversation it describes, and is where every other chat failure
already appears. A user with a flaky network gets nothing at all for one or two
blips, which is the point of the counter.

**ITEM-7 (progress).** The onboarding step and the LLM-providers view show a bar
that moves and byte counts that climb, on a download that can take an hour. The
previous behaviour ("0 Bytes / 0 Bytes", 0%) is indistinguishable from a stalled
download, which is exactly why the owner reported it twice.

**ITEM-8 (keep-alive).** Invisible when it works. Its absence shows up as a
download whose progress stops updating partway through a long transfer over the
tunnel, with no error — the worst kind of failure to debug.

## 2. Infrastructure-integration walk

Every subsystem the change touches, and what each required:

| subsystem | interaction | handled |
|---|---|---|
| CORS layer (framework) | the union must not alter the two permissive branches | `config_headers_are_any` is captured BEFORE the union; TEST-2 covers `*` and `[]` |
| desktop boot (`BackendModule::init`) | applies `server.cors` for BOTH the file-loaded and generated config | the assignment stays in `init`; only the VALUE moved, so neither branch changes |
| ngrok tunnel (`remote_access`) | adds its origin to the CORS config at tunnel-start | untouched — it appends to `allow_origins`, and the union only touches `allow_headers` |
| chat-stream registry | delivery is gated on `active_conversation` | unchanged; the fix restores the PUT that sets it |
| chat store `reloadOpen` | bails while `isStreaming` — so a wedged flag is unrecoverable | ITEM-6 clears it via `buildSendFailureState`, the existing recovery shape |
| chat extensions (`onStreamError`) | the `error` FRAME path notifies extensions | ITEM-6 deliberately does NOT fire it: no provider stream errored, and telling extensions a turn failed when the server is still generating it would be a lie. See DRIFT-1.4. |
| split panes | each pane owns its own client + store | `onSubscriptionError` is per-instance, like `onFrame`/`onReconnect`; one pane's failure cannot banner another |
| api-client SSE transport | dispatches on `event:`/`data:` prefixes | a keep-alive comment line (`:`) matches neither and is ignored — verified by reading the parser, and by every other SSE route already sending them |
| OpenAPI / generated types | no schema surface changes | confirmed: no `JsonSchema` type, route, permission or `SyncEntity` variant touched |
| sync stream | shares the CORS path | `X-Sync-Connection-Id` is now unionable too, so it cannot be lost either; TEST-3 asserts it did not regress |

**Things checked and deliberately NOT changed.** The download monitor's
self-termination, its DB-error exit and its unreachable `remove_client`
(`downloads.rs:389`) — none fired in the observed session, and DEC-8 records the
owner's scope call. The `MONITORING_ACTIVE` flag remains a `Mutex<bool>` guard.

## 3. Entity-lifecycle walk

For each entity a touched surface holds, from BOTH the local and the sync/SSE
path (they are different code):

**Chat conversation (held by the pane store, scoped on the stream).**
- *switch away mid-failure* — `setActiveConversation` re-PUTs for the new
  conversation; the failure counter is NOT reset by a switch, so a permanently
  broken transport reports once rather than once per conversation. Verified by
  the "reports at most ONCE per failure run" case.
- *logout / user switch* — `stop()` resets `subscriptionFailures`, so a new
  session starts clean rather than inheriting a previous user's failure run.
  Added deliberately: without it, one report would be suppressed forever.
- *deleted / access revoked while the banner is up* — unchanged behaviour; the
  banner is dismissible and the existing delete path clears the pane.
- *pane torn down* — the client is per-instance and `stop()` aborts it; the
  handler closes over that pane's `get()`, so a late report cannot land on
  another pane's store.

**Download row (held by `llmModelDownload.downloads`).**
- *terminal status arrives* — `applyProgressUpdate` narrows the wire `status`,
  and the existing filter drops `completed`/`cancelled` rows. Preserved: TEST-8's
  fourth case asserts the terminal status still carries through, which was the
  half that always worked.
- *an unrecognised status string* — previously written straight onto the row by
  the cast; now the row keeps its existing status rather than holding a value the
  rest of the store compares against and never matches.
- *a frame with null fields* — must not blank a figure already on screen; that is
  a real lifecycle case because the server sends `Option`s and emits `null` (not
  `0`) before any progress exists. TEST-8 and TEST-9 cover both halves.
- *row removed while the stream is open* — `updates.find` simply matches nothing;
  no change.

**SSE connection (server-side).** Untouched by this branch — the `ConnGuard`
slot-release contract and its two in-source tests are unchanged. The keep-alive
adds writes to an existing stream, which cannot extend its lifetime past the
token deadline or the re-check teardown.
