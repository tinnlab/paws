# TEST_RESULTS — sse-slot-leak

Backend + SDK only; neither UI workspace is touched and no OpenAPI/type regen is
implied, so the frontend gates (`npm run check`, `gate:ui`, e2e) do not apply.
No permission is introduced, so A9/A10 do not apply.

Full logs: `/data/pbya/ziee/tmp/lifecycle-logs/sse-slot-leak-{int,BEFORE}.log`.

## Commands + raw results

```
# SDK unit (framework registry + sync)
cd sdk && cargo test -p ziee-framework --lib sync::
  → test result: ok. 21 passed; 0 failed; 51 filtered out

# SDK crate-scoped integration (real mounted sync_routes via tower::oneshot)
cd sdk && cargo test -p ziee-framework --test sync_routes
  → test result: ok. 7 passed; 0 failed
cd sdk && cargo test -p ziee-framework --test permission_extractors --test sync_origin_extractor
  → test result: ok. 10 passed; 0 failed   /   ok. 3 passed; 0 failed

# server unit (chat-token stream registry + handler)
cd src-app && cargo test -p ziee --lib chat::stream::
  → test result: ok. 15 passed; 0 failed; 1321 filtered out (14 registry + the handler guard test)

# server integration, real TestServer subprocess (sync + chat stream)
source src-app/server/tests/.env.test
cd src-app && cargo test -p ziee --test integration_tests -- --test-threads=4 \
    sync:: chat::stream_slot_reclaim_test chat::chat_stream_test
  → test result: ok. 30 passed; 0 failed; 2294 filtered out; finished in 58.53s

# build gates
cd sdk     && cargo check -p ziee-framework --tests   → clean
cd src-app && cargo check -p ziee --tests             → clean (no new warnings)
```

## Per-TEST results

- **TEST-1**: PASS — `sync::registry::tests::prune_closed_reclaims_a_connection_whose_stream_is_gone`
- **TEST-2**: PASS — `sync::registry::tests::per_user_cap_counts_live_connections_only`
- **TEST-2b**: PASS — `sync::registry::tests::global_cap_counts_live_connections_only`
- **TEST-3**: PASS — `sync::registry::tests::prune_closed_for_user_is_scoped_to_that_user`
- **TEST-3b**: PASS — `chat::stream::registry::tests::prune_closed_for_user_is_scoped_to_that_user`
- **TEST-3c**: PASS — `chat::stream::registry::tests::prune_closed_never_removes_a_live_connection`
- **TEST-4**: PASS — `sync_routes::abandoned_unpolled_streams_release_their_slots` **[acceptance INV-1]**
- **TEST-5**: PASS — `chat::stream::registry::tests::prune_closed_reclaims_dead_connections_and_leaves_live_ones_and_buffers`
- **TEST-6**: PASS — `sync::subscribe_test::abandoned_reconnects_release_their_slots_and_never_lock_the_user_out` **[acceptance INV-1]**
- **TEST-7**: PASS — `chat::stream_slot_reclaim_test::abandoned_chat_stream_reconnects_release_their_slots`
- **TEST-8**: PASS — `sync::subscribe_test::the_per_user_cap_is_still_enforced_for_live_streams` **[acceptance INV-3]**
- **TEST-9**: PASS — `sync::registry::tests::prune_closed_never_removes_a_live_connection`
- **TEST-10**: PASS — `sync::subscribe_test::owner_scoping_and_notify_only_wire_format_survive_slot_reclamation` **[acceptance INV-4]**
- **TEST-11**: PASS — `sync_routes::every_stream_exit_path_releases_its_slot` **[acceptance INV-2]**
- **TEST-12**: PASS — `chat::stream::registry::tests::per_user_cap_counts_live_connections_only_at_the_configured_limit` **[acceptance INV-3]**
- **TEST-13**: PASS — build gates clean (above) AND every pre-existing test in the
  blast radius passes with its assertions unmodified: all 8 original
  `tests/sync/subscribe_test.rs` tests, all 8 `tests/sync/delivery_test.rs` +
  `file_delivery_test.rs` tests, and all 6 `tests/chat/chat_stream_test.rs`
  tests. `git diff origin/feat/agent-core -- tests/sync/subscribe_test.rs` shows
  **zero deleted lines** — the file is append-only on this branch.
- **TEST-16**: PASS — `chat::stream::handler::tests::conn_guard_is_constructed_outside_the_stream_generator`
- **TEST-17**: PASS — `chat::stream::registry::tests::global_cap_counts_live_connections_only`

## Acceptance tests (design-invariant proofs) — all PASS

| INV | acceptance test | result |
|---|---|---|
| INV-1 | TEST-4 (`abandoned_unpolled_streams_release_their_slots`), TEST-6 | PASS |
| INV-2 | TEST-11 (`every_stream_exit_path_releases_its_slot`) | PASS |
| INV-3 | TEST-2, TEST-2b, TEST-8, TEST-12 | PASS |
| INV-4 | TEST-10 | PASS |

## Red-before-fix evidence (D2 — the acceptance tests are not tautologies)

The fix was reverted in place and the acceptance tests re-run against the
UNFIXED handler:

| test | unfixed | fixed |
|---|---|---|
| `abandoned_unpolled_streams_release_their_slots` (N=20) | **FAIL** — `connection_count` 0 → **20** | PASS — 0 → 0 |
| `every_stream_exit_path_releases_its_slot` leg (a) | **FAIL** — 0 → **1** after one abandoned subscribe | PASS |
| the 4 registry cap unit tests | **FAIL** — they registered already-dead connections (DRIFT-1.1) | PASS |

## Pre-existing failures (NOT regressions — classified, not hand-waved)

- `ziee-framework --lib openapi::emit_ts::tests::generator_golden_fixture` —
  **FAILS on this branch and FAILS IDENTICALLY on a pristine detached worktree of
  the pinned SDK commit `01a96b7` with zero local modifications** (verified by
  running it there). An OpenAPI→TypeScript golden-fixture drift, in a file this
  branch does not touch. Framework lib is otherwise 71 passed / 1 failed.
- `cargo test -p ziee --lib` (whole-crate) shows 5 failures in modules this diff
  never touches — `bio_mcp::supervisor`, `code_sandbox::tools::files`,
  `scheduler::repository` (all `SYSTEM_DATABASE_ERROR`, i.e. category-A
  missing-DB-fixture), `chat::core::repository::contents` (`read migrations dir:
  NotFound` — a path that does not exist in this layout), and `workflow::models`
  (`unknown variant 'subagent'`). All five are environment/fixture failures
  unrelated to SSE connection registries; the crate is otherwise 1331 passed.
  The scoped suite this change owns (`chat::stream::`) is 15/15 green.
