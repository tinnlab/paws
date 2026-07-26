# DECISIONS — net-hygiene

Every human/product input the implementation needs, resolved up front. Zero
markers remain.

### DEC-1: Where does request de-duplication live — per store, or once in the transport?
**Resolution:** once in the transport (`callAsync`), as an in-flight-only coalescer. Stores are not touched.
**Basis:** convention — the framework already puts cross-cutting request concerns in `api-client/core.ts` (auth token, 401 silent-refresh + retry, GET retry ladder, `netRequestStart/End` bracketing from `net-idle.ts`). A per-store fix would have to be repeated in ~130 stores AND could not catch the store-kit chunk-load race, which is upstream of every store guard. The task brief also asks for exactly this: "one shared store read / in-flight request de-dupe rather than N independent callers".

### DEC-2: Coalesce, or cache with a TTL?
**Resolution:** coalesce only — join a request that is literally on the wire right now; never hold a response after it settles.
**Basis:** convention + INV-1. A TTL cache can serve data the caller has already invalidated; an in-flight join cannot serve anything the caller could not equally have received by being 1 ms earlier. `CODING_GUIDELINES.md` §7's notify-and-refetch contract assumes a refetch is a real round-trip, and a TTL would silently break that. No cache is introduced anywhere in this branch.

### DEC-3: How is "a coalesced response is never stale" made provable rather than argued?
**Resolution:** a monotonic freshness epoch. `bumpFetchEpoch()` fires on (a) every completed non-GET request and (b) every inbound realtime-sync frame. An in-flight entry records the epoch it started in; a later caller may join it ONLY if the epoch still matches, otherwise it gets its own request.
**Basis:** convention — this mirrors the epoch/generation guard the codebase already uses for exactly this class of race: `SyncClient.ts`'s `epoch` (a user switch supersedes an in-flight loop) and `loadRecentConversations.ts`'s `recentLoadSeq` (a mid-flight reset discards a stale result). Reusing the house idiom, not inventing one.

