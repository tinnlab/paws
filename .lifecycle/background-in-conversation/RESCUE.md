# RESCUE ledger — what was found vs. what was ported

The feature existed only as **uncommitted** changes in the scratch worktree
`/data/pbya/ziee/tmp/fp-ac-merge` (branch `integration/main-agentcore`, HEAD
`51164e4cd`). That tree was left untouched; everything was copied out first to
`/data/pbya/ziee/tmp/RESCUE-bg-inconv-20260726-182552/`
(`all-tracked.diff` = full `git diff`, `untracked.tgz` = the three new files).

## Belongs to this feature — PORTED

| Source change | Disposition |
|---|---|
| `server/src/modules/background_mcp/runs.rs` (`ListBackgroundRunsQuery.conversation_id` + pass-down) | ported (ITEM-1) |
| `server/src/modules/workflow/repository.rs` (`list_background_runs_for_user` + two-state disjoint WHERE on list **and** count) | ported verbatim (ITEM-2) |
| `ui/src/modules/background/chat-extension/extension.tsx` (NEW) | ported ~verbatim (ITEM-7) — the literature precedent it mirrors is unchanged on the new base |
| `ui/src/modules/background/components/BackgroundRunsPanel.tsx` (NEW) | ported, **reworked** (ITEM-5) — see "rewritten" below |
| `ui/src/modules/background/components/BackgroundRunsFooter.tsx` (NEW) | ported, **reworked** (ITEM-6) — see "rewritten" below |
| `ui/src/modules/background/types.ts` (`PanelRendererMap` merge) | ported verbatim (ITEM-8) |
| `ui/src/modules/background/module.tsx` (drop nav entry + route) | ported (ITEM-9), extended: the now-unreachable page is DELETED |
| `ui/src/modules/notification/module.tsx` (drop `agent-inbox` nav entry) | ported verbatim (ITEM-10) |
| `ui/src/modules/background/stores/BackgroundRuns.store.ts` (`loadRuns` 3rd arg) | **superseded** — see "rewritten" below (ITEM-4) |
| `ui/openapi/openapi.json` + `desktop/ui/**` + both `api-client/types.ts` | NOT copied — regenerated fresh on the new base (ITEM-3); the source tree's copies carried unrelated regen churn |
| `ui/src/modules/background/pages/BackgroundTasksPage.tsx` (empty-state copy reword) | **dropped** — the page itself is deleted, so the reword is moot |

## Does NOT belong to this feature — LEFT BEHIND

Unrelated work from the fp↔agent-core merge, deliberately not carried over:

- `server/ai-providers/src/providers/openai.rs`
- `ui/src/modules/chat/core/stores/chat/index.ts` + `actions/applyStreamFrame.ts`
  (the rAF stream-coalescing perf work)
- `ui/src/modules/chat/core/extensions/registry.tsx` (`console.log` cleanup)
- `ui/src/modules/chat/extensions/text/components/TextInput.tsx` (TextStore
  register-race fix)

## Rewritten because the base moved / the original had a defect

1. **Store scoping (ITEM-4) — the original had a live defect.** The original added
   a third `conversationId` argument to `loadRuns` and let the panel + footer
   filter the ONE shared `runs` array client-side. On the current base the store's
   `init` subscribes `sync:workflow_run` → `loadRuns(get().currentPage)` with **no**
   conversation id. Under the new disjoint backend semantics that call returns only
   conversation-LESS runs, so the very first run state-change (i.e. exactly when
   the user is watching) would replace the panel's list and the client-side filter
   would yield zero — the panel silently empties. The original also acknowledged in
   a comment that two split panes clobber each other. Replaced with a
   conversation-KEYED slice plus a scope-aware sync reload.
2. **Global page deletion (ITEM-9).** The original removed the route but kept
   `BackgroundTasksPage.tsx` (only rewording its empty state), leaving an
   unreachable page (dead code, §15). The page is now deleted. This is also forced
   by ITEM-2: with disjoint semantics a conversation-spawned run no longer appears
   in the unfiltered global list at all, so the page could not have shown the runs
   its own e2e specs seeded.
3. **e2e reconciliation (ITEM-13) — absent from the original.** The current base
   has seven specs that drive `/background-tasks` or assert the two nav entries are
   VISIBLE (including the A10 `background-negative-perm` positive control). The
   original predates them. They are retargeted onto the in-conversation surface.
4. **`BackgroundRunCard` context prop (ITEM-11) — absent from the original.** The
   card's "Open conversation" button is a no-op (worse: a pane-hijacking navigate)
   when the card is rendered inside that same conversation's panel.
5. **Paging (ITEM-5).** The original panel rendered whatever page 1 returned with
   no bound or "showing N of M". Replaced with an explicit bounded first page +
   Load more.
6. **Gallery + testid registry (ITEM-12/14) — absent from the original.** Both are
   gate-enforced by `npm run check` on the current base.
