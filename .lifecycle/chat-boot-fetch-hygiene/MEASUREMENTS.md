# MEASUREMENTS — chat-boot-fetch-hygiene

All numbers below were **observed**, not derived. Method, instrument and raw
output are recorded so the claims are reproducible.

## Instrument

Playwright, real backend driven through the UI (the standard `testInfra` fixture:
per-test Postgres database + a spawned server + Vite). **No `page.route` mocking
and no stubbed responses.**

The counter is a **passthrough `window.fetch` observer** installed via
`page.addInitScript` *before any navigation*: it records `{url, location.pathname,
timestamp, new Error().stack}` and then calls the original `fetch`, so every
request still reaches the real server.

### Why not Playwright's own request log

The first attempt counted with `page.on('request'|'response')` around
`page.goto('/chats')`. That over-counted by one: the listener also catches
requests the **previous** document had in flight across the navigation. It
reported 3 both before AND after the first fix, which is what exposed the flaw —
the in-page counter (attributable to the `/chats` document by `location.pathname`)
showed the real before/after. TEST-1 therefore ships with the in-page counter, and
this is called out in the spec header so nobody "simplifies" it back.

The `new Error().stack` capture is what made attribution possible: the built
chunks are per-action (`assets/loadConversations-*.js`), so each call names the
store action that issued it, and the `reloadQueued` replay is distinguishable by
its **two** `loadConversations` frames (the action re-imports itself to replay).

## Rank 3 — `/chats` list fetches

Cold, authenticated `/chats` load with one seeded conversation (so
`ConversationList` actually mounts — on an empty `/chats` it never renders and the
redundant callers do not exist). Counting `GET /api/conversations?…` issued by the
`/chats` document.

### BASELINE — unmodified `origin/feat/agent-core` @ `9363976a2`: **3 requests**

```
PROBE#1 +0ms   path=/chats  /api/conversations?page=1&limit=20
      at async assets/loadRecentConversations-cGkgd0K7.js:1:312
PROBE#2 +278ms path=/chats  /api/conversations?page=1&limit=20
      at async assets/loadConversations-CzA74HY1.js:1:298
      at async assets/loadConversations-CzA74HY1.js:1:903     ← TWO frames = the replay
PROBE#3 +634ms path=/chats  /api/conversations?page=1&limit=20
      at async assets/loadConversations-CzA74HY1.js:1:298
```

Attributed:

| # | caller | why it is on the wire |
|---|---|---|
| 1 | `loadRecentConversations` (sidebar recent cursor) | The page's own `loadConversations` fires **concurrently** with identical params (`page=1&limit=20`, default sort, no search), so the transport in-flight coalescer (net-hygiene ITEM-1) collapses the two onto ONE request. **Legitimate — this is the one that should survive.** |
| 2 | `loadConversations` **replay** | `ConversationList`'s mount effect was a SECOND caller. `loadConversations`' in-flight guard does not drop a duplicate page-1 call — it sets `reloadQueued`, and the load is replayed after the first settles (`await import('./loadConversations')` → the second stack frame). A replay starting after the first request **completed** is not concurrent, so the coalescer cannot merge it. **Redundant.** |
| 3 | `loadConversations` via `setSearchQuery('')` | `ConversationList`'s 500 ms search debounce **also runs on mount**, calling `setSearchQuery('')` when the store's `searchQuery` was already `''`. `setSearchQuery` unconditionally issues `loadConversations(1)`. The +634 ms − 278 ms ≈ 356 ms and the 500 ms debounce period identify it. **Redundant.** |

