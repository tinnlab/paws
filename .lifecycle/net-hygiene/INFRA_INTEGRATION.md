# INFRA_INTEGRATION — net-hygiene

The three mandatory phase-5 walks, per item. This feature adds no entity and no
surface, so the entity-lifecycle walk is about the SUBSYSTEMS the change sits
under rather than about a new record.

## User-experience walk

A real user never sees this feature; they see its absence of symptoms. What they
encounter end-to-end:

- **Cold load of any page.** The shell now issues its session verification in the
  first burst rather than after the router chunk lands, so the full-screen
  `AuthGuard` spinner clears on the earlier of (verification, chunk arrival)
  instead of strictly after both in series. Measured: `/api/auth/me` starts at
  ~63–77 ms instead of ~361–377 ms (median of 5 cold loads, three routes).
- **`/settings/profile`.** Previously the page issued a second `/api/auth/me`
  ~380 ms after boot's; now it reuses the one that just landed. The user-visible
  contract is unchanged: `has_password` and the profile fields are still correct
  (asserted by TEST-11, which checks the form is POPULATED, not merely that the
  request count dropped).
- **Saving the profile.** The one place the de-duplication could plausibly hurt.
  It does not: the PUT bumps the freshness epoch, so the refresh after the save
  is never suppressed and never joins a pre-save read (TEST-7, TEST-12).
- **A second device changes something.** Unchanged. Every store still subscribes
  to its `sync:<entity>` and to `sync:reconnect`, and the inbound frame bumps the
  epoch BEFORE the event is emitted, so the refetch is a real round-trip.
- **A saturated deployment.** A user whose SSE connection slots are exhausted
  previously watched the client retry `/api/sync/subscribe` every ~1 s; it now
  retries on a jittered ~10–15 s cadence. Nothing the user sees changes (the
  stream was not connecting either way) — the app just stops behaving badly.

## Infrastructure-integration walk

Every existing subsystem the change touches, and the constraint it imposes:

| Subsystem | Constraint found | How it is handled |
|---|---|---|
| **Realtime sync (notify-and-refetch)** | The contract assumes a refetch is a REAL round-trip. A naive key→promise map would let a `sync:<entity>`-driven refetch join a read started before the change, silently collapsing the contract. | `SyncClient.handleFrame` bumps the freshness epoch BEFORE emitting `sync:<entity>`, and `maybeResync` bumps before `sync:reconnect`. In-flight reads from the older epoch are no longer joinable. TEST-3. |
| **401 silent refresh + retry** (`core.ts`) | Lives INSIDE the coalesced runner. Two joiners must not each trigger a refresh (which would burn a rotation — refresh tokens are single-use with a 30 s grace). | The refresh/retry happens once for the whole group; joiners observe the already-retried outcome. Strictly better than before. TEST-1 (shared rejection). |
| **Transient GET retry ladder** (up to 6 attempts) | Same containment: N duplicate callers used to mean N ladders. | One ladder per coalesced group. |
| **Auth token rotation / user switch** | A login or user switch mid-flight must not hand user B a response fetched as user A. | The coalescing key folds in a fingerprint of the auth token (not the token itself — it must never reach a log). TEST-1. |
| **File upload (`FormData` + XHR progress)** | Uploads are mutations with non-comparable payloads and a progress callback bound to one XHR. | Excluded from coalescing by an explicit `params instanceof FormData` check, alongside non-GET and SSE. |
| **SSE streams (`chat/stream`, `sync/subscribe`, hardware, downloads)** | A stream has ONE consumer wired to ONE reader; two subscribers sharing a response body would starve one. | Excluded by the `callbacks?.SSE` check. |
| **store-kit / lazy actions (~130 stores, 3 apps)** | Every store's own `if (loading) return` guard is unreachable during its own chunk load. Closing that must not change steady-state dispatch, or repeated mutations would silently collapse. | The de-dup window applies ONLY while `implReady` is false; after that the dispatcher is byte-identical. TEST-4 asserts both halves. |
| **Ref-counted store destroy** (`stores.ts`, 5 s delay) | A store destroyed and re-initialised re-runs `init` (and its loads). A SECOND proxy for the same store would have its own ref count and could re-run `init` independently. | `registerModule` now reuses an already-registered proxy. TEST-10b. |
| **Smart module loader** (`loader.ts`) | Its documented contract: a permission-gated predicate means the module's CODE never reaches a user who lacks the permission — and modules are NEVER unloaded, so a stale grant would persist for the whole session. | Only `isAuthenticated` is derived from a live token; permissions stay non-persisted, so `ctx.can()` still evaluates against an empty set until `/auth/me` lands. TEST-6 is written so it FAILS if permissions are ever persisted. |
| **Desktop (Tauri) auto-login** | A token persisted from a previous launch is stale by design (the desktop server regenerates its JWT secret per launch); verifying it would `endSession()` and fight the auto-login loop. | `bootSessionVerify.desktop.ts` is a build-time no-op — the code is not in the desktop bundle. A runtime `AppMode` check would race `main.tsx`'s post-load flip. |
| **Desktop override registry** | `npm run check` runs `check:override-registry`, which FAILS on an orphaned `*.desktop.ts` with no core sibling. | Core sibling exists; `OVERRIDE_MANIFEST.md` regenerated + committed (14 → 15 co-located overrides). |
| **Permissions / RBAC** | No permission is added, and no existing gate is widened. `hasPermissionNow` still gates every shell-eager fetch. | Nothing to do; asserted by TEST-6. |
| **OpenAPI / api-client contract** | A regen here would collide with the concurrent branch that owns the by-conversation batch endpoint. | No backend change ⇒ no regen. Enforced mechanically by TEST-9. |
| **Chat pipeline / MCP tool-call + approval / workflow runner / notifications delivery** | All reached only through `callAsync`; none issue a GET that another caller could concurrently duplicate with different intent. | No change needed. The notification INBOX load gained the guard its siblings had (ITEM-8). |

## Entity-lifecycle walk

No new entity. The state this feature holds is three module-scoped values, each
with an explicit lifecycle:

| State | Added | Mutated | Removed | Access-loss |
|---|---|---|---|---|
| `inFlight` map entry (`inflight.ts`) | on the first caller of a key | never (an entry is immutable once created) | in the request's own `.finally()`, and ONLY if the map still holds THAT promise — a newer-epoch entry that replaced it is not evicted (asserted by TEST-2's "superseded entry" case) | a user switch changes the key's identity fingerprint, so the previous identity's entry is unreachable and expires with its request |
| `fetchEpoch` | monotonic; never reset outside tests | bumped by every completed non-GET and every inbound sync frame / reconnect | n/a | n/a |
| `coldCalls` map entry (`lazy-dispatch.ts`) | on a cold call | never | in the call's `.finally()`; the map is unreachable once `implReady` flips | n/a |
| `lastMeAt` / `lastMeEpoch` (`meFreshness.ts`) | on each `/me` that lands | re-armed by a later `/me` | never needs removal — staleness is a comparison, not a stored value | a logout is a POST → epoch bump → immediately not fresh, so a re-login always verifies |

**Both origins checked for the one case that matters** — "the user's own data
changed": the LOCAL path (a mutation through `callAsync`) and the SYNC path (an
inbound frame) each bump the epoch independently. Neither relies on the other, so
the originating device's self-echo suppression cannot leave a hole. Verified by
running: TEST-12 drives a real profile rename through the UI against the real
backend and asserts the new value survives both the in-page refresh and a reload.
