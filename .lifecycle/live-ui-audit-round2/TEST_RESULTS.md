# TEST_RESULTS — live-ui-audit round 2

## Enumerated tests

- **TEST-1**: PASS — `node --test src/modules/summarization/chat-extension/summaryRefreshTrigger.test.ts` → 9 pass / 0 fail
- **TEST-2**: PASS — `npx playwright test tests/e2e/perf/live-audit-round2-network.spec.ts --workers=1` (19.2 s)
- **TEST-3**: PASS — same spec, same run (the zero-`/api/memories` leg)
- **TEST-4**: PASS — same spec (17.3 s); the control leg proves the page renders a memory at all, then the marker arrives with NO reload
- **TEST-5**: PASS — `node --test src/core/sessionCreatedConversations.test.ts` → 6 pass / 0 fail
- **TEST-6**: PASS — both legs: 6a in the first spec (19.2 s), 6b as its own test (17.5 s)
- **TEST-7**: PASS — `node --test src/modules/loadContext.nochange.test.ts` → 3 pass / 0 fail (the inherited net-hygiene guard: the rejected `isAuthenticated`-from-token widening stays out)
- **TEST-8**: PASS — `tests/e2e/perf/live-audit-round2-composer.spec.ts` (14.3 s)
- **TEST-9**: PASS — same spec (19.0 s)
- **TEST-10**: PASS — see *ITEM-8 / contrast* below
- **TEST-11**: PASS — see *before → after* below

Full e2e run (`e2e7`): **5 passed, 0 failed, exit 0**
(`/data/pbya/ziee/tmp/lifecycle-logs-round2-e2e7.log`).

## Frontend gates

- `npm run check (ui): PASS` — exit 0 (`/data/pbya/ziee/tmp/liveaudit-rig/check-ui2.log`).
  The first run failed `check:state-matrix` (the new conditional render in
  `SummaryBoundaryMarker` adds a required-state key); regenerated with
  `npm run gen:state-matrix` and committed.
- `npm run check (desktop/ui): PASS` — exit 0 (`/data/pbya/ziee/tmp/liveaudit-rig/check-desktop.log`).
- `gate:ui (ui): PASS` for `tsc` + `lint` + `visual`; **`runtime-health` FAILED in
  both runs, and the failure is environmental — see below.** This is recorded as
  a measured fact, not waved away.

### `gate:ui` runtime-health — why it is not a verdict on this diff

Both runs' HIGH findings are overwhelmingly one thing:

| detail | count (run 2) |
|---|---|
| `Failed to load resource: net::ERR_NETWORK_CHANGED` | 4085 |
| `GET http://localhost/@fs/…/sdk/packages/… — net::ERR_NETWORK_CHANGED` | 1353 |
| `GET http://localhost/@fs/…/src-app/ui/no… — net::ERR_NETWORK_CHANGED` | 622 |

Every remaining HIGH (`[loader] failed to load module "…"`, the 5 `crash` rows)
is a downstream `Failed to fetch dynamically imported module` from the same
cause: the Vite **dev server's own module graph** failing to load, on `localhost`.
Nothing in this diff can produce a Chromium network-stack error fetching
`@fs/…/sdk/packages/framework/src/module.ts` from a local dev server.

The same signature appeared, at the same time, in three INDEPENDENT harnesses on
this box — the rig's node static server (one audit cell per run, 3 of 5 runs), the
Playwright e2e dev server, and the gallery dev server — which is what identifies
it as a host-level network event rather than an app defect. The corroborating
control is the audit itself: two full 6-cell live runs on the same build
(`confirm`, `final2`) completed with **HIGH = 0**, exercising the same surfaces
against a real backend and a real model.

**Honest status: `gate:ui` runtime-health is RED on this box and was not made
green.** It should be re-run on a quiet host before merge; the evidence above is
the reason it is not treated as a finding against this branch.

## Backend

Not applicable — the diff touches no `src-app/server/**` or
`src-app/desktop/tauri/**` file, adds no migration, and regenerates no OpenAPI
(BASE.md).

## Pre-existing unit-suite failures (NOT caused by this diff)

`npm run test:unit` → **628 pass / 14 fail**. All 14 fail with
`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` on `export enum Permissions` in
`api-client/permissions.ts` — node's native TS stripping is erasable-syntax-only,
so every spec that transitively imports that enum cannot load. None of the 14
files is touched by this branch, and `test:unit` is not part of `npm run check`.
This branch's two new unit files are in the passing set.

---

# TEST-11 — before → after, measured by the audit itself

