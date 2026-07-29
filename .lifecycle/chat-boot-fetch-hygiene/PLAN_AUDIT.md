# PLAN_AUDIT — chat-boot-fetch-hygiene (plan vs codebase)

Audited against the worktree at `fix/chat-boot-fetch-hygiene` (base
`origin/feat/agent-core` @ `9363976a2`), before any code was written.

## Breakage risk

**ITEM-2 is the only behavioural change, and its blast radius is bounded by a
single-consumer fact I verified rather than assumed.**

- `ConversationList` is imported in exactly ONE production module:
  `src-app/ui/src/modules/chat/pages/ChatHistoryPage.tsx:5`. A repo-wide grep for
  `ConversationList` over `src-app/ui/src` + `src-app/desktop/ui/src` returns only
  (a) that import, (b) the component's own file, (c) unrelated hits for the
  DIFFERENT symbol `VirtualizedConversationList`, and (d) gallery references.
  There is no second mount site whose fetch would disappear.
- The gallery demo `src-app/ui/src/dev/gallery/ConversationListLongDemo.tsx`
  renders `VirtualizedConversationList` **directly** (`:17`, `:74`) with synthetic
  offline rows — it does NOT render `ConversationList`, so removing that
  component's effect cannot change any gallery cell's data.
- The chat gallery's `/chats` page cells (`modules/chat/gallery.tsx:962`, `:984`)
  drive the REAL page through the mock-API cassette. They assert on the
  `loading && !isInitialized` spinner arm, which is driven by store state the page
  effect still sets — the removed effect was never the thing that produced that
  state (it was the *second* caller, which short-circuits on the in-flight guard).
- **`ConversationList` cannot mount before its parent's effect has run.** The page
  only renders it when `conversations.length > 0 || loading || error || hasSearch`
  — every one of those becomes true only as a consequence of a `loadConversations`
  call. So the child effect provably never fires *first*; it can only ever be the
  redundant second caller. Removing it therefore cannot delay or remove a fetch.
- **Risk that IS real and is covered:** a `ConversationList` remount *within* one
  page mount (e.g. list drains to empty via bulk-delete, then re-populates) would,
  today, re-run the child effect. After the change it will not. This is why ITEM-3
  exists and TEST-3 drives the create-after-prime case explicitly rather than
  asserting it from the code. Verdict: the page's mount fetch plus the store's own
  post-mutation refetches (`bulkDelete`, `deleteConversation`, `setSearchQuery`,
  `setSort`) cover it; TEST-2/3 prove it rather than argue it.

**ITEM-5 (descoped) carries the larger breakage risk and is the reason it is cut.**
Dropping the `hasPermissionNow` gate in `server-update` would issue
`GET /api/server-update/status` for EVERY authenticated user. `server_update::` is
granted by **no** migration under `src-app/server/migrations-merged/` (grep returns
zero grant rows), so it reaches only administrators via the `*` wildcard — i.e.
every ordinary user's boot would carry a guaranteed 403. That is a regression
dressed as an optimization; see DEC-2.

## Pattern conformance

- **e2e measurement pattern** — `tests/e2e/perf/boot-parallelism.spec.ts` already
  establishes the exact idiom the plan names: `recordApi(page, body)` over
  `page.on('request')` / `page.on('response')`, real backend, no `page.route`. The
  new specs mirror it, including the "no mocking" comment convention. ✔
- **Single-owner route fetch** — matches `agent-kit/docs/CODING_GUIDELINES.md` §12
  (frontend store discipline: a component consumes store state; the route owner
  drives the load) and the meta-framework's store-kit authoring model. ✔
- **Restricted-user login** — `tests/common/auth-helpers.ts::login(page, baseURL,
  username, password)` is the established non-admin path (token injected into
  `auth-storage`, then reload). ✔
- **Test placement** — `tests/e2e/perf/` already holds the network-hygiene specs
  from the predecessor lifecycle; the two new specs belong there, not in
  `tests/e2e/chat/`. ✔

## Migration collisions

None. This branch adds **zero** migrations. Highest on base:
`migrations-merged/202607191300_agent_delegate_enabled.sql` (unchanged). ✔

## OpenAPI regen

Not required. No Rust handler, model, permission, or `SyncEntity` change ⇒
`openapi.json` and `api-client/types.ts` are byte-unchanged in BOTH `src-app/ui`
and `src-app/desktop/ui`. The diff is confined to two `.tsx` files plus new specs
plus lifecycle artifacts. ✔

## Per-item verdicts

- **ITEM-1** — verdict: PASS — measurement-only; mirrors the committed
  `recordApi` idiom from `boot-parallelism.spec.ts`. No production code touched, so
  it cannot itself break anything. The one hazard is measuring the WRONG signal:
  both `loadConversations` and the sidebar's `loadRecentConversations` hit
  `GET /api/conversations` with identical default params, so the spec must count
  wire requests to that path and reason about the coalescer rather than assume a
  1:1 caller↔request mapping. Called out here so the spec is written accordingly.
- **ITEM-2** — verdict: PASS — single-consumer verified by grep (see above); the
  child provably cannot be the first caller; no desktop twin exists
  (`src-app/desktop/ui/src/modules/chat/{components/ConversationList,pages/ChatHistoryPage}.tsx`
  both absent), so R2-3 desktop-override review is a no-op for this diff.
- **ITEM-3** — verdict: PASS — the correctness guard for ITEM-2, and the direct
  realization of INV-1. Drives a seeded backend, so it exercises the populated
  render the plan checklist calls for.
- **ITEM-4** — verdict: CONCERN — *not* a defect in the plan, but the item's
  honest outcome is "no change", and a no-change item can degrade into an
  unfalsifiable claim. Mitigation, already folded into the plan: ITEM-4 must
  discharge itself with (a) a measured timeline and (b) an EXECUTABLE proof
  (TEST-5) that the gate is load-bearing — a restricted-user boot issuing zero
  requests to the gated endpoint. Without (b) this item would be prose only.
  Tracked, not blocking.
- **ITEM-6** — verdict: PASS — added in phase 5 (DRIFT-1.2). Same defect class as ITEM-2 and the same blast radius (one component, one production consumer). The one judgment call is the guard's SHAPE: comparing `localSearchQuery` against the STORE's `searchQuery` rather than "is this the first run" — the latter would pass TEST-1's count assertion while stranding a user who clears a query back to empty, which is why TEST-6 was enumerated to cover exactly that leg. Uses `.$` (non-subscribing snapshot), correct per the reactive-read-in-effect rule; a reactive proxy read here would be an illegal hook call outside render. All 8 pre-existing specs covering `ConversationList`/`ChatHistoryPage` (search ×3, sort, load-more, virtualization ×2, narrow-search) re-run green.
- **ITEM-5** — verdict: PASS — correctly `[DESCOPED]`, with an approved
  disposition recorded in DECISIONS.md (DEC-2). Descoping it is the *finding*, not
  an omission: implementing it would violate INV-3, which this repo states as a
  standing rule in `CLAUDE.md` and `CODING_GUIDELINES.md` §7.

## Notes carried into implementation

1. The `reloadQueued` branch in `loadConversations.ts:16-20` is the mechanism that
   makes the duplicate call a *serial second wire request* rather than a dropped
   no-op. The measurement must therefore observe request COUNT + ordering, not just
   "did a duplicate caller exist".
2. `loadConversations` and `loadRecentConversations` share the endpoint and the
   default params; the transport in-flight coalescer (net-hygiene ITEM-1) merges
   them only while genuinely concurrent. Expect the boot burst to collapse to one
   request and any post-settle replay to be a separate one.