This **corrects the triage's mechanism.** It stated "only the transport coalescer
prevents a duplicate wire request" — i.e. that the duplicate was already absorbed.
The coalescer does absorb the *page ⇄ sidebar* pair (#1), but it cannot touch #2 or
#3, which are serial. The duplication was real and on the wire.

### After removing `ConversationList`'s mount fetch only: **2 requests**

```
PROBE#1 +0ms   ... loadRecentConversations-D8NlWGt_.js:1:312
PROBE#2 +532ms ... loadConversations-DibEUDPB.js:1:298          ← the debounce no-op
```

The double-framed replay is gone; the debounce no-op remains. **This is the step
that disproved the first hypothesis**: the fix removed exactly one request, not
the two the "two mount fetchers" framing predicted, because a third caller the
triage never named was also live.

### After also skipping the no-op search debounce: **1 request**

```
PROBE#1 +0ms   path=/chats  /api/conversations?page=1&limit=20
      at async assets/loadRecentConversations-C0IgN50A.js:1:312
```

**Result: 3 → 1 on a cold `/chats` load** (−2 requests, −67%). The single survivor
is the coalesced boot request shared by the sidebar cursor and the page list —
i.e. the route now genuinely has one owner, which is INV-2 stated exactly.

Guarded by TEST-1, which asserts `=== 1`. Its negative control is the baseline
above: the identical instrument reported **3** on unmodified code, so the
assertion is falsifiable and would fail if either caller returned.

## Rank 4 — the second boot tier

Measured on a cold authenticated boot of `/`.

**Finding: the serialization is REAL and the gate is load-bearing. No change made.**

The three second-tier stores wait on something only `GET /api/auth/me` supplies:

| store | gate | what it waits for |
|---|---|---|
| `server-update` (`stores/serverUpdate/index.ts:12`) | `if (!hasPermissionNow(Permissions.ServerUpdateRead)) return` | the permission set |
| `notification` (SDK `store/index.ts:36-38`) | `if (!hasPermissionNow(deps.readPermission)) return` | the permission set |
| `onboarding` (`stores/onboarding/index.ts:16-30`) | `watch(useAuthStore, s => s.user?.id, …)` | the user identity |

`hasPermissionNow` reads `authStoreProxy().$.permissions`
(`sdk/packages/framework/src/permissions/hasPermissionNow.ts:18`). That field is
populated **only** by `/api/auth/me`. So there is no ordering to relax: the input
the gate reads does not exist any earlier. "Parallelize it" is not available;
the only available change is "fire without the input and accept the 403".

Two independently sufficient reasons not to:

1. **It would break a documented standing rule.** `CLAUDE.md` §"Realtime Sync →
   Frontend" states the **no-403 rule** as an invariant; `CODING_GUIDELINES.md` §7
   restates it; the SDK notification store's own doc-comment calls it "the no-403
   invariant — same perm the endpoint enforces".
2. **The 403 would be certain, not hypothetical, for most users.** `grep -rn
   'server_update::' src-app/server/migrations-merged/` returns **zero** grant
   rows, so `server_update::read` reaches only administrators via the `*`
   wildcard. Every ordinary user's boot would carry a guaranteed 403.

### The dependency runs deeper than the store gate — the MODULE LOADER is permission-driven

Found while auditing the test (and it materially strengthens the verdict).
`server-update`'s module declares:

```ts
// src-app/ui/src/modules/server-update/module.tsx:26
shouldLoad: (ctx) => ctx.isAuthenticated && ctx.can(Permissions.ServerUpdateRead),
```

So for that tier the permission set is not merely consulted by the store — it
decides whether the module is **loaded at all**. "Fire the second tier in parallel
with `/api/auth/me`" is therefore not a small reordering of two fetches; it would
require the smart-module-loading system to resolve `ctx.can(...)` before the
permissions exist. There is no version of the triage's suggestion that is a local
change to three `init()` gates.

Not every module is gated this way, which is what made an isolating test possible:
`memory` and `notification` declare only `shouldLoad: ctx => ctx.isAuthenticated`,
so their stores DO initialize for every authenticated user and the store's own
`hasPermissionNow` is the sole thing preventing a 403. That asymmetry is the basis
of TEST-7/TEST-8 (below).

Measured benefit on offer: ≈ one RTT, on a LOW-severity finding. Declined.

The verdict is made falsifiable rather than left as prose:

- **TEST-4** (positive control) — on an ADMIN boot the gated
  `GET /api/server-update/status` IS issued, and its start is at/after
  `/api/auth/me`'s end. This is the serialization, measured.
- **TEST-5** — a user **lacking** `server_update::read` issues **zero** requests
  to that endpoint. This proves the OUTCOME the no-403 rule promises. It does
  **not** isolate the store gate (the module-load gate above would deliver the
  same zero), so it deliberately does not carry the acceptance tag.
- **TEST-7 / TEST-8** (TEST-8 = acceptance / INV-3) — the isolating pair, over
  the `memory` tier. TEST-7 is the positive control (an admin booting `/` DOES
  reach `GET /api/memory/admin-settings`, proving the surface initializes the
  store); TEST-8 asserts a user lacking `memory::admin::read` issues zero. Since
  `memory`'s module is not permission-gated, the ONLY thing that can produce that
  zero is `hasPermissionNow(Permissions.MemoryAdminRead)` in the store's `init()`.

**Falsifiability of TEST-8, verified by running it** (not asserted): the store's
gate was temporarily replaced with `if (true)`, and TEST-8 failed —

```
Error: a user WITHOUT memory::admin::read issued 1 request(s) to /api/memory/admin-settings
Expected: 0   Received: 1
```

— then the gate was restored and it passed. So the acceptance test genuinely goes
red when the invariant is violated, rather than restating whatever the code does.

`onboarding` is left alone for a different reason (DEC-3): its endpoint is
JwtAuth-only, so it *could* fire on a bare token — but its gate is not a
permission check, it is an identity-change subscription that also clears stale
progress and refetches on a user switch. Trading that for ~1 RTT is what INV-1
forbids.
