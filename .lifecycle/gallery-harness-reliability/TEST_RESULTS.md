# TEST_RESULTS — gallery-harness-reliability

Every number below is transcribed from a real run's own output and exit code.
Logs: `/data/pbya/ziee/tmp/lifecycle-logs/`.

## Gate commands (exit codes captured with `set -o pipefail`)

```
npm run check (ui): PASS                     # exit 0
npm run check (desktop/ui): PASS             # exit 0 (56 gallery-script tests)
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
gate:ui (desktop/ui): PASS
```

The **desktop** gate is the cleaner demonstration, because it PASSES outright:

```
  validity: 318/318 cells · origin alive (55 checks) · transport artifacts 0 (0% of findings)
✅ runtime-health — 51 surfaces clean
--- per-surface runtime verdict: 51/51 PASS ---
✅ GATE PASSED — every desktop UI DONE criterion met            (exit 0)
```

manifest: `cellsCompleted 318/318`, `complete: true`, `void: false`,
`gatingHigh: 0`, contamination `0`. 548 findings, **0 `net::ERR`**. It also
exercised the host lock end-to-end from a SECOND workspace — its crawl registered
as a worker under the same `/tmp/ziee-gate-ui-1000.lock` while the web gate's run
had held it earlier.

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

- **TEST-1**: PASS — lib/finding-classify.test.mjs 17/17 — the muting is narrow in BOTH directions
- **TEST-2**: PARTIAL — PARTIAL — FLAKE_STUDY.md discharges INV-2's investigate-first clause; the reproduce-to-gate MECHANISM is NOT implemented (FB-5)
- **TEST-3**: PASS — CONCURRENCY_PROOF.md — two real worktrees serialized; GATE_UI_LOCK=0 control overlapped
- **TEST-4**: PASS — gate-ui.stale.e2e.mjs — spawns the REAL gate; mutation-verified
- **TEST-5**: PASS — gen-testid-registry.test.mjs — 4 phantoms absent, 2 real ids present, same fixture
- **TEST-6**: PASS — check-harness-parity.test.mjs 6/6 — guard goes RED on a mutated copy
- **TEST-7**: PASS — run-validity.test.mjs TEST-7..7e — real http fixture; one blip does not void
- **TEST-8**: PASS — run-validity.test.mjs TEST-1b..1e + the 1c2 calibration table
- **TEST-9**: PASS — finding-classify.test.mjs TEST-9..9e — product url still gates
- **TEST-10**: PASS — finding-classify.test.mjs TEST-10..10f — same-module corroboration required
- **TEST-11**: PASS — run-validity.test.mjs TEST-11/11b + finding-classify TEST-11
- **TEST-12**: PASS — FLAKE_STUDY.md — 2 VALID runs, 8 vs 2 gating HIGH, membership recorded
- **TEST-13**: PASS — finding-classify.test.mjs TEST-11b + the decoy-substring case
- **TEST-14**: PASS — the full branch gate:ui run — 682/682 cells, validity line reported
- **TEST-15**: PASS — gate-ui.stale.e2e.mjs control leg — a valid run still gets its table
- **TEST-16**: PASS — host-lock.test.mjs TEST-16..16h
- **TEST-17**: PASS — host-lock.test.mjs TEST-17/17b — token inheritance is load-bearing
- **TEST-18**: PASS — host-lock.test.mjs TEST-18/18b/18c — incl. the orphaned-worker case
- **TEST-19**: PASS — run-validity.test.mjs TEST-19 — each refusal names its own cause
- **TEST-20**: PASS — run-validity.test.mjs TEST-20/20b — atomic write, no partial file
- **TEST-21**: PASS — gen-testid-registry.test.mjs TEST-21 — golden set, 3 removed + 6 added by name
- **TEST-22**: PASS — gen-testid-registry.test.mjs TEST-22..22e — value positions, both directions
- **TEST-23**: PASS — gen-testid-registry.test.mjs TEST-23..23c — shape guard throws, names the id
- **TEST-24**: PASS — check:testid-registry exit 0 from BOTH workspace cwds, 1778 ids each
- **TEST-25**: PASS — gen-testid-registry.test.mjs TEST-25 — ts-morph declared
- **TEST-26**: PASS — check:harness-parity exit 0 in both workspaces
- **TEST-27**: PASS — tree-wide grep: no executor of the deleted ui-local copy remains
- **TEST-28**: PASS — test:gallery-scripts exit 0 — ui 99 tests, desktop 56; the formerly-dead ones now run
- **TEST-29**: PASS — CLAUDE.md + agent-kit doc paths all resolve after the deletion
- **TEST-30**: PASS — npm run check exit 0 in both workspaces
- **TEST-31**: PASS — branch 1 vs base 3 failing surfaces, 0 transport artifacts on both

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

