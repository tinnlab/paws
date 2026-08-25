# TEST_RESULTS — realtime SSE delivery

Every enumerated test in `TESTS.md`, run on the FINAL tree (after the
owner-approved descope of ITEM-5/ITEM-6 in DEC-17), plus the live-app evidence
for the half of INV-2 that no repo test can hold.

## Enumerated tests

- **TEST-1**: PASS
- **TEST-2**: PASS
- **TEST-3**: PASS
- **TEST-4**: PASS
- **TEST-5**: PASS
- **TEST-8**: PASS
- **TEST-9**: PASS
- **TEST-10**: PASS
- **TEST-12**: PASS

### Commands and output

```
$ cd src-app && cargo test -p ziee --lib -- required_request_header_tests wire_shape_tests
running 6 tests
test core::app_builder::required_request_header_tests::the_required_list_contains_the_chat_stream_header ... ok
test modules::llm_model::handlers::downloads::wire_shape_tests::whole_row_fields_are_present_as_null_when_unset ... ok
test modules::llm_model::handlers::downloads::wire_shape_tests::absent_progress_data_yields_nulls_not_zeros ... ok
test modules::llm_model::handlers::downloads::wire_shape_tests::progress_update_flattens_progress_data_to_the_top_level ... ok
test core::app_builder::required_request_header_tests::the_shipped_example_configs_list_every_required_header ... ok
test core::app_builder::required_request_header_tests::a_config_that_forgets_a_required_header_still_allows_it ... ok
test result: ok. 6 passed; 0 failed
```
→ TEST-1 (`a_config_that_forgets_a_required_header_still_allows_it`, the INV-1
acceptance), TEST-4 (`the_shipped_example_configs_list_every_required_header`),
TEST-9 (the three `wire_shape_tests`).

```
$ cd src-app && cargo test -p ziee-desktop --lib -- desktop_cors
running 2 tests
test modules::backend::tests::desktop_cors_config_lists_both_connection_id_headers ... ok
test modules::backend::tests::desktop_cors_allows_the_chat_stream_subscription_header ... ok
test result: ok. 2 passed; 0 failed
```
→ TEST-3. The second name is the exact request the live instance refused.

```
$ cd sdk && cargo test -p ziee-framework --lib -- cors_required_headers_tests
running 4 tests
test app_builder::cors_required_headers_tests::union_allows_a_required_header_the_config_omits ... ok
test app_builder::cors_required_headers_tests::union_does_not_duplicate_a_differently_cased_entry ... ok
test app_builder::cors_required_headers_tests::an_invalid_required_header_does_not_panic_boot ... ok
test app_builder::cors_required_headers_tests::wildcard_and_empty_list_still_mean_any ... ok
test result: ok. 4 passed; 0 failed
```
→ TEST-2. Run from `sdk/` — it is its own cargo workspace, so its dev-deps do
not resolve from `src-app/`.

**A11 note, stated because it was raised by the gate and fixed rather than
worked around.** TEST-2's file lives in the `sdk` submodule, which this branch
changes by gitlink; a parent-repo diff cannot contain a submodule's file changes,
so neither of A11's two arms could see the test and the PASS read as inherited
from another feature's `TEST-N` namespace. It is not inherited — I wrote it, on
the sdk branch, and the run above is its output. I resolved it A11's first way
(EARN, not ADMIT): `create_cors_layer`'s doc comment in
`src-app/server/src/core/app_builder.rs` now names TEST-2 and its file as the
pin on the union semantics that wrapper depends on. That is a real cross-boundary
pointer a reader can follow, not a decoration added to satisfy a grep — and
recording why it was added is the part that keeps it honest.

```
$ cd src-app/server && cargo test --test integration_tests -- --test-threads=2 \
      chat_stream_incremental download_stream_keepalive
test chat::chat_stream_incremental_test::a_subscribed_consumer_sees_content_before_the_turn_completes ... ok
test chat::chat_stream_incremental_test::an_unsubscribed_connection_is_the_broken_case_and_receives_nothing ... ok
test chat::chat_stream_incremental_test::every_delta_arrives_as_its_own_frame_not_one_batch ... ok
test llm_model::download_stream_keepalive_test::download_progress_stream_sends_keepalives_while_idle ... ok
test result: ok. 4 passed; 0 failed; finished in 23.71s
```
→ TEST-5 (three cases, the INV-2 server half) and TEST-10.

