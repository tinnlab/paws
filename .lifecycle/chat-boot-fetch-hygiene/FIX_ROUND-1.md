# FIX_ROUND-1 — chat-boot-fetch-hygiene

## Honest note on the phase-6 audit's independence

The phase-6 pass was **self-conducted, not blind**: subagent capacity was
exhausted fleet-wide (`Concurrent subagent limit reached`) on three attempts, and
a resource condition is not a valid deferral (B1). It is recorded as self-audited
rather than allowed to imply an independent review — see DEC-9. It was not a
rubber stamp: the mechanical checks were run as commands rather than eyeballed,
and it caught the round's highest-risk defect (a vacuous acceptance test, LEDGER
line 1 / DEC-8).

For **this** round a genuinely blind reviewer WAS available and was used: a fresh
agent given only `git diff origin/feat/agent-core...HEAD` plus the surrounding
source, with none of my reasoning. It returned 11 confirmed findings, and they
were substantially better than my own pass — including a HIGH I had missed in my
own newly-written tests. Every one is dispositioned below.

## Findings from the blind round, and their disposition

**Fixed (7):**

1. **HIGH — TEST-3 was vacuous.** `page.getByText(later).first()` was UNSCOPED, and
   the sidebar's `RecentConversationsWidget` renders conversation titles on every
   authenticated route from the separate `recentConversations` cursor — with
   `later` the newest, it is always at the top of that list. The assertion passed
   whether or not `/chats`' own list ever refetched. Galling because I had fixed
   exactly this bug in TEST-6 and documented it there, then left it standing in
   TEST-2/TEST-3. **Fixed:** both now scope to `chat-conversation-list-rows`.
2. **MEDIUM — TEST-3's premise was destroyed before its assertion ran.** It claimed
   to prove "created after the store was primed", but both hops used `page.goto()`
   — full document navigations that reload the SPA and wipe every in-memory store.
   It was really just another cold load, i.e. a duplicate of TEST-2. **Fixed:** the
   round trip is now client-side (header new-chat button → router `pushState`, then
   `page.goBack()` → popstate), and a `window.__SPA_MARKER__` set before the trip is
   asserted afterwards, so the test FAILS if a reload ever silently reintroduces
   itself rather than degrading back into TEST-2.
3. **MEDIUM — TEST-2's backstop did not close its own gap.** A permanently-`loading`
   list renders the spinner branch while the page suppresses its empty state, so
   `expect('No chat history yet').toHaveCount(0)` passed on a stuck list.
   **Fixed:** scoped to the rows container, which is rendered only on the
   non-spinner branch, so a visible row there IS proof the list settled. I first
   added a separate "not spinning" assertion keyed on
   `chat-conversation-list-loading` and **removed it after checking the source** —
   the spinner branch carries no testid, so that assertion would have been
   vacuously true: exactly the defect class this round is about.
4. **MEDIUM — `recordApi` counted RESPONSES, not requests.** Both negative tests
   assert "issued ZERO requests", but a request that is aborted, unanswered at the
   cutoff, or fails at the network layer produced no `response` event and was
   invisible. **Fixed:** records on the `request` event; the `response` event now
   only fills in `end`/`status`.
5. **MEDIUM — TEST-4's ordering used Node-side CDP timestamps.** CDP delivery is
   async and reorders under load, so the causality assertion could fail spuriously
   on a busy box (or mask a real overlap). **Fixed:** the ordering is now judged on
   the BROWSER's clock via Resource Timing (`performance.getEntriesByType('resource')`).
6. **MEDIUM — TEST-7/TEST-8 were a cross-persona pair.** The positive control ran as
   ADMIN and the negative as a restricted user, so TEST-8 inferred "the store
   initialized" from a different identity; if the pill stopped mounting for
   non-admins, TEST-8 would go vacuously green while TEST-7 stayed green. **Fixed:**
   TEST-8 now asserts a SAME-PERSONA witness — the restricted user's own
   `memory-status-pill` must be visible, which proves `MemoryStatusPill` mounted and
   therefore read `MemoryAdmin.settings` (it reads it above every early return).
   Both tests now run on the same `/chat/{id}` surface. I verified by measurement
   that a weaker witness was not available: a restricted user's boot issues **no**
   `/api/memory/*` request at all, so the network alone cannot distinguish "gate
   fired" from "store never initialized".
7. **LOW ×2 — two load-bearing comments were wrong.** (a) ChatHistoryPage claimed the
   list "mounts strictly after this fetch has started"; React runs CHILD effects
   BEFORE parent effects, so on an SPA re-entry with a primed store the list's
   effects run first. The justification for "do not add a second caller" is
   COVERAGE (the list does not mount in the empty state), not ordering — corrected.
   (b) ConversationList's guard comment implied `setSearchQuery` is a pure setter;
   it unconditionally issues `loadConversations(1)`, so an equal→equal pass now
   suppresses a REFETCH. The one real behaviour change ('a'→'ab'→'a' after a failed
   load no longer self-heals; the user takes the explicit Retry) is now stated.

**Accepted and documented, not code-changed (2):**

8. **MEDIUM — StrictMode double-invokes the surviving page effect** in a DEV build,
   reintroducing a `reloadQueued` replay. Correct, and worth knowing. Not changed:
   StrictMode double-invocation is deliberate and apps are expected to tolerate it;
   the underlying wart is `reloadQueued` replaying an identical page-1 request,
   which is pre-existing store behaviour outside this round's scope. What I DID fix
   is the overclaim: the spec header now states the "exactly one" measurement holds
   for the PRODUCTION build the harness serves (`vite preview`), which is what ships.
9. **LOW — re-entering `/chats` with a stale non-empty `searchQuery` still produces
   two requests.** Correct; pre-existing and orthogonal to both callers this round
   removed. Documented as an explicit scope limit in the spec header rather than
   left implied by an unqualified "exactly one" claim.

**Rejected by the blind reviewer itself (8):** including the two most important
confirmations — that `create_user` genuinely honours the explicit permission list
so neither restricted user holds the permission under test, and that TEST-8's
stated mechanism is real (memory's module is `isAuthenticated`-only, the
`toolbar_status` slot registration carries no permission, and `MemoryStatusPill`
reads `MemoryAdmin.settings` above its early returns). It also independently
dismissed the mount-path, timer-orphan, fixture-contamination and
window-count hypotheses.

**LOW deliberately not taken (1):** merging TEST-4+7 and TEST-5+8 into two
harness boots to halve setup cost. Real, but it would collapse four distinct
TEST-IDs onto two test bodies, which trades a clear 1:1 ID↔assertion mapping for
~40s of suite time. Kept separate.

## Re-audit

Every fix above was re-run rather than reasoned about:

- All 8 enumerated tests re-run after the fixes — see TEST_RESULTS.md.
- **TEST-8's falsifiability was re-verified AFTER its rewrite** (not just before):
  the store gate was again replaced with `if (true)` and TEST-8 failed with
  `issued 1 request(s)`; restored, it passes. The acceptance test still genuinely
  goes red when the invariant is violated.
- **`seeded-file-rag-error` (the `gate:ui` HIGH) was proven pre-existing by an A/B
  in the SAME environment**: with the two changed source files reverted to
  `origin/feat/agent-core` and everything else identical, the surface still fails
  with `HIGH 6` ("Rendered more hooks than during the previous render", a file-rag
  surface this diff does not touch). A first attempt to baseline it in a separate
  pristine worktree was DISCARDED as untrustworthy — that environment produced
  11,807 findings vs 414, so it was measuring its own breakage, not the base.

**New confirmed findings:** 0
