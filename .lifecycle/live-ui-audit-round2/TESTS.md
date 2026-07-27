# TESTS — live-ui-audit round 2

Every ITEM is covered; every `INV-N` is pinned by an `[acceptance]` test that
asserts the DESIGN's promise (the audit's own measurable signal, or the
mechanism the promise depends on) rather than what the new code happens to do.

**No new permission is introduced** by this round (it removes/retimes fetches and
adds a re-entrancy latch), so no `[negative-perm]` restricted-user e2e is
required. The three descoped items (ITEM-10/11/12) carry approved dispositions in
DECISIONS.md (DEC-6/7/8) and are exempt from test coverage.

## Tests

- **TEST-1** (tier: unit) [covers: ITEM-1] file: `src-app/ui/src/modules/summarization/chat-extension/summaryRefreshTrigger.test.ts` — asserts: `shouldLoadSummaryOnOpen(state, held)` contributes **zero** reads across the exact state sequence a send produces (including the composer re-mount and the transient idle window `loadConversation` opens mid-navigation), reads exactly once per genuine open/switch, is idempotent across re-mounts because it keys on the STORE not on component state, and never reads mid-stream — with two counter-factual cases pinning what it prevents (the old `messages.size` trigger's four reads, and the leaked read when the session-created signal is absent)
- **TEST-2** (tier: e2e) [covers: ITEM-1, ITEM-2] file: `src-app/ui/tests/e2e/perf/live-audit-round2-network.spec.ts` — asserts: sending one message from a new chat issues **at most one** `GET /api/conversations/{id}/summary` for that conversation across the whole send step (the audit's `duplicate`/`excess` signal, which measured 3–4), against the real backend with no request mocking, and that the summarization pill still renders its mode afterwards (proving the read-model was not simply switched off)
- **TEST-3** (tier: e2e) [covers: ITEM-4] file: `src-app/ui/tests/e2e/perf/live-audit-round2-network.spec.ts` — asserts: completing a turn issues **zero** `GET /api/memories` (the audit's `irrelevant` signal, which measured one per turn), while the composer's memory pill still renders — i.e. the extension was retimed, not deleted. (Written as e2e rather than unit because the extension module is `.tsx` and node's `--test` TypeScript support does not transform JSX, so it cannot be imported by the unit runner — see `scripts/node-test-hooks.mjs`, which stubs a JSX barrel for the same reason.)
- **TEST-4** (tier: e2e) [acceptance] [invariant: INV-2] file: `src-app/ui/tests/e2e/perf/live-audit-round2-network.spec.ts` [covers: ITEM-4] — asserts: with `/memories` open, a memory created out-of-band via `POST /api/memories` appears in the list **without a reload** — the `sync:memory` frame is what keeps the page fresh, so deleting the per-turn refetch removed a request and not the freshness. Turns red if the sync subscription is ever the thing that breaks
- **TEST-5** (tier: unit) [covers: ITEM-5, ITEM-1] file: `src-app/ui/src/core/sessionCreatedConversations.test.ts` — asserts: `noteSessionCreatedConversation(id)` / `isSessionCreatedConversation(id)` — an id marked in this session is reported as session-created, an unmarked id is not, the set is bounded (oldest entries evicted past the cap so a long session cannot grow it without limit), and marking is idempotent
- **TEST-6** (tier: e2e) [covers: ITEM-5] file: `src-app/ui/tests/e2e/perf/live-audit-round2-network.spec.ts` — asserts: BOTH legs — (a) sending the first message in a brand-new chat issues **zero** `GET /api/background/runs` (the audit's `irrelevant` signal), and (b) opening a conversation that was NOT created in this tab still issues **≥1** `GET /api/background/runs`, so the footer can still discover pre-existing runs. Leg (b) is the control that stops leg (a) from being satisfied by simply deleting the probe
- **TEST-7** (tier: unit) [acceptance] [invariant: INV-3] [covers: ITEM-3] file: `src-app/ui/src/modules/loadContext.nochange.test.ts` — asserts: the guard test inherited from `.lifecycle/net-hygiene` TEST-14 still passes on this branch — `buildLoadContext`'s `isAuthenticated` comes from the verified session flag and NEVER from a persisted token, so no `ctx.can(P)`-gated module's code is delivered before `/auth/me` proves the grant. This is the executable form of ITEM-3's "do not re-implement the rejected design" and turns red the moment the widening is reintroduced
- **TEST-8** (tier: e2e) [acceptance] [invariant: INV-4] [covers: ITEM-7] file: `src-app/ui/tests/e2e/perf/live-audit-round2-composer.spec.ts` — asserts: the 1×1 px control the audit flagged at `home`@390 is the WCAG 2.4.1 bypass link — at rest it is a visually-hidden `sr-only` element (which is WHY it measures 1×1), and pressing `Tab` from the document body makes it the focused element, renders it VISIBLE with a real tap target (≥ 24×24 CSS px), and activating it moves focus to the `#main-content` landmark. A finding disposed with evidence, not silenced: if the link were genuinely dead (never focusable, never sized, no target) this test is red
- **TEST-9** (tier: e2e) [covers: ITEM-6] file: `src-app/ui/tests/e2e/perf/live-audit-round2-composer.spec.ts` — asserts: the audit's LITERAL repro — fill the composer, `press('Enter')`, `press('Enter')` again immediately — leaves exactly ONE user message and ONE assistant turn in the conversation, exactly ONE `POST /api/conversations/{id}/messages`, and a composer that is enabled with a non-spinning send button once the turn ends (the `stuck-loading` signal: zero visible `.animate-spin` in the composer after settle)
- **TEST-10** (tier: e2e) [acceptance] [invariant: INV-5] [covers: ITEM-8] file: `agent-kit/skills/live-ui-audit/live-ui-audit.mjs` — asserts: a targeted repeat sweep of the cell the HIGH `contrast` finding fired in (`--jtbd=home --viewports=390 --themes=light`, repeated so the 2-in-81 rate has a real chance to surface) reports **zero** `HIGH contrast` findings on a build of this branch; the run count and the measured result are transcribed into TEST_RESULTS.md whether it reproduces or not (INV-4's "classified with evidence, never unexplained")
- **TEST-11** (tier: e2e) [acceptance] [invariant: INV-1] [covers: ITEM-9] file: `agent-kit/skills/live-ui-audit/live-ui-audit.mjs` — asserts: the SAME unmodified battery (same flags, same backend process `:29511`, same cloned database, same static rig `:1560`), run against a build of the branch BEFORE and AFTER, reports ZERO `network/duplicate` + `network/excess` rows naming `…/summary`, ZERO `network/irrelevant` rows naming `/api/background/runs` or `/api/memories`, ZERO `stuck-loading` rows on `rapid-double-submit`, a reduced `network/waterfall` count, and NO finding category the BEFORE run did not have; every per-category before→after number is transcribed into TEST_RESULTS.md

## Coverage map

| ITEM | covered by |
|---|---|
| ITEM-1 summary refetch storm | TEST-1, TEST-2 |
| ITEM-2 why the coalescer cannot cover it | TEST-2 |
| ITEM-3 boot-waterfall diagnosis (no eligibility change) | TEST-7 |
| ITEM-4 drop the per-turn `/api/memories` refetch | TEST-3, TEST-4 |
| ITEM-5 `/api/background/runs` off the compose path | TEST-5, TEST-6 |
| ITEM-6 rapid-double-submit wedge | TEST-9 |
| ITEM-7 zero-size-control disposition | TEST-8 |
| ITEM-8 contrast disposition | TEST-10 |
| ITEM-9 before→after audit proof | TEST-11 |
| ITEM-10/11/12 | [DESCOPED] — DEC-6 / DEC-7 / DEC-8 |

| INV | acceptance test |
|---|---|
| INV-1 proven by the rig that found it | TEST-11 |
| INV-2 removed request keeps its freshness | TEST-4 |
| INV-3 eligibility inputs unchanged | TEST-7 |
| INV-4 disposed with evidence, never silenced | TEST-8 |
| INV-5 semantic tokens / AA contrast | TEST-10 |
