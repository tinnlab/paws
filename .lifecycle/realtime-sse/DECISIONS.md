# DECISIONS — realtime SSE delivery

Every human/product input the implementation needs, resolved up front — nothing left
unresolved for implementation time.

### DEC-1: Where does the canonical "custom request headers the API reads" list live — the framework or the app?
**Resolution:** Split by ownership. `ziee-framework` owns its OWN headers
(`SYNC_CONNECTION_HEADER`) and exposes `create_cors_layer_with(config, always_allow)`
so an app can add its own; ziee owns the app-level list
(`CHAT_STREAM_CONNECTION_HEADER` + `ziee_auth`'s `REFRESH_COOKIE_OPTIN_HEADER`) and
feeds it in through a same-signature `create_cors_layer` wrapper in
`server/src/core/app_builder.rs`.
**Basis:** convention — the framework is app-agnostic by construction (CODING_GUIDELINES §9:
"Hub/aggregator modules don't import feature-module types"; a domain-specific crate must
not leak into a generic one). Hardcoding `X-Chat-Stream-Connection-Id` in the sdk would
be exactly that leak. The delegation shape mirrors the existing
`apply_rate_limit_layer(app, config, default_when_absent)` in the same file.

### DEC-2: When a config's explicit `allow_headers` omits a header the API reads — union it in, replace the list, or refuse to boot?
**Resolution:** UNION (deduped case-insensitively) into the configured list. Not replace
(that would discard an operator's own additions), and not fail-loud-at-boot.
**Basis:** convention + the design's INV-1. The headers in question are ones the server
itself defines and already accepts at the handler; refusing them at preflight can only
break the app, never protect it, so there is no configuration in which omitting them is
the operator's intent. A boot refusal would turn a silent bug into a hard outage on
upgrade for every deployment that copied an example — strictly worse. The
`*`/empty ⇒ `Any` branches are untouched, so nothing becomes MORE permissive than it
already was.

### DEC-3: Should a REJECTED subscription PUT (network / CORS refusal) force a stream reconnect, as a non-2xx already does?
**Resolution:** Yes — same handling for both. A rejected `fetch` drops the connection id
and aborts the live stream so the connect loop reconnects and re-PUTs.
**Basis:** codebase — `ChatStreamClient.ts:104-115` already does exactly this for a
non-2xx, with the comment "otherwise the pane would sit token-less silently". A rejection
is the STRONGER signal of the same condition, and it is the one the reported bug takes.
The cost (a transient offline blip now reconnects instead of being ignored) is bounded by
the existing exponential backoff to 30 s (`ChatStreamClient.ts:24-26,132-133`).
Recorded against the ITEM-5 CONCERN in PLAN.md's phase-2 audit.
**Sharpened by the blind correctness audit**, which put the cost precisely: on a
link that drops PUTs while holding the SSE open, the stream is now torn down on
every drop instead of surviving it, and a PUT for a NEWLY-selected conversation
that blips will abort a stream that was healthy for the previous one. Accepted
unchanged: it self-heals via the registry's replay, it is bounded by the backoff,
and the alternative — keeping a connection whose scope we could not set — is the
silence that produced the reported bug.

### DEC-4: `SUBSCRIPTION_FAILURE_LIMIT` / `SUBSCRIPTION_REREPORT_EVERY` (and the SSE keep-alive interval) — fixed constants or admin-configurable settings rows?
**Resolution:** All fixed constants. `SUBSCRIPTION_FAILURE_LIMIT = 3` and
`SUBSCRIPTION_REREPORT_EVERY = 5` are named module-level constants in
`ChatStreamClient.ts` alongside the existing `INITIAL_BACKOFF_MS` /
`MAX_BACKOFF_MS` / `STABLE_AFTER_MS`. The download stream uses axum's
`KeepAlive::default()` rather than a configured interval.
**Amended after the audit:** the re-report interval did not exist in the first
implementation — reporting fired once, on `failures === LIMIT`, and could never
fire again. Two independent audit angles showed that reverts to the reported bug
on the user's SECOND message. The resulting user-visible policy (banner at ~7 s,
re-raised every 5 further failures — minutes apart once the backoff saturates) is
now stated in the design doc rather than left as an accident of the code.
**Basis:** convention. The mandatory configurable-settings rule targets OPERATIONAL
tunables an admin has a reason to weigh (resource caps, retention, quotas). Neither of
these is one: the failure limit is a client-side UX threshold in a bundle the operator
cannot reach anyway (there is no per-deployment client config), and it sits next to three
existing constants of exactly the same kind — promoting it alone would be inconsistent
with its own neighbours. `KeepAlive::default()` is what every other SSE route in the tree
uses (`chat/stream/handler.rs:179`, `ziee-framework/src/sync/routes.rs:269`,
`hardware/handlers.rs:173`, voice, workflow, code_sandbox); a bespoke interval here would
be the outlier. Both are named constants rather than inline literals, so either can be
promoted later without a rewrite.

### DEC-5: Where does a hard subscription failure surface to the user — a new UI affordance or an existing one?
**Resolution:** The EXISTING chat error banner. The store sets its existing `error` field,
which `ConversationPane` already renders as `chat-conversation-error-alert`
(`ConversationPage.tsx:1003-1005`) with a close action.
**Basis:** codebase — reuse-first. That state already has a gallery cell
(`chat/gallery.tsx:1158`), so no new conditional render state is introduced and
`check:state-matrix` / gallery coverage are unaffected. A bespoke "live updates
unavailable" surface would duplicate an affordance that already exists for exactly this
class of failure.

### DEC-6: How does the sdk half of this change reach the paws line?
**Resolution:** Branch `fix/cors-required-headers` cut from **`origin/paws`** on
`ziee-ai/sdk`, PR'd **into `paws`** — never `chat` or `main`. This branch's `sdk` gitlink
moves to that commit. The move also carries one unrelated intervening commit
(`8693247`, a testId-registry regen) because `origin/paws` is one ahead of the pin.
**Basis:** user — the owner's standing policy, relayed by the lead: `chat` belongs to
another platform and pushing paws changes there would break them. The intervening commit
is a generated-file regen already on the paws line, recorded in `BASE.md` so it is not a
surprise at review.

### DEC-7: Fix the download progress mismatch on the client, or change the server's wire format to nest `progress_data`?
**Resolution:** Client. `DownloadProgressUpdate` stays flat; the consumer rebuilds
`progress_data` from the delivered fields.
**Basis:** convention — the wire format is shared (it is a `JsonSchema` type in the
generated OpenAPI and TS clients, consumed by the desktop and web bundles alike), so
changing it is a breaking API change requiring a regen and touching every consumer, to fix
a defect that lives in exactly one client handler. The sibling
`runtimeDownloadProgress/subscribeToKey.ts:51-63` already maps a flat frame field-by-field
correctly against the same pattern — the correct shape of this code already exists in the
tree.

### DEC-8: How much of the download monitor's latent fragility is repaired here?
**Resolution:** The missing `KeepAlive` only. The self-termination on an empty first tick,
the permanent death on one transient DB error, and the unreachable `remove_client` are
recorded as follow-ups with their evidence, not fixed.
**Basis:** user — the owner picked "Keep-alive only" from an explicit option picker.
Supporting evidence: none of the other three fired in the observed session
(`get_all_active` at `repository.rs:1042` selects EVERY status, so it is empty only on a
virgin install, and the client only subscribes once a download is already in its store —
`setupDownloadTracking.ts:14-22`). Keeping the diff minimal also keeps it portable
upstream, which the brief asked for.

### DEC-9: Does this branch add an end-to-end streaming deadline so a stalled turn cannot spin forever?
**Resolution:** No. INV-4 is satisfied at the actual defect — a subscription that cannot be
established is made loud — and no global deadline is introduced.
**Basis:** user — the owner picked "Loud-fail the subscription only" from an explicit
option picker. A deadline bounds every provider and every slow model and is a product
decision about how long "still working" is allowed to last; the previous round escalated it
for the same reason. Recorded as an open follow-up for the owner, not silently dropped.

### DEC-10: Is `config/prod.example.yaml` updated as well as `dev.example.yaml`?
**Resolution:** Yes — both. `prod.example.yaml:59` carries the same explicit
`allow_headers: ["Content-Type", "Authorization"]` list.
**Basis:** convention — the example configs are operator-facing documentation, and after
DEC-2 they are no longer load-bearing for correctness, so the only reason to update them
is that a wrong example teaches a wrong thing. Updating one and not the other would be
arbitrary.

### DEC-11: `.lifecycle/default-model-onboarding/` is present on `origin/main` — does this branch remove it?
**Resolution:** No. This branch adds only `.lifecycle/realtime-sse/` and leaves the
inherited directory untouched; it is reported to the lead instead.
**Basis:** convention — the lifecycle validator's A1 check FAILS a branch that deletes a
`.lifecycle/<feature>` directory inherited from base, precisely so one worker cannot tidy
away another's audit trail. It is a merge-hygiene miss on PR #10 (the skill's "Merge
hygiene" section requires `git rm -r .lifecycle` at merge, and `cbfd71683` shows this has
happened before); it belongs in a strip commit of its own, not smuggled into a bugfix.
Consequence for this branch: `lifecycle-check.mjs` must be run with an explicit
`--dir .lifecycle/realtime-sse`, since auto-discovery refuses a `.lifecycle/` holding two
features.