---

## Round 2 + 3 results (ITEM-23, ITEM-24)

Real exit codes, captured with `set -o pipefail` (a recorded PASS taken from a
`| tail` is a pipeline artifact, not a result).

- **TEST-32**: PASS — `node --test .../lib/finding-classify.test.mjs` → **26 pass /
  0 fail**. Observed RED first: `SyntaxError: The requested module
  './finding-classify.mjs' does not provide an export named
  'classifyConsoleMessage'`. Mutation-verified afterwards — loose-list-on-error
  25/1, precedence reversed 25/1, channel filter removed 25/1, `errSeverity`
  always-HIGH 25/1, control 26/0.
- **TEST-33**: PASS — parity ENGINE against synthetic fixtures, no consumer path
  in the shared package's test. Per-core removal loop, dead wiring,
  producer/consumer role split, missing copy, unknown core, core-declared-by-none,
  empty cores, unknown role, collected-not-early-returned.
- **TEST-34**: PASS — config contract: absent ⇒ nothing to check; inline array
  resolves against cwd; manifest string resolves against the MANIFEST;
  unreadable and malformed both THROW.
- **TEST-35**: PASS — measured red→green on a STANDALONE checkout of
  `sdk/packages/gallery` with no consumer tree:
  BEFORE `guard exit=1`, 4 violations, package test **3 pass / 3 fail**;
  AFTER `guard exit=0` ("no consumer harness copies configured"), package test
  **12 pass / 0 fail**. In ziee's tree the guard still ENFORCES from BOTH
  workspace cwds: `4 live copies … all 5 behavioural cores`, exit 0.
- **TEST-36**: PASS — D2 re-measured; see FLAKE_STUDY.md § Re-measurement. Both
  runs VALID (ERR_NETWORK_CHANGED **0**, transport artifacts **0 (0%)**,
  248/248 cells, origin alive). **D2 still reproduces**: 1 vs 0 gating HIGH.
  Reported in the direction the evidence went, including that the gate now flips
  PASS/FAIL rather than looking more stable.
- **TEST-6** (acceptance, INV-6): PASS — real-tree half now at
  `src-app/ui/scripts/check-harness-parity.consumer.test.mjs`; 25 pass / 0 fail
  across both halves. Mutation-verified: dropping a core from the manifest →
  guard **exit 1**; a new `runtime-health.v2.mjs` → TEST-6g **red**; deleting
  `harnessCopies` from the desktop config → TEST-6f **red**.

### Frontend gate lines (re-run after the round-3 fixes)

- `npm run check (ui): PASS` — exit 0
- `npm run check (desktop/ui): PASS` — exit 0

---

## Re-scope round — one implementation (ITEM-25), on the REBASED tree

Rebased onto `origin/main e13ee2552` (carries the AppLayout-seam hook-order fix
`62cb8b19b`) with sdk rebased onto `origin/chat 3fe72f3`.
`testIds.generated.ts` regenerated ON TOP of the rebase (the documented remedy for
that collision; the delta was the header count, 1778 → 1781).

