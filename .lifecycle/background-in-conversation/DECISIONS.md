# DECISIONS — background-in-conversation

Every human/product input the implementation needs, resolved up front.

### DEC-1: Is the global `/background-tasks` PAGE deleted, or kept as a nav-less deep link?
**Resolution:** DELETED — route, `sidebarNavigation` entry, and `pages/BackgroundTasksPage.tsx`.
**Basis:** user — `DESIGN.md` §2 states verbatim "There is **no global 'Background tasks' page**". Reinforced by two codebase facts: (a) with ITEM-2's disjoint semantics the unfiltered list returns only conversation-LESS runs, so the page could no longer show the conversation-spawned runs its own e2e specs seed — keeping it would ship a page that silently lost its content; (b) a route-less page is unreachable dead code (CODING_GUIDELINES §15).

### DEC-2: Is the `/notifications/background` (agent-inbox) ROUTE also removed?
**Resolution:** NO — only its `sidebarNavigation` entry is removed. The route, the page, and the `sidebarBottom` bell all stay.
**Basis:** user — `DESIGN.md` §2 removes the "Background results" **sidebar entry** and names the bell as the replacement surface ("results surface via the central notification bell, whose click navigates to the conversation"). The bell needs a target, so the route is load-bearing. This also keeps `sync/subagent-completion-sync.spec.ts` passing unchanged.

### DEC-3: How is the conversation scope carried in the store — a third argument to `loadRuns`, or a keyed slice?
**Resolution:** a conversation-KEYED slice (`runsByConversation` &c.) with a dedicated `loadConversationRuns(conversationId, page?)`; `loadRuns`' unscoped global form is removed along with its only consumer (the deleted page).
**Basis:** codebase — the rescued original passed a third arg into the single shared `runs` array, but the store's `init` refetches on `sync:workflow_run` with NO conversation id; under the new disjoint semantics that call returns conversation-less runs and blanks the panel at exactly the moment a run changes state. Keying also fixes split-pane clobbering, which the original acknowledged in a comment but did not solve. Keying by id mirrors the store's own `detailsByRun` / `notesByRun`.

### DEC-4: Does the `sync:workflow_run` reload fan out across ALL tracked conversation scopes?
**Resolution:** yes, but only over scopes that were EXPLICITLY loaded this session (the keys present in `runsByConversation`), each refetched at page 1 with its accumulated page count preserved. No unscoped refetch is issued.
**Basis:** convention — mirrors the existing handler's intent (refresh what is on screen) while respecting the no-403 self-gate. Bounded by open panes (≤2 in practice), so it cannot become an unbounded fan-out.

### DEC-5: Page size + pagination idiom for the in-conversation Tasks panel.
**Resolution:** `per_page: 20`, page 1 on open, a "Showing N of M" line, and a **Load more** control that appends the next page. Not numbered `ListPagination`.
**Basis:** convention — the lifecycle UI checklist assigns numbered pagination to settings/detail lists and Load-More to feed-like surfaces; the right panel is a narrow feed-shaped column, and the sibling `LiteratureScreeningPanel` likewise does not use numbered pagination. 20 keeps the first paint small while covering the overwhelmingly common case in one request.

### DEC-6: Is a new index on `workflow_runs.conversation_id` added?
**Resolution:** NO — none is needed. A partial index already exists: `CREATE INDEX idx_workflow_runs_conv ON public.workflow_runs (conversation_id) WHERE (conversation_id IS NOT NULL)` (`src/modules/workflow/migrations/202607140230_workflow_schema.sql:87`).
**Basis:** codebase — the scoped (`Some(id)`) direction is served by that existing partial index; the unscoped (`None`) direction is `conversation_id IS NULL`, which the partial index deliberately excludes but which is already bounded by `user_id` + `created_at DESC` (`idx_workflow_runs_user_created`) + `LIMIT`, exactly like the pre-existing `status`/`kind` residual filters. No migration is owed. Verified after the PLAN_AUDIT, which had recorded this as an open concern on the assumption no such index existed.

