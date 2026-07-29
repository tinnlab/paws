# TEST_RESULTS — Activity Rail

Phase 8. Every result below was **observed**, not summarised: each line was produced by a run whose
output I watched, with the log path named. Counts are transcribed verbatim.

## Suites, as run

| suite | command | observed |
|---|---|---|
| UI unit — full | `npm run test:unit` (`src-app/ui`) | **824 tests, 810 pass, 14 fail** |
| UI unit — rail-owned | `node --test` over the rail/contribution/panel/registry specs | **230 tests, 230 pass, 0 fail** |
| Rust lib — tool_calls | `cargo test -p ziee --lib mcp::tool_calls::` | **17 passed, 0 failed** |
| Rust lib — chat_extension + openapi | `cargo test -p ziee --lib -- mcp::chat_extension:: openapi::` | **99 passed, 0 failed** |
| Rust integration — feature scope | `cargo test -p ziee --test integration_tests -- mcp::tool_call_* bio_mcp::tool_names chat::showcase_seed chat::stream_tool_timing` | **19 passed, 0 failed** |
| Playwright — feature scope | `npx playwright test tests/e2e/chat/activity-rail-*.spec.ts tests/e2e/07-mcp/builtin-call-history-access.spec.ts --workers=1` | **19 passed, 0 failed** |
| UI gate | `npm run gate:ui -- --skip-visual` | **GATE PASSED** — tsc, lint, runtime-health all PASS; **187/187 surfaces runtime-clean, 0 gating HIGH** |
| tsc | `npx tsc --noEmit` in `src-app/ui` **and** `src-app/desktop/ui` | **exit 0 in both** |
| check chain | every `check:*` + `lint:*` script individually | **all PASS** |

npm run check (ui): PASS
npm run check (desktop/ui): PASS
gate:ui (ui): PASS
gate:ui (desktop/ui): PASS

### The 14 UI-unit failures are BASELINE, proven not asserted

I cut a scratch worktree at `origin/feat/agent-core`, ran the same suite there, and diffed the
failing-file sets. **All 14 also fail at the base; the branch introduces zero new failures.** They
are `*.store.test.ts` / barrel-import specs failing with `ERR_MODULE_NOT_FOUND` /
`ERR_UNSUPPORTED_DIR_IMPORT` — Vitest-targeted specs caught by a `node --test` glob. Logs:
`/data/pbya/ziee/tmp/unit-final.log` (branch) vs `/data/pbya/ziee/tmp/unit-baseline.log` (base).

## Per-test results

- **TEST-1**: PASS
- **TEST-2**: PASS
- **TEST-3**: PASS
- **TEST-4**: PASS
- **TEST-5**: PASS
- **TEST-6**: PASS
- **TEST-7**: PASS
- **TEST-8**: PASS
- **TEST-9**: PASS
- **TEST-10**: PASS
- **TEST-11**: PASS
- **TEST-12**: PASS
- **TEST-13**: PASS
- **TEST-14**: PASS
- **TEST-15**: PASS
- **TEST-16**: PASS
- **TEST-17**: PASS
- **TEST-18**: PASS
- **TEST-19**: PASS
- **TEST-20**: PASS
- **TEST-21**: PASS
- **TEST-22**: PASS
- **TEST-23**: PASS
- **TEST-24**: PASS
- **TEST-25**: PASS
- **TEST-26**: PASS
- **TEST-27**: PASS
- **TEST-28**: PASS
- **TEST-29**: PASS
- **TEST-30**: PASS
- **TEST-31**: PASS
- **TEST-32**: PASS
- **TEST-33**: PASS
- **TEST-34**: PASS
- **TEST-35**: PASS
- **TEST-36**: PASS
- **TEST-37**: PASS
- **TEST-38**: PASS
- **TEST-39**: PASS
- **TEST-40**: PASS
- **TEST-41**: PASS
- **TEST-42**: PASS

## Re-verification after the base merge + FIX_ROUND-3/4 (this session)

The branch merged `origin/feat/agent-core` (8 commits) and then took two more fix
rounds, so every load-bearing result above was RE-RUN rather than inherited. Each
line below was watched to completion; logs under
`/data/pbya/ziee/tmp/lifecycle-logs/`.

