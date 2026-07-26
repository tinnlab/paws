# FIX_ROUND-2 — resolving the round-2 blind re-audit

Two fresh blind agents (diff-only context, no access to my reasoning) re-audited
the REDUCED diff across 15 angles. It did not come back clean: **21 new confirmed
findings**, two of which the first round could not have seen. Both agents also
independently confirmed the core mechanism is sound ("I could not break it";
"the production change is correct, minimal and well-reasoned").

## The two findings that mattered

### 1. The structural guard's second assertion was VACUOUS

> `src[stream_at..].contains("let _guard = guard;")` matches the test's OWN
> assertion message, which contains that literal and sits after the `stream!`
> block. Verified empirically: deleting the real move-in line still leaves the
> assertion true. That mutation compiles (unused-variable warning only) and is
> catastrophic — `guard` would drop at the end of the handler, unregistering
> immediately, so every chat SSE stream would close right after the handshake.

Correct, and a genuinely dangerous hole: the chat handler had no other coverage.

**Resolution — the deeper fix, not the patch.** The second agent showed the
justification for a source-shape test was overstated: the only blocker was that
the register → guard → `stream!` construction was inlined in a handler needing
`RequirePermissions`. So `open_chat_stream(user_id, exp_unix, token_ver)` is
extracted (no extractor, no HTTP, no DB — the sole DB access is in the re-check
arm, which lives inside the generator and never runs unpolled), and the
source-shape assertion is REPLACED by two real behavioural tests:

- `an_unpolled_stream_still_releases_its_slot` — opens `cap + 8` streams,
  drops each `Sse` **without ever polling it**, asserts the user's slot count
  is 0 after every one.
- `a_live_stream_keeps_its_slot_until_dropped` — the complementary direction, so
  the contract is not satisfied by "always release".

Both verified RED before the fix (`left: 1, right: 0`). This closes the single
biggest gap of round 1: the chat half of a two-half fix now has its own
behavioural proof instead of a string match. See DEC-16.

### 2. A concurrent revert was committed (recovered)

Both agents independently found that HEAD had LOST both production hunks. Cause,
confirmed by the second agent (which owned it): its own temporary red-before-fix
revert was in flight in this SHARED worktree when my `git add -A` docs commit ran
at 18:03:53, sweeping the reverted files into `7c594f791`.

**Resolution:** restored and committed; HEAD re-verified to contain
`let guard = ConnGuard(conn_id);` and both `register` sweeps. Note the intended
guard WOULD have caught this — the structural test's *first* assertion fails on
that state — but I had not re-run tests after that commit. The new behavioural
tests fail on it too. **Process lesson: never `git add -A` in a worktree shared
with agents that mutate source; stage explicit paths, and re-run the scoped
suite immediately after any commit.**

## Remaining confirmed findings

