# DESIGN — chat/boot fetch hygiene (net-hygiene round 2)

## Provenance

This is a **follow-on round of the `net-hygiene` lifecycle** (see
`.lifecycle/net-hygiene/DESIGN.md` + `PLAN.md`), scoped to the two LOW-severity
residuals its own follow-up triage left open:

- `/data/pbya/ziee/tmp/live-ui-247/TRIAGE-vs-9363976a2.md` §4 **Rank 3**
  — "`/chats` mounts two independent list fetchers (LOW)"
- `/data/pbya/ziee/tmp/live-ui-247/TRIAGE-vs-9363976a2.md` §4 **Rank 4**
  — "boot chain serializes one level behind `/api/auth/me` (LOW, **intentional**)"

Both are LOW. Neither justifies a risky refactor. The design position for this
round is therefore deliberately conservative: **measure first, and prefer a
well-evidenced "no change" over a manufactured one.**

## Root causes as stated by the triage

### Rank 3 — two owners for one route-level fetch

`ChatHistoryPage.tsx` and `ConversationList.tsx` each run an unconditional
`ChatHistory.loadConversations()` in a mount effect. The store action has an
in-flight guard, but the guard's *mid-flight* branch does not simply drop the
duplicate — for `page === 1` it sets `reloadQueued: true`, and the queued reload
is replayed *after* the first load settles. A replay that starts after the first
request has already completed is **not** concurrent, so the transport's in-flight
coalescer (`net-hygiene` ITEM-1) cannot merge it. The triage's "only the transport
coalescer prevents a duplicate wire request" is therefore a hypothesis to test,
not a given — the render order (`ConversationList` mounts only *after* the page's
own fetch has flipped `loading` true) predicts an extra, *serial* wire request.

**Approach.** Give the fetch a **single owner**. `ConversationList` has exactly one
production consumer (`ChatHistoryPage`); it can never mount earlier than its parent
and can never mount without it. The page is therefore the correct owner of the
route-level fetch, and the list becomes a presentational consumer of store state.
This is the smallest correct change: delete one effect, no new machinery.

### Rank 4 — the second boot tier waits on identity/permissions

`/api/auth/me` and `/api/app/setup/status` are **already parallel** (net-hygiene
ITEM-5 / TEST-5). What remains is a second tier — `onboarding`, `server-update`,
`notification` store `init()` — that self-gates on identity or on a permission
that only `/api/auth/me` can supply:

- `server-update` — `if (!hasPermissionNow(Permissions.ServerUpdateRead)) return`
- `notification` (SDK `createNotificationsStore`) — `if (!hasPermissionNow(deps.readPermission)) return`
- `onboarding` — `watch(useAuthStore, s => s.user?.id, …, { fireImmediately: true })`

The triage's suggested fix ("optimistically fire, tolerate a 403") **contradicts
the codebase's own standing rule.** `CLAUDE.md` §"Realtime Sync → Frontend" states
the **no-403 rule** as a hard invariant, and `CODING_GUIDELINES.md` §7 restates it;
the SDK notification store's own doc-comment calls it "the no-403 invariant — same
perm the endpoint enforces". `server_update::read` is granted by NO migration, so
it reaches only administrators (via the `*` wildcard) — every ordinary user would
receive a 403 on every boot if the gate were dropped.

**Approach.** Treat Rank 4 as a **documented no-change**, and back that with an
executable proof that the gate is load-bearing rather than decorative: a
restricted-user boot must issue **zero** requests to the permission-gated
endpoints. The saving on offer is ≈ one RTT; the cost is a standing violation of a
documented invariant, on the app's boot path, for every non-admin user. That trade
is not worth making at LOW severity — or at any severity, while the invariant
stands.
