# PLAN_AUDIT — background-in-conversation

Audited against the codebase at `origin/feat/agent-core` @ `f78a23a22`.

> **Known base condition (not a finding of this plan):** gate A1 ("a branch may
> carry exactly ONE `.lifecycle/` feature dir") fails because the BASE branch
> already carries 10 sibling feature trails
> (`git ls-tree origin/feat/agent-core .lifecycle/` → 10 entries). They are
> deliberately kept on `feat/agent-core`; stripping them would show up as a
> spurious deletion in this branch's diff. Every other gate is run and must pass.

## Breakage risk

- **`list_background_runs_for_user` signature change (ITEM-2)** — verified the
  function has exactly ONE caller in the repo (`background_mcp/runs.rs:78`;
  definition at `workflow/repository.rs:1649`). No other module, test, or MCP tool
  calls it. Breakage surface: the one call site, updated in the same item.
- **Disjoint semantics is a BEHAVIOUR CHANGE to an existing endpoint (ITEM-2).**
  An unfiltered `GET /api/background/runs` previously returned ALL of the user's
  background runs; it now returns only the conversation-LESS ones. That is the
  design (INV-3), but it means the existing global page could no longer show
  conversation-spawned runs even if it were kept — which independently forces
  ITEM-9 and the ITEM-13 spec retargeting. Recorded rather than discovered later.
- **Removing the `/background-tasks` route + both nav entries breaks 7 existing
  e2e specs.** Enumerated exhaustively:
  `15-background/background-sandbox-panel`, `15-background/background-negative-perm`,
  `chat/background-persist`, `chat/background-status`, `chat/steer-running-agent`
  (all drive `/background-tasks`); `15-notifications/background-inbox` (asserts the
  `agent-inbox` nav entry is visible); `sync/subagent-completion-sync` (uses
  `goto('/notifications/background')` only — that route is KEPT, so it is
  unaffected). All six affected specs are covered by ITEM-13.
- **`sdk/packages/kit/src/testIds.generated.ts` is inside a submodule (ITEM-14).**
  Removing `background-tasks-*` ids and adding the new ones makes
  `npm run check:testid-registry` fail until regenerated, and the regen writes into
  the `sdk` submodule (per `src-app/ui/gallery.config.json` → `"testidOut"`).
  Requires an sdk commit + superproject pointer bump. Precedent: the two most recent
  sdk commits are `chore(kit): regen testid registry`.
- **`MessageList` early-returns for an empty conversation** (`MessageList.tsx:481-493`)
  and that branch does NOT render `message_list_footer`. Consequence: the footer is
  structurally invisible on a message-less conversation. Harmless (a conversation
  with no messages has no sub-agents), but it must not be relied on as the empty
  state — the panel owns the empty state. No plan change needed; noted so the e2e
  seeds at least one message.
- **`registerPanelRenderer` runs per PANE mount**, not once globally
  (`registry.tsx:475`). Repeated registration is an idempotent `Map.set`, exactly as
  literature/knowledge-base already do. No leak.
- **`sync:workflow_run` reload (ITEM-4)** is the single highest-risk change: today
  it refetches ONE global page; it must become a fan-out across tracked conversation
  scopes. Bounded by the number of conversations the session has opened panels for
  (1 per pane, ≤2 panes in practice). Must not become an unbounded fan-out — the
  plan tracks only scopes that were explicitly loaded.

## Pattern conformance

- **ITEM-7 (chat-extension)** mirrors `modules/literature/chat-extension/extension.tsx`
  1:1: `createExtension` from `@/modules/chat/core/extensions`, lazy
  `registerPanelRenderer` inside `initialize`, `import '../types'` to force the
  declaration merge. Verdict: conformant. The sibling-module glob
  (`../../*/chat-extension/extension.tsx`, `chat/extensions/index.ts:61`) picks up
  `modules/background/chat-extension/extension.tsx` with zero wiring.
- **ITEM-6 (slot)** mirrors `modules/projects/chat-extension/extension.tsx:301`
  (`slots: { <slot>: { component, order } }`). Slot components take **no props**
  (`SlotRegistration.component: React.ComponentType`), so the footer must resolve
  its conversation from `useChatPaneOrNull()` — which is exactly the
  `LiteratureToolResultCard.tsx:30` idiom. Verdict: conformant.
- **ITEM-4 (store)** stays inside the established store-kit authoring model
  (`defineStore` + `actions: (set,get)` + `init: ({on,get,actions})`), and keeps the
  `hasPermissionNow(Permissions.BackgroundUse)` self-gate on every fetch (the
  no-403-on-reconnect rule). Keying by id mirrors the store's own
  `detailsByRun`/`notesByRun`. Verdict: conformant.
- **ITEM-2 (SQL)** extends the existing residual-filter idiom in the same function.
  The two-state predicate is applied to BOTH queries so `total` cannot disagree with
  the page — the classic bug in this shape. Verdict: conformant.
- **ITEM-11** adds an optional prop rather than a second card component — satisfies
  the affordance-parity/reuse angle (no parallel implementation).
- **Index on `workflow_runs.conversation_id` — RESOLVED, one already exists.**
  `202607140230_workflow_schema.sql:87` ships
  `CREATE INDEX idx_workflow_runs_conv ON public.workflow_runs (conversation_id)
  WHERE (conversation_id IS NOT NULL)`, which serves the scoped direction; the
  unscoped `IS NULL` direction stays bounded by
  `idx_workflow_runs_user_created (user_id, created_at DESC)` + `LIMIT`, exactly
  like the pre-existing `status`/`kind` residual filters. No migration owed
  (see DEC-6).

## Migration collisions

**None.** This feature adds no migration. There is no numbered
`src-app/server/migrations/` directory on this base — migrations are per-module
timestamped files merged into `migrations-merged`; the highest is
`202607191300_agent_delegate_enabled.sql`. The `background::use` permission and its
Users-group grant already exist (`202607191000_background_grant_permissions.sql`),
so no new permission is introduced (⇒ A9/A10 are not newly triggered, though the
existing negative-perm spec is still updated + run).

## OpenAPI regen

**Required, in BOTH workspaces.** `ListBackgroundRunsQuery` gains
`conversation_id`, which changes:
- `src-app/ui/openapi/openapi.json` + `src-app/ui/src/api-client/types.ts`
- `src-app/desktop/ui/openapi/openapi.json` + `src-app/desktop/ui/src/api-client/types.ts`

Run `just openapi-regen` (both binaries) — NOT a single-binary run, or desktop
drifts. `openapi::emit_ts::tests::types_ts_parity` is the golden guard. Both
generated pairs are excluded from the phase-6 audit-coverage law by the validator's
`DIFF_EXCLUDES`, so the *source* hunks (`runs.rs`) carry the review.

## Per-item verdicts

- **ITEM-1** — verdict: PASS — additive `#[serde(default)] Option<Uuid>` on an
  existing `JsonSchema` query struct; `Uuid` is already imported in `runs.rs`.
- **ITEM-2** — verdict: PASS — single caller; predicate mirrors the existing
  residual-filter idiom; applied to list AND count.
- **ITEM-3** — verdict: CONCERN — must run `just openapi-regen` (BOTH workspaces);
  a single-binary regen silently leaves desktop stale. Tracked by TEST-14.
- **ITEM-4** — verdict: CONCERN — the `sync:workflow_run` handler currently
  refetches a global page and WOULD wipe the conversation-scoped list under the new
  semantics (the defect in the rescued original). The keyed slice + scope-aware
  reload is the fix and is the single most important thing to test (TEST-6).
- **ITEM-5** — verdict: PASS — mirrors `LiteratureScreeningPanel` as a right-panel
  renderer; reuses `BackgroundRunCard`; bounded first page + Load more satisfies
  the scale-performance angle.
- **ITEM-6** — verdict: PASS — `message_list_footer` exists and is rendered
  (`MessageList.tsx:631`); no extension currently occupies it, so no ordering
  conflict. Pane-scoped read matches the established idiom.
- **ITEM-7** — verdict: PASS — auto-discovered by the sibling-module glob; mirrors
  literature exactly.
- **ITEM-8** — verdict: PASS — `declare module '@/modules/chat/core/stores/chat'`
  is the exact string used by all three existing mergers.
- **ITEM-9** — verdict: CONCERN — deleting the page is correct (unreachable ⇒ dead
  code; and disjoint semantics make it unable to show conversation runs anyway) but
  it is the item that breaks the most existing specs. Fully enumerated under
  Breakage risk and covered by ITEM-13.
- **ITEM-10** — verdict: PASS — removing ONLY the `sidebarNavigation` entry; the
  `sidebarBottom` bell and the `/notifications/background` route are untouched, so
  the bell's navigate-to-conversation path (INV-2's stated replacement) still works
  and `sync/subagent-completion-sync.spec.ts` still passes unchanged.
- **ITEM-11** — verdict: PASS — optional prop, default preserves today's behaviour
  everywhere else.
- **ITEM-12** — verdict: CONCERN — `check:gallery-coverage` + `check:state-matrix`
  are inside `npm run check`, so removing the page's gallery surface and adding the
  panel/footer states must be reflected in the generated coverage files or the gate
  fails. Requires the regen scripts, not a hand edit.
- **ITEM-13** — verdict: CONCERN — three of the six specs
  (`background-persist`, `background-status`, `steer-running-agent`) are real-LLM
  agentic specs; retargeting must preserve what they actually prove (persistence
  across reload, live status transition, steering) rather than weakening them into
  a render check.
- **ITEM-14** — verdict: CONCERN — writes into the `sdk` submodule; needs an sdk
  commit + pointer bump, and cannot be skipped (`check:testid-registry` is in
  `npm run check`).

No `BLOCKED` verdicts.
