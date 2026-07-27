# DESIGN — network hygiene: boot waterfall + settings over-fetch + duplicate requests

**Status:** design pass written for this lifecycle (no prior design doc existed —
the upstream input is an evidence report, not a design).

## Upstream evidence (the input this design is derived from)

`agent-kit/skills/live-ui-audit` was run against a live ziee instance on
2026‑07‑26; the merged report lives at
`/data/pbya/ziee/tmp/live-ui-audit-2026-07-26/{findings.md,findings.jsonl}`
(machine-local — 2,197 deduped findings, 1,905 of them in the `network`
dimension). The network dimension's definitions are specified in
`agent-kit/skills/live-ui-audit/SKILL.md` §"The check battery" item 6, and its
detectors are implemented in `live-ui-audit.mjs:873-940`.

The four signals this design addresses, with the evidence:

| Signal | Count | Evidence |
|---|---|---|
| `waterfall` | 400 raw / 318 deduped | `waterfall: 9 sequential dependent /api requests … /api/app/setup/status → /api/auth/me → /api/sync/subscribe → /api/onboarding/progress` |
| `duplicate` | 501 raw / 298 deduped | `GET /api/conversations fired 3-4× within step "(load)"`, `GET /api/llm-models fired 3×`, `GET /api/auth/me fired 2×`, `GET /api/sync/subscribe fired 2-3×` |
| `n+1` | 247 | 245 of 247 are `GET /api/projects/by-conversation/{id}`; the other 2 are `GET /api/mcp/system-servers/{id}/groups` (6 ids) |
| `settings-user` volume | ≈1,150 `/api` requests per audit cell | `shard3.log`: `settings-user/desktop/light (1169 /api reqs)` vs `settings-user/mobile/light (158)` |

## Root causes (established by reading the code AND measuring the live app)

Measured with `.lifecycle/net-hygiene/boot-probe.mjs`, which re-implements the
audit's `waterfall`/`duplicate` detectors byte-for-byte (same 20 ms slack, same
`new URL(u).pathname` keying) so its numbers are directly comparable, but runs in
seconds instead of an hour.

1. **The boot chain is serialized behind `/api/auth/me`.** `Auth`'s persist
   `partialize` (`modules/auth/Auth.store.ts`) keeps only `{token, expiresAt,
   expiresIn}` — **`user`/`permissions`/`isAuthenticated` are not persisted**. So
   `buildLoadContext()` (`modules/loadContext.ts`) reports `isAuthenticated:
   false` on every cold boot, and the smart module loader (`modules/loader.ts`)
   registers ONLY core modules in wave 1. Every `shouldLoad: ctx =>
   ctx.isAuthenticated …` module — chat, projects, notification, onboarding — is
   deferred to wave 2, which cannot start until `/auth/me` resolves.
   Compounding it, `/auth/me` itself is not issued until `AuthGuard`'s **mount
   effect** runs (`modules/auth/AuthGuard.tsx`), i.e. after the router + guard
   chunks have downloaded. Measured: `setup/status` at t=47 ms, `auth/me` at
   t=346 ms, everything else at t≥403 ms.

2. **There is no request-dedupe layer anywhere.** `callAsync`
   (`sdk/packages/framework/src/api-client/core.ts`) has a base-URL resolver, a
   token provider, a 401 silent-refresh, a GET retry loop — but no in-flight
   registry, no key, no coalescing. Two concurrent identical GETs are two
   round-trips.

3. **Store-level in-flight guards cannot fire in time.** store-kit's lazy action
   dispatcher (`sdk/packages/framework/src/store-kit.ts`) is
   `dispatch = (...a) => resolveImpl().then(impl => impl(...a))`. The action body
   — and therefore its own `if (state.loading) return` guard — only runs after
   the action chunk resolves. Two synchronous calls in the same tick both get
   past every guard. This defeats the guards in `loadConversations`,
   `loadRecentConversations`, `loadProjects`, `checkSetupStatus`,
   `initializeDownloadTracking`; `notification-ui`'s `load` has no guard at all.

4. **`/settings/profile` refetches `/auth/me` ~380 ms after boot's.**
   `ProfileSettingsPage` calls `Auth.refreshCurrentUser()` on mount to fill
   `has_password`; on a cold boot `initAuth()` already fetched exactly that.

5. **The SSE subscribe hammers a rate-limited endpoint.** `SyncClient`'s
   reconnect backoff floor is 1 s regardless of WHY the stream ended, so a `429`
   (per-user connection cap) is retried at the same cadence as a transient drop
   → 2–3 `/api/sync/subscribe` per 2.5 s audit step.

6. **`settings-user`'s ≈1,150 requests are ~13 cold boots, not 13 SPA
   navigations.** The audit's `nav()` helper (`live-ui-audit.mjs:251-261`) uses
   `page.goto` — a full reload per surface. Per boot the desktop sidebar costs
   `1 × /api/conversations` + `N × /api/projects/by-conversation/{id}` (N = the
   loaded page of conversations); at mobile the sidebar is collapsed, which is
   exactly the 158-vs-1169 split. **The dominant term is the by-conversation
   N+1, which is explicitly OUT OF SCOPE here (owned by another agent).** What is
   in scope is the remaining ~13 shell requests per boot and the serial ordering
   between them.

## Non-negotiables

- Correctness first: a stale or missing refetch is a worse defect than a
  duplicate request. Any coalescing must be provably incapable of serving a
  response that predates a mutation the caller already made.
- The two excluded endpoints (`/api/projects/by-conversation/{id}`,
  `/api/llm-models`) are owned by a concurrent agent; their call sites must not
  be edited on this branch.
- `modules/loader.ts`'s documented security contract — "a permission-gated
  predicate (`ctx.can(Permissions.X)`) means the module's code never reaches a
  user who lacks the permission" — must survive unchanged. Permissions must NOT
  be persisted to make boot faster (modules are never unloaded, so a stale
  persisted permission would leak a module's code for the whole session).
- The realtime-sync contract (notify-and-refetch; every store refetches on its
  `sync:<entity>` and on `sync:reconnect`) must be preserved exactly.

## Approach

Fix the two LAYERS rather than the N call sites:

- **Transport layer** — one in-flight GET coalescer in `callAsync`, guarded by a
  monotonic *freshness epoch* that is bumped by every non-GET request and every
  inbound sync frame. A caller can only join an in-flight GET that started in the
  CURRENT epoch, so a refetch issued after a mutation/sync event always gets its
  own round-trip. This is the single change that makes every store's guard moot.
- **Dispatch layer** — close store-kit's chunk-load race so an action's own
  guard is not bypassed: calls made while the action's chunk is still loading
  share one invocation. Steady-state dispatch is untouched.
- **Boot ordering** — issue `/auth/me` at module-initialize time (parallel with
  `/api/app/setup/status` + `/api/onboarding/progress`) instead of from a mount
  effect, and let the module loader treat a live persisted token as
  `isAuthenticated` so auth-gated (not permission-gated) modules register in
  wave 1.
- **Point fixes** for the residual duplicates: the profile page's redundant
  `/me`, `notification-ui`'s missing guard, and the SSE 429 backoff.