### DEC-13: Should the subscription-failure banner ever fire when no turn is in flight?
**Resolution:** Yes — the banner, but NOT the turn-failure reset, and with different
wording. At rest the action sets only `error`; mid-turn it additionally applies
`buildSendFailureState`.
**Basis:** codebase + the blind audit. `buildSendFailureState` always sets
`lastTurnInterrupted: true`, which `MessageList` renders as an "interrupted" badge
on the last assistant message — so applying it at conversation-open decorated a
reply that had completed normally, possibly days earlier. And the single message
("the reply is still being generated") is false in that path, which is the most
common trigger. The user still needs to know live updates are not arriving before
they type, so suppressing the banner entirely would be worse than either.

### DEC-14: Which error wins when a turn already surfaced one and the stream then becomes undeliverable?
**Resolution:** The delivery failure replaces it.
**Basis:** the blind audit. The first implementation kept the earlier text, which —
combined with the one-shot reporting defect — meant the user was never told the
real, ongoing problem. The earlier error describes something that already finished;
the delivery failure is live, is still true, and is the one with an action attached
(reload). Recorded as a decision because the reverse is defensible and was in fact
what shipped first.

### DEC-12: How is `ITEM-8` (the keep-alive) tested without waiting on production timings?
**Resolution:** An integration test subscribes to the real endpoint and asserts a keep-alive
comment frame arrives, with a timeout comfortably above axum's 15 s default interval.
**Basis:** convention — B7 ("verification means RUNNING it"). Asserting the builder was
called would not prove a byte reaches the client; the observable contract is that an idle
stream is not silent. One ~16 s test is an acceptable cost for the only assertion that
actually exercises the behaviour.
