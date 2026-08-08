# Design — gallery harness reliability

**Authority.** This document transcribes the owner's five diagnosed defects in the
shared gallery/testid tooling, verbatim where the wording is load-bearing. There
was no prior design doc for this tooling; the owner's session brief IS the design,
so it is recorded here (per the feature-lifecycle rule: never plan against thin
air). Every non-negotiable below is lifted into `PLAN.md` §Invariants unchanged.

## Context

`npm run gate:ui` is the UI build gate — the machine-enforced exit condition for
every UI surface (CLAUDE.md §"UI Build Gate"). Across a long session it became
unable to adjudicate any branch: its findings were up to 95.5% harness artifacts,
its failing set was unstable across identical inputs, two concurrent runs silently
corrupted each other, and a killed run reported a confident verdict over a
previous run's data. Separately, the shared testid registry generator harvests
phantom ids from comments and template interpolations into a registry every
consumer imports.

The tooling lives in three trees, and they are NOT synced:

| script | `sdk/packages/gallery/scripts/` | `src-app/ui/scripts/` | `src-app/desktop/ui/scripts/` |
|---|---|---|---|
| `runtime-health.mjs` | LIVE — `ui` workspace's `gallery:runtime` + `gate:ui` | present but **DEAD** (no invoker) | LIVE — desktop's `gallery:runtime` |
| `gate-ui.mjs` | LIVE — `ui` workspace's `gate:ui` | absent | LIVE — desktop's `gate:ui` |
| `gen-testid-registry.mjs` | LIVE — **both** workspaces | absent | absent |

A fix applied to one copy does not reach the others.

## D1 — runtime-health gates on cancelled module imports it already knows are noise

`runtime-health.mjs` drives each gallery cell as
`page.goto(url, {waitUntil:'domcontentloaded'})` → `waitForTimeout(settle)` →
`page.close()`. `domcontentloaded` does not await lazy ESM imports, so `close()`
cancels every module request still in flight. Chromium reports each cancellation
TWICE: to `page.on('requestfailed')` AND to `page.on('console')` as
`Failed to load resource: net::ERR_NETWORK_CHANGED`.

`isHarnessNoise()` mutes the first and not the second. `isViteDevAsset()` catches
the `request-failed` twin; `HARNESS_CONSOLE` only matches
`/^Failed to load resource: the server responded with a status of/` — an HTTP-status
mirror. The `net::ERR_*` transport mirror matches nothing, so it survives as a
**gating HIGH**.

Evidence: one loaded-box run produced 10,925 findings, 10,430 containing
`ERR_NETWORK_CHANGED` (95.5%). The gate's own line read
`harness-noise muted: request-failed 5156, console-error 2`. Contamination was
surface-specific and all-or-nothing (`settings-profile` 1970/1970), ordered by
module-graph size; every failing URL was a Vite dev asset, never a product `/api`
call. The same commit on a quiet box produced ~300 findings and zero contamination.

It also fabricates crashes: `isHarnessNoise()` deliberately never mutes a `crash`,
so a lazy module cancelled mid-import rejects its dynamic import and trips the
ErrorBoundary. Four "product crashes" all carried
`Failed to fetch dynamically imported module`.

