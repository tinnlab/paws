# TESTS — chat-boot-fetch-hygiene

Every test drives the REAL backend through the UI (no `page.route` mocking, no
stubbed responses), mirroring `tests/e2e/perf/boot-parallelism.spec.ts`.

`boot-tier-permission-gate.spec.ts` reads Playwright's page-level request log.
`chats-list-single-fetch.spec.ts` instead counts with a PASSTHROUGH `window.fetch`
observer installed before navigation (it records, then calls the original fetch, so
every request still hits the real server). That difference is deliberate and was
forced by measurement: the page-level log also catches requests the PREVIOUS
document had in flight across the navigation, which inflated the `/chats` count by
one and initially masked the real before/after. See MEASUREMENTS.md §Instrument.

`ITEM-5` is `[DESCOPED]` with an approved disposition in DECISIONS.md (DEC-2) and
is therefore exempt from needing a covering test — but INV-3, the invariant that
*causes* the descope, is still pinned by an executable acceptance test (TEST-5).

## Tests

- **TEST-1** (tier: e2e) [acceptance] [invariant: INV-2] [covers: ITEM-1, ITEM-2, ITEM-6] file: `src-app/ui/tests/e2e/perf/chats-list-single-fetch.spec.ts` — asserts: a cold, authenticated `/chats` load issues EXACTLY ONE wire request to `GET /api/conversations` (the route-level list fetch). Counts the browser's real requests to that path over the whole cold load + settle window and fails on ≥2, naming the observed timeline in the failure message. This is the direct executable form of INV-2 ("one shared store read rather than N independent callers"): it fails if a second independent caller is reintroduced, and it would have FAILED on the unmodified tip (the pre-change count is recorded in MEASUREMENTS.md as the negative control).
- **TEST-2** (tier: e2e) [acceptance] [invariant: INV-1] [covers: ITEM-3] file: `src-app/ui/tests/e2e/perf/chats-list-single-fetch.spec.ts` — asserts: the de-duplicated `/chats` still RENDERS its data — with conversations seeded through the real API before navigation, the page shows the conversation rows (not the "No chat history yet" empty state) on a cold load. This is the INV-1 half of the trade: it fails if the single-owner change cost the page its fetch, so a "fewer requests" win that produced an empty list cannot pass.
- **TEST-3** (tier: e2e) [covers: ITEM-3] file: `src-app/ui/tests/e2e/perf/chats-list-single-fetch.spec.ts` — asserts: the exact case the removed `ConversationList` comment cited — a conversation created AFTER the store has already been primed (visit `/chats`, create a conversation out-of-band via the API, navigate away and back) still appears in the list. Proves the surviving page-level fetch covers the reactivity the removed effect claimed to provide.
- **TEST-4** (tier: e2e) [covers: ITEM-4] file: `src-app/ui/tests/e2e/perf/boot-tier-permission-gate.spec.ts` — asserts: the measured Rank-4 shape on an ADMIN boot — `GET /api/auth/me` is issued, and the permission-gated `GET /api/server-update/status` is issued only after `/api/auth/me` has RESOLVED (its start is at/after `/api/auth/me`'s end). This documents the serialization as a measured fact rather than a claim, and is the positive control for TEST-5.
- **TEST-6** (tier: e2e) [covers: ITEM-6] file: `src-app/ui/tests/e2e/perf/chats-list-single-fetch.spec.ts` — asserts: the no-op guard added by ITEM-6 did NOT break real search — typing a query that matches only one of two seeded conversations filters the list to it, and CLEARING the query back to empty restores the other one. The clear-to-empty leg is the load-bearing half: it is the case where `localSearchQuery` is `''` (identical to a mount pass) but the store holds a non-empty query, so a guard written as "skip the first run" instead of "skip when equal to the store" would strand the user in a filtered list. This is the direct regression guard for the risk ITEM-6 introduces.
- **TEST-5** (tier: e2e) [acceptance] [invariant: INV-3] [covers: ITEM-4] file: `src-app/ui/tests/e2e/perf/boot-tier-permission-gate.spec.ts` — asserts: a NON-ADMIN user (who lacks `server_update::read` — granted by no migration, so held only by admins via `*`) boots the app and issues **ZERO** requests to `GET /api/server-update/status`, and receives **ZERO** 403 responses on any `/api/` request during boot. This is the executable proof that the `hasPermissionNow` gate is load-bearing and not decorative: it fails the moment anyone "optimistically fires and tolerates a 403" (ITEM-5), which is precisely the change this round declines to make. It asserts the DESIGN's promise (the no-403 rule), not the current code's behaviour — flipping the invariant off turns it red.

## Coverage map

| ITEM | covered by |
|---|---|
| ITEM-1 | TEST-1 |
| ITEM-2 | TEST-1 |
| ITEM-6 | TEST-1, TEST-6 |
| ITEM-3 | TEST-2, TEST-3 |
| ITEM-4 | TEST-4, TEST-5 |
| ITEM-5 | `[DESCOPED]` — approved disposition in DECISIONS.md (DEC-2) |

| INV | pinned by |
|---|---|
| INV-1 | TEST-2 `[acceptance]` |
| INV-2 | TEST-1 `[acceptance]` |
| INV-3 | TEST-5 `[acceptance]` |

## Tier note

The diff touches a frontend workspace (`src-app/ui/**`) and every enumerated test
is `tier: e2e`, satisfying the frontend e2e requirement. The change introduces **no
new permission** (it only *asserts* an existing one), so the A10
`[negative-perm]` requirement is not triggered — TEST-5 nevertheless uses a
restricted user, for the INV-3 proof rather than for a UI-absence claim.

No unit tier is enumerated deliberately: the change is the DELETION of a React
mount effect, and the property under test ("how many wire requests does a real cold
load make") is only observable in a real browser against a real backend. A mocked
unit standing in for that would be exactly the cosmetic test the guidelines forbid.