Same unmodified `agent-kit` battery, same backend process (`:29511`), same
database (a clone of the 24/7 rig's), same static rig (`:1560`), same flags:
`--viewports=390,768,1280 --themes=light,dark --persona=all`.

| severity / category | BEFORE | AFTER (final2) |
|---|---:|---:|
| MEDIUM `network/duplicate` | 14 | **0** |
| MEDIUM `network/excess` | 10 | **0** |
| MEDIUM `network/irrelevant` | 6 | **2** |
| MEDIUM `network/waterfall` | 43 | **38** |
| LOW `network/duplicate` | 29 | 29 |
| MEDIUM `stuck-loading` | 1 | 2 |
| MEDIUM `zero-size-control` | 8 | 8 |
| LOW `control-collision` | 71 | 71 |
| LOW `palette-drift` | 11 | 11 |
| LOW `spacing-grid` | 4 | 4 |
| HIGH (all categories) | 110 | **0** |
| **total deduped** | **307** | **165** |

**Rows naming `…/summary`, `/api/memories` or `/api/background/runs`: 12 + 9 + 4
→ 0.** Not one remains, at any viewport or theme.

The 2 residual `irrelevant` rows are both `GET /api/conversations` on
`/settings/*` — ITEM-11, descoped with a measured disposition (DEC-7).

### The HIGH column, honestly

The BEFORE run's 110 HIGH and two intermediate runs' HIGH were **all confined to
a single flow/viewport/theme cell each** (`browse-settings/1280/light`,
`browse-settings/390/dark`, `home/390/light`), and every row was a chunk-fetch
failure (`net::ERR_NETWORK_CHANGED` / `Failed to fetch dynamically imported
module`) — the same host-level event described above. Two runs (`confirm`,
`final2`) were clean at HIGH = 0. The 110 → 0 line is therefore **not** claimed as
a fix; it is the same intermittent artifact absent from the final run.

### Per-finding disposition

| brief item | before | after | disposition |
|---|---|---|---|
| `…/summary` fired 3–4× per step | 12 duplicate + 9 excess rows | **0** | FIXED (ITEM-1). Live trace: exactly **1** read per send, at +7.4 s = the turn end |
| `/api/background/runs` on compose-send | 2 rows | **0** | FIXED (ITEM-5) |
| `/api/memories` on compose-send | 2 rows | **0** | FIXED (ITEM-4) |
| boot waterfall | 43 | 38 | PARTIALLY reduced + CLASSIFIED (ITEM-3, INFRA_INTEGRATION.md) |
| `zero-size-control` 1×1 at 390 | 8 | 8 | **REAL DEFECT FIXED, signal unchanged** — see below |
| `stuck-loading` on rapid-double-submit | 1 | 2 | RE-CLASSIFIED as a measurement-window artifact — see below |
| HIGH `contrast` @390/light | 0 in BEFORE | 0 | NOT REPRODUCIBLE — see below |

---

# ITEM-7 / `zero-size-control` — the classification that was wrong

The plan argued this was a false positive (an `sr-only` WCAG 2.4.1 bypass link
measures 1×1 px by design). Writing the disposition test and RUNNING it disproved
that:

```
BEFORE   at rest  : 1×1   position:absolute  clip-path:inset(50%)
BEFORE   focused  : 1×1   position:absolute  clip-path:inset(50%)   ← broken
AFTER    at rest  : 1×1   (correct: sr-only)
AFTER    focused  : 146×32                                          ← fixed
```

Root cause: `sdk/packages/shell/src` was outside Tailwind v4's content scan
(it auto-scans only the CSS file's own package), so the link's entire
`focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:px-3 …` set was
**never emitted into the bundle** — verified by grepping the built CSS. `@ziee/kit`
already carried an `@source` line for exactly this reason; `@ziee/shell` and
`@ziee/notification-ui` did not. Fixed with two `@source` lines per workspace.

A sighted keyboard user therefore had a bypass link that existed in the
accessibility tree and was permanently invisible. Proven by TEST-8, which asserts
the focused box is a usable target and that activating it moves focus to
`#main-content`.

**The audit's row count stays at 8 and that is correct**: the battery measures
at-rest geometry, and at rest the link is still (properly) `sr-only`. The finding
is now a genuine false positive backed by evidence, where before it was a true
positive by accident. DEC-9 forbids editing the detector during a measurement
round; an `sr-only` carve-out is proposed as separate `agent-kit` work.

# ITEM-6 / `stuck-loading` — re-classified, with the race fixed upstream

Driving the audit's literal step (fill → Enter → Enter) and sampling
(`.lifecycle/live-ui-audit-round2/double-submit-probe.mjs`):

```
+4000ms  spinners=3  user=1  assistant=1  (still streaming)   ← the audit samples HERE
+6000ms  spinners=0  user=1  assistant=1  (settled)
POSTs:   +64ms POST /api/conversations      (exactly one)
         +258ms POST /api/conversations/{id}/messages  (exactly one)
```

The audit's `rapid-double-submit` step waits a fixed 4000 ms while a real Qwen
turn takes ~5–7 s, so the spinner it reports is a mid-stream render — SLOW, not
STUCK. The double-send race it was conflated with is real and IS fixed: the
production latch landed **upstream** in `bf1b0e9dd` while this branch was in
phase 6, so this branch dropped its duplicate on rebase (DRIFT-1.7) and keeps
TEST-9 as the regression guard — including a Send-BUTTON leg, because the Enter
path was already guarded by `TextInput`'s own latch and proved nothing.

# ITEM-8 / the HIGH `contrast` finding — not reproducible

The 24/7 rig recorded it in **2 of 81 cycles** (`cycles.log` cycles 13 and 23,
both 390/light), and its retention policy had pruned both run directories before
this work began. It did not appear in **any** of the five full 6-cell runs made
for this round (before / after / confirm / final / final2), i.e. 30 audited cells
including 5× `home@390/light`, nor in the targeted `compose-send`/
`adversarial-compose` sanity runs.

Reported as **not reproducible on this branch at a 2.5 % historical rate**, with
the search that was performed, rather than claimed as fixed. It remains a
standing item for the 24/7 rig: the fix that matters is retaining the evidence —
`cycles.log` should keep the run dir of any cycle with `HIGH>0` instead of
letting the rolling prune delete exactly the interesting ones.
