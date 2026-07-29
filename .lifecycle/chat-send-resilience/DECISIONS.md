# DECISIONS — chat-send-resilience

Every human/product input the implementation needs, resolved up front — nothing
left unresolved.

### DEC-1: Fail-closed for EVERY contributor, or only for contributors marked "required"?

**Resolution:** Fail-closed for every contributor. `composeRequestFields` runs all
contributors, collects failures, and throws if any failed. There is no `required`
flag on the extension API. A contributor that genuinely wants to tolerate its own
failure must catch it inside its own `composeRequestFields` — an explicit, local,
reviewable choice.
**Basis:** codebase — a per-extension opt-in flag re-creates the exact failure
class the repo already documents as a silent-failure trap (forgetting one of the
two `mcp.rs` edits when adding a built-in MCP server: the code registers, curl
works, and the model never sees the tools). A flag an author can forget defaults
the system back to the defect. The audit of all five production contributors
(PLAN_AUDIT "Breakage risk") shows only `model` throws in normal operation, and
that throw is the one the design wants surfaced — so the safe default costs
nothing today. And the alternative outcome for the other four is not "graceful
degradation": it is silently sending WITHOUT the user's attached files, MCP
selection, or assistant, which is a worse defect than an actionable abort.

### DEC-2: "Abort with a clear message" or "retry the import then abort"? (asked explicitly in the brief)

**Resolution:** **Both, at the layer each belongs to.** The RETRY lives in
`lazy-dispatch.ts`, where a chunk-load failure is a generic, transient,
every-lazy-action concern (ITEM-5) — so the recovery benefits all ~130 lazy
actions, not just chat. The ABORT lives in the chat send path (ITEM-1..4) and is
unconditional: by the time a contributor has rejected, the retry budget is
already spent, and the send must not proceed on a partial body under any
circumstance. Sequence: dispatch → import fails → bounded retry with backoff →
still failing → contributor rejects → registry throws → send aborts with an
actionable message → the NEXT user attempt re-imports from scratch (the rejection
was never memoized), so a genuinely transient blip self-heals on retry.
**Basis:** convention — this is the repo's existing layering rule (a generic
transport/dispatch concern is fixed at the transport, as with the api-client's
`inflight.ts` read-coalescer that `lazy-dispatch.ts`'s own header comment cites as
precedent for exactly this "fix it one layer down" reasoning).

### DEC-3: Should `vite:preloadError` auto-reload the page?

**Resolution:** **No.** The listener logs and records a "stale build" mark; it
never navigates — and (amended during phase 5, see DRIFT-1.7) it deliberately
does **not** call `preventDefault()` either. The mark makes the send-abort
message add "The app may have been updated…", so the user chooses when to reload.

On preventDefault specifically: Vite's helper is
`return baseModule().catch(handlePreloadError)` where `handlePreloadError`
rethrows ONLY `if (!e.defaultPrevented)`. Calling `preventDefault()` therefore
does not merely suppress a duplicate console error — it makes the import promise
**resolve with `undefined`**, so the caller reads `.default` off `undefined` and
the dispatcher's retry never runs because nothing rejected. That is the very
silent-failure class this branch exists to remove. The listener is an OBSERVER
only; recovery belongs to `lazy-dispatch.ts`, and the rejection is always handled
by an awaiting caller, so it never becomes an unhandled page error.
**Basis:** convention + user-data safety — an automatic `location.reload()` during
a chat session destroys the unsent draft in the composer and tears down an
in-flight assistant stream, and a reload loop is a real hazard when the chunk is
missing for a non-deploy reason (an offline tab, a proxy 502). The repo already
prefers "surface an actionable error and let the user act" over silent recovery
navigation: the root `AppErrorBoundary` in both `main.tsx` entries renders a
"Reload page" BUTTON rather than reloading itself. This decision follows that
precedent exactly.

### DEC-4: What is the retry budget/backoff for a chunk-load failure, and is it configurable?

**Resolution:** A fixed constant: **2 retries** (3 import attempts total) with a
**150 ms linear backoff** (150 ms, 300 ms), and the rejection is never permanently
memoized — a later dispatch starts a fresh budget. The deterministic FACTORY-throw
path keeps today's `MAX_RESOLVE_RETRIES = 1` memoize-after-one-retry semantics
unchanged. These are named constants in `lazy-dispatch.ts`, not inline magic
numbers.
**Basis:** convention (configurable-settings rule) — this is NOT an operational
tunable in the admin sense: it is a client-side, per-browser-tab transport detail
with no server state, no security boundary, and nothing an operator could sensibly
set per deployment; the repo's singleton-settings pattern
(`code_sandbox_settings` / `session_settings`) exists for server-side resource and
retention limits, and there is no client-side settings table to add a row to.
Structured as named constants so a future change is one edit. Bounds chosen to
keep the worst case (~450 ms of added latency before an abort) well inside the
existing 10 s Playwright `actionTimeout` and imperceptible against a normal send
round-trip.

### DEC-5: Where does the composition failure become visible to the user?

**Resolution:** On the EXISTING surfaces, in both places: `store.error` (rendered
by the conversation error `Alert`, `data-testid="chat-conversation-error-alert"`)
AND — for the two composer call sites that already try/catch — their
`message.error(...)` toast. No new component, no new render state.
**Basis:** codebase — `ChatInput.tsx:82` and `TextInput.tsx:139` already catch a
pre-flight throw and toast it, while `startRegenerateMessage.ts:70` does NOT catch,
so writing `store.error` is what covers the programmatic callers. Reusing both
surfaces means zero gallery/state-matrix work and matches the documented split in
`empty-submit-no-throw.spec.ts` ("the store's own catch records it on
`store.error`… the Enter handler's own `message.error` covers the other class").

### DEC-6: Which fields does the pre-POST guard require?

**Resolution:** `content` (a string, possibly empty) and `model_id` (a non-empty
string). `branch_id` is NOT guarded.
**Basis:** codebase — the wire contract in
`src-app/server/src/modules/chat/core/extension/request.rs` declares `content:
String`, `model_id: Uuid`, `branch_id: Uuid` as the required fields. `content` and
`model_id` are extension-contributed and therefore in the contributor-failure blast
radius; `branch_id` is supplied by `sendMessage` itself from
`conversation.active_branch_id` and is out of scope for this defect. An empty
`content` is legitimate at this layer (an attachment-only turn), so the guard
checks PRESENCE and type, not non-emptiness — `beforeSendMessage` already owns the
"the composer is empty" veto.

### DEC-7: Does the two-stage `createLazyDispatcher` signature keep a back-compat single-arg form?

**Resolution:** No. The signature becomes
`createLazyDispatcher(importModule, buildImpl)` with both arguments required.
**Basis:** codebase — `createLazyDispatcher` has exactly one call site
(`store-kit.ts:361`) and is deliberately NOT re-exported from `@ziee/framework`'s
barrel (`src/index.ts`), so there is no out-of-tree consumer to break. Keeping a
dual-form overload would mean keeping an error-message-sniffing fallback path that
can never distinguish the two stages reliably — carrying a strictly worse code
path forever for zero callers.

### DEC-8: Does this branch add any admin-configurable setting, permission, migration, or API change?

**Resolution:** No. Zero backend changes, zero permissions, zero migrations, zero
OpenAPI/`types.ts` regen. It is a client-side defect fix in two UI files, two app
entries, and two SDK framework files.
**Basis:** codebase — see `BASE.md`; recorded explicitly so the A9/A10 permission
gates and the C2/C3 merge gates have a stated, checkable answer rather than an
omission.
