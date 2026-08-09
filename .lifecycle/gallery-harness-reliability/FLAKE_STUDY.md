# FLAKE_STUDY — D2, the unstable failing set (TEST-12 / ITEM-6)

INV-2 says: *"Mechanism is unknown — investigate before fixing. First establish
the flake rate: run the same commit N times and record failing-set membership."*
This is that measurement. **No D2 fix was designed before it existed**, and the
result changed the answer.

## Headline

**D2 REPRODUCES, and it is INDEPENDENT of D1/D3.** Two runs of the same commit,
on the same box, against the same Vite server, both fully VALID by the new
validity gate (`248/248` cells, origin alive, **0 transport artifacts, 0%**),
disagreed on the failing set:

| run | findings | cells | origin | transport artifacts | gating HIGH | failing surfaces |
|---|---|---|---|---|---|---|
| flake2/run01 | 208 | 248/248 | alive (46 probes) | **0 (0%)** | **8** | `seeded-file-rag-error` (6), `seeded-s3-version-models-failed` (2) |
| flake2/run02 | 204 | 248/248 | alive (44 probes) | **0 (0%)** | **2** | `seeded-s3-version-models-failed` (2) |

- **Stable:** `seeded-s3-version-models-failed` — 2/2 runs, identical count.
- **Flaky:** `seeded-file-rag-error` — 1/2 runs, 6 findings or 0.
- Flake rate on this sample: **1 of 2 failing surfaces (50%) is unstable**, and
  the gating-HIGH count moved **8 → 2** between two runs that are byte-identical
  in input.

This matches the owner's original table, which showed `seeded-file-rag-error`
appearing in exactly one of three runs.

## Why this is the load-bearing result

Both runs pass the owner's stated validity gate (`ERR_NETWORK_CHANGED` ≈ 0 — here
*all* transport artifacts are 0), so neither can be dismissed as contaminated.
That rules out the hypothesis this branch was otherwise converging on: the
`run-key.mjs` doc-comment attributes "failing surface sets that differ run to run"
to the same cross-worktree port collision as D1, and DRIFT-1.3 took that
seriously. **The measurement falsifies it.** With the origin verifiably stable and
zero transport noise, the failing set still moved. So:

