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

- `gate:ui (ui): PASS`
- `gate:ui (desktop/ui): PASS`

```
# src-app/ui        → 177/177 surfaces PASS, runtime-health HIGH 0 gating
# src-app/desktop/ui →  51/51  surfaces PASS, runtime-health HIGH 0 gating
CHOKIDAR_USEPOLLING=1 GALLERY_PORT=7471 npm run gate:ui -- --skip-visual   # ui
CHOKIDAR_USEPOLLING=1                   npm run gate:ui -- --skip-visual   # desktop/ui
```

**`CHOKIDAR_USEPOLLING=1` is load-bearing on this box, and finding that out took
four red runs — recorded so nobody repeats it.** Without it the gate failed
non-deterministically with a different surface set every time (4 surfaces, then
10, then 2), and twice the gallery server did not come up at all. The cause is not
this diff and not the app: this host is at its **inotify instance ceiling**
(`/proc/sys/fs/inotify/max_user_instances = 128`, with ~30 worktrees running Vite
watchers), so Vite dies with `EMFILE: too many open files, watch …` while creating
its watcher. The visible symptom is the `net::ERR_NETWORK_CHANGED` /
"Failed to fetch dynamically imported module" cascades that dominated those runs.
Polling avoids inotify entirely.

Cross-checked against the unmodified base before the cause was understood: a base
worktree at `origin/feat/agent-core` (own `npm install`) failed the same gate with
the same class of unrelated seeded surfaces (`seeded-hardware-no-gpu`,
`seeded-file-rag-error`, `knowledge`, `hub`), confirming the failures were never
attributable to this branch. Log: `chat-send-resilience-gateui-BASE{,2}.log`.

## Not applicable

- **A9 / A10 (permission tests)**: this branch introduces no permission — no
  `modules/*/permissions.rs` change, no migration grant (DEC-8).
- **Backend integration tests**: no backend file is touched.
- **`check:state-matrix`**: no new conditional render state; the regenerated
  matrix carries only line-number drift from one added import in `registry.tsx`,
  regenerated and committed.
