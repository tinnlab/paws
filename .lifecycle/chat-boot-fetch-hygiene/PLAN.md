# PLAN — chat-boot-fetch-hygiene

## Design source

- Realizes `.lifecycle/chat-boot-fetch-hygiene/DESIGN.md` §"Rank 3" and §"Rank 4"
  (written this round; it is itself a follow-on to `.lifecycle/net-hygiene/DESIGN.md`
  §"Root causes" and §"Approach", whose invariants this round inherits verbatim).
- Grounded in the upstream evidence report
  `/data/pbya/ziee/tmp/live-ui-247/TRIAGE-vs-9363976a2.md` §4 Rank 3 + Rank 4.
- Conforms to `CLAUDE.md` §"Realtime Sync → Frontend" (the **no-403 reconnect
  rule**) and `agent-kit/docs/CODING_GUIDELINES.md` §7 (realtime sync) + §12
  (frontend store discipline).

## Invariants

Lifted VERBATIM from `.lifecycle/net-hygiene/PLAN.md` §Invariants (INV-1, INV-3)
and from `CLAUDE.md` §"Realtime Sync → Frontend" (the no-403 rule):

- **INV-1**: Do NOT regress correctness for the sake of fewer requests (a stale/missing refetch is worse than a duplicate) — keep the sync/refetch semantics intact.
- **INV-2**: De-duplicate: one shared store read / in-flight request de-dupe rather than N independent callers.
- **INV-3**: **No-403 reconnect rule** is enforced by the store SELF-GATING its refetch: the `sync:<entity>` / `sync:reconnect` handler calls `hasPermissionNow(Permissions.X)` and returns early if the user lacks it. The perm checked MUST equal the read-perm the refetch endpoint enforces.

## Items

