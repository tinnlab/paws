# RESULTS — net-hygiene, measured before → after

## Protocol

Paired A/B against ONE backend, so the delta is attributable to the frontend diff:

- **before** = `origin/feat/agent-core` @ `a02c09a04` (the current tip), production
  build, served on `:1548`.
- **after** = this branch (that tip merged in), production build, served on `:1547`.
- **backend** = a single instance built FROM THIS BRANCH on `:29185`, seeded with
  one admin + 50 conversations. Its per-IP rate limiter is disabled — the audit's
  settings sweep exhausts the token bucket and would otherwise measure the limiter
  instead of the diff. Both sides talk to that same instance.
- The stale `:1520` deployment was never used.

Because the baseline is the CURRENT tip, the concurrent branch's landed
`POST /api/projects/by-conversations` batch and llm-model coalescing catalog are
in BOTH sides. This branch is credited with neither, and the `n+1` row is 0→0 for
exactly that reason.

## Headline

| what | before | after |
|---|---|---|
| network findings (audit, deduped) | 68 | **31** (−54%) |
| `duplicate` findings | 16 | **1** (−94%) |
| `GET /api/sync/subscribe` duplicates | 14 steps, 2–3× each | **none** |
| `GET /api/auth/me` duplicates | 2 steps × 2 | 1 step × 2 |
| `failure` findings (all `sync/subscribe` → 429) | 26 | **3** (−88%) |
| max waterfall depth | 16 | **12** (−25%) |
| `settings-user` cell, total `/api` requests | 178 | **163** |
| `home` cell, total `/api` requests | 23 | **21** |

## Boot ordering — the INV-2 evidence (median of 5 cold loads per route)

| route | `/auth/me` starts | overlap with `/api/app/setup/status` | longest serial `/api` run |
|---|---|---|---|
| `/` | 360 ms → **62 ms** | **−293 ms → +8 ms** | 20 → **9** |
| `/settings/general` | 350 ms → **69 ms** | **−294 ms → +5 ms** | 9 → **5** |
| `/settings/profile` | 357 ms → **54 ms** | **−295 ms → +1 ms** | 10 → **5** |

The overlap column is the invariant: a NEGATIVE value means `/auth/me` did not
start until after `/api/app/setup/status` had already finished — it was a
dependent successor, on every route. It is now positive everywhere, i.e. the two
are genuinely issued in the same burst. `/settings/profile` also drops from 13 to
10 requests per cold load (the `/me` and `sync/subscribe` duplicates).

## What did NOT move, honestly

- **`n+1`: 0 → 0.** Already fixed on the baseline by the other branch. Untouched
  here by construction (TEST-9).
- **`irrelevant`: 13 → 13.** These are the sidebar's `/api/conversations` on
  settings pages — by design, not a defect this feature addresses.
- **`waterfall` COUNT: 13 → 14** while max DEPTH fell 16 → 12. The detector counts
  a run of consecutive requests each starting after the previous ended, so pulling
  requests into one early burst (the fix) can split one long run into two shorter
  ones. Depth is the meaningful direction; the count is not claimed as a win.
- **Residual `auth/me ×2` on `settings-root`.** From `refreshFromSync` (the
  `sync:session` / `sync:profile` handler). Deliberately NOT suppressed: a
  sync-driven refetch is exactly what INV-1 protects, and an inbound frame bumps
  the freshness epoch precisely so that refetch is real.
- **The `sync/subscribe` 429 itself** is a server-side per-user connection-slot
  defect owned by `feat/sse-slot-leak`. This branch only stopped the CLIENT
  hammering it: 26 refused attempts → 3.

## Raw tool output


## live-ui-audit — network dimension

| metric | before | after | Δ |
|---|---|---|---|
| networkFindings | 68 | 31 | -54% |
| waterfall | 13 | 14 | 8% |
| waterfallScoped | 8 | 12 | 50% |
| maxWaterfallDepth | 16 | 12 | -25% |
| maxWaterfallDepthScoped | 12 | 12 | 0% |
| duplicate | 16 | 1 | -94% |
| duplicateScoped | 16 | 1 | -94% |
| conversationsDup | none | none | |
| authMeDup | 2,2 | 2 | |
| syncSubscribeDup | 3,2,2,2,2,2,2,2,2,2,2,2,2,2 | none | |
| nPlus1 | 0 | 0 | — |
| nPlus1Scoped | 0 | 0 | — |
| failure | 26 | 3 | -88% |
| excess | 0 | 0 | — |
| irrelevant | 13 | 13 | 0% |

## boot-probe — per cold page load

| route | total | total excl. owned | serial-chain depth | depth excl. owned | /auth/me start (ms) | overlap with setup/status (ms) |
|---|---|---|---|---|---|---|
| `/` | 24 → 24 | 22 → 22 | 20 → 9 | 18 → 9 | 360 → 62 | -293 → 8 |
| `/settings/general` | 10 → 10 | 9 → 9 | 9 → 5 | 8 → 4 | 350 → 69 | -294 → 5 |
| `/settings/profile` | 13 → 10 | 12 → 9 | 10 → 5 | 9 → 5 | 357 → 54 | -295 → 1 |

### duplicates per route

- `/`
  - before: {"/api/chat/stream/subscription":2}
  - after:  {"/api/chat/stream/subscription":2}
- `/settings/general`
  - before: {}
  - after:  {}
- `/settings/profile`
  - before: {"/api/auth/me":2,"/api/sync/subscribe":3}
  - after:  {}
