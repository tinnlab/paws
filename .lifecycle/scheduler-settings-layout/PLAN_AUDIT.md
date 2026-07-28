# PLAN_AUDIT — scheduler-settings-layout

Audited against the codebase at `origin/feat/agent-core` @ `d53db2d11`.

## Breakage risk

- **`data-testid` contract.** `tests/e2e/14-scheduler/admin-settings.spec.ts`
  drives `scheduler-admin-page`, `scheduler-max-active`, `scheduler-retention`
  and `scheduler-admin-save`, and `tests/e2e/permissions/*` may assert the
  read-only alert. The rebuild MUST preserve every existing testid verbatim
  (`scheduler-admin-page`, `scheduler-admin-card`, `scheduler-admin-readonly`,
  `scheduler-admin-error`, `scheduler-max-active`, `scheduler-min-interval`,
  `scheduler-max-horizon`, `scheduler-max-failures`, `scheduler-retention`,
  `scheduler-admin-save`) and only ADD (`scheduler-admin-cancel`,
  `scheduler-admin-form`, `scheduler-admin-load-error`). Verified by grep: the
  only external consumers are `14-scheduler/admin-settings.spec.ts` and the
  generated testid registry.
- **`check:testid-registry`** regenerates from source; adding testids requires
  re-running `npm run gen:testid-registry` or `npm run check` fails. Budgeted.
- **Store contract unchanged.** `SchedulerAdmin.updateSettings(patch)` already
  takes `UpdateSchedulerAdminSettings`; the rebuild keeps calling it with the
  same five keys. No store/action/type change ⇒ no `actions.gen` regen.
- **`Card footer` prop** — confirmed present and used by `SessionSettingsPage`
  and `RetrievalLimitsSection`, so no kit change is needed.
- **`ErrorState variant="page"`** — confirmed exported from `@ziee/kit` and used
  by `SessionSettingsPage`. Adding a new `error` branch introduces a new
  conditional render state ⇒ `check:state-matrix` may demand a gallery cell.
  The gallery already declares `settings-scheduler` as
  `{ kind: 'data-page', states: ['loaded','empty','error'] }` in
  `dev/gallery/coverage.ts`, so the error state is already covered. No new
  gallery entry needed.
- **New gating visual spec** — adding an element to `gallery.config.json →
  visualSpecs` makes `gate:ui` run one more spec. If any OTHER page surface is
  starved, the gate goes red for a pre-existing defect. Mitigated by ITEM-7:
  the empirical sweep already proves `settings-scheduler` is the sole offender
  across 46 pages + 47 overlays / 220 labels at desktop; the sweep is re-run at
  390 and 768 before the spec is wired in, and any pre-existing offender found
  is either fixed or explicitly baselined with a reason (never silently muted).
- **New static lint rule** — `lint:settings-field` is inside `npm run check`,
  so a false positive breaks the whole frontend gate for every branch. Scoped
  narrowly: it fires ONLY on a *stretching* control inside a hand-composed
  `Field orientation="horizontal"|"responsive"` that is not inside a
  `FormField`. Verified by AST grep across both workspaces: the only
  `orientation="horizontal"|"responsive"` sites are
  `SchedulerAdminPage` (the defect), `ScheduledTaskFormDrawer` (Switch —
  intrinsic width, legal), `settings-general/ThemeSettings` (Segmented +
  swatches — legal), `mcp/.../McpToolApprovalsTab` (Select…: see below),
  `file/**/{InlineFilePreview,FileCard}` (not settings-scoped),
  `dev/gallery/stories/controls.story.tsx` (excluded — not settings-scoped).
  **CONCERN:** `McpToolApprovalsTab` renders a control inside a `responsive`
  Field — must be measured before the rule ships, and either it is legal
  (intrinsic width) or it is a second offender to fix.
- **agent-kit submodule bump** — the branch moves the `agent-kit` pointer from
  `925cef2` to `origin/main` (`8435b4b`). Required: the pinned `925cef2`
  lifecycle validator's A1 counts feature dirs ON DISK, so ANY branch cut from
  this base fails phase 1 against the 17 inherited dirs; upstream `2ec3232`
  fixes it to count what the BRANCH adds. The bump also brings the
  `live-ui-audit` skill in-tree (needed by ITEM-10). Sibling branches on this
  base already do exactly this ("chore: bump agent-kit submodule → …").

## Pattern conformance

- ITEM-1..4 are a direct transcription of `RetrievalLimitsSection` (form) and
  `SessionSettingsPage` (shell). Both were read in full; every construct used
  (`useForm`, `form.reset` only when `!isDirty`, `Card footer`,
  `SettingsFormActions`, `Paragraph type="secondary"`, `InputNumber w-40 +
  suffix`) is copied from them, not invented.
