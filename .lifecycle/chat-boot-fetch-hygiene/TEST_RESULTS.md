# TEST_RESULTS — chat-boot-fetch-hygiene

Final run, all enumerated tests in one pass, after the phase-7 fixes.
Full log: `/data/pbya/ziee/tmp/lifecycle-logs/chat-boot-fetch-hygiene-e2e.log`

```
cd src-app/ui && npx playwright test \
  tests/e2e/perf/chats-list-single-fetch.spec.ts \
  tests/e2e/perf/boot-tier-permission-gate.spec.ts --workers=1
→ 8 passed (3.0m)
```

- **TEST-1**: PASS
- **TEST-2**: PASS
- **TEST-3**: PASS
- **TEST-4**: PASS
- **TEST-5**: PASS
- **TEST-6**: PASS
- **TEST-7**: PASS
- **TEST-8**: PASS

Acceptance tests (design-invariant proofs) — all PASS:

| invariant | acceptance test | result |
|---|---|---|
| INV-1 | TEST-2 | PASS |
| INV-2 | TEST-1 | PASS |
| INV-3 | TEST-8 | PASS |

## Frontend gate

- `npm run check (ui): PASS`
- `gate:ui (ui): PASS`

`gate:ui` final run: `runtime-health: 418 findings (HIGH 0 gating …)`,
**per-surface verdict 174/174 PASS**, and `tsc / lint / runtime-health / visual`
all PASS (visual run with `--skip-visual`; Layer B pixel regression not run).

Only `src-app/ui` is touched, so no `desktop/ui` gate line is required — verified
that neither changed component has a desktop twin
(`src-app/desktop/ui/src/modules/chat/{components/ConversationList,pages/ChatHistoryPage}.tsx`
do not exist), and `openapi.json` / `api-client/types.ts` are unchanged in both
workspaces.

### Note on `seeded-file-rag-error`

Two earlier `gate:ui` runs reported this surface as failing (`HIGH 6`,
"Rendered more hooks than during the previous render" — a file-rag surface this
diff does not touch); the final run above is clean, so the surface is
intermittent. It is **not attributable to this branch**, proven by an A/B in the
SAME environment: with the two changed source files reverted to
`origin/feat/agent-core` and everything else identical, it failed identically
(`HIGH 6`). (An earlier attempt to baseline it in a separate pristine worktree
was discarded as untrustworthy — that environment produced 11,807 findings vs
414, i.e. it was measuring its own breakage.)

## Falsifiability checks (run, not asserted)

Two of the three acceptance tests were verified to FAIL when the property they
pin is broken — the D2 property that separates a real proof from a tautology:

- **TEST-8 / INV-3** — the store gate in `memory/stores/memoryAdmin/index.ts` was
  temporarily replaced with `if (true)`; TEST-8 failed with
  `a user WITHOUT memory::admin::read issued 1 request(s) to /api/memory/admin-settings`.
  Gate restored → PASS. Re-verified a second time AFTER TEST-8 was rewritten in
  phase 7, so the check applies to the shipped version of the test.
- **TEST-1 / INV-2** — the negative control is the measured baseline: the same
  in-page instrument reported **3** requests on unmodified
  `origin/feat/agent-core`, against an assertion of exactly 1.

## Pre-existing failure NOT caused by this branch

`src/modules/chat/stores/ChatHistory.store.test.ts` (a vitest unit spec, not part
of this round's enumerated set) fails to even load with
`TypeError: registerLazyStore is not a function`. Verified pre-existing by
checking out the untouched base and re-running: identical failure. Reported
upward rather than absorbed; out of scope to fix here.

## Scoped runs during iteration

Per the orchestrator's cost guidance, iteration used scoped runs (only the specs
covering the touched files) and the full enumerated set was run once, at the end
— the run recorded above. The scoped regression set for
`ConversationList.tsx` / `ChatHistoryPage.tsx` was also run green after the
production change:

```
tests/e2e/chat/{conversation-list-search,conversation-list-narrow-search,
history-content-search,history-sort,conversation-list-load-more,
conversation-list-virtualization}.spec.ts  → 8 passed (2.8m)
```
