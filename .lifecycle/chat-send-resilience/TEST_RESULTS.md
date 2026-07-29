# TEST_RESULTS — chat-send-resilience

Every line below is a result I observed. Full logs under
`/data/pbya/ziee/tmp/lifecycle-logs/chat-send-resilience-*.log`.

Final run commands:

```bash
# unit — node:test (45) + vitest (22)
cd src-app/ui
node --import ./scripts/node-test-loader.mjs --test \
  src/api-client/lazy-dispatch.test.ts src/api-client/chunk-recovery.test.ts \
  src/api-client/shared-infra.test.ts \
  src/modules/chat/core/extensions/composeRequestFields.test.ts \
  src/modules/chat/core/extensions/requestFieldFailure.test.ts \
  src/main.entry-wiring.test.ts                       # → pass 45 / fail 0
npx vitest run src/modules/chat/core/stores/chat/sendMessage.store.test.ts
                                                      # → 22 passed (22)
# e2e — real backend + real production build via vite preview
npx playwright test tests/e2e/chat/send-field-composition-failure.spec.ts --workers=1
                                                      # → 4 passed (3.1m)
```

## Unit

- **TEST-1**: PASS
- **TEST-2**: PASS
- **TEST-3**: PASS
- **TEST-4**: PASS
- **TEST-5**: PASS
- **TEST-6**: PASS
- **TEST-7**: PASS
- **TEST-8**: PASS
- **TEST-9**: PASS
- **TEST-10**: PASS
- **TEST-11**: PASS
- **TEST-12**: PASS
- **TEST-16**: PASS
- **TEST-18**: PASS
- **TEST-19**: PASS
- **TEST-20**: PASS
- **TEST-21**: PASS

## E2E (`--workers=1`, real backend, real provider + model seeded)

- **TEST-13**: PASS
- **TEST-14**: PASS
- **TEST-15**: PASS
- **TEST-17**: PASS

## Frontend gate

- `npm run check (ui): PASS`
- `npm run check (desktop/ui): PASS`

## UI runtime canary (A7)

- `gate:ui (ui): FAIL — 2 gating-HIGH surfaces, BOTH reproduced on the unmodified base`

This line is recorded as observed rather than as required. The measurement:

| run | tree | gating-HIGH surfaces |
|---|---|---|
| branch (clean, `GALLERY_PORT=7451`) | `HEAD` | `seeded-file-rag-error` (6), `seeded-hardware-no-gpu` (1) |
| base (clean, `GALLERY_PORT=7421`) | `origin/feat/agent-core` in its own worktree | `seeded-hardware-no-gpu` (1) |
| base (2nd, `GALLERY_PORT=7431`) | same | `seeded-file-rag-error` (3), `knowledge`, `hub` |

Both surfaces still failing on the branch appear on the **unmodified base**, and
neither is touched by this diff (`seeded-file-rag-error` is a file-RAG gallery
fixture raising "Rendered more hooks than during the previous render";
`seeded-hardware-no-gpu` raises React's "Expected static flag was missing"). The
runs are also unstable in this environment: two branch runs and two base runs each
produced a DIFFERENT failing set, with the large ones dominated by
`net::ERR_NETWORK_CHANGED` cascades from stale worktree Vite servers. `tsc`,
`lint` and `visual` are PASS in every run; only `runtime-health` fails, and it
fails on the base too.

**This is therefore classified as a pre-existing, environment-flaky gate, not a
regression from this branch** — but it is recorded as FAIL rather than written as
PASS, because I did not observe a PASS. The orchestrator should treat the A7 line
as the one outstanding gate and decide whether the base-comparison evidence
discharges it.

## Not applicable

- **A9 / A10 (permission tests)**: this branch introduces no permission — no
  `modules/*/permissions.rs` change, no migration grant (DEC-8).
- **Backend integration tests**: no backend file is touched.
- **`check:state-matrix`**: no new conditional render state; the regenerated
  matrix carries only line-number drift from one added import in `registry.tsx`,
  regenerated and committed.
