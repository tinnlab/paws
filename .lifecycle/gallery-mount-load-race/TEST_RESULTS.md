# TEST_RESULTS

All runs on `origin/main` @ `dca29493f`, sdk `0ba62538`, in a dedicated worktree
with its own hardlinked `node_modules` (never a shared/symlinked one) and
`node_modules/.vite` dropped.

- **TEST-1**: PASS — baseline measured on unmodified main, 110 runs:
  30 sequential -> `=== BASELINE: 0 / 30 FAILED ===`;
  80 under 8-way self-contention -> `worker 6: 1/10 failed`, all others 0/10.
  **Baseline failure rate 1/110 (0.9%); under contention 1/80 (1.25%);
  uncontended 0/30.** Classification over all 229 captured logs:
  `hook-order msgs: 0`, `static-flag msgs: 0`, `timeouts: 1`. The single failure
  is `Error: Test timed out in 5000ms.` The reported hook-order signature
  ("Rendered more hooks…") did not occur once.
  Supporting distributions: 12 cold-`.vite` runs 0/12; full component suite
  (`npm run test:component`) 0/10.
- **TEST-2**: PASS — FB-11 probed where it is live. Gallery served on a private
  bind-checked port `:21777`; `runtime-health.mjs --report-only
  --only-match=file-rag` (8 cells x 2 themes) run 20x. Every run:
  `HIGH 0 gating`, 0 hook messages. Validity line clean
  (`8/8 cells · origin alive · transport artifacts 0 (0%)`).
  FB-11 refuted as the cause; see DEC-2.
- **TEST-3**: PASS — instrumented `createStoreProxy` path probe, 40 runs, 0
  flips. Positive control asserted and green:
  `PROBE_OBSERVED 12 (store,prop) pairs; reactive=12 action=0 nested=0`
  (a vacuous "no flips" over 0 observations would have failed). Probe reverted;
  `sdk/` working tree clean.
- **TEST-4**: PASS — deterministic red/green at `--testTimeout=2000`:
  PRE-fix `Error: Test timed out in 2000ms.` / `Tests 2 failed | 1 passed (3)`,
  `exit=1`; POST-fix `Tests 3 passed (3)`, exit 0. Mechanism pinned.
- **TEST-5**: PASS — post-fix rate over the IDENTICAL baseline conditions,
  110 runs: `=== POST-FIX SEQUENTIAL: 0 / 30 FAILED ===` and 8x10 contended,
  every worker `0/10 failed`, 0 timeout logs. **Post-fix failure rate 0/110.**
  Margin, measured under the same 6-way contention as the baseline profile:
  pre-fix first test `n=36 min=3656 p50=3921 p90=4128 max=4292` ms;
  post-fix `n=36 min=375 p50=453 p90=545 max=605` ms, against a 5000ms timeout.
- **TEST-6**: PASS — `npm run test:component` -> `Test Files 9 passed (9)`,
  `Tests 118 passed (118)`; `npx tsc --noEmit` -> `tsc exit=0`.

## Honest scope limits

- The gallery probe (TEST-2) was scoped to the file-rag surfaces
  (`--only-match=file-rag`, 8 cells x 2 themes), i.e. the surface named in the
  brief. The 248-cell `--only-kinds=seeded` crawl that the earlier D2 flake study
  used was NOT re-run here, so this branch says nothing about a residual D2 on
  other surfaces; DEC-D2's approved descope is untouched.
- The baseline's 1/110 is lower than the 1-in-5 in the brief. That brief figure
  came from a 5-run sample; a 5-run sample cannot distinguish 20% from 1%. The
  measurement here (n=110, plus 119 further captured runs) is the stronger
  estimate, and it re-classifies the failure signature.
