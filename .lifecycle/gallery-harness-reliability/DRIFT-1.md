# DRIFT-1 — implementation vs plan/design

Authored DURING phase 5, as each item landed.

## The big one: D1's stated MECHANISM is disproved

- **DRIFT-1.1** — verdict: impl-wins — **DESIGN §D1's causal claim ("`page.close()`
  cancels every module request still in flight") does NOT reproduce.** A direct
  probe (`mech-probe.mjs`, four variants) drove a page whose lazily-imported ES
  module is deliberately stalled 3000 ms past a 400 ms settle window, then closed
  it. Result, verbatim:

  ```
  --- A: page.close(): 0 events
  --- B: context.close(): 0 events
  --- C: page.close({runBeforeUnload:false}) then nothing: 0 events
  --- D: browser.close() with page open: 0 events
  ```

  Playwright 1.60 emits **no** `requestfailed` and **no** console mirror for
  requests outstanding at close. The first draft of the acceptance test
  (`quiesce.e2e.mjs`) refused to false-pass on exactly this — its negative control
  fired:

  ```
  LEGACY  (goto → settle → close):
    cancelled requests : 0
    console mirrors    : 0
    dyn-import crashes : 0
  AssertionError: NEGATIVE CONTROL FAILED: the legacy sequence produced no
  cancellation artifacts, so this fixture is not reproducing the defect and the
  QUIESCE leg below would prove nothing.
  ```

  Had that control not been written, a quiesce "fix" would have shipped with a
  green test proving nothing — the exact tautology D2 warns about.

- **DRIFT-1.2** — verdict: impl-wins — **the real mechanism is the ORIGIN becoming
  unreachable mid-crawl.** A second probe held the fixture identical and varied
  only origin liveness:

  ```
  --- E: origin ALIVE throughout: 0 events
  --- F: origin DIES after DOMContentLoaded (in-flight import): 3 events
      requestfailed ://127.0.0.1:41557/m1.js net::ERR_CONNECTION_RESET
      console.error Failed to load resource: net::ERR_CONNECTION_RESET
      console.error [AppErrorBoundary] Failed to fetch dynamically imported module: …
  --- G: origin GONE before goto: 2 events
      requestfailed http://127.0.0.1:41557/ net::ERR_CONNECTION_REFUSED
  ```

  Case F reproduces the reported triad EXACTLY and in full: the muted
  `requestfailed` twin, the **unmuted console twin**, and the **fabricated
  ErrorBoundary crash** carrying `Failed to fetch dynamically imported module`.
  It also explains every secondary observation the design records, which the
  close()-cancellation theory does not:

  | observation (DESIGN §D1) | explained by dead origin |
  |---|---|
  | contamination "surface-specific and all-or-nothing (`settings-profile` 1970/1970)" | the origin was down for the whole of that cell |
  | "ordered by module-graph size" | more modules per cell ⇒ more failed requests |
  | "every failing URL was a Vite dev asset, never a product `/api` call" | `/api` is intercepted IN-PAGE by the mock cassette and never touches the network, so a dead origin can ONLY manifest on dev assets |
  | "~300 findings and zero contamination on a quiet box" | no concurrent run to disturb the server |
  | D2's "failing set unstable across identical inputs" | same cause — see DRIFT-1.3 |

- **DRIFT-1.3** — verdict: impl-wins — **the repo had already diagnosed this
  class, and says so in `scripts/lib/run-key.mjs`'s `isPortBindable` doc-comment
  on main:** *"Symptom: thousands of `net::ERR_NETWORK_CHANGED` HIGHs, a portless
  `http://localhost/`, and failing surface sets that differ run to run. Three
  separate investigations chased that as a UI regression before the collision was
  traced here."* That is D1 **and** D2 named together, attributed to a
  cross-worktree port collision — i.e. to concurrency, which is D3. The
  dual-stack bind probe already on main is a partial fix; what is still missing is
  (a) any lock preventing concurrent runs from interfering at all, and (b) any
  check that the origin stayed alive for the run, so a disturbed run still reports
  thousands of findings as if they were product defects.

