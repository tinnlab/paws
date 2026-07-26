
## live-ui-audit — network dimension

| metric | before | after | Δ |
|---|---|---|---|
| networkFindings | 115 | 60 | -48% |
| waterfall | 14 | 12 | -14% |
| waterfallScoped | 5 | 6 | 20% |
| maxWaterfallDepth | 24 | 20 | -17% |
| maxWaterfallDepthScoped | 23 | 20 | -13% |
| duplicate | 35 | 4 | -89% |
| duplicateScoped | 19 | 1 | -95% |
| conversationsDup | none | none | |
| authMeDup | 2,2 | none | |
| syncSubscribeDup | 2,2,2,2,2,2,2,2,2,2,2,2,2,2 | none | |
| nPlus1 | 14 | 14 | 0% |
| nPlus1Scoped | 0 | 0 | — |
| failure | 39 | 17 | -56% |
| excess | 0 | 0 | — |
| irrelevant | 13 | 13 | 0% |

## boot-probe — per cold page load

| route | total | total excl. owned | serial-chain depth | depth excl. owned | /auth/me start (ms) | overlap with setup/status (ms) |
|---|---|---|---|---|---|---|
| `/` | 43 → 42 | 21 → 20 | 10 → 15 | 7 → 7 | 361 → 71 | 708 → 982 |
| `/settings/general` | 29 → 28 | 10 → 9 | 9 → 6 | 6 → 6 | 366 → 77 | 154 → 496 |
| `/settings/profile` | 30 → 28 | 11 → 9 | 9 → 10 | 7 → 6 | 377 → 63 | -169 → 141 |

### duplicates per route

- `/`
  - before: {"/api/projects/by-conversation/{id}":19,"/api/sync/subscribe":2,"/api/llm-models":3,"/api/chat/stream":1}
  - after:  {"/api/projects/by-conversation/{id}":19,"/api/chat/stream":1,"/api/llm-models":3}
- `/settings/general`
  - before: {"/api/projects/by-conversation/{id}":19,"/api/sync/subscribe":2}
  - after:  {"/api/projects/by-conversation/{id}":19}
- `/settings/profile`
  - before: {"/api/projects/by-conversation/{id}":19,"/api/sync/subscribe":2,"/api/auth/me":2}
  - after:  {"/api/projects/by-conversation/{id}":19}