| Finding | Resolution |
|---|---|
| TEST-6's doc claims "before the fix the 13th subscribe returns 429" — measured FALSE by our own DRIFT-1.2; TESTS.md was amended but the **test source** still carried the wrong claim a future reader would open | corrected in the source, with the measurement inline (20/100/400 abandons leaked 0) and a pointer to the tests that ARE red-before-fix |
| the chat integration module doc reads as the proof of the chat fix | caveat added naming `an_unpolled_stream_still_releases_its_slot` as the real proof |
| TEST-10 asserts "notify-and-refetch, **and nothing more**" but `SyncProbe` parses out `{entity,action,id}` and discards the rest, so extra row data is undetectable by construction | claim narrowed to what the assertion can actually observe, with a note on where the wire shape IS pinned |
| the six `prune_*` unit tests exercise the `#[cfg(test)]` wrappers only — with the production `register` sweeps removed they all still pass; only the cap tests prove the wiring | a COVERAGE NOTE added above both test blocks saying exactly that |
| the 429 body assertions were disjunctions (`ERROR_CODE` **or** the human message), so dropping the machine-readable code would still pass | tightened to require the error code |
| `count_available_slots` never exits early (`best + 1 >= ceiling` with ceiling 64 vs caps 24/12), burning the full 20s deadline and ~1000-1700 requests per call, ×4 callers | now returns as soon as two consecutive passes agree (normally 2 iterations) |
| the same helper accepted ANY 429 as the per-user cap, so a global-cap refusal would silently understate the discovered cap and make downstream assertions vacuous | now asserts the refusal carries a `*USER_LIMIT` code |
| the load-bearing rationale (is_closed liveness, the no-TTL decision, the sole-`Sender` invariant) sat on a `#[cfg(test)]` wrapper — absent from release builds and `cargo doc` — while the production `prune_closed_locked` carried three lines | moved onto the production function in both registries |
| the "other reapers" comment described the PRE-fix world and omitted the guard, so a maintainer could conclude the guard is unreliable and reintroduce the rejected deadline reaper | rewritten to name the guard as the primary path and the sweep as the backstop |
| stale claim "the framework twin IS `pub`: its crate-level test needs the public entry" — false on both halves after FIX_ROUND-1 (`#[cfg(test)]` items are not visible to a separate test crate, and that test uses `connection_count()`) | corrected in the chat mirror |
| `prune_closed_for_user_locked` SKIPPED a `by_user` id missing from `clients` instead of removing it; `user_count` derives from `by_user`, so an orphan would count against the cap forever and NEITHER sweep could clear it — the permanently-429'd account this feature exists to prevent | `is_none_or` makes the sweep repair it (defensive; unreachable today since both indexes move under one lock) |
| PLAN's scoping survey claimed the other SSE handlers are "unkeyed broadcast, no cap" — **false for `hardware`**, which has a keyed pool with `MAX_SSE_CLIENTS = 256` and releases via `remove_client` as the last statement INSIDE its generator (the same anti-pattern), masked by a 2s broadcast prune | PLAN corrected; left untouched deliberately (different module, no reported symptom, self-heals in seconds) and called out in the hand-off |
| DEC-5 still specified per-user-first sweeping, contradicting the global-first order FIX_ROUND-1 deliberately restored | DEC-5 amended; DEC-15 added recording the order as a contract |

## Judged and consciously NOT actioned

- **Extract the duplicated sweep into a shared generic** (flagged `medium`/`high`
  by both agents). ~45 lines duplicated across the SDK/app boundary over
  structurally different types with different limit sources. Recorded as DEC-13;
  the stronger form of the argument — a shared `guarded_sse(...)` constructor in
  the framework that would make the bug *unrepresentable* — is a real
  improvement and is written into the hand-off as follow-up work, but it is a
  refactor of two handlers plus a new SDK seam, well outside a production
  bug-fix's blast radius.
- **A debounce on the global sweep under saturation** — O(512) under the
  delivery mutex, microsecond-scale, only when the global cap would otherwise
  refuse. Noted, not added.
- **`the_per_user_cap_is_still_enforced_for_live_streams` duplicates a
  pre-existing test.** True, but the pre-existing one is byte-frozen by DEC-10
  and the new one adds the handshake poll, the second attempt, and the
  error-code check. Kept.
- **An operator surface (metric / forced sweep)** for the failure mode. Would
  need a route + permission + OpenAPI regen + a `[negative-perm]` e2e, which
  this backend-only diff deliberately avoids. Recorded in the hand-off.
- **Pre-existing `set_chat_stream_subscription` conn_id ownership gap** — both
  agents flagged it independently. Not introduced or worsened here; reported to
  the owner rather than fixed in a bug-fix diff.

## Verification after this round

Re-run in full on the CURRENT base (`origin/feat/agent-core` @ `f78a23a22`,
sdk `ebe3ff8`) after merging:

- `ziee-framework --lib sync::` — **21 passed, 0 failed**
- `ziee-framework --test sync_routes` — **7 passed, 0 failed**
- `ziee --lib chat::stream::` — **16 passed, 0 failed**
- `ziee --test integration_tests sync:: chat::stream_slot_reclaim_test
  chat::chat_stream_test` — **30 passed, 0 failed**
- `cargo check -p ziee --tests` / `-p ziee-framework --tests` — clean
- `npm run lint:hooks` (the gate that landed on the new base) — **OK, 0
  violations across 2441 files**

**New confirmed findings:** 0