### DEC-7: Is the per-conversation run cap / page size an admin-configurable setting or a fixed constant?
**Resolution:** fixed constants — `PANEL_PAGE_SIZE = 20` (client) and the server's existing `per_page` clamp `1..=500`. No new settings row.
**Basis:** convention — the configurable-settings rule targets OPERATIONAL tunables (resource limits, retention, concurrency, quotas). A client-side page size is a presentation choice with no server cost profile, and the endpoint's real operational bound (the `1..=500` clamp) already exists and is unchanged. It is declared as a named module constant, not an inline literal, so it can be promoted later without a rewrite.

### DEC-8: Where does the "Open conversation" affordance go when a card renders inside its own conversation's panel?
**Resolution:** suppressed, via an optional `contextConversationId` prop on the existing `BackgroundRunCard` (absent ⇒ today's behaviour). No second card component.
**Basis:** convention — the new-rendering-context affordance audit: navigating to the conversation you are already reading is a no-op, and inside a split pane the card's `useNavigate()` would move the whole window rather than the pane. Reusing the card with an optional prop satisfies the affordance-parity/reuse angle.

### DEC-9: Does the footer render for every conversation, and what does it cost?
**Resolution:** the footer component mounts in every conversation (it occupies `message_list_footer`) but renders `null` unless that conversation has ≥1 run; it triggers ONE scoped `GET /api/background/runs?conversation_id=…&per_page=20` per conversation, deduped with the panel through the shared keyed slice, and skipped entirely without `background::use`.
**Basis:** convention — mirrors `ProjectChipForConversationHeader`, which likewise mounts everywhere and renders null when not applicable. One small owner-scoped GET per conversation open is the same order as the other per-conversation fetches already issued on load.

### DEC-10: Which conversation does the footer/panel bind to under split panes?
**Resolution:** the PANE's own conversation — `(useChatPaneOrNull()?.store ?? Chat)`; `displayInRightPanel` is called on that same pane store.
**Basis:** codebase — the established idiom at `LiteratureToolResultCard.tsx:30` and `SearchKnowledgeToolResultCard.tsx:30`; anything else opens the tab in the focused pane rather than the clicked one.

### DEC-11: The testid registry regen lands inside the `sdk` SUBMODULE — is that acceptable, and is it pushed?
**Resolution:** yes, acceptable and required; committed in the submodule locally plus a superproject pointer bump, and NOT pushed.
**Basis:** codebase + user — `src-app/ui/gallery.config.json` sets `"testidOut": "../../sdk/packages/kit/src/testIds.generated.ts"`, and `check:testid-registry` is inside `npm run check`, so it cannot be skipped. The two most recent `sdk` commits on the pinned branch `sdk/agent-core-and-perf` are exactly `chore(kit): regen testid registry`, so this is the established flow. The task brief says the owner lands the work, so nothing is pushed.

### DEC-12: The base branch already carries 10 sibling `.lifecycle/` dirs, failing gate A1. Strip them?
**Resolution:** NO — leave them. A1 is recorded as a known base condition; every other gate is run and must be green.
**Basis:** codebase — `git ls-tree origin/feat/agent-core .lifecycle/` shows the 10 dirs are committed on the base, and the base's own history contains `chore(lifecycle): restore sibling feature audit trails stripped for A1; they belong on feat/agent-core` — a previous attempt to strip them was explicitly reverted. Stripping would also show up as spurious deletions in this branch's diff.

### DEC-13: Do the three real-LLM agentic specs get retargeted or replaced with cheaper render checks?
**Resolution:** RETARGETED, preserving exactly what each proved (live status transition / reload persistence / steering); only the observation surface changes from `/background-tasks` to the in-conversation Tasks panel.
**Basis:** convention — `feedback_no_cosmetic_tests` + the test-reality audit angle: weakening an agentic spec into a render check while keeping its TEST-ID is coverage inflation. Their assertions are preserved verbatim where the surface allows.

### DEC-14: Is a new permission introduced (triggering A9/A10)?
**Resolution:** NO. `background::use` and its Users-group grant already exist (`202607191000_background_grant_permissions.sql`); this feature only moves the surfaces it gates.
**Basis:** codebase. The existing `[negative-perm]` spec is still updated and run (TEST-13) because its surfaces moved, but no new backend deny test is owed beyond the existing `list_and_cancel_require_background_use_permission`.

## Descopes

None. Every ITEM-1..ITEM-14 is implemented and covered by an enumerated TEST.