- **DRIFT-1.4** — verdict: plan-wins → **re-scoped.** PLAN ITEM-1/ITEM-2 (quiesce
  before close) are **DESCOPED**: they fix a mechanism that does not exist, and
  shipping them would be manufacturing a fix for a disproved defect — which the
  owner explicitly said not to do ("A disproved defect is a valid result"). They
  are replaced by ITEM-1b/ITEM-2b (origin-liveness validity gate), which address
  the mechanism that IS proven. `lib/quiesce.mjs` and `lib/quiesce.e2e.mjs` are
  removed rather than left as dead code (CODING_GUIDELINES §15).
  ITEM-3/ITEM-4/ITEM-5 stand unchanged — the classifier gap they close is real and
  independently confirmed by probe F, and INV-1's "paired, never instead-of" rule
  is now satisfied by pairing them with the D3 lock + the liveness gate rather
  than with quiesce.

- **DRIFT-1.4b** — verdict: impl-wins — **a THIRD trigger of the same class was
  caught live, and it was me.** Flake-study run02 (the same commit, same box,
  same vite server as run01) produced **538 `net::ERR_ABORTED` request-failures
  where run01 produced 0**, concentrated all-or-nothing on exactly two surfaces
  (`settings-skills` 402, `settings-sessions` 136) — the same "surface-specific
  and all-or-nothing, ordered by module-graph size" signature DESIGN §D1
  describes. The cause: I regenerated `sdk/packages/kit/src/testIds.generated.ts`
  during the run. That file IS in the gallery's Vite module graph, so HMR
  invalidated and full-reloaded the open pages, **aborting every ESM import in
  flight**. `runtime-health`'s own existing comment already names this shape
  (*"a full reload aborts in-flight ESM / font imports … net::ERR_ABORTED"*).

  So the mechanism generalizes to: **the harness moved under the crawl**, with at
  least three distinct triggers, all producing the identical triad:

  | trigger | error | evidence |
  |---|---|---|
  | origin dies (concurrent run kills vite, `pkill -f vite`) | `ERR_CONNECTION_*` | probe F, DRIFT-1.2 |
  | a source file changes mid-crawl → Vite HMR full reload | `ERR_ABORTED` | flake run02 (measured) |
  | port collision serving from a FOREIGN worktree | `ERR_NETWORK_CHANGED` | `run-key.mjs` `isPortBindable` doc-comment |

  `page.close()` is on none of this list. The fix set is correspondingly
  trigger-agnostic: the host lock removes trigger 1 and 3, and the run-validity
  gate VOIDS a run affected by ANY of them rather than trying to enumerate them.
  It also yields a concrete operating rule, now in the docs: **do not edit files
  in the gallery's module graph while a crawl is running** — a rule this feature's
  own flake study had to learn the hard way, and which invalidated its run02.

## D5 — landed as planned

- **DRIFT-1.5** — verdict: none — ITEM-14/15/16/17 landed exactly as planned. The
  measured delta matched the DEC-1 prediction to the id: `-3` phantoms, `+6` real.
  `git diff` of the regenerated registry, verbatim:
  ```
  -  "${testid}-row-${cssEscape(rk)}",     +  "chat-single-drop-column",
  -  "chat-pane-${idx}",                   +  "desktop-bootstrap-failed",
  -  "kb-hit-source-${n - 1}",             +  "desktop-bootstrap-starting",
                                           +  "memory-core-block-create-dialog",
                                           +  "memory-core-block-edit-dialog",
                                           +  "settings-page-title",
  ```
- **DRIFT-1.6** — verdict: resolved — the predecessor unit test asserted the
  quoted-key object form (`{'data-testid':'beta'}`) was NOT captured, with a
  comment saying this "mirrors the original app generator's regex". That encoded a
  scanner ARTIFACT, not intent, so the AST pass captures it and the test was
  updated with that rationale stated inline. Verified to add ZERO ids on the real
  trees, so the golden set is unaffected.
- **DRIFT-1.7** — verdict: resolved — the plan said "string literals in value
  positions"; a first draft that walked ALL descendant literals over-collected 15
  fragments (`toggle` from `tid('toggle')`, `failed` from a ternary CONDITION,
  `data-testid` from `props['data-testid']` inside a template span). The
  value-position recursion is the rule that is correct in both directions; each of
  those three real over-collections is now pinned as a negative test (TEST-22c/d).

## Scope

- **DRIFT-1.8** — verdict: resolved — ITEM-6..9 (`--repeat`/flaky gating) are
  **DESCOPED for this round**, pending the flake study's data. DRIFT-1.3 shows D2
  is plausibly the SAME root cause as D1/D3, in which case a reproduce-to-gate
  mechanism would be treating a symptom of something the lock already fixes.
  Building it before the measurement lands would violate INV-2's explicit
  "investigate before fixing". The study runs regardless and its result is
  reported.

**Unresolved drifts:** 0