- **ITEM-1**: **Measure Rank 3 before changing anything.** Count the wire requests to `GET /api/conversations` on a cold, authenticated `/chats` load against the UNMODIFIED tip, using the browser's own request log (no `page.route` mocking). Record the observed count + the request timeline in `MEASUREMENTS.md`. This is the evidence gate: a change is only justified if the duplicate is real on the merged tip.
- **ITEM-2**: **Give the `/chats` list fetch a single owner.** Remove the mount-effect `ChatHistory.loadConversations()` from `ConversationList.tsx` and leave `ChatHistoryPage.tsx` as the sole owner of the route-level fetch; replace both components' now-stale comments with the single-owner contract (why the page owns it, why the list must not). `ConversationList` has exactly ONE production consumer (`ChatHistoryPage`) and cannot mount without it, so the page's unconditional mount fetch already covers every case the list's own effect claimed to cover. No new machinery.
- **ITEM-3**: **Prove the de-dupe did not cost data or reactivity (INV-1).** Verify that after ITEM-2 the `/chats` page still lists seeded conversations on a cold load, still picks up a conversation created *after* the store was primed (the exact case `ConversationList`'s comment cited), and still refetches on search/sort/delete.
- **ITEM-4**: **Investigate Rank 4 and record a verdict.** Measure the second boot tier (`/api/onboarding/progress`, `/api/server-update/status`, `/api/notifications`) relative to `/api/auth/me`, and determine whether each gate encodes a REAL dependency. Record the finding + verdict in `MEASUREMENTS.md` and the disposition in `DECISIONS.md`.
- **ITEM-6**: **Stop the search debounce firing a no-op refetch on mount.** (Added in phase 5 — DRIFT-1.2, `impl-wins`: the measurement found a THIRD redundant caller the triage never named.) `ConversationList`'s 500 ms debounce effect also runs on mount and calls `ChatHistory.setSearchQuery(localSearchQuery)` with `''` when the store's `searchQuery` is already `''`; `setSearchQuery` unconditionally issues `loadConversations(1)`, so every cold `/chats` load paid a second full page-1 refetch ~500 ms after the first. Guard the effect on `localSearchQuery !== ChatHistory.$.searchQuery` — `.$` being the NON-subscribing snapshot, since a reactive proxy read is a hook and is illegal outside render. Comparing against the STORE, rather than "is this the first run", is what preserves every real reconciliation: clearing a query back to `''` still differs from the store's `'x'` and still fires, and remounting the list while the store holds a stale query still resets it to match the empty input the user can see. Only a genuine equal→equal pass is skipped.

- **ITEM-5**: **[DESCOPED] Optimistically fire the second-tier boot fetches and tolerate a 403.** This is the triage's suggested Rank-4 fix. It is cut because it directly violates INV-3, a documented standing rule of this codebase; `server_update::read` is granted by no migration and so reaches only administrators, meaning every ordinary user's boot would carry a guaranteed 403. See DEC-2 and the executable proof enumerated as TEST-5. The alternative disposition — leave the gates alone, documented — is ITEM-4's verdict.

## Files to touch

- `src-app/ui/src/modules/chat/components/ConversationList.tsx` (ITEM-2 — remove the mount effect + comment; ITEM-6 — guard the search-debounce effect)
- `src-app/ui/src/modules/chat/pages/ChatHistoryPage.tsx` (ITEM-2 — record the single-owner contract)
- `src-app/ui/tests/e2e/perf/chats-list-single-fetch.spec.ts` (new — ITEM-1/2/3)
- `src-app/ui/tests/e2e/perf/boot-tier-permission-gate.spec.ts` (new — ITEM-4)
- `.lifecycle/chat-boot-fetch-hygiene/*` (artifacts)

No backend files. No migration. No OpenAPI/type regen (no Rust type changes).
`src-app/desktop/ui` carries NO copy of either component (verified: neither file
exists under `src-app/desktop/ui/src/modules/chat/`), so there is no desktop twin
to mirror.

## Patterns to follow

- **e2e network measurement** — mirror `src-app/ui/tests/e2e/perf/boot-parallelism.spec.ts`
  exactly: the `recordApi(page, body)` helper reading `page.on('request'|'response')`,
  the real backend driven through the UI, NO `page.route` mocking. That spec is the
  closest existing module and was written by the same (`net-hygiene`) lifecycle.
- **restricted-user e2e** — mirror the `login(page, baseURL, username, password)`
  helper in `src-app/ui/tests/common/auth-helpers.ts` (as used by
  `tests/e2e/permissions/`), not `loginAsAdmin`.
- **route-level data ownership** — mirror the prevailing meta-framework contract:
  the page owns its route fetch; a child list component consumes store state
  (`Stores.X.field`) and does not issue its own load. See
  `agent-kit/docs/CODING_GUIDELINES.md` §12.

## UI-surface checklist

This round adds **no new UI surface** — it removes one redundant effect from an
existing component and changes no markup, no styling, no state branch, and no
rendered output. Consequently:

- **Precedent** — n/a (no new surface). The touched surface (`/chats`) keeps its
  existing structure verbatim; the diff contains no JSX change.
- **Scale / cardinality** — unchanged. `/chats` already pages server-side
  (`page`/`limit`) and virtualizes rows via `VirtualizedConversationList`; this
  round neither widens nor narrows that.
- **Device size / responsive** — unchanged; no layout, breakpoint or class change.
  The narrow-viewport (390px) search-toggle path in `ChatHistoryPage` is untouched.
- **Populated-render review** — the risk this change carries is precisely a
  POPULATED-render risk (does the list still fill?), which is why ITEM-3 exists and
  is proven by TEST-2/TEST-3 against a seeded backend rather than an empty one.
- **User-visible progress** — unchanged: `loading` still flips on the page's own
  fetch, so the list's spinner behaviour is identical.
- **Input economy / JTBD** — unchanged. The user's job on `/chats` ("find and reopen
  a past conversation") is unaffected; the only observable delta is one fewer
  network round-trip.
- **Multi-instance / URL-as-view-into-focus / platform affordances** — n/a; no
  new context, no URL semantics touched.

## Conditional render states

No new loading/empty/error/variant state is introduced, so no new gallery cell is
required (`check:state-matrix` is expected to stay green unchanged).