| suite | command | observed |
|---|---|---|
| `npm run check` (ui) | `npm run check` in `src-app/ui` | **exit 0** |
| `npm run check` (desktop/ui) | `npm run check` in `src-app/desktop/ui` | **exit 0** |
| `just openapi-regen` (BOTH binaries) | after the merge | **exit 0**; spec verified semantically, both sides' content present |
| `cargo check --workspace` (lib + bin) | | **exit 0** |
| Rust lib — tool_calls | `cargo test -p ziee --lib mcp::tool_calls::` | **18 passed, 0 failed** |
| Rust integration — feature scope | `cargo test -p ziee --test integration_tests -- mcp::tool_call bio_mcp::tool_names chat::showcase_seed chat::stream_tool_timing` | **33 passed, 0 failed** (31 before the pg_indexes guard + its negative control) |
| UI unit — full | `npm run test:unit` | **825 tests, 811 pass, 14 fail** (baseline; see below) |
| UI unit — chat family | `node --test "src/modules/chat/**/*.test.ts"` | **334 tests, 330 pass, 4 fail** — all 4 among the same 14 |
| Rail unit family | `node --test .../components/rail/*.test.ts` | **39 passed, 0 failed** |
| `transport.test.ts` (new) | `node --test .../elicitation/transport.test.ts` | **8 passed, 0 failed** |
| **e2e — rail family + run_js, bridge ON** | `playwright test activity-rail-*.spec.ts run-js-inner-approval.spec.ts --workers=1` | **21 passed, 0 failed** — re-run to green after EACH of FIX_ROUND-4 (8.5m), FIX_ROUND-5 (8.5m), FIX_ROUND-6 (8.3m), FIX_ROUND-7 (7.0m), FIX_ROUND-8 (8.8m), FIX_ROUND-9 (8.8m), FIX_ROUND-10 (6.4m), FIX_ROUND-11 (6.9m), FIX_ROUND-12 (6.9m), FIX_ROUND-13 (6.8m), FIX_ROUND-14 (6.9m) and FIX_ROUND-15 (6.5m) |
| e2e — the two specs touched last | same, scoped | **3 passed, 0 failed (1.3m)** |
| Rust lib — after FIX_ROUND-6 | `cargo test -p ziee --lib mcp::tool_calls::` | **18 passed, 0 failed** |
| **Rust integration — the `pg_indexes` owner-leading guard + its COMMITTED negative control** | `cargo test -p ziee --test integration_tests mcp::tool_call_index -- --test-threads=1` | **2 passed, 0 failed** |
| …**MUTATION** controls (FIX_ROUND-8): weaken the rule to `cols.first().is_some()`; a stale allowlist entry | **each RED** (both were GREEN before this round) |
| …compliant vs non-compliant EXPRESSION index | compliant **passes**; `lower(tool_use_id)` **RED** |
| …drift control: an existing narrowing moved onto the `WHERE` line, its column removed from the const | **RED** (silently green before) |
| seam-guard mutations | local shadow of `withSegmentationShape` **RED**; inline revert **RED**; line-wrapped revert **RED**; multi-branch body putting the revert past the old window **RED** (FIX_ROUND-9) |
| tooltip-guard evasions (FIX_ROUND-9) | boolean-shorthand `disabled`; a spread carrying it; a `>` inside an earlier quoted attribute; renaming the scanned file | **each RED** (all four were GREEN before) |
| call-site latch mutation (FIX_ROUND-9) | both `disabled` props → `disabled={blocked !== null}` (the FIX_ROUND-7 latch verbatim) | **RED** (green before) |
| predicate mutations (FIX_ROUND-10) | revert the tone rule (`elicitationIsError`); revert the failure judgement (`resolveDidFail`) | **each RED** — both were GREEN before, with the whole suite unchanged |
| guard-precision controls (FIX_ROUND-10) | rename the scanned `<Button>` element; rename a TEST-36 file with the forbidden import; a spread placed AFTER a conforming `disabled` | **each RED** |
| guard FALSE-POSITIVE controls (FIX_ROUND-10) | hoist the predicate to a local; an apostrophe in JSX text | **each correctly GREEN** |
| latch-spelling controls (FIX_ROUND-11) | `blocked != null`; `!!blocked`; `Boolean(blocked)`; `blocked ? true : false`; a spread after the conforming prop | **each RED** — the first four were GREEN under FIX_ROUND-10 |
| call-site controls (FIX_ROUND-11) | revert the tone to an inline `blocked !== null`; revert the failure judgement to the inline form | **each RED** — both were GREEN |
| predicate control (FIX_ROUND-11) | drop the `hadEntry &&` conjunct from `resolveDidFail` | **RED** — GREEN before the discriminating cell was added |
| scanner controls (FIX_ROUND-11) | a `}` inside a string inside a prop expression, with a violation after it; an apostrophe in JSX text | violation **RED**; apostrophe correctly **GREEN** |
| determinism controls (FIX_ROUND-12) | `pred(x) \|\| blocked !== null`; a full inversion `!pred(x)`; a conforming `type={}` on an earlier element plus a revert of the status region; a second `setResolveFailed` beside the conforming one; a hoist carrying a latch | **each RED** — all five were GREEN under FIX_ROUND-11 |
| FALSE-POSITIVE controls (FIX_ROUND-12) | a Prettier-wrapped hoist; `'til` / `'90s` in JSX text; a `<ButtonGroup disabled tooltip>` | **each correctly GREEN** |
| **AST-guard decisive run (FIX_ROUND-13)** | ALL 14 evasions accumulated across rounds 8-13, re-applied against the TypeScript-AST guards | **each RED** |
| …and the legitimate refactors | a Prettier-wrapped hoist; a braced `if` consequent; an element-valued prop before the status testid; `'til '90s, don't` in JSX text | **each correctly GREEN** |
| round-14 controls | the `else`-branch polarity inversion; the `resolve()` handler latch; constant `resolveDidFail` args; a same-named local predicate | **each RED** |
| …and the rename control | `blocked` → `blockedReason` throughout | **correctly GREEN** (it false-RED before) |
| round-15 controls | the gate polarity inversion; four latch operands (`\|\| blocked`, `\|\| Boolean(blocked)`, `\|\| resolveFailed`, `\|\| healExhausted`); a fake classifier; a reassigned binding | **each RED** |
| …and its false-RED controls | splitting the guard clauses; `function resolve(…)`; renaming the unrelated local `submitting` | **each correctly GREEN** |
| `repository.rs` formatting | lines with a single-space indent | **0** — FIX_ROUND-8 had mangled 222; the delta vs FIX_ROUND-7 is back to 22 insertions / 10 deletions |
| …ad-hoc controls incl. both bypasses that defeated the deleted parser | `ALTER … ADD CONSTRAINT UNIQUE(message_id)`; the multi-action `ALTER` bypass; UPPERCASE table; lowercase DDL; a `DO $$` block; an expression index; filtered-column drift | **each turns the guard RED**, green on removal |
| …INCLUDE-column control (must NOT false-RED) | `CREATE INDEX … (created_at) INCLUDE (server_id)` | **stays green** (it did not before FIX_ROUND-7) |
| a11y negative control | re-add FIX_ROUND-5's CONDITIONAL `tooltip` to the approve/deny buttons | **RED** — `a <Button> takes BOTH \`disabled\` and \`tooltip\`` (the source guard) |
| `withSegmentationShape` mutation controls | drop the `consumed` term, then the `blocking` term, from `shapeIntact` | **each RED**, green on restore |
| seam-guard control | the real `resolveStep` revert spelling | **RED**, green on restore |
| `liveSteps.test.ts` (new, FIX_ROUND-5) | `node --test .../core/rail/liveSteps.test.ts` | **6 passed, 0 failed** |
| chat unit family — after FIX_ROUND-5 | `node --test "src/modules/chat/**/*.test.ts"` | **341 tests, 337 pass, 4 fail** (the same pre-existing loader failures) |