> **Fix the cause, not the symptom.** Await network-idle (or explicitly await the
> cell's pending module requests) before `close()`, so the cancellation never
> happens. Muting the `net::ERR_*` console string is the reachable layer — it would
> leave the gate blind to genuine transport failures and still load-fragile. If you
> add muting at all, it must be *paired with* the cancellation fix, never instead
> of it.

## D2 — the failing set is unstable across identical inputs

Two runs of the SAME commit (`d6ce3311a`) disagreed on three of five failing
surfaces:

| surface | base(loaded) | base(quiet) | branch(quiet) |
|---|---|---|---|
| `seeded-s3-version-models-failed` | HIGH 2 | HIGH 2 | HIGH 2 |
| `seeded-s5-project-form-loading` | HIGH 1 | absent | HIGH 1 |
| `hardware-monitor` | absent | HIGH 1 | absent |
| `overlay-dialog-host-described` | absent | HIGH 1 | absent |
| `seeded-file-rag-error` | absent | absent | HIGH 3 |

All three runs reported exactly THREE failing surfaces — a count comparison would
have said "no change" while membership shifted underneath. The unstable findings
are all React errors on *seeded* surfaces, suggesting a render/timing-order
dependency possibly interacting with the fixed `settle` timeout.

> **Mechanism is unknown — investigate before fixing.** First establish the flake
> rate: run the same commit N times and record failing-set membership. That alone
> distinguishes timing from ordering. Then either make cell mounting deterministic,
> or require a finding to reproduce across runs before it gates. A per-surface
> stability annotation would let the gate distinguish "new failure" from "flaky
> failure" instead of treating both as HIGH.

## D3 — no machine-wide lock

Two agents running `gate:ui` concurrently on one host silently corrupt each other,
with no warning in either output. Observed directly: runs in two worktrees
overlapped, the first produced 95.5% contaminated findings, and a serialized run
of the same commit produced zero. **Per-worktree `node_modules` isolation does NOT
protect against this.**

> Take a host-level lock, or detect a live instance and refuse to run.

## D4 — gate-ui rolls up a STALE findings file when runtime-health dies

When the runtime-health step is killed mid-crawl, `gate-ui.mjs` rolls up the
*previous* run's `RUNTIME_FINDINGS.jsonl` and prints a confident verdict over it.
Observed: a killed run at `575/682 cells` printed `103/106 PASS` derived entirely
from an earlier run's file, detectable only by the truncated cell count and the
file's unchanged mtime. An agent nearly reported a defect "reproducing" on a
second run that never happened.

> **A run whose crawl did not complete must fail loudly, not inherit stale data.**

## D5 — the testid registry generator harvests ids from comments and interpolations

`gen-testid-registry.mjs` is a TEXT scan for the attribute followed by a quoted
value, so it harvests any quoted string in that shape — including from comments
and template interpolations. **Five confirmed phantoms this session**, and the two
sharpest are self-referential: one from the testid plugin's own doc comment, and
one from a comment *warning that the scanner would harvest the pattern*. The owner
personally produced two more while fixing an unrelated bug — writing the natural
`` `[data-testid="${CONST}"]` `` harvested `${CONST}` as a real id. Phantoms land
in the SHARED kit registry used by every consumer.

> **Fix:** replace the regex in `collectTestIds` with a ts-morph AST pass (already
> a dependency, already used by the sibling `gen-state-matrix.mjs`) collecting JSX
> attributes and object properties named `data-testid` with string-literal values.
> Comments stop being harvestable structurally rather than by pattern-matching — a
> hand-rolled comment-stripper is itself a text scan with its own evasion space.
> Guard with a **golden set-equality assertion** against the current id set, plus
> the comment/JSDoc/interpolation cases with a REAL attribute in the same fixture
> as a negative control. Note the current registry legitimately contains phantoms;
> decide and state whether your golden baseline is "current ids" or "current ids
> minus proven phantoms" — if you remove any, list each and its source. Also
> consider a three-line id-shape validation (`/^[a-zA-Z0-9_-]+$/`) at render time,
> which would have caught all five regardless of scanner.

## Cross-cutting non-negotiables (owner's brief)

- "**Check whether the ziee copies are synced from the sdk or independently
  maintained** and handle both, or the fix lands in one place and not the others."
- "Reproduce each defect BEFORE fixing it, and show red-then-green verbatim. A
  disproved defect is a valid result."
- "Report the `ERR_NETWORK_CHANGED` count for every gate run you do as a validity
  gate before any conclusion drawn from it; a healthy run is ~0, and any run where
  it isn't is VOID."
