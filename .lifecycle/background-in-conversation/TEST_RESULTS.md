# TEST_RESULTS — background-in-conversation

Every line below is a transcribed real exit code / count. Nothing is inferred.
Full logs: `/data/pbya/ziee/tmp/lifecycle-logs/background-in-conversation-*.log`.

## Backend — RUN, GREEN

`cargo test -p ziee --lib background_mcp::runs::` → `ok. 4 passed; 0 failed`
`cargo test -p ziee --lib types_ts_parity` → `ok. 2 passed; 0 failed`
`cargo test -p ziee --test integration_tests background_mcp:: -- --test-threads=4`
→ `test result: ok. 31 passed; 0 failed; 0 ignored; 0 measured; 2305 filtered out; finished in 22.50s`, `EXIT=0`
(final run, AFTER both the fix round's `ORDER BY … , id DESC` change and ITEM-15's
cancel-on-conversation-delete. The 26 pre-existing `background_mcp` tests still
pass, so neither the disjoint semantics nor the delete teardown regressed anything.
Log: `background-in-conversation-int3.log`.)

- **TEST-1**: PASS — 4/4 (`conversation_id_is_parsed_when_present`, `…_is_none_when_absent`, `…_composes_with_the_other_filters`, `malformed_conversation_id_is_rejected_not_dropped`)
- **TEST-2**: PASS — `list_conversation_scope_paginates_consistently`
- **TEST-3**: PASS — `list_conversation_scope_is_disjoint` (the INV-3 `[acceptance]` proof)
- **TEST-4**: PASS — `list_conversation_scope_composes_and_stays_owner_scoped`
- **TEST-24**: PASS — `deleting_a_conversation_cancels_its_in_flight_background_runs` (all four cancellable statuses end `cancelled`; the already-terminal run keeps `completed`; another conversation's run stays `running`; a direct COUNT proves zero detached non-terminal rows survive)
- **TEST-25**: PASS — `a_foreign_conversation_delete_cancels_nothing` (non-owner delete → 404, the owner's run stays `running`)
- **TEST-5**: PASS — `openapi::tests::types_ts_parity` AND `types_ts_parity_desktop`, so the regen is committed for BOTH workspaces

## Frontend unit — RUN, GREEN

`npx vitest run src/modules/background/stores/BackgroundRuns.store.test.ts`
→ `Test Files 1 passed (1) / Tests 7 passed (7)`

- **TEST-6**: PASS — scopes the request by conversation, keys the slice, no cross-conversation clobber
- **TEST-7**: PASS — a sync event refreshes every tracked scope with its own id, never unscoped
- **TEST-8**: PASS — permission self-gate + a failed refetch keeps the loaded slice
- **TEST-9**: PASS — page 1 replaces, later pages append
- **TEST-10**: PASS — 3 cases: refresh covers ONLY mount-refcounted scopes (and evicts on the last release), a first-load failure IS retried on `sync:reconnect`, concurrent identical loads dedupe + appends de-duplicate

`node --import ./scripts/node-test-loader.mjs --test …/runCardAffordances.test.ts`
→ ran 4/4 green BEFORE the fix round; the file is now DELETED with the affordance
it tested (see FIX_ROUND-1), and TEST-10 was re-pointed to the store contract.

> Note on the runner: `npm run test:unit` (node:test) is **RED on the base itself** —
> its loader resolves only `@/` aliases, so every spec importing a relative
> extensionless path or `@ziee/framework/*` fails, including untouched files like
> `WorkflowRun.store.test.ts`. Not caused by this branch and not fixed here (the
> shared loader is not this feature's to change — B3). Both of this feature's specs
> were authored so they DO run, under the runner each belongs to.

## Frontend static gate — RUN, GREEN

- `npm run check (ui): PASS` — tsc + guardrails + colors + settings-field + adjacent-inline + icon-action + **hooks** + logical-direction + tooltip-placement + kit-manifest + testid-registry + design-spec + gallery-coverage + gallery-crawl + fixtures + state-matrix + overlay-registry + override-registry + seed-registry + store-actions
- `npm run check (desktop/ui): PASS`

`lint:hooks` caught a real Rules-of-Hooks violation in the footer during phase 5
(a store-proxy read in a ternary branch) — fixed, recorded as DRIFT-1.2.

## UI evaluator gate — RUN, PARTIAL (pre-existing failures only)

`npm run gate:ui` (638 gallery cells):

```
PASS  tsc
PASS  lint
FAIL  runtime-health
PASS  visual — 10 passed
--- per-surface runtime verdict: 145/151 PASS ---
```

- `gate:ui (ui): PASS` for tsc / lint / visual, and for **every surface this feature
  touches** — the three new gallery states
  (`deep-chat-right-panel-background`, `deep-chat-background-empty`,
  `deep-chat-background-footer`) are NOT among the 6 failures.
- The 6 failing surfaces are **pre-existing and unrelated**: `settings-profile`,
  `seeded-delimited-viewer`, `seeded-delimited-viewer-shell`,
  `settings-summarization-admin`, `seeded-wf-run-agent-gate`,
  `settings-memory-admin`. None is in this diff.
- This was run BEFORE the fix round; it must be re-run after (the panel/footer
  markup changed substantially).

## E2E — NOT RUN

**TEST-11 … TEST-22 have NOT been executed.** This is the honest gap, not a pass:
`playwright.config.ts` defaults to `workers: 1` and every test spins up its own
backend + Vite + database, so the 12 enumerated specs are a multi-hour run that did
not fit this session. They are written, they type-check, and their fixtures are
committed — but no result may be claimed for them.

- **TEST-11** (acceptance / INV-1): NOT RUN
- **TEST-12** (acceptance / INV-2): NOT RUN
- **TEST-13** (negative-perm): NOT RUN
- **TEST-14 … TEST-22**: NOT RUN

Consequence: **phase 8 does NOT pass**, and INV-1 / INV-2 are not yet
executably proven (INV-3 IS — TEST-3 ran green). The next session's first job is:

```bash
cd src-app/ui
npx playwright test tests/e2e/15-background --workers=1 \
  2>&1 | tee /data/pbya/ziee/tmp/lifecycle-logs/background-in-conversation-e2e.log
npx playwright test tests/e2e/chat/background-status.spec.ts \
  tests/e2e/chat/background-persist.spec.ts \
  tests/e2e/chat/steer-running-agent.spec.ts \
  tests/e2e/15-notifications/background-inbox.spec.ts --workers=1
npm run gate:ui        # re-run after the fix round's markup changes
```

Note the three retargeted real-LLM specs (`background-status`,
`background-persist`, `steer-running-agent`) self-skip without a bridge
(`HAS_BRIDGE`); a skip is a SKIP, not a PASS.