### The two `[acceptance]` skips were resolved by supplying the dependency, not accepted

A first e2e pass reported **17 passed, 2 skipped**. The two skips were
`activity-rail-breakout-real` (INV-3) and `activity-rail-lifecycle` (INV-4) — both
`[acceptance]` tests, where a skip is not an acceptable result. The local bridge
(`localhost:4000`, `qwen3.6-35b-a3b`) was reachable; only the env seam
(`OPENAI_BASE_URL` / `ZIEE_TEST_LLM_MODEL`) was unset. With it set, both **ran for
real and passed** (19.1s and 34.2s), and every subsequent run was made with the
bridge on. **All 9 invariants' acceptance tests are PASS on a real run.**

### The single integration failure FIX_ROUND-2 recorded is gone

FIX_ROUND-2 saw `mcp::tool_call_history_test::chat_path_tool_call_records_source_chat`
panic on `ANTHROPIC_API_KEY … NotPresent` because `server/tests/.env.test` does not
exist in a fresh worktree. Copying the repo's env file in makes the scoped run
**31 passed, 0 failed** — it was an environment gap, not a defect. (The file is
gitignored; nothing was committed.)

### A recorded control that was WRONG, and is corrected here

FIX_ROUND-7 recorded an e2e assertion (`toHaveAccessibleName(/approve/i)`) as the
negative control for the tooltip regression, and recorded it as RED. A round-8
auditor showed that result could only have come from an UNCONDITIONAL tooltip —
FIX_ROUND-5's actual regression was **conditional** on the degraded state, and the
spec only ever reaches the healthy state, where the tooltip is `undefined` and the
name is "Approve". So the control was **mis-designed**: it went red for a
mutation that was not the regression.