### DEC-4: Should the coalescer key include the auth token?
**Resolution:** yes — the key is `method + resolved path/query + a token fingerprint`.
**Basis:** convention — every other identity-sensitive cache in the tree is keyed or torn down on user switch (`SyncClient.stopSyncClient` on user change; the Auth store's `sessionEpoch`). Without it, a login/user-switch mid-flight could hand user B a response fetched as user A. The fingerprint is a short hash, never the token itself, so it cannot leak into a log or an error message (`CODING_GUIDELINES.md` §3).

### DEC-5: `refreshCurrentUser()` freshness window — how wide, and does it apply after a mutation?
**Resolution:** suppress only when a `/me` landed within **3000 ms** AND the freshness epoch has not moved since. So the boot-time duplicate is suppressed and `updateProfile()`'s post-save refresh (which bumps the epoch when the PUT completes) always runs. The window is a named constant (`ME_BOOT_FRESH_MS`), not an inline literal.
**Basis:** codebase — the measured gap between `initAuth`'s `/me` and `ProfileSettingsPage`'s is ~380 ms (`.lifecycle/net-hygiene/probe-baseline.json`), so 3 s covers it with an order of magnitude of headroom while being far below any realistic "user navigated back later" interval. The epoch condition is what keeps it correct rather than merely short.

### DEC-6: Is the freshness window an operational tunable that needs an admin settings row?
**Resolution:** fixed constants, deliberately — `ME_BOOT_FRESH_MS`, `CAPACITY_BACKOFF_MS`, and the existing `INITIAL_BACKOFF_MS` / `MAX_BACKOFF_MS` stay named constants in the client bundle. No settings table, no REST, no permission, no sync entity.
**Basis:** convention + the configurable-settings rule's stated exception. These are **client-side transport timings**, not deployment policy: they are compiled into a static bundle that an operator cannot re-read at runtime, they have no server-side effect an admin could reason about, and every existing sibling (`SyncClient`'s three backoff constants, `store-kit`'s `warmIdle` 2 s timeout, `stores.ts`'s `DEFAULT_DESTROY_DELAY_MS`, `net-idle.ts`'s 500 ms quiet window) is a named constant for the same reason. They are structured as named constants precisely so a future round can promote them without a rewrite.

### DEC-7: How is the desktop build kept away from the boot-time `/auth/me`?
**Resolution:** a co-located `bootSessionVerify.desktop.ts` no-op twin resolved by the override plugin — NOT a runtime `AppMode.multiUserMode` check.
**Basis:** codebase — `AuthGuard.desktop.tsx` reason 3 documents that a persisted desktop token is stale by design (the desktop server regenerates its JWT secret per launch), so calling `initAuth()` there would `endSession()` and fight the auto-login loop. A runtime flag is unsafe because `desktop/ui/src/main.tsx` calls `AppMode.setMultiUserMode(false)` AFTER `loadDesktopModules()`, which can race a module `initialize()`. The `.desktop.ts` twin removes the code from the desktop bundle entirely — the same mechanism the existing 14 co-located overrides use.

### DEC-8: Should `user` / `permissions` be persisted so wave-1 module loading is not gated on `/auth/me`?
**Resolution:** NO. Only `isAuthenticated` is derived, from a live persisted token (present and not past `expiresAt`). Permissions remain non-persisted.
**Basis:** codebase — `modules/loader.ts` documents the security contract "a permission-gated predicate means the module's code never reaches a user who lacks the permission", and modules are NEVER unloaded once registered. A stale persisted permission would therefore deliver a gated module's code for the whole session after the permission was revoked. This is the faster option and it is being deliberately declined; recorded here so the trade-off is visible rather than silently taken.

### DEC-9: `/api/sync/subscribe` returns 429 — is the server-side connection-slot leak in scope?
**Resolution:** NO. Only the CLIENT's reconnect behaviour changes (a 429 gets a longer jittered backoff). The 429 itself — a per-user SSE connection-slot reclamation defect in `server/src/modules/sync/registry.rs` — is owned by the concurrent `feat/sse-slot-leak` worktree and is not touched here.
**Basis:** user — the task scoped this branch to the boot waterfall and the settings over-fetch, and another agent holds that worktree. The client change is correct independently of whether the server leak is fixed (a client should not retry a rate-limited endpoint at a 1 s cadence), so the two do not conflict.

### DEC-10: `/api/projects/by-conversation/{id}` is the dominant term in BOTH the settings-user volume and the boot waterfall depth. Do we touch it?
**Resolution:** NO — not the endpoint, not its callers, not its N+1. The results will report the two excluded endpoints as a SEPARATE line so the other agent's before→after stays readable, and will state plainly that the residual `settings-user` volume is dominated by their fix, not by anything left undone here.
**Basis:** user — the brief excludes `/api/projects/by-conversation/{id}` and `/api/llm-models` explicitly. Enforced mechanically by TEST-9 rather than by intention.

### DEC-11: Do the two excluded endpoints get excluded from the generic coalescer as well?
**Resolution:** NO — the transport coalescer is generic and will incidentally coalesce concurrent `/api/llm-models` calls. It is not modified to carve them out.
**Basis:** convention — a transport-layer allow/deny list keyed on specific product endpoints would be exactly the kind of hidden cross-module coupling `CODING_GUIDELINES.md` §9 forbids, and it would leave a booby-trap for whoever reads it next. The ownership boundary is about not editing the other agent's FIX (their call sites / their batch endpoint), which TEST-9 enforces; a layer that happens to also help is not a conflict. Reported explicitly in the results so their measurement is not silently confounded.

### DEC-12: `registerModule` builds a second store proxy — is that a duplicate-request bug worth claiming?
**Resolution:** fix it (single-owner contract) but claim NO request reduction for it.
**Basis:** codebase — a repo-wide search shows `state.stores` is read by nothing outside `module-system/store.ts` itself (the global `Stores` facade was removed), so today the second proxy is never accessed and never runs `init`. It is latent, not live. Fixing it is cheap and correct; attributing measured requests to it would be false.

### DEC-13: What is the measurement protocol for the before→after numbers?
**Resolution:** the same production build pipeline (`npm run build:nocheck` → `src-app/dist/ui`), the same static server (`serve-dist` clone on `:1547`), the same backend instance (`127.0.0.1:29185`), the same audit invocation and flow/viewport/theme cell set, run BEFORE any code change and again AFTER. Both runs are committed under `.lifecycle/net-hygiene/audit/{before,after}`.
**Basis:** convention — holding the backend + dataset fixed is what makes the delta attributable to the frontend diff. The stale `:1520` deployment is explicitly not used.

### DEC-14: The `settings-user` cell measures ~13 FULL PAGE RELOADS, not 13 SPA navigations. Do we report the raw number anyway?
**Resolution:** yes, report the raw audit number (it is the DoD metric), AND state the per-boot decomposition next to it so the number is interpretable.
**Basis:** codebase — the audit's `nav()` helper (`live-ui-audit.mjs:251-261`) uses `page.goto`, so each step is a cold boot; the 158-vs-1169 mobile/desktop split in the upstream `shard3.log` is the collapsed-vs-expanded sidebar. Reporting the raw figure without that decomposition would imply a per-navigation refetch loop that does not exist.

- DESCOPED: none — every ITEM-1…ITEM-11 is implemented this round.
