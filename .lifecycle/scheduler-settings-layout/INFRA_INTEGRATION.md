# INFRA_INTEGRATION — scheduler-settings-layout

The three mandatory phase-5 walks. This branch is a **frontend-only** layout fix
plus two mechanical checks, so several subsystems are deliberately recorded as
NOT-TOUCHED with the evidence for that claim, rather than omitted.

## 1. User-experience walk (per item)

- **ITEM-1/2/3/4 (the page).** A deployment admin opens Settings → Scheduler.
  Before: five labels wrapped one word per line beside ~780px inputs holding a
  two-digit number, and the Save floated at the bottom of the card body. After:
  a fixed 13rem label column, `w-40` numeric controls with the unit as a right
  adornment, a per-field description explaining what each limit bounds, and
  Cancel + Save in the card footer. Save is disabled until the form is dirty, so
  the admin can't "save" a no-op; Cancel restores the loaded row. A non-manager
  sees the same page with a "Read-only view" Alert, a disabled form, and a
  disabled Save whose tooltip states why (previously the Save block was omitted
  entirely, which reads as a broken page rather than a permission boundary).
- **ITEM-5 (mobile).** At 390px the kit `Form` self-stacks (its own
  ResizeObserver, `< 480px` of the form's OWN width → vertical), so the label
  sits above a full-reach control. Verified by screenshot + measurement, not by
  reading the kit source.
- **ITEM-8/9/10 (the checks).** The user is the next author. The static lint
  fires at `npm run check` with a message naming the correct composition; the
  gated visual spec fires in `npm run gate:ui` with the measured numbers in the
  failure text; the rig detector fires on the 24/7 live run with the same text.
  None of the three says only "this is wrong" — each names the fix.

## 2. Infrastructure-integration walk

Every subsystem the page or the checks touch, and what it constrains:

| subsystem | constraint found | how it is handled |
|---|---|---|
| **permissions** | the page gates on the EXISTING `scheduler_admin::{read,manage}`; no new permission is introduced (verified: `git diff origin/feat/agent-core...HEAD` touches no `permissions.rs` and no migration) | `usePermission(Permissions.SchedulerAdminManage)` drives `Form disabled` + `saveDisabled`/`cancelDisabled`. A9/A10 do not apply — no new permission. |
| **store / actions** | `SchedulerAdmin.updateSettings(patch)` already takes `UpdateSchedulerAdminSettings`; changing its shape would force an `actions.gen` regen | the rebuild calls it with the SAME five keys ⇒ no store, action or type change. `check:store-actions` green. |
| **realtime sync** | the store may refetch under a `sync:*` signal while the admin is typing | the re-seed effect is guarded by `!form.formState.isDirty`, so a sync-driven refetch cannot clobber in-progress edits; after a successful save `form.reset(v)` re-opens the page to re-seeding. |
| **testid registry** | `check:testid-registry` regenerates from static `data-testid` literals only, so a testid passed as a PROP (`saveTestid`) leaves the registry | regenerated in the sdk (`8c5cef7`); `scheduler-admin-save`/`-cancel` now arrive via `SettingsFormActions` props exactly as on every other settings card (`session-settings-save` is likewise absent from the registry). `byTestId`'s `TestIdLike` accepts any string, so the existing specs still compile. Verified: `check:testid-registry` PASS. |
| **state matrix** | the rebuild changes the page's conditional-render forks (6 signals → 3), and `check:state-matrix` reconciles the generated matrix against the gallery entries | `stateMatrix.generated.ts` + `STATE_MATRIX.md` regenerated; `coverage.ts` already declares `settings-scheduler` as `data-page` with `['loaded','empty','error']`, so no new gallery cell is needed. Verified: `check:state-matrix` PASS. |
| **gallery / mock-API cassette** | the `loaded` state must stay POPULATED for the sweep to mean anything | `modules/scheduler/gallery.tsx` already seeds `SchedulerAdminSettings.get` with all five values — unchanged. Confirmed populated in the AFTER screenshots. |
| **gate:ui / visualSpecs** | adding a spec to `gallery.config.json → visualSpecs` makes it gate for EVERY future branch; a pre-existing offender elsewhere would turn the gate red for someone else's code | swept first: 46 page surfaces × 3 viewports × 126 labels ⇒ 0 starved after the fix, 5 (all on `settings-scheduler`) before. No baseline/allowlist entry was needed, and none was added. |
| **`npm run check` (the static lint)** | `lint:settings-field` is inside `npm run check`, so a false positive breaks the frontend gate on every branch | scoped to STRETCHING controls only (`Input`/`InputNumber`/`InputPassword`/`Textarea`). Census over the whole tree: 79 settings-scoped files, 1 flagged pre-fix, 0 post-fix, and 0 non-scoped files would trip it either. The PLAN_AUDIT CONCERN about `McpToolApprovalsTab` is CLOSED: it composes `Select` (content-sized root), the lint does not flag it, and it measures 0 starved labels at all three viewports. |
| **agent-kit (the 24/7 rig)** | the target file is being edited upstream by the orchestrator (their copy is ~2392 lines vs 1473 on `origin/main`) | DEC-7: the detector is ONE additive hunk on the submodule branch `fix/label-starvation-detector`, and the superproject pointer is `origin/main` (`8435b4b`) per DEC-8 — i.e. the branch does NOT drag an unpushed agent-kit commit along. Flagged for the orchestrator to carry. |
| **backend / migrations / OpenAPI** | — | untouched. No `src-app/server/**`, no migration, no `openapi.json` / `api-client/types.ts` change (verified by the diff name-list). |
| **desktop workspace** | — | untouched. `src-app/desktop/ui` has no scheduler module (`find … SchedulerAdminPage.tsx` → nothing), so only the `ui` workspace gates apply. |

## 3. Entity-lifecycle walk

The surface holds exactly ONE entity: the singleton `scheduler_admin_settings`
row (there is no list, no per-user row, no attachment, no membership).

| event | local path | sync / SSE path |
|---|---|---|
| **add** | n/a — the row always exists (a singleton seeded by migration); the page never creates one. | n/a |
| **mutate** | `updateSettings` → store updates → `settings` changes → the `!isDirty` guard permits the re-seed → the form shows the saved values. Proven by TEST-5d (edit → save → reload → values persist). | a refetch driven by another device's save reaches the same effect; the `!isDirty` guard means it applies only when the local admin has no unsaved edits — otherwise the local edits stand and the next save wins. Deliberate, and the reason the guard is copied from `SessionSettingsPage`. |
| **remove / delete** | not reachable — the row has no delete endpoint and no UI affordance. Verified: the scheduler admin store exposes only `loadSettings` / `updateSettings`. | n/a |
| **access-loss** | `usePermission(SchedulerAdminManage)` flips false → the read-only Alert appears, the whole `Form` becomes `disabled`, and Save/Cancel render DISABLED with a reason tooltip (DEC-10: the footer renders in BOTH cases, so a reader sees an explained control rather than a missing one). **NOT DRIVEN — an inherited gap, honestly recorded, not closed here** (see GAP-1 below): the route itself requires `scheduler_admin::read`, so the `read && !manage` state needs a purpose-built group + user, and the gallery has no permission-variant state for a page surface. The branch introduces no new permission, so A9/A10 do not require it. | the session re-bootstrap that carries a permission change re-renders the page through the same `!canManage` branch. |

### GAP-1 (recorded, not closed)

The `!canManage` read-only branch of `/settings/scheduler` has **no automated
coverage** — before this branch or after it. It is reachable only by a principal
holding `scheduler_admin::read` WITHOUT `::manage`, which needs a custom group +
user fixture; the gallery's `data-page` states (`loaded`/`empty`/`error`) carry
no permission axis. This branch CHANGES that branch's behaviour (DEC-10: the
footer is now rendered disabled instead of omitted), so the change is
review-verified only. Closing it properly means either (a) a permission-variant
gallery state for page surfaces, or (b) a `read`-only user fixture in the e2e
harness — both larger than this fix and left for the owner to schedule.
| **load failure** | primary load fails with no row → retryable `ErrorState variant="page"` (previously: an inline Alert above an EMPTY card). A save failure keeps `settings` and surfaces a toast instead, so a transient save error never blows the page away. | — |
