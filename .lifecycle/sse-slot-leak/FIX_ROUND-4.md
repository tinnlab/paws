# FIX_ROUND-4 — tightening the round-3 additions

A fourth blind agent (read-only) re-audited the merged diff. **Nothing high.** It
independently verified the three load-bearing mechanism claims rather than taking
them on faith — the `async move` capture that makes the hoist work, the sole-
surviving-`Sender` invariant in both handlers, and the orphan-repair borrow
pattern (compiled standalone) — and confirmed `CLAUDE.md`'s added paragraph is
accurate. Two mediums and five lows, all resolved.

## Findings and resolutions

| Finding | Resolution |
|---|---|
| **The HEAD mechanism was misattributed.** Four doc blocks said "hyper encodes a HEAD response with a zero-length body encoder". It is **axum**: `RouteFuture::poll` swaps the body for `Body::empty()` (`routing/route.rs`) synchronously, before the response ever reaches hyper. The conclusion (body dropped unpolled → the guard must exist by then) is unchanged; the cause was wrong | corrected in all four places. It also explains something the diff had gotten backwards: the SDK's `tower::oneshot` tests exercise this path with no hyper in the process at all |
| **The HEAD integration tests do NOT isolate the guard hoist** — with the guard reverted but the sweep kept, the (cap+1)th HEAD reclaims the leaked entries and they still pass. They prove the account is not locked out; they do not prove where the release came from. `handler.rs` credited them with the latter | docs no longer make that claim. The unpolled-drop UNIT tests are what isolate it — they assert the count after EVERY drop while staying below the cap, so `register`'s sweep never runs and cannot mask a reverted guard. That property is now stated explicitly in the test that has it |
| **The chat registry shipped the orphan-repair branch with no test**, directly contradicting the SDK test's own rationale ("defensive code with no natural trigger is exactly why it needs a test") | added the chat twin (TEST-21b) |
| **The orphan repair closed only one desync shape.** If a cid sat in `by_user[A]` while `clients[cid].user_id == B`, `remove_conn` (keyed off `clients`) would clean B's index and leave A's entry as a NEW orphan; a LIVE cross-user entry would never enter `dead` at all and would count against A's cap forever — the permanently-429'd account the branch exists to prevent | `remove_conn` is now followed by an **unconditional** `by_user[user_id].remove(&cid)`, which closes every shape rather than the one that was imagined |
| **Neither HEAD test anchored its own premise.** Both would pass vacuously if HEAD were ever short-circuited before the handler (a future axum change, a proxy, a HEAD-handling layer) — they only assert 200s and a settled count | each now opens the user's whole allowance as LIVE streams and asserts a HEAD is **refused with 429**, which it can only be if it reached `register()` |
| TEST-21 covered only the "set becomes empty" branch and never asserted `clients` was untouched | widened to cover "orphan alongside a live connection" (the entry must SHRINK, not vanish) and to assert `clients` is left alone. Same in the chat twin |
| helper duplication (`count_available_slots`/`DISCOVERY_CEILING` copied between the two integration test files) | acknowledged, not actioned — they differ only in a URL literal and live in the same test binary. Recorded as follow-up (the natural home is `ziee-test-harness`, which already hosts `SyncProbe`) |
| a new O(N)-under-lock cost on the REJECTION path at global saturation | noted across rounds 2, 3 and 4 and consistently judged not worth a debounce: 512 `HashMap` entries, no allocation on a clean sweep, and only when the cap would otherwise refuse. Recorded rather than actioned |

## Verification after this round

- `ziee-framework --lib sync::` — **22 passed, 0 failed**
- `ziee-framework --test sync_routes` — **7 passed, 0 failed**
- `ziee --lib chat::stream::` — **17 passed, 0 failed**
- `ziee --test integration_tests sync:: chat::stream_slot_reclaim_test
  chat::chat_stream_test` — **32 passed, 0 failed**
- both HEAD tests re-run with the new anchor block — green

## Convergence

Rounds 1-4 found, in order: 22 → 21 → 10 → 7 confirmed findings, with severity
falling from `high` (a security regression in the deadline reaper; a whole half
of the fix untested) to `medium`/`low` (claim accuracy, test isolation, defensive
coverage). Round 4 returned **nothing high** and nothing that changed the shipped
behaviour except one strictly-safer index removal.

A fifth blind round was commissioned on the post-round-4 diff as a final
pre-merge go/no-go. If `FIX_ROUND-5.md` is absent, that round had not returned at
hand-off time and the merge decision rests on rounds 1-4 — which is stated
plainly in the hand-off rather than implied to be a clean fifth round. This
file's count refers to round 4's own findings, all resolved above.

**New confirmed findings:** 0
