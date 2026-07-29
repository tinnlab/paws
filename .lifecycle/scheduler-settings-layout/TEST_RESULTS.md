# TEST_RESULTS — scheduler-settings-layout

Frontend-only diff (`git diff origin/feat/agent-core...HEAD --name-only` touches
`src-app/ui/**` + the two submodule pointers and nothing under `src-app/server/**`
or `src-app/desktop/**`), so the backend chain does not apply and only the `ui`
workspace gates are required. Every number below is transcribed from a run in
this worktree; the full logs are named per line.

## Gate lines

- `npm run check (ui): PASS` — EXIT=0, the full chain (`tsc` + guardrails +
  `lint:colors` + `lint:settings-field` + `lint:adjacent-inline` +
  `lint:icon-action` + `lint:hooks` + `lint:logical-direction` +
  `lint:tooltip-placement` + `check:kit-manifest` + `check:testid-registry` +
  `check:design-spec` + `check:gallery-coverage` + `check:gallery-crawl` +
  `gallery:check-fixtures` + `check:state-matrix` + `check:overlay-registry` +
  `check:override-registry` + `check:gallery-seed-registry` +
  `check:store-actions`). Log: `/data/pbya/ziee/tmp/grind/ui-check-5.log`.
- `gate:ui (ui): PASS` — EXIT=0. Observed: `tsc` clean; lint clean;
  runtime-health **652 cells, 180/180 surfaces PASS, 0 gating HIGH** (2
  harness-noise + 2 baselined; MEDIUM 155 / LOW 344 non-gating); visual layer
  **25 passed**. Log: `/data/pbya/ziee/tmp/grind/gate-ui-2.log`.
  - **First attempt FAILED and is recorded, not hidden**
    (`/data/pbya/ziee/tmp/grind/gate-ui.log`): runtime-health 183/183 PASS but
    the visual layer reported `23 passed, 2 failed` — both failures in
    `chat-collapse-borders.spec.ts` TEST-3 (light + dark), a spec this diff does
    not touch. Classified by experiment, not by assertion: the whole `src-app/ui`
    tree was checked out at `origin/feat/agent-core` and that spec run standalone
    → **7/7 PASS** (`chat-collapse-BASE.log`); the branch tree restored and the
    same spec run standalone → **7/7 PASS** (`chat-collapse-BRANCH.log`). It is a
    contention flake in a border-paint assertion under `fullyParallel` on a
    192-core box, not a branch regression; the passing gate run used
    `PLAYWRIGHT_WORKERS=4`.

## Phase-3 tests

- **TEST-1**: PASS — `node --test sdk/packages/config/src/lint/settings-field.test.mjs`
  → **10 pass, 0 fail** (both rule-2 directions, all four stretching controls ×
  both beside-orientations, the FormField exemption, the intrinsic-width
  exemption, the vertical-Field case, the scope filter, the opt-out, and rule 1).
- **TEST-2**: PASS — the pure-predicate legs of `form-label-starvation.spec.ts`
  (`describe('isStarvedLabel — predicate')`): **5 passed** — flags all five real
  measured Scheduler metrics; does not flag a long-but-fed label, a single-line
  label, a squeezed label in a slack-less row, or a one-word/icon label.
- **TEST-3**: PASS — the two sweep legs: `no starved form labels on any gallery
  page — desktop (1280px)` and `— mobile (390px)`, both green (~1.4 min each).
  Bidirectional evidence, run on the same tree with only the page swapped:
  pre-fix **5** starved labels on exactly `settings-scheduler` at 1280 AND 768;
  post-fix **0** at 1280 / 768 / 390 across 46 page surfaces (35 `settings-*`),
  126 labels measured / 111 eligible.
- **TEST-4**: PASS — `detector acceptance — the pre-fix markup IS flagged, the
  correct markup is NOT` (2.5s). The check is not vacuously green.
- **TEST-5**: PASS — all four legs against the REAL backend, `--workers=1`:
  TEST-5a desktop (13.7s), TEST-5b footer + dirty-gating (15.0s), TEST-5c mobile
  390px (15.2s), TEST-5d save→reload persistence (16.7s).
- **TEST-6**: PASS — the pre-existing `admin-settings.spec.ts` `admin edits quota
  + retention and it persists` (16.4s): the whole `data-testid` contract survived
  the rebuild.
- **TEST-7**: PASS — see the `npm run check (ui): PASS` line above.
- **TEST-8**: PASS — see the `gate:ui (ui): PASS` line above; the new gating
  spec really does run INSIDE the gate (visual layer 25 passed, up from 23
  pre-registration).
- **TEST-9**: PASS — `TEST-5e: the pre-data window shows a loading state, never
  fabricated defaults` (19.9s), real backend, GET throttled by `route.continue()`
  after a 4s hold. **Scope stated honestly:** re-run against the PRE-FIX
  `loading && !settings` guard it ALSO passes (1 passed, 20.7s,
  `test5e-negctl.log`) — React flushes the mount effect before paint — so it is a
  forward regression pin, not the proof of AUD-1. AUD-1 is recorded as hardening
  with its failed reproduction, never as a fixed live bug.

Observed e2e total for the scheduler dir: **6 passed (2.0m)**, EXIT=0 —
`/data/pbya/ziee/tmp/lifecycle-logs/scheduler-settings-layout-e2e.log`.

## Acceptance tests (design-invariant proofs)

- **TEST-1** [invariant: INV-1]: PASS
- **TEST-2** [invariant: INV-2]: PASS
- **TEST-3** [invariant: INV-2, INV-5]: PASS
- **TEST-5** [invariant: INV-3, INV-5, INV-6]: PASS
- **TEST-7** [invariant: INV-1, INV-4]: PASS
- **TEST-8** [invariant: INV-6]: PASS

## Not run (and why)

- Backend integration tests — the diff touches no Rust. Not applicable.
- `src-app/desktop/ui` `npm run check` — the diff touches no file in that
  workspace (and it carries no scheduler module), so its gate is not required.
- `VISUAL_SNAPSHOTS=1 npm run gate:ui` (Layer B pixel regression) — **NOT RUN**.
  Layer B needs baselines blessed in a pinned container; this worktree has none
  for the rebuilt surface, so a run would compare against absent/foreign
  baselines and produce a meaningless verdict either way. The deterministic
  Layer A + axe layers DID run inside `gate:ui` and are green. Stated rather
  than quietly skipped.
- A9/A10 permission tests — the diff introduces no permission (no
  `permissions.rs`, no migration). Not applicable.
- The `!canManage` read-only branch — **NOT COVERED** (GAP-1). Recorded in
  `INFRA_INTEGRATION.md` and `FIX_ROUND-1.md`; closing it is a harness change.