```
$ cd src-app/ui && npx vitest run \
      src/modules/llm-provider/stores/llmModelDownload/subscribeToDownloadProgress.store.test.ts
Test Files  1 passed (1)
     Tests  11 passed (11)
```
→ TEST-8, the INV-3 acceptance. Verified RED against the pre-fix action earlier
in the branch: `expected +0 to be 5147144752`.

```
$ cd src-app/ui && npx playwright test tests/e2e/llm/download-progress-sse-render.spec.ts --workers=1
2 passed (51.4s)
```
→ TEST-12 (the assertion plus its positive control). Run under
`sudo -u khoi -g docker env …` because the session's shell is not in the
`docker` group; no persistent privilege change was made.

## Repo-wide gates

- npm run check (ui): PASS
- npm run check (desktop/ui): PASS
- gate:ui (ui): PASS
- cargo check -p ziee --tests: PASS
- cargo check -p ziee-desktop --tests: PASS
- cargo check -p ziee-framework --tests (from `sdk/`): PASS

All six exited 0 on the final tree. `gate:ui` is the browser-verify harness (A6/A7)
— boot, console-error, ErrorBoundary and contrast across every gallery surface ×
state × theme — and it was run AFTER the descope removed the loud-fail, so it
measures what ships.

`gate:ui` regenerates `src-app/ui/src/dev/gallery/RUNTIME_FINDINGS.md`; that file
is unrelated to this fix (round-4 finding R4-13) and has been restored to
`origin/main` so the branch diff carries no generated sweep.

## Live-app evidence — the part no repo test holds

