# gate:ui — recorded with its own exit code and validity

`npm run gate:ui` was run TWICE on the branch. The first run is recorded and
DISCARDED, because a discarded run is a result too.

## Run 1 — VOID, discarded (not a pass, not a fail)

```
  validity: 682/682 cells · origin alive (133 checks) · transport artifacts 836 (75.6% of findings)
❌ RUN VOID — these findings do not describe the product:
   · 836 of 1106 findings (75.6%) are transport artifacts (836 failed requests …)
❌ visual — skipped — the runtime crawl was not usable
❌ GATE FAILED — runtime-health, visual
GATE_AFTER_EXIT=1
```

`ERR_NETWORK_CHANGED` count in `RUNTIME_FINDINGS.jsonl`: **0**. The artifacts were
`net::ERR_ABORTED` on the Vite dev server's own module fetches — a second worktree
(`/data/pbya/cytoanalyst/tmp/export-pane-wt`) was running its own `runtime-health`
concurrently and the origin could not keep up. The gate detected this itself and
refused to produce a verdict, which is the correct behaviour. **This run tells us
nothing about the branch and is not reported as a result.**

## Run 2 — VALID, and the recorded result

```
✅ tsc — clean
✅ lint — clean
=== runtime-health: 400 findings (HIGH 0 gating + 2 harness-noise + 2 baselined / MEDIUM 102 / LOW 294) ===
  validity: 682/682 cells · origin alive (108 checks) · transport artifacts 0 (0% of findings)
  0 surface(s) with gating HIGH findings
✅ runtime-health — 162 surfaces clean
✅ visual — 30 passed

--- per-surface runtime verdict: 162/162 PASS ---
   ✅ all surfaces runtime-clean

=== gate summary ===
  PASS  tsc
  PASS  lint
  PASS  runtime-health
  PASS  visual

✅ GATE PASSED — every UI DONE criterion met
GATE_EXIT=0
```

Validity, per the rule that any bad-validity run is void: **682/682 cells, origin
alive, 0 transport artifacts (0%), `ERR_NETWORK_CHANGED` count 0.**

## A7 line

```
gate:ui (ui): PASS
```

The zero-findings form applies (0 gating HIGH), so no base comparison is required
— a branch with zero findings cannot be worse than any base. The exit code is the
gate's own (`GATE_EXIT=0`, captured on its own line rather than through a pipe, so
this is not a `tail`-status artifact).
