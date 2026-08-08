# TEST_RESULTS — gallery-harness-reliability

Every number below is transcribed from a real run's own output and exit code.
Logs: `/data/pbya/ziee/tmp/lifecycle-logs/`.

## Gate commands (exit codes captured with `set -o pipefail`)

```
npm run check (ui): PASS                     # exit 0
npm run check:harness-parity (desktop/ui): PASS   # exit 0
npm run test:gallery-scripts (ui): PASS      # 99 tests, 99 pass, 0 fail — exit 0
npm run test:gallery-scripts (desktop/ui): PASS   # 56 tests, 56 pass, 0 fail — exit 0
npm run test:gate-ui-stale (ui): PASS        # exit 0
npm run check:testid-registry (ui): PASS     # 1778 ids — exit 0
npm run check:testid-registry (desktop/ui): PASS  # 1778 ids — exit 0
```

`npm run check` in the ui workspace now includes `check:harness-parity`,
`test:gallery-scripts` and `test:gate-ui-stale`; desktop's includes
`check:harness-parity` and `test:gallery-scripts`. **B6 verified**: with
`.lifecycle/` moved aside, all three new gates still exit 0 — none reads a
lifecycle artifact.

## A7 — boot/runtime canary, baseline-controlled

```
gate:ui (ui): branch 1 vs base 3
```

Both runs, same worktree, same box, `--skip-visual`, full 682-cell crawl:

| | base (origin/main code) | branch |
|---|---|---|
| cells | 682/682 | 682/682 |
| findings | 531 | 477 |
| gating HIGH | 4 | 2 |
| failing surfaces | **3** | **1** |
| `ERR_NETWORK_CHANGED` | **0** | **0** |
| any `net::ERR` | **0** | **0** |
| run manifest | (none — feature not present) | `complete: true`, `void: false`, `originChecks: 98` |

Gate exit code: **1** on both — captured from `${PIPESTATUS[0]}`, not from a
pasted tail. The gate FAILS on both because `seeded-s3-version-models-failed`
carries 2 real React errors; that surface is a PRE-EXISTING product defect on
`origin/main`, not something this branch introduced, and this branch does not
claim to fix it.

**Honest reading of "3 → 1".** The two surfaces that dropped out
(`seeded-hardware-monitor-error`, `seeded-s5-project-form-loading`) are exactly
the ones FLAKE_STUDY.md shows to be UNSTABLE. So the improvement is **not**
attributable to this branch — it is the D2 flakiness, measured and still
unfixed. A7 requires only "branch no worse than base", which holds (1 ≤ 3). I am
not claiming a runtime improvement, and a single-run comparison of a knowingly
unstable metric would not support one.

**Validity gate (the owner's rule): PASS.** Both runs report `0` transport
artifacts, so no conclusion here rests on a contaminated measurement.

## Acceptance tests (design invariants)

- **TEST-1** (INV-1): PASS — `lib/finding-classify.test.mjs`, 17/17.
- **TEST-2** (INV-2): PASS **for the invariant's FIRST clause only** — the
  investigation is done and recorded (FLAKE_STUDY.md). The SECOND clause (the
  reproduce-to-gate mechanism) is **NOT implemented**; see DESIGN_FIDELITY INV-2
  and HUMAN_FEEDBACK FB-5. Recorded here as half-met rather than as PASS.
- **TEST-3** (INV-3): PASS — CONCURRENCY_PROOF.md, two real worktrees.
- **TEST-4** (INV-4): PASS — `gate-ui.stale.e2e.mjs`, spawning the real gate.
- **TEST-5** (INV-5): PASS — `gen-testid-registry.test.mjs`, 18/18.
- **TEST-6** (INV-6): PASS — `check-harness-parity.test.mjs`, 6/6.

## Per-TEST results

- **TEST-1**: PASS · **TEST-2**: PARTIAL (first clause only — see above)
- **TEST-3**: PASS · **TEST-4**: PASS · **TEST-5**: PASS · **TEST-6**: PASS
- **TEST-7**: PASS · **TEST-8**: PASS · **TEST-9**: PASS · **TEST-10**: PASS
- **TEST-11**: PASS · **TEST-12**: PASS · **TEST-13**: PASS · **TEST-14**: PASS
- **TEST-15**: PASS · **TEST-16**: PASS · **TEST-17**: PASS · **TEST-18**: PASS
- **TEST-19**: PASS · **TEST-20**: PASS · **TEST-21**: PASS · **TEST-22**: PASS
- **TEST-23**: PASS · **TEST-24**: PASS · **TEST-25**: PASS · **TEST-26**: PASS
- **TEST-27**: PASS · **TEST-28**: PASS · **TEST-29**: PASS · **TEST-30**: PASS
- **TEST-31**: PASS

## Red-then-green, verbatim

**D5 — the old text scanner on the acceptance fixture (RED):**
```
OLD text scan yields: ["${CONST}-row","phantom-from-jsdoc","phantom-from-line-comment",
                       "phantom-from-warning-comment","real-attribute-id"]
PHANTOMS HARVESTED: 4     REAL IDS MISSED: 1 ('real-fallback-id')     EXIT=1
```
**GREEN:** the AST collector returns exactly `['real-attribute-id','real-fallback-id']`.
Registry delta on the real trees: `-3` phantoms, `+6` real ids (1775 → 1778), each
named in DECISIONS DEC-1.

**D1 — the stated mechanism (DISPROVED):**
```
--- A: page.close(): 0 events        --- C: page.close({runBeforeUnload:false}): 0 events
--- B: context.close(): 0 events     --- D: browser.close() with page open: 0 events
```
The reproducing mechanism instead:
```
--- F: origin DIES after DOMContentLoaded (in-flight import): 3 events
    requestfailed …/m1.js net::ERR_CONNECTION_RESET
    console.error Failed to load resource: net::ERR_CONNECTION_RESET      ← the unmuted twin
    console.error [AppErrorBoundary] Failed to fetch dynamically imported module: …
```

**D3 — two real worktrees (GREEN, with negative control):**
```
• waiting for the gallery host lock — held by pid 222452 (/data/pbya/ziee/wt-harness-fix).
• host lock acquired after 39s
```
Control (`GATE_UI_LOCK=0`): both crawls observed running simultaneously.

**D4 — mutation-verified:** with the refusal branch disabled
(`if (false && !verdictOk.ok)`) the rewritten e2e FAILS (2 assertions, exit 1);
the previous version of that test passed the same mutation (exit 0).

## What is NOT green

- **Phase 3 of the lifecycle gate is RED**, on exactly one thing: ITEM-7/8/9 are
  `[DESCOPED]` without an `[approved: …]` token. That token is the owner's to
  write; fabricating it is the self-certification the gate exists to prevent. See
  HUMAN_FEEDBACK FB-5.
- **`gate:ui` still exits 1** on both base and branch, because
  `seeded-s3-version-models-failed` has a real, pre-existing product defect.
- **D2 is measured, not fixed.**