- ITEM-8 extends an EXISTING lint file with a second rule using the same
  TS-compiler-API walk and the same `data-standalone-control`-style opt-out
  idiom, rather than adding a new script.
- ITEM-9 follows the Layer-A idiom (`tests/e2e/visual/*.spec.ts` under
  `playwright.visual.config.ts`, backend-free, deterministic, gallery-driven)
  and puts the reusable probe next to the other invariants in
  `tests/e2e/helpers/layout.ts`.
- ITEM-10 follows the rig's in-page detector shape
  (`findings.push({category, severity, selector, detail})` + a `DIMENSION` entry).
- ITEM-11 sits in the existing `tests/e2e/14-scheduler/` dir with the same
  `loginAsAdmin` + `testInfra.baseURL` idiom, but drives the REAL backend rather
  than `page.route()` (TESTING_GUIDE: "No `page.route()` API mocking").

## Migration collisions

None. This branch adds no migration; server migrations on this base live under
`sdk/crates/*/migrations` and `src-app/desktop/tauri/migrations`, none of which
is touched. (`ls src-app/server/migrations` does not exist on this base.)

## OpenAPI regen

Not required. No Rust type, handler, permission or sync entity changes;
`openapi.json` / `api-client/types.ts` are untouched in both workspaces.

## Per-item verdicts

- **ITEM-1** — verdict: PASS — a 1:1 transcription of `RetrievalLimitsSection`'s
  `Form layout="horizontal"` + `FormField` composition; `FormField` emits the
  label as a DIRECT `Field` child with `style={{width:'13rem',flex:'none'}}`
  (form.tsx:280), which structurally cannot be starved.
- **ITEM-2** — verdict: PASS — `w-40` is the established numeric width across
  all 12 `file-rag` numeric fields and `McpUserPolicyCard`; `suffix` is a real
  `InputProps` field rendered as a right adornment (input.tsx).
- **ITEM-3** — verdict: PASS — `Card footer` + `SettingsFormActions` is
  documented in that component as "The ONE convention for a card's Save/Cancel
  actions … never as a Separator + inline buttons in the body". The current page
  violates it.
- **ITEM-4** — verdict: PASS — `ErrorState variant="page"` + the `!isDirty`
  re-seed guard are copied verbatim from `SessionSettingsPage`. The gallery
  `error` state for this surface already exists in `coverage.ts`.
- **ITEM-5** — verdict: PASS — the stacking is the kit `Form`'s own
  ResizeObserver (`form.tsx:150-165`, `< 480px` → vertical), i.e. inherited, not
  re-implemented. Verification is measurement, not new code.
- **ITEM-6** — verdict: PASS — mechanically enforced by the existing
  `lint:colors` + `lint:logical-direction` inside `npm run check`; the audit is
  a read of the final file plus those gates.
- **ITEM-7** — verdict: PASS — the sweep is already executed once (desktop) with
  a reproducible probe; extending it to 390/768 is the same probe.
- **ITEM-8** — verdict: CONCERN — must first measure `McpToolApprovalsTab`
  (a `responsive` Field with a control) to confirm the rule has zero false
  positives before wiring it into `npm run check`. If it IS starved, it is a
  second offender to fix (ITEM-7 output), not a reason to weaken the rule.
- **ITEM-9** — verdict: CONCERN — makes `gate:ui` stricter for every future
  branch. Acceptable only if the 390/768/1280 sweep is clean after ITEM-1; any
  residual offender must be fixed or explicitly baselined with a written reason
  (the repo already has this idiom: `layout-baseline.ts` / `axe-baseline.ts` /
  `geometry-allowlist.json`).
- **ITEM-10** — verdict: CONCERN — the target file is DIRTY and unpushed in
  the orchestrator's own `agent-kit` checkout (2392 lines) while
  `agent-kit/origin/main` has 1473. Editing the committed version risks a
  conflict with in-flight work. Resolution recorded as DEC-7: land the detector
  as ONE self-contained additive hunk on an agent-kit branch (unpushed) and
  flag it explicitly for the orchestrator to carry onto their working copy.
- **ITEM-11** — verdict: PASS — the real-backend route
  `GET/PUT /api/scheduler/admin-settings` exists (used by the store's
  `ApiClient.SchedulerAdminSettings`), and `loginAsAdmin` grants
  `scheduler_admin::{read,manage}` via the Administrators `*` wildcard.

No `BLOCKED` verdicts.
