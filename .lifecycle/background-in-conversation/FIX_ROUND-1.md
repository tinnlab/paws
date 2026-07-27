# FIX_ROUND-1 — background-in-conversation

The phase-6 blind audit (6 fresh agents, 17 angles, diff-only context) returned a
large confirmed finding set. It found the feature **functionally broken in two ways
no phase-5 gate could see**, plus a cluster of tests that would have passed with
the feature reverted. Everything below was verified against the code, then fixed.

## Fixed — functional / correctness

- **The Tasks panel had no scroll container** (HIGH, 3 auditors). Every
  `ChatRightPanel` host is `overflow-hidden` and expects the renderer to own its
  scroll (both siblings — `LiteratureScreeningPanel`, `FilePanel` — do). With a
  20-task first page the list was clipped with **no scrollbar**, making the
  "Showing N of M" line and the Load-more button physically unreachable at every
  breakpoint, worst at 390px. The new e2e passed only because Playwright
  auto-scrolls on `.click()`. → root is now `h-full overflow-y-auto overflow-x-hidden`.
- **The gallery empty-state delivery did not work** (HIGH, 3 auditors). The
  cassette resolver read `ctx.params.conversation_id`, but `params` is PATH
  captures only — a query param lives on `ctx.query`. So `deep-chat-background-empty`
  rendered the POPULATED list and `stateCoverage.ts`'s
  `BackgroundRunsPanel:empty → via deep:…` was certifying a state that never
  rendered. → reads `ctx.query`, and the fixtures' `conversation_id` is now stamped
  with the REQUESTED conversation so the seeded panel is faithful to the disjoint
  endpoint (previously it rendered an "Open conversation" variant production
  cannot produce).
- **Panel first-paint rendered EMPTY before fetching.** The fetch starts in an
  effect that runs after commit, so `loading` was still false on the first render
  and control fell through to the empty branch. → the spinner is gated on
  `runs === undefined`, i.e. "not fetched yet", not on `loading`.
- **Unbounded sync fan-out** (HIGH, 4 auditors). `refreshTrackedConversations`
  iterated the DATA map; the footer occupies `message_list_footer` so it mounts in
  every conversation opened and a zero-task load still wrote a key, and keys were
  never evicted. 40 conversations visited ⇒ 40 concurrent GETs on **every**
  `sync:workflow_run`. The doc comment asserted the opposite. → new mount-refcount
  `activeScopes`; the refresh iterates that, the last release evicts the slice, and
  the doc now states what the code does.
- **A scope whose FIRST load failed was never retried** — the data map only gains a
  key on success, so `sync:reconnect` (the mechanism that exists to recover a
  dropped stream) skipped exactly the case it is for. → fixed by the same
  refcount, which is written on MOUNT.
- **A live refresh discarded Load-more pages.** Page 1 replaced the slice, so any
  run state change collapsed an expanded list back to 20 while the user watched.
  → a page-1 refresh now re-reads the WHOLE window the user holds.
