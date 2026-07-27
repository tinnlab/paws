# DRIFT-1 — implementation vs plan (authored live, during phase 5)

Each entry was written as the item landed and was re-measured on the rig, not
reconstructed afterwards. Two of them are the reason the shipped design differs
from the plan's first draft.

- **DRIFT-1.1** — verdict: plan-wins — PLAN ITEM-3 originally said "add an
  optimistic speculative wave so `ctx.isAuthenticated`-gated modules register in
  parallel with `/auth/me`". Reading `.lifecycle/net-hygiene/DECISIONS.md` at
  phase 2 showed that is a design this codebase already implemented,
  blind-audited (3 angles), measured at ZERO benefit, and CUT (its ITEM-6 /
  DEC-15) — with a committed guard test that would have gone red. The plan was
  amended to diagnosis + classification BEFORE any code was written; no
  eligibility code was touched. Plan-wins in the sense that the PLAN was the
  thing corrected.

- **DRIFT-1.2** — verdict: impl-wins — PLAN ITEM-1 specified the trigger as
  "conversation-change + the streaming true→false edge". Implemented as such,
  rebuilt, re-measured: the audit still reported `…/summary` **2×** per step. The
  live trace (`.lifecycle/live-ui-audit-round2/summary-trace-probe.mjs`, which
  wraps `fetch` in-page and captures a stack + a ms-since-send timeline) showed
  why: navigating `/` → `/chat/{id}` mid-send runs `loadConversation`, which sets
  `isStreaming:false` transiently, so `isStreaming` produces **two** falling
  edges per send. The implementation moved the turn-end read onto the
  summarization extension's `afterStreamComplete` hook — which the stream handler
  invokes exactly once per completed turn — and PLAN ITEM-1's wording was amended
  to match. **Plan amended**, phases 1–3 re-gated.

- **DRIFT-1.3** — verdict: impl-wins — with the hook in place the audit still
  reported `…/summary` **2×**. Trace: the remaining read fired at **+102 ms after
  the send**, i.e. from the pill's open/switch effect, inside the window between
  `createConversation`'s `set({ conversation })` and the `conversation.created`
  event — so the "created in this session" marker did not exist yet. Two changes
  followed: (a) `sessionCreatedConversations` was promoted from a
  background-module file to `src-app/ui/src/core/` because a SECOND module now
  consumes it (the placement rule `core/permissions` / `core/llmModelCatalog`
  follow), and (b) the id is now marked inside `createConversation` **before**
  `set({ conversation })`, not only on the event. Re-measured: **1** summary read
  per send, at +7.4 s (the turn end). PLAN ITEM-1/ITEM-5 `Files to touch` amended
  to include `core/sessionCreatedConversations.ts` and
  `chat/core/stores/chat/actions/createConversation.ts`.

- **DRIFT-1.4** — verdict: impl-wins — PLAN ITEM-2 said to document the
  coalescer's non-coverage in `sdk/…/inflight.ts`. Implemented in the app-side
  `summaryRefreshTrigger.ts` instead: `sdk` is a submodule, and a comment-only
  edit there would move the submodule pointer and make the branch un-landable
  without a separate sdk push. PLAN + BASE.md amended; no submodule pointer
  moves.

- **DRIFT-1.5** — verdict: impl-wins — TESTS TEST-3 was enumerated as a unit test
  importing the memory chat-extension. It cannot be: the extension is `.tsx`, and
  node's `--test` TypeScript support does not transform JSX (`node-test-hooks.mjs`
  stubs a JSX barrel for exactly this reason — the run failed with
  `ERR_UNKNOWN_FILE_EXTENSION`). Re-enumerated as an e2e leg asserting zero
  `GET /api/memories` during a turn, which is a stronger assertion anyway (it
  measures the request, not the shape of the object). TESTS.md amended.

- **DRIFT-1.6** — verdict: none — ITEM-4, ITEM-6, ITEM-7 landed exactly as
  planned.

**Unresolved drifts:** 0
