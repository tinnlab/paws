# FIX_ROUND-1

Three blind angles ran over `git diff origin/main...HEAD` (plus the sdk half):
**correctness**, **design-conformance** (required), and **security** (conditional —
the change alters a CORS layer). None was given the author's reasoning.

The round's headline: **the two angles that differ most in kind independently
found the same HIGH defect, and it was in the fix itself.** My loud-fail reported
exactly once per page load, so the user's SECOND message reverted to the precise
infinite spinner this branch exists to remove. It would have shipped looking
fixed.

## Fixed

- **FIX-1 (high, corroborated ×2)** — the one-shot report.
  `onSubscriptionAttemptFailed` fired on `failures === LIMIT` and the counter only
  reset on SUCCESS, so under a permanent failure it climbed past the limit and
  never matched again. `sendMessage` clears `error` and sets `isStreaming: true`
  at the start of every turn, so message two was back to a silent spinner. Now
  re-arms every `SUBSCRIPTION_REREPORT_EVERY` further failures (minutes apart once
  the backoff saturates). **Verified RED**: restoring `=== LIMIT` fails the new
  test with `expected 1 to be greater than 1`.
- **FIX-2 (medium, ×2)** — a subscription failure AT REST applied the whole
  turn-failure reset, whose `lastTurnInterrupted: true` renders an "interrupted"
  badge on the last assistant message — decorating a reply that had completed
  normally. The reset is now applied only when a turn is actually in flight.
- **FIX-3 (medium, ×2)** — the single message ("the reply is still being
  generated and saved") is false in that same at-rest path, which is the most
  common trigger. The client now emits only what it can always truthfully say;
  the store, which is what knows whether a turn is running, picks the advice.
- **FIX-4 (medium)** — the `?? 0` tail materialised a zeroed `progress_data` for a
  row that had none, so a QUEUED download rendered the literal "0 Bytes / 0 Bytes"
  until its first tick: the reported symptom string, re-introduced in a different
  state, by the fix for it. It now stays absent until something is known.
- **FIX-5 (low)** — `error_message`/`model_id` carry the whole row's value on every
  frame, so a null means CLEARED, not "unknown". Falling back left stale red error
  text on a recovered row. Those two now take the wire value directly; the
  progress figures keep the fallback, which is correct for them.
- **FIX-6 (low)** — `DOWNLOAD_STATUSES` was a hand-respelled `readonly
  DownloadStatus[]`, so adding a server status was not a compile error and
  `narrowStatus` would silently pin the row at "downloading" forever. Now a
  `Record<DownloadStatus, true>` — exhaustive by construction. (This was the same
  drift class the branch's own comments condemn for the CORS header.)
- **FIX-7 (low, ×2)** — `the_required_list_is_sourced_from_the_handler_constants`
  compared `&str` VALUES, so substituting an equal literal left it green: it
  detects drift in spelling, not in sourcing, contradicting its own doc. Renamed
  to `..._contains_both_custom_headers` and the claim corrected.
- **FIX-8 (low, ×2)** — the relocated desktop doc comment asserted the ngrok origin
  is "added at tunnel-start time". There is no such code; `allow_origins` has one
  producer in the tree. Corrected rather than re-asserted by the extraction.
- **FIX-9 (low)** — the timing assertion stamps time when the TEST task dequeues
  from the probe's channel, not when the frame arrived, so a long deschedule on
  the shared box could fail it on a perfectly incremental server. Pacing widened
  to 400 ms, threshold lowered to 150 ms, limitation named in the test.
- **FIX-10 (low)** — `create_cors_layer_with` took `&[&str]`; nothing stopped a
  future caller threading a config-derived value in and reopening the allow-list.
  Now `&[&'static str]`, so "these are compile-time constants the server defines"
  is enforced by the type system.
- **Documentation honesty (low, several)** — the design doc's INV-1 framing
  overstated what shipped (see below); its "Out of scope (recorded, not fixed)"
  heading contradicted its own KeepAlive bullet; `SUBSCRIPTION_FAILURE_LIMIT` was
  an undescribed user-visible policy; the example configs told operators to use
  `allow_credentials`, which `CorsConfig` cannot express and nothing sets; and both
  new e2e specs claimed more realism than they have. All corrected, and the
  `CODING_GUIDELINES` §14 "no `page.route()` mocking" exception is now named and
  justified rather than quietly taken.
- **Tests that locked defects in** — two of my own tests asserted the buggy
  behaviour (`errors.length === 1`; "does not clobber an earlier error"). Both
  rewritten to assert the property rather than the implementation, which is what
  let the defect hide in the first place.

## Accepted, with the reasoning recorded rather than the finding dismissed

- **A transient PUT rejection now tears down a healthy stream** (medium). This is
  DEC-3, taken deliberately; the audit's sharper framing is folded into it. It
  self-heals via replay and is bounded by the existing backoff, and the
  alternative is the silence that produced the reported bug.
- **INV-1 does not eliminate "someone forgets a string"** (medium) — it eliminates
  the N-places version. A source-scanning guard over "which headers does the
  frontend send" was deliberately NOT written: that guard class has failed to
  converge twice in this repo. The design doc now states the limit instead of
  claiming the stronger property.
- **INV-2 has no single test that can fail on it** (medium) — true, and
  irreducible: the failure lived in a browser policy no same-origin harness
  enforces. TESTS.md now states the acceptance as an explicit CONJUNCTION with a
  red-able condition per half, the e2e gained a browser-level assertion that the
  PUT is issued and accepted, and the out-of-band MiniBrowser + live-instance
  evidence is recorded in TEST_RESULTS.

## Escalated to the lead — real, pre-existing, NOT introduced here

Deliberately not widened into a bugfix branch; each is written up with its
evidence in `LEDGER.jsonl` and in the STATUS file:

1. **Download SSE has no per-user scoping** (`downloads.rs`) — `SSE_CLIENTS` is a
   process-global pool and every subscriber sees every user's download rows. The
   most substantive thing this audit surfaced.
2. **`set_subscription` never binds `conn_id` to the authenticated user** — a
   cross-user stream-silencing DoS, gated only by having to guess a UUIDv4.
3. **`set_subscription` answers 204 for an unknown connection id** — "the PUT
   succeeded" is not evidence the connection is subscribed.
4. **An all-unparseable `allow_headers` list fails OPEN to `Any`** — pre-existing,
   preserved here byte-for-byte on purpose.
5. **`http://localhost:1420` is allow-listed in release desktop builds.**
6. **`reloadOpen` cannot self-heal a wedged pane** — named in this branch's own
   diagnosis, now recorded explicitly as a scope boundary rather than left
   implicit.

**New confirmed findings:** 19

(That is the count the round's own re-audit returned, not a target. Two blind
angles over this round's diff — state-management and design-conformance/
test-reality — found 19 confirmed items including two HIGHs, and both HIGHs were
defects THIS round introduced or falsely certified. They are worked in
`FIX_ROUND-2.md`; writing 0 here would have been the same kind of claim the round
was convened to remove.)
