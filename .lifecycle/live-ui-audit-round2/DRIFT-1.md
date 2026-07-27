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

- **DRIFT-1.6** — verdict: none — ITEM-4 and ITEM-7 landed exactly as planned.

- **DRIFT-1.7** — verdict: impl-wins — while this branch was in phase 6,
  `origin/feat/agent-core` advanced from `24ce5dcca` to `bf1b0e9dd`
  ("fix(e2e/chat/a11y): stale specs, **double-send latch**, …"), landing an
  equivalent synchronous latch in the SAME function from a concurrent agent.
  Discovered by accident, which is the honest account: the red-proof probe for
  ITEM-6 restored `sendMessage.ts` from `origin/feat/agent-core` expecting the
  unguarded version and got a guarded one. The branch was rebased onto
  `bf1b0e9dd` and this branch's duplicate latch was **dropped** — `sendMessage.ts`
  is now byte-identical to upstream and is no longer in the diff. Keeping two
  latches, or preferring this branch's throw-for-programmatic-callers variant
  over a landed fix, would have been a gratuitous conflict. TEST-9 stays: a
  regression guard for the behaviour is still worth having, and it now guards
  SOMEONE ELSE's fix, which is strictly better. PLAN ITEM-6 + BASE.md amended.
  *Lesson recorded for the report: `--base origin/feat/agent-core` is a MOVING
  ref in a shared clone; re-check it before trusting a "red proof".*

- **DRIFT-1.8** — verdict: impl-wins — the reproduction for ITEM-6 also
  re-classified its finding. Driving the audit's literal step
  (`.lifecycle/live-ui-audit-round2/double-submit-probe.mjs`, fill → Enter →
  Enter) and sampling at 4/6/8/12/20/30 s: at **+4000 ms** (the audit's fixed
  wait) there are 3 spinners and the assistant text is still streaming; at
  **+6000 ms** there are 0 spinners, exactly 1 user + 1 assistant message, 1
  `POST /api/conversations` and 1 `POST …/messages`. So the `stuck-loading` row
  is a MEASUREMENT-WINDOW artifact (a fixed 4 s wait against a ~5–7 s real-LLM
  turn), not a stuck spinner. The double-send race it was conflated with is real
  and is fixed (by the upstream latch, per DRIFT-1.7). PLAN ITEM-6 amended to say
  so instead of claiming the signal as a fix.

**Unresolved drifts:** 0