- The **host lock (D3)** and the **run-validity gate (D1)** do NOT fix D2.
- A `--repeat`-based reproduce-to-gate mechanism (INV-2's second named option) is
  therefore genuinely required, not a symptom-patch over something already fixed.

Had the mechanism been built before this measurement, it would have been built on
the assumption it was redundant — or skipped for the same reason. This is exactly
what "investigate before fixing" is for.

## What the unstable findings ARE

Every unstable finding is a React console error on a **seeded** surface. From the
full-crawl baseline (`flake/run01.jsonl`) the two recurring texts are:

```
Internal React error: Expected static flag was missing. Please notify the React team.
Each child in a list should have a unique "key" prop.
```

Two observations worth recording, neither yet proven:

1. **`Internal React error: Expected static flag was missing`** is a React
   *internal* consistency error, characteristic of a hook-order / concurrent-render
   inconsistency. That is inherently timing-sensitive, which fits a failing set
   that moves without any input changing.
2. **The React key warning arrives on the `console.error` channel**, so it is
   classified `console-error` at **HIGH** — even though `runtime-health`'s own
   taxonomy lists `unique "key" prop` under `REACT_WARNING` at MEDIUM. That branch
   only applies when `msg.type() === 'warning'`, and React 19 emits warnings
   through `console.error`. So a warning the harness intends to be MEDIUM is
   gating as HIGH. This is a **separate, independent defect** found by this study;
   it is NOT fixed here (it changes what the gate reports for every surface, which
   deserves its own change), and it is recorded in HUMAN_FEEDBACK for the owner.

Load correlates with the count: run01 (8 gating HIGH) ran while two audit
sub-agents were saturating the box; run02 (2) ran after they finished. That is
consistent with a render-timing dependence but is **one observation, not a
result** — flagged as a lead, not a conclusion.

## Honest limits of this study

- **N = 2 valid runs**, not the N ≥ 5 the plan budgeted. Two earlier attempts were
  abandoned for stated reasons rather than quietly dropped:
  - the first (`flake/`) had run02 **invalidated by my own edit** to a file in the
    gallery's Vite module graph mid-crawl (538 `ERR_ABORTED`; DRIFT-1.4b) — the
    study taught the operating rule that is now in CLAUDE.md;
  - the second was stopped because continuing would have run **edited harness
    code**, making later runs non-comparable to earlier ones.
  A 2-run sample is enough to establish *that* the set is unstable (one
  disagreement on identical input proves it) but **not** enough to estimate a
  rate. The "50%" above is a description of this sample, not a measurement of the
  system.
- **Scope:** `--only-kinds=seeded` (248 of 682 cells). Justified because every
  instability observed here and in the owner's table is on seeded surfaces, but it
  means a flaky non-seeded surface would not have been seen.
- The box was **not quiet**: the explorer fleet was running throughout, and audit
  sub-agents during run01. The owner offered to pause the fleet; that offer was
  not taken up, because the validity gate showed both runs clean and the fleet's
  contribution is bounded by that. A quiet-box repeat would still be worth doing.

## Recommendation (NOT implemented — see DRIFT-1.8)

Implement `--repeat=N` + reproduce-to-gate exactly as PLAN ITEM-7/8/9 describe:
run the crawl N times in one invocation, key findings by
`(surface, state, theme, category, normalizedDetail)` — `normalizeDetail` already
strips the volatile port and `?t=` timestamp, so cross-run identity is stable — and
gate a HIGH only when `runs_seen === runs_total`. Emit anything less as
`flaky: true`, subtracted from the gating total like `baselined`/`harness`, and
surfaced in its own rollup section so the gate can say "new failure" and "flaky
failure" as different things.

Separately, investigate the React-key-warning severity misclassification above; it
inflates gating HIGHs on every surface and is likely a meaningful share of what
made this gate feel unreliable.

---

# Re-measurement (TEST-36) — after the React-warning severity fix (ITEM-23)

Run on a **fleet-paused** box (0 explorers; the rig stayed up on :1520 but was not
driven), on a dedicated port `:1731` bind-checked free, with this worktree's own
`node_modules` and `.vite` dropped first. Both runs use the same scope as flake2
(`--report-only --only-kinds=seeded`, 248 cells) so the numbers are comparable.

## Validity FIRST (the owner's gate)

| run | ERR_NETWORK_CHANGED | transport artifacts | cells | origin | verdict |
|---|---|---|---|---|---|
| flake3/run01 | **0** | **0 (0%)** | 248/248 | alive (51 checks) | VALID |
| flake3/run02 | **0** | **0 (0%)** | 248/248 | alive (48 checks) | VALID |

Neither run is dismissible. Contention caveat, stated rather than hidden: the box
was not fully quiet — two other agents (`wt-notif-popover`, `wt-filerag-hooks`)
were mid-run and ~36 chromium processes remained after the pause. The port was
chosen and verified free specifically because a foreign-worktree port collision is
one of D1's three reproducing triggers. With 0 transport artifacts in both runs,
a collision is ruled out for THESE runs; general CPU contention is not, and is a
live confounder for the load-correlated behaviour below.

## Result — D2 STILL REPRODUCES

| run | findings | gating HIGH | failing surfaces |
|---|---|---|---|
| flake3/run01 | 195 | **1** | `hardware-monitor` (1) |
| flake3/run02 | 200 | **0** | — none |

**Two VALID runs, identical input, disagree.** Per the owner's framing this is the
stronger of the two possible answers: D2 is a **confirmed defect, independent of
D1/D3/D4 and independent of the misclassification**. It does NOT reopen the
approved descope (DEC-D2).

## What the fix DID change — and it is not a stability win

The misclassification was **the entirety of the previously "stable" failing
surface**. `seeded-s3-version-models-failed` failed in 2/2 flake2 runs; its two
findings were both `Each child in a list should have a unique "key" prop` from
`VersionModelsBlock`. In flake3 those same two findings are still RECORDED, now at
**MEDIUM** — correctly, per the harness's own taxonomy — and the surface no longer
gates. That is the fix working exactly as intended, verified in the run data
(`react key-warnings recorded: 2 -> severities: ['MEDIUM']` in both runs).

But the instability did not shrink; it changed KIND, and got more visible:

- **Before** the fix: 8 vs 2 gating HIGH — both runs FAIL. Instability was
  *count*-visible only; the verdict agreed.
- **After** the fix: 1 vs 0 gating HIGH — run01 **FAILS**, run02 **PASSES**.
  Instability is now **verdict-visible**.

This is an honest gate and a worse-looking one. Removing the constant background
of misclassified HIGHs did not stabilise the verdict; it removed the floor that
was masking the flip. Reporting it as "the gate got more reliable" would be false.

## The disagreeing finding is the SAME product-defect family, on a NEW surface

flake3/run01's single gating HIGH:

```
[hardware-monitor | seeded | light] console-error
Internal React error: Expected static flag was missing. Please notify the React team.
```

That is the second of the two recurring texts flake2 recorded, and it is the
mount-time face of the same hook-count instability as flake2's
`Rendered more hooks than during the previous render` (a missing passive-effect
static flag is what React reports when a component's hook set differs between the
mount and the next render).

Independent corroboration of the mechanism, from a different direction: the
component behind flake2's crash was traced to shared shell code reading
`appLayoutSeam.peek()?.nativeScroll` — an optional chain over a call result, so
the store proxy's get-trap (2 hooks) either runs or short-circuits (0 hooks)
depending on whether the `app-layout` chunk has landed. **`HardwareMonitor.tsx:147`
renders `DivScrollY`** — the very component carrying that read
(`sdk/packages/shell/src/components/DivScrollY.tsx:34-36`) — and, like
`seeded-file-rag-error`, it is a lazy component whose seeded `setup` forces a
second render pass. Two different surfaces, one shared mechanism.

So the re-measurement supports, and does not weaken, the reading that **the
harness is faithfully reporting a genuinely nondeterministic PRODUCT defect**.
The defect is in `sdk/packages/shell`, affects any surface using
`DivScrollY`/`SettingsPageContainer`, and is owned elsewhere
(`wt-filerag-hooks`); it is deliberately NOT fixed on this branch.

## What this says about the descope, restated

A reproduce-to-gate would require a finding to occur in EVERY run before it gates.
Applied to flake3, it would have suppressed the `hardware-monitor` React internal
error (1 of 2 runs) — and applied to flake2, the `seeded-file-rag-error`
ErrorBoundary crash (1 of 2 runs). In the only two samples that exist, the
mechanism would have suppressed exactly the real product defects and retained only
the misclassified warning. The descope is right.

## Honest limits

- **N = 2 valid runs**, again. Enough to prove the set is unstable (one
  disagreement on identical input does that); NOT enough to estimate a rate. No
  percentage is claimed.
- Scope is `--only-kinds=seeded` (248 of 682 cells); a flaky non-seeded surface
  would not have been seen.
- CPU contention from the two still-running agents could not be excluded, and the
  behaviour is load-correlated, so run01-vs-run02 ordering may not be neutral.
- `seeded-file-rag-error` gated in NEITHER flake3 run, having gated in 1 of 2
  flake2 runs. Consistent with load-dependence on a quieter box, but with N=2 that
  is an observation, not a measurement.