The e2e assertions are kept (they do pin the accessible names and the conditional
`aria-describedby`), and the actual property is now pinned by a SOURCE guard —
`no tooltip on a Button that can be disabled` — which was run against
FIX_ROUND-5's verbatim conditional form and **is** RED. The reason the e2e cannot
be the guard is stated in the test: no spec can reach a state that needs mcp's
transport to be absent mid-conversation.

### The 14 UI-unit failures are still baseline

Same 14 files, all failing at IMPORT with `ERR_MODULE_NOT_FOUND` /
`ERR_UNSUPPORTED_DIR_IMPORT` / `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` — the
`node-test-loader` vs store-kit directory-import defect. None is a file this
feature owns; the branch adds tests without adding failures (825/811/14 here
vs 824/810/14 recorded before this session's two rounds).

### One pre-existing compile failure, proven not ours

`cargo check --workspace --all-targets` fails in
`agent-core/tests/real_llm_loop.rs` (`missing fields isolate_children and
schedule`). `git diff --stat origin/feat/agent-core...HEAD -- src-app/agent-core`
is **empty**, so those sources are byte-identical to the base and the error exists
there too; both responsible commits are ancestors of the base. Left alone — it is
another feature's test target.

## Notes that qualify a PASS

Three results deserve their qualification stated rather than buried.

- **TEST-4 (INV-4, real model)** needs a live LLM. It self-skips without one — the single
  conditional skip in the whole change, and the only kind the house rule allows. It was **run for
  real** against the local OpenAI-compatible bridge (`qwen3.6-35b-a3b` at `localhost:4000/v1`) and
  passed in 48.5s. Recorded as PASS on that basis; on a box without a model it will SKIP, not fail.
- **TEST-3 (INV-3)** proves the request breaks OUT of the rail, is full-width, non-collapsible, and
  its controls are enabled and keyboard-reachable. It deliberately does **not** drive the approval
  decision to resolution: that routes through `sendMessage` and a real generation round-trip, is
  owned by the `07-mcp` approval specs, and is not drivable from a seeded fixture. The scope note is
  in the spec itself.
- **TEST-14** asserts the row's decisions (truncation bound, elapsed formatting, artifact overflow,
  summary status precedence, accessible name, view-state keys) as pure functions, because this
  workspace's unit runner cannot parse JSX. The *rendered* claims — single line box and
  `scrollWidth > clientWidth` at 390px, the accessible name in the DOM — are asserted in a real
  browser by TEST-8 and TEST-2. Recorded as DRIFT-1.11; the enumeration wording still overstates
  what the unit half proves, which is called out in FIX_ROUND-1 rather than quietly left.

## Defects the test runs themselves exposed (all fixed)

Running the suites was not a formality — it found six real problems, four of them in the tests:

1. `tool_call_reveal_test` seeded `conversations.active_branch_id` **before** the branch row existed
   (FK violation). Four tests dead on arrival.
2. `tool_call_lookup_test` bound random UUIDs to `mcp_tool_calls.message_id`, which is an FK to
   `messages`. Three tests dead on arrival.
