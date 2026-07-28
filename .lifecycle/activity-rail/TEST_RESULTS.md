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
