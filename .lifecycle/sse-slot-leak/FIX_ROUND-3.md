# FIX_ROUND-3 — the round that found the actual production trigger

A third blind agent (diff-only context, explicitly READ-ONLY after the round-2
incident) re-audited the merged diff across 10 angles. It cleared the three
things it was asked to attack hardest — the `open_chat_stream` extraction is
behaviour-preserving, `is_none_or` cannot remove a live connection, and the two
new handler tests are real and leak no state — and then found the thing five
earlier passes (mine and four auditors') had all missed.

## The finding: `HEAD` is the production trigger

Everything in this branch had asserted that the never-polled window is
unreachable through the real endpoint, on the strength of my own measurements
(20 sequential, 100 sequential, 200 and 400 concurrent abandoned raw sockets →
**0** slots leaked). Those measurements were correct and the conclusion drawn
from them was wrong, because they only ever issued **GET**.

> axum routes `HEAD` to the `GET` handler (`method_routing.rs`,
> `call!(req, HEAD, get)`), and hyper encodes a HEAD response with a zero-length
> body encoder (`can_have_body == false`), so `can_write_body()` is false and the
> dispatcher sets `clear_body = true` — **the SSE body is DROPPED WITHOUT EVER
> BEING POLLED.**

So the handler runs, `register()` claims a slot, and the generator holding the
guard never starts. The auditor reproduced it in a scratch axum/hyper server;
**I then reproduced it against the real ziee server**, which is what makes it
load-bearing:

| `HEAD /api/sync/subscribe`, unfixed server | result |
|---|---|
| HEAD #1 … #12 | 200 |
| **HEAD #13** | **429** — `left: 429, right: 200` |

Twelve HEADs permanently lock an account out of realtime sync;
`GLOBAL_MAX_CONNECTIONS` of them take the whole deployment down. It needs no
malice and no unusual client: uptime monitors, reverse proxies, link previewers
and security scanners HEAD URLs routinely, and there is no method-filtering
middleware in front of these routes. **This fits the report exactly** — accounts
permanently 429'd on a QUIESCENT box, on BOTH `/api/sync/subscribe` and
`/api/chat/stream`, with no client connected to explain it.

The shipped fix already closes it, twice over (the guard hoist means the guard is
dropped with the unpolled future; the sweep reclaims the closed channel at the
cap). What was wrong was the *documentation* — every comment asserted the path
was unreachable, which would have justified reverting the `open_chat_stream`
seam — and the *coverage*: not one test issued a HEAD.

**Resolution:**
- **TEST-19** (`sync`) and **TEST-20** (`chat`) — `2 × cap` HEADs must all be
  accepted and leave the user's full allowance free. TEST-19 is verified RED
  before the fix at HEAD #13. This is the red-before-fix proof through the real
  HTTP endpoint that every prior round said was impossible to obtain.
- Every "unreachable through the real endpoint" claim corrected in all four
  places it had been copied to (`handler.rs` ×2, both integration test files),
  now stating the GET-vs-HEAD distinction precisely.
- `PLAN.md`'s root-cause section rewritten: the mechanism is no longer
  "unexplained", and the earlier caveat is retired.

## Other confirmed findings

| Finding | Resolution |
|---|---|
| `prune_closed_for_user_locked`'s doc claimed it REPAIRS an orphaned `by_user` id, but `remove_conn` is keyed off `clients` and no-ops when the row is missing — so `is_none_or` selected the orphan, counted it as reclaimed, and left it in place, still counting against the cap forever with neither sweep able to clear it | the repair is now real (drop the index entry directly), pinned by **TEST-21**, which forges the desync because it has no natural trigger. The `medium` here is the one that would have re-created the exact bug this feature exists to fix |
| `a_live_stream_keeps_its_slot_until_dropped`'s doc claimed it covers "the other two exit paths" — it never polls the stream, so it covers the same path plus a still-registered check | doc corrected to what it actually asserts, and it now points at the sync handler's `every_stream_exit_path_releases_its_slot` for the other two |
| two stale "with the leak present the 13th subscribe would 429" rationales, invalidated by the sweep added in the same change (dropping an unpolled stream closes its channel, so `register` reclaims at the cap) | corrected in both places to name the per-iteration slot-count assertion as the discriminating one |
| `n` over-reported the count and the `tracing::debug!` line was false in the orphan case | fixed with the repair |
| `CLAUDE.md` says the sweep runs "before each cap check", reading as unconditional | left as-is: the very next clause in the same paragraph already says a cap is only charged for live streams, and the in-code comment states the conditionality precisely. Noted rather than churned |

## Judged and consciously NOT actioned

- **Storm-test flake risk** (both storm tests assert every one of `cap + 8`
  back-to-back subscribes returns 200 with no settling, while the helper right
  above them retries because reclamation is asynchronous). Real, and worth
  fixing if it ever flakes — but the tests have now run green 5× consecutively
  including on a freshly-cleaned build, and adding retry logic to the *assertion*
  would weaken exactly what it asserts. Recorded in the hand-off.
- **Hardcoded `12` in the SDK crate test** — forced, the const is private; the
  ziee-side siblings probe instead. Recorded.
- **Global sweep contention under saturation** — O(512) under the delivery
  mutex, only when the global cap would otherwise refuse. Noted across three
  rounds, still judged not worth a debounce.
- **`prune_closed_reclaims_…` asserts only the `clients`-derived count, not
  `by_user`** — genuine gap, now indirectly covered by TEST-21 which asserts
  `by_user` directly.

## Verification after this round

- `ziee-framework --lib sync::` — **22 passed, 0 failed**
- `ziee-framework --test sync_routes` — **7 passed, 0 failed**
- `ziee --lib chat::stream::` — **16 passed, 0 failed**
- `ziee --test integration_tests sync:: chat::stream_slot_reclaim_test
  chat::chat_stream_test` — **32 passed, 0 failed**
- `cargo check` clean on both crates, from a `cargo clean`ed tree

**New confirmed findings:** 0