3. `stream_tool_timing_test` asserted the model makes **exactly one** tool call. That is an assertion
   about model behaviour, not the wire contract under test — the model made nine. Now `>= 1`, with
   every frame still checked, so more calls is a stronger assertion.
4. `showcase_seed_rail_test` decoded `jsonb_array_length` (INT4) as `i64`.
5. My own new seed-ordering guard was **wrong**: it checked uniqueness conversation-wide, but a
   message may be linked to several branches, so it reported a message as its own collision. The
   invariant is per-BRANCH.
6. The e2e specs asserted the pre-audit component structure — including one that asserted the
   summary is a **disabled** button, i.e. it asserted the exact a11y bug the audit made me fix.

And one that looked like a security failure and was not: the reveal spec's own fixture id contained
the string `reveal`, and a right-panel tab's close button carries the tab id in its accessible name —
so the "no reveal affordance" scan matched the close button. The exhaustive control enumeration in
the same test proves the restricted user has no reveal path at all. Fixture renamed, selector
tightened to the affordance's real wording.

## Post-merge re-verification (FIX_ROUND-18 / -19 + the `origin/feat/agent-core` merge)

The branch merged `origin/feat/agent-core` (84 commits) after rounds 18-19, so every
load-bearing result was RE-RUN on the merged tree rather than inherited. Logs under
`/data/pbya/ziee/tmp/lifecycle-logs/`; each run is wrapped in an explicit `*_EXIT=` marker,
because round 19 found a 0-byte log being cited as "exit 0" (FR19-9).

| suite | observed | log |
|---|---|---|
| `npm run check` (ui) | **`CHECK_UI_EXIT=0`** | `rail19-check-ui.log` |
| `npm run check` (desktop/ui) | **`CHECK_DESKTOPUI_EXIT=0`** | `rail19-check-desktopui.log` |
| `railIsolation.test.ts`, post-merge | **10 tests, 10 pass, 0 fail**, `UNIT_EXIT=0` | `rail19-unit-postmerge.log` |
| restore regression controls (the 5 round-18 holes), post-merge | **5/5 RED**, `RESTORE_EXIT=0` | `rail19-restore-postmerge.log` |
| e2e — rail family + the run_js matrix, post-merge | **21 passed, 0 failed (7.1m)**, `E2E_POSTMERGE_EXIT=0` | `rail19-e2e-postmerge.log` |

npm run check (ui): PASS
npm run check (desktop/ui): PASS

### Merge conflict resolutions

- `registry.tsx` — union of both import blocks (the rail/elicitation imports and
  `composeRequestFieldsFrom`); no logic conflict.
- the four generated gallery artifacts — took the base's, then regenerated
  (`gen:gallery-coverage` 437 surfaces, `gen:state-matrix` 349 surfaces,
  `gen:overlay-registry` 38 overlay surfaces).
- `sdk` — took the base's pointer `675a8ac` and re-ran `gen:testid-registry` on top
  (1748 ids) as `a50e07c`, rather than merging the branch's sibling regen `7636ad6`.
  The two diverged only in generated content, so regeneration is the resolution.
  **`sdk@a50e07c` is local-only and must be pushed before the superproject pointer.**
- `helpers.rs`, `tests/mcp/mod.rs`, `coverage.ts` auto-merged cleanly.

### Gate state — phase 7 does NOT pass, deliberately

`lifecycle-check --all` reports **8 of 9 phases OK**; phase 7 FAILS with
"`FIX_ROUND-19.md`: fix loop not converged — 11 new confirmed finding(s)".

That is not a bookkeeping gap to be edited away. Round 18 deleted the js-tool approval
card's source guards on the strength of seven RED mutations, and its blind audit found
five spellings those mutations missed; round 19 restored them, and its audit found five
MORE — including one (FR19-10) where the POST's arguments are unguarded, so
`resolveElicitationVia(id, blocked === 'not-registered' ? 'cancel' : action)` type-checks
and silently sends a different answer than the user gave. Two audits in opposite
directions, same result.

The six `accepted-open` entries are all **pre-existing** and all closed BY CONSTRUCTION by
the component-level harness named in `FIX_ROUND-18.md` §8. Adding a twentieth predicate is
the treadmill rounds 13-17 already ran. **This branch should not be pushed as converged
until that harness lands, or an owner accepts the recorded gaps explicitly.**