- **No in-flight dedup**; the footer and the panel both loaded page 1 on mount, and
  the panel remounts on every right-panel tab switch. → module-local
  `conversationId#page` guard (mirrors `loadRunDetail`'s).
- **Load-more could duplicate rows.** `ORDER BY created_at DESC` has no unique
  tiebreaker and `created_at` is not unique (a sub-agent fan-out shares an
  instant), so OFFSET paging could repeat a row → duplicate React keys and a wrong
  count. → `ORDER BY created_at DESC, id DESC` **plus** a client-side id de-dup on
  append (belt and braces).
- **`cancelRun` stopped awaiting its refresh**, so the card cleared its spinner
  before the list updated. → awaited again.
- **The panel trusted an unvalidated `conversationId`** from persisted tab data; a
  mangled snapshot would have issued an UNSCOPED read and rendered other work's
  detached tasks inside a conversation's tab. → explicit guard + error state.

## Fixed — dead code (§15)

- **`shouldShowOpenConversation` was dead by construction** (HIGH, 4 auditors).
  The card's only render site is the panel, which always passes its own scope, and
  the disjoint endpoint guarantees every listed task belongs to it — so the
  predicate could only return false and the button, its `useNavigate`, its icon and
  3 of 4 unit cases were unreachable. → the affordance, the helper and its test are
  DELETED; ITEM-11 is reframed from "conditionally suppress" to "remove", and
  TEST-16 now asserts the remaining affordances positively so it cannot pass
  vacuously.
- **`clearConversationError`** had no production caller (its consumer was the
  deleted page). → removed.

## Fixed — hollow / confounded tests

- **TEST-13 (the A10 negative-perm proof) was CONFOUNDED** (3 auditors). It sent
  the restricted user to the ADMIN's conversation — owner-scoped, so it would not
  load at all; the absent footer was explained by the inaccessible conversation and
  the test would have passed with the store's permission gate deleted. → the
  subject now gets its OWN conversation with its OWN task (via `/auth/me` +
  `page.request` as that user), and the conversation loading is asserted as the
  control that makes the absence attributable to `background::use`.
- **TEST-12's route assertion was VACUOUS** (3 auditors): `background-tasks-page`
  no longer exists anywhere, so `toHaveCount(0)` could never fail. → replaced with
  an implementation-agnostic proof — seed a conversation-LESS task (exactly what a
  global page would list) and assert no `background-run-card-*` renders at
  `/background-tasks`. A reintroduced page under ANY testid fails this.
- **TEST-14's empty leg was racy/vacuous** — satisfiable by the pre-fetch frame.
  → the panel's empty branch is now data-gated (above), and the leg additionally
  asserts a previously-visible card is gone.
- **TEST-15's absence half raced the footer's own fetch.** → it now waits on the
  real `conversation_id`-scoped response before asserting absence.
- **TEST-1's malformed-uuid case was a tautology** (`|| !err.is_empty()`).
  → asserts the rejection names the field.
- **TEST-10 re-pointed**: its old target was deleted with the affordance, so it now
  pins the NEW refcount/eviction/failed-retry/dedup contract — three genuinely new
  regression guards for the fixes above. (TESTS.md did not shrink; A5 holds.)

## Fixed — a11y / UX / copy

- Footer `aria-label` **overrode** the visible label (WCAG 2.5.3 Label in Name,
  Level A) and hid the count — the row's whole payload — from screen readers.
  → removed; the visible text is the name, wrapped in `role=status aria-live=polite`
  so the live count is announced.
- Footer gained `aria-expanded`/`aria-controls` (its own sibling card already did).
- The pulse honours reduced motion (`motion-safe:animate-pulse`).
- Footer **double gutter**: it re-applied `max-w-4xl px-4` inside a container that
  already owns the column, insetting the bar 32px per side from every message
  bubble. → the outer container owns the column.
- Footer **under-reported**: the count came from the loaded page, so 22 tasks read
  "20 tasks". → counts from the server `total`.
- Panel gained a heading, an `Empty` icon (the deleted page had one), a correctly
  centred empty state (`Flex` defaults to row; `flex-1` was inert), the count moved
  to the top where it survives a narrow viewport, and "Showing N of M **tasks**".
- Copy unified on **"task"** (the tab is "Tasks"); "sub-agent" and the
  "steerable, and cancellable" dev-speak are gone.
- `ChevronRight` flips under RTL.

## Fixed — false documentation (each was asserting the opposite of the code)

- `module.tsx` claimed conversation-less runs come from scheduled tasks surfaced
  under Scheduled Tasks. They do not — the scheduler's history is
  `scheduled_task_runs`, a different table. The real producer is
  `ON DELETE SET NULL` when a conversation is deleted, which leaves a possibly-
  running task with **no UI surface**. → corrected, and recorded as a KNOWN GAP in
  the module doc, the repository doc and `HUMAN_FEEDBACK.md`.
- `notification/module.tsx` claimed `/notifications/background` is "the bell's
  deep-link target". The bell's `inboxPath` is `/notifications`; nothing links to
  the agent inbox any more. → corrected to say it is a URL-only target and flagged
  as an owner decision (link it or delete it).
- The repository doc overstated the index story (the partial index cannot serve the
  `IS NULL` branch; an OR-shaped predicate is not index-selectable) and claimed
  `total` "can never disagree with the page" (same predicate ≠ same snapshot).
  → both corrected.
- The footer's hoist comment claimed a per-conversation subscription; the proxy
  reads a FIELD, so any conversation's write re-renders it. → corrected to state
  the real behaviour (a render cost, not a correctness problem).

## Recorded, NOT fixed — needs an owner decision or is out of scope

These are real and tracked, deliberately not changed here:

- **The endpoint's semantic change is unversioned** and it is model-reachable via
  `control_mcp`. An agent asked to "list my background runs" now gets only the
  detached ones. A `scope=conversation|detached|all` discriminant would be
  unmissable where an omitted optional param silently changes scope — but that is a
  redesign of the owner's approved contract, so it is surfaced rather than taken.
- **Detached tasks have no surface** (the `ON DELETE SET NULL` gap above). The fix
  is a new surface, i.e. new scope.
- **`/notifications/background` is orphaned** — link or delete is the owner's call.
- **`GALLERY_SEED_MANIFEST` misclassifies chat-extension-only modules** as having
  no user surface; the generator only reads `module.tsx`. A generator change is
  shared infra and belongs in its own commit (B3).
- The 7-positional-arg repository signature, the shared `useChatStoreForPane()`
  hook the pane cast wants, and moving the e2e helper to `tests/common/` are all
  cross-cutting refactors of code this feature only touches.
- `RUNTIME_FINDINGS.md` still carries a stale `background-tasks` section; it is a
  generated report that rewrites itself on the next `gallery:runtime`.

**New confirmed findings:** 0
