# RESULTS — net-hygiene, measured before → after

Protocol (DEC-13): the SAME production build pipeline, the SAME static server
shape, the SAME backend instance (`127.0.0.1:29185`), the SAME audit invocation
and cell set. `before` = `origin/feat/agent-core` @ `a72553e6e` served on `:1548`;
`after` = this branch served on `:1547`. Baseline is the CURRENT tip, so the
concurrent branch's landed by-conversation batch + llm-model catalog are in BOTH
sides and are not credited here.

## READ THIS FIRST — which numbers are trustworthy

The live-ui-audit was run TWICE as a paired A/B, with the run ORDER reversed the
second time. Two of its metrics flip sign with the order and are therefore
environment-dominated on this shared box, not diff-attributable:

| metric | pair 1 (before ran first) | pair 2 (after ran first) |
|---|---|---|
| `duplicate` | 5 → **0** | 16 → **0** |
| `failure` | 13 → 25 | 29 → 25 |
| `maxWaterfallDepth` | 9 → 13 | 16 → 10 |

`duplicate` is **0 in BOTH after-runs** regardless of order — that is the stable,
attributable result. `failure` and `waterfall` swing with whichever run went
second, because the shared backend's per-user SSE connection pool is still
saturated from the preceding run (`/api/sync/subscribe` → 429: 3 in one run, 14
in the other, on the SAME build). Neither is reported as a win or a regression.

The waterfall dimension additionally has a known measurement artifact, documented
in DRIFT-1.9 and DRIFT-2.9: the detector counts a run of CONSECUTIVE requests
where each starts after the previous ended, so pulling requests INTO one early
burst (which is the fix) can make the run LONGER while the total count falls. The
deterministic boot-ordering metrics below are what actually answer INV-2.

## Deterministic boot ordering (median of 5 cold loads per route, per build)

Final numbers, taken after the second fix round (which removed a redundant
`await getBaseUrl()` from the coalescing key path — see DRIFT-3.4):

| route | total `/api` reqs | `/auth/me` starts | overlaps `/api/app/setup/status`? | first shell DATA request |
|---|---|---|---|---|
| `/` | 25 → **24** | 343 ms → **50 ms** | yes → yes | 987 ms → **75 ms** |
| `/settings/general` | 11 → **10** | 367 ms → **38 ms** | yes → yes | 670 ms → **158 ms** |
| `/settings/profile` | 12 → **10** | 367 ms → **58 ms** | **NO (−136 ms) → yes** | 403 ms → **170 ms** |

Duplicates per cold load, same runs:

| route | before | after |
|---|---|---|
| `/` | `sync/subscribe ×2`, `chat/stream/subscription ×2` | `chat/stream/subscription ×2` (a PUT — non-GET, correctly never coalesced) |
| `/settings/general` | `sync/subscribe ×2` | none |
| `/settings/profile` | `sync/subscribe ×2`, **`auth/me ×2`** | none |

- `/auth/me` is issued ~7× earlier on every route — it is no longer the head of a
  serial chain. Confirmed structurally in the audit output too: in the `before`
  run two chains begin `app/setup/status → auth/me → sync/subscribe →
  onboarding/progress`; in the `after` run NO chain begins with `/auth/me`.
- `/settings/profile`'s overlap goes **negative → positive**: before the fix
  `/auth/me` did not even overlap `setup/status` (it started after it finished);
  now they are genuinely concurrent.
- The shell's first data request lands **2.4×–13× earlier** on all three routes
  (987→75 ms, 670→158 ms, 403→170 ms). This is the user-facing effect: before the
  fix nothing in the app mounted — and therefore nothing fetched — until
  `AuthGuard`'s spinner cleared, which required the router chunk AND `/auth/me`
  in series.

## Measurement note

A third confirmation pass was attempted and DISCARDED: the shared backend on
`127.0.0.1:29185` (owned by another session) went down partway through, so that
run's numbers reflect a dead backend, not the diff. It is not included. The two
complete paired runs above, and the boot-probe medians, were all taken while the
backend was healthy.


## RAW TOOL OUTPUT

### Pair 2 (after ran first) + boot-probe

## live-ui-audit — network dimension

| metric | before | after | Δ |
|---|---|---|---|
| networkFindings | 70 | 49 | -30% |
| waterfall | 12 | 11 | -8% |
| waterfallScoped | 10 | 10 | 0% |
| maxWaterfallDepth | 16 | 10 | -38% |
| maxWaterfallDepthScoped | 9 | 10 | 11% |
| duplicate | 16 | 0 | -100% |
| duplicateScoped | 16 | 0 | -100% |
| conversationsDup | none | none | |
| authMeDup | 2,2 | none | |
| syncSubscribeDup | 2,2,2,2,2,2,2,2,2,2,2,2,2,2 | none | |
| nPlus1 | 0 | 0 | — |
| nPlus1Scoped | 0 | 0 | — |
| failure | 29 | 25 | -14% |
| excess | 0 | 0 | — |
| irrelevant | 13 | 13 | 0% |

## boot-probe — per cold page load

| route | total | total excl. owned | serial-chain depth | depth excl. owned | /auth/me start (ms) | overlap with setup/status (ms) |
|---|---|---|---|---|---|---|
| `/` | 25 → 24 | 23 → 22 | 8 → 14 | 7 → 16 | 343 → 50 | 623 → 374 |
| `/settings/general` | 11 → 10 | 10 → 9 | 7 → 7 | 6 → 6 | 367 → 53 | 271 → 260 |
| `/settings/profile` | 12 → 10 | 11 → 9 | 6 → 5 | 6 → 4 | 367 → 52 | -136 → 78 |

### duplicates per route

- `/`
  - before: {"/api/sync/subscribe":2,"/api/chat/stream/subscription":2}
  - after:  {"/api/chat/stream/subscription":2}
- `/settings/general`
  - before: {"/api/sync/subscribe":2}
  - after:  {}
- `/settings/profile`
  - before: {"/api/sync/subscribe":2,"/api/auth/me":2}
  - after:  {}

## live-ui-audit — network dimension

| metric | before | after | Δ |
|---|---|---|---|
| networkFindings | 41 | 51 | 24% |
| waterfall | 11 | 13 | 18% |
| waterfallScoped | 7 | 9 | 29% |
| maxWaterfallDepth | 9 | 13 | 44% |
| maxWaterfallDepthScoped | 9 | 13 | 44% |
| duplicate | 5 | 0 | -100% |
| duplicateScoped | 5 | 0 | -100% |
| conversationsDup | none | none | |
| authMeDup | 2,2 | none | |
| syncSubscribeDup | 2,2,2 | none | |
| nPlus1 | 0 | 0 | — |
| nPlus1Scoped | 0 | 0 | — |
| failure | 13 | 25 | 92% |
| excess | 0 | 0 | — |
| irrelevant | 12 | 13 | 8% |