- **TEST-37**: PASS — TEST-6h: neither `src-app/ui/scripts/` nor
  `src-app/desktop/ui/scripts/` contains `runtime-health.mjs`/`gate-ui.mjs`, and
  both workspaces' `gallery:runtime` + `gate:ui` invoke
  `sdk/packages/gallery/scripts/`. Mutation-verified by the blind auditor:
  re-adding the actual deleted fork turns TEST-6h AND TEST-6g red; repointing a
  package.json script at a local path turns TEST-6h red. A *renamed* fork
  (`crawl-health.mjs`) is caught by TEST-6g's content walk, not 6h — the pair is
  what carries the invariant, and that is now stated in the test.

- **TEST-38**: PASS — **desktop `gate:ui`, post-unification, exit 0.** The
  distinguishing evidence (F3 exists because this was previously claimed but never
  written down, and the only transcript on file was the deleted fork's):
  ```
  === UI evaluator gate ===            ← shared script (the fork printed "desktop UI evaluator gate")
  ✅ visual — not configured for this app   ← the new visualConfig:null path
  • coverage …
  ✅ coverage — ok                          ← the new gateExtraCmds path
  validity: 318/318 cells · origin alive (63 checks) · transport artifacts 0 (0% of findings)
  ✅ GATE PASSED — every UI DONE criterion met   ← shared string, NOT "every desktop UI DONE criterion met"
  ```

- **TEST-39**: PASS — **web `gate:ui` on the rebased tree, exit 0** (the gate's own
  exit, not a pipeline's):
  ```
  === runtime-health: 371 findings (HIGH 0 gating + 2 harness-noise + 2 baselined / MEDIUM 84 / LOW 283) ===
  --- per-surface runtime verdict: 149/149 PASS ---
  validity: 682/682 cells · origin alive · transport artifacts 0 (0% of findings)
  ✅ GATE PASSED — every UI DONE criterion met
  ```
  **This is the honest post-seam-fix baseline.** The pre-rebase run of the same
  branch failed with 3 gating HIGH on `seeded-file-rag-error` (the hook-count
  crash); that base predated `62cb8b19b`, and the diff touches no product render
  code. With the seam fix present the crash did not fire and the failing set is
  empty. Note what this does NOT show: residual nondeterminism is still expected
  (~1 in 5 on the merged tree), so a single green run is a baseline, not proof of
  determinism.

- **TEST-40**: PASS — the reduced guard still refuses a declared copy that drops a
  core, and the WIRING-not-LOGIC caveat in its output is now asserted (F7: it was
  claimed but unbacked — the note prints only in the `isMain` block, which no unit
  test executes, so the assertion is over the banner source).

### Frontend gate lines (rebased tree, after the testid regen)

- `npm run check (ui): PASS` — exit 0
- `npm run check (desktop/ui): PASS` — exit 0

## Round-7 additions (coverage for the config-driven branches)

- **TEST-41**: PASS — `sdk/packages/gallery/scripts/lib/gallery-config.test.mjs`,
  8 cases: an unknown key is refused naming the key; prototype-chain names
  (`constructor`/`toString`/`hasOwnProperty`/`valueOf`) are refused rather than
  silently accepted; the visual-layer keys this package's OWN
  `playwright/visual.config.ts` documents are accepted; `$`-prefixed comments are
  allowed and the error says so; defaults survive a partial config;
  `visualConfig: null` is legal; a missing file still resolves to defaults; malformed
  JSON throws naming the file.
- **TEST-42**: PASS — `sdk/packages/gallery/scripts/gate-ui.config.e2e.mjs`,
  6 cases spawning the REAL scripts: both entry points refuse a missing config with
  an operator message (asserted NOT to be a stack trace) and exit 2, each with a
  positive control proving "refuses" does not mean "always fails"; a typo'd key
  stops the gate before the crawl; and a DOC-DRIFT check that states in its own body
  that it is not behavioural evidence.
- Both suites wired into `test:gallery-scripts` in **both** workspaces.
  `npm run test:gallery-scripts (ui)`: **150 pass / 0 fail**.

### Frontend gate lines (after round 7)

- `npm run check (ui): PASS` — exit 0
- `npm run check (desktop/ui): PASS` — exit 0