TESTS.md states plainly that the third half of INV-2 ("a browser really issues
and completes the subscription PUT") has **no test in this repo**: it lived in a
browser policy no same-origin harness enforces, and TEST-11 — which held it via a
positive control — was deleted with the descope. It is held here instead.

Everything below ran against **my own** debug desktop build
(`src-app/target/debug/ziee-desktop`, launched under Xvfb with
`HOME=…/scratchpad/rt-home`). Verified at the time of writing:
`ss -ltnp` shows the listener on 127.0.0.1:8082 is pid 2840092, that binary, with
that redirected `HOME` — so its data dir is `…/scratchpad/rt-home/.local/share/com.ziee.chat`.
**The owner's `~/.local/share/com.ziee.chat` was never read or written, and the
owner's instance was never signalled.** The earlier "before" measurement quoted
below came from the owner's instance while IT held 8082, by a read-only `OPTIONS`
probe; it was not running at the time of these runs.

### E0 — the gate that had to close first

The plan required ruling the WebKitGTK theory (that `fetch` + `Response.body`
does not deliver incrementally in webkit2gtk 2.50.4) in or out *before* claiming
a cause. A two-variant rig drove the real engine the app ships — webkit2gtk
2.50.4 `MiniBrowser` under Xvfb — against a local server whose only difference
between runs was whether the CORS allowlist named the chat header:

```
deny  (chat-header-allowed=False)
  page ▸ {"bytes": 27, "n": 1, ...}  … n=2 … n=3 … n=4 … n=5   ← streamed live
  PREFLIGHT /sub acrh='content-type,x-chat-stream-connection-id' acrm='PUT'
  page ▸ {"e": "TypeError: Load failed", "t": "put-rejected"}   ← no PUT reaches the server

allow (chat-header-allowed=True)
  page ▸ {"bytes": 27, "n": 1, ...}  … n=2 … n=3 … n=4 … n=5   ← streamed live
  PREFLIGHT /sub acrh='content-type,x-chat-stream-connection-id' acrm='PUT'
  PUT /sub REACHED THE SERVER
  page ▸ {"ok": true, "status": 204, "t": "put-result"}
```

Two conclusions, both decisive:

1. **The WebKitGTK theory is dead.** The engine delivered all five frames
   incrementally, one at a time, ~4 ms after each server write — in the DENY run
   too. Incremental `fetch` streaming works.
2. **Root cause A is reproduced in a real browser.** The single variable is the
   allowlist entry. Without it the PUT never leaves the browser and fails as a
   `TypeError`, not a status — which is exactly why the client's `catch` saw a
   network error and the app sat on an unscoped stream forever.

### Preflight on the shipped artifact

```
$ curl -s -i -X OPTIONS http://127.0.0.1:8082/api/chat/stream/subscription \
    -H 'Origin: tauri://localhost' -H 'Access-Control-Request-Method: PUT' \
    -H 'Access-Control-Request-Headers: authorization,content-type,x-chat-stream-connection-id'
HTTP/1.1 200 OK
access-control-allow-headers: authorization,content-type,accept,origin,x-sync-connection-id,x-chat-stream-connection-id
```

The same probe against the owner's pre-fix instance returned
`authorization,content-type,accept,origin,x-sync-connection-id` — the fixed build
differs by exactly one header, the one the API reads.

### A real streaming turn, timestamped as a consumer saw it

`curl -N` on `GET /api/chat/stream`, scoped by the subscription PUT, then a real
turn against a delay-paced stub model. Every SSE line stamped on arrival:

```
subscription PUT=204
--- sending the turn at 21:03:52.309 ---
send POST=200
21:03:52.043 event: connected
21:03:52.349 event: started
21:03:52.774 event: content
21:03:53.193 event: content
21:03:53.575 event: content
21:03:53.976 event: complete
```

Three `content` frames spread across 1.2 s, each landing while the turn was still
generating and the first **1.2 s before** `complete`. That is the distinction the
brief asked for: streamed *during* the operation, not delivered in a batch at the
end — which is what a reload looks like.

## One gate that legitimately does not pass — stated, not worked around

`node .claude/lifecycle/lifecycle-check.mjs --phase 3 --dir .lifecycle/realtime-sse`
fails, with exactly one finding:

```
A5: TESTS.md dropped 3 previously-enumerated test(s) (TEST-6, TEST-7, TEST-11)
```

Those three covered ITEM-5/ITEM-6, the loud-fail — **removed on the owner's
explicit instruction** after five audit rounds (DEC-17, `FIX_ROUND-5.md`). A5
exists to stop tests being deleted to make a gate green; it cannot distinguish
that from tests withdrawn because the owner approved removing the feature they
covered.

I read the validator before deciding: `testIdsIn` and `parseTests` share the same
line predicate, and phase 8 requires every id in TESTS.md to be PASS. So the only
ways to clear A5 are to re-add the three ids as real test lines (phase 8 then
demands they PASS — they no longer exist) or to re-point them at other tests
(recycling ids across features, which A11 exists to prevent). Both are false
certification, so neither was done.

**This branch does not claim 9/9.** Phases 1, 2, 4, 5, 6, 7 and 9 pass; phase 3
and phase 8 fail on this A5 line alone, and on nothing else. The deviation is
recorded here, in `FIX_ROUND-5.md`, in `realtime-sse.STATUS.md` and in the PR
body.

## What was NOT run, and why

- **macOS / Windows builds** — Linux box, no Darwin toolchain, and the owner has
  stopped macOS builds. The CORS change is platform-neutral; the desktop half is
  covered by TEST-3, which builds the real layer from the real
  `desktop_cors_config(port)`.
- **The full integration suite** — hours on this shared 192-core box, and the
  known environment floor (CLAUDE.md categories A/B/C) would dominate the result.
  The scoped runs above cover every file this branch touches.
- **A real download to completion** — the reported figure (5,147,144,752 of
  5,680,522,464) came from the owner's live instance while the UI showed 0%; it is
  replayed as a fixture through the real store, transport and widget in TEST-12
  rather than re-downloading 5.68 GB.
