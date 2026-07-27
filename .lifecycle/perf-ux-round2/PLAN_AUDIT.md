# PLAN_AUDIT — perf-ux-round2

The plan audited against the codebase as it stands on `feat/perf-ux-round2`
(base `origin/feat/agent-core` `a49d48271`), before any implementation.

## Breakage risk

- **ITEM-1 is the only item that can change runtime behaviour.** It converts the
  kit barrel's `DatePicker` from an eager to a lazy component. Consequences,
  each checked:
  - **Ref/prop injection.** `sdk/packages/kit/src/kit/form.tsx`'s `FormField`
    injects `value`/`onChange`/`name`/`id`/`ref` onto its child via
    `React.cloneElement`, and the underlying `DatePicker` is a
    `forwardRef<HTMLButtonElement>`. A wrapper that is not itself a `forwardRef`
    spreading `{...props}` and forwarding `ref={ref}` would silently break every
    date field. The plan mandates that exact shape, and it is not speculative:
    `src-app/ui/src/components/common/LazyDatePicker.tsx` already ships it and is
    already in production use on both consumers.
  - **A Suspense boundary appears where none was.** The wrapper supplies its own
    `<Suspense fallback={<Skeleton/>}>`, so it cannot suspend an ancestor that
    lacks a boundary. `Skeleton` is exported from the kit, so no new dependency.
  - **Consumers.** Exactly three surfaces render a `DatePicker`:
    `modules/workflow/components/WorkflowElicitForm.tsx` and
    `modules/mcp/chat-extension/components/elicitationFields.tsx` (both already go
    through the app's `LazyDatePicker`, so they are unaffected either way), and
    `src/dev/gallery/stories/controls.story.tsx` (dev-only, imports from the
    barrel — it now gets the lazy one, which is the point).
  - **Type export.** `export type { DatePickerProps } from './kit/date-picker'`
    stays pointed at the eager module. Type-only exports are erased by the
    compiler, so they cannot re-create the runtime edge. Verified this is how the
    leak is avoided rather than assumed — the built kit chunk's
    `import{a as Ve,…}from"./date-picker-*.js"` is a VALUE import.
  - **Not proven until built.** Whether rolldown actually drops
    `date-picker-*.js` from `index.html`'s `modulepreload` set under this design
    is a build-output question. The equivalent experiment (deleting the export
    outright) DID remove it, which establishes the barrel re-export as the cause,
    but the lazy-export variant must be re-measured before ITEM-1 is claimed. This
    is exactly what TEST-1 asserts.
- **ITEM-2** adds a step to `npm run check`. A new gate that is wrong fails every
  future branch, so: it must not depend on a build being present (the build-based
  half is opportunistic), and it must not read its config from `.lifecycle/`
  (**B6** — a gate that reads a stripped path passes here and then fails
  permanently on main; this repo has already hit that on the desktop-override
  gate). The plan places the list at `src-app/ui/scripts/lazy-deps.json`.
- **ITEM-3** changes a gate shared by every consuming app. The change is strictly
  **narrowing** (it can only turn a FAIL into a PASS, never the reverse): a branch
  that adds ≤1 feature dir now passes where it previously failed on inherited
  siblings; a branch that adds ≥2 still fails. Failure mode if `git ls-tree` on
  the base throws (base has no `.lifecycle/`): the `catch` leaves `inherited`
  empty, so every dir counts as added — i.e. it degrades to the OLD behaviour,
  which is the safe direction.
- **ITEM-6** deletes a `console.log` in an e2e fixture. It cannot change test
  behaviour; `cargoPath` (the variable) is untouched and still used by the
  fallback branch.
- **ITEM-7** rewrites generated output. Zero code risk. Its only hazard is
  regenerating it on a CONTENDED box, where injected-error timing noise could
  change MEDIUM counts — so it must be regenerated in the same quiet-box run that
  produces the `gate:ui` result recorded in `TEST_RESULTS.md`.

## Pattern conformance

| Item | Reference mirrored | Conforms? |
|---|---|---|
| ITEM-1 | `src-app/ui/src/components/common/LazyDatePicker.tsx`; sibling `LazyStreamdown` | **Yes** — same `forwardRef` + `lazy` + `Suspense`/`Skeleton` shape, moved one layer down into the kit. |
| ITEM-2 | `src-app/ui/scripts/lint-hooks.mjs`, `check-gallery-fixtures.mjs` + their `*.test.mjs` + the `check:*` chain in `package.json` | **Yes** — plain Node script, own unit test, committed config file, chained into `npm run check`. |
| ITEM-3 | `checkA3` / `checkA10Enumeration` in the same file | **Yes** — pure function returning gap strings, reuses module-level `baseRef` + the existing `git()` helper. |
| ITEM-5 | the "Prove whether a saturated shared instance is env noise or an app bug" block it extends | **Yes** — same section, same probe-then-report structure. |
| ITEM-6 | the `console.log` two statements later in the same function | **Yes** — report the decision actually taken, in the branch that takes it. |

## Migration collisions

**None.** No migration is added. Migrations in this tree live per-crate under
`sdk/crates/*/migrations` and `src-app/desktop/tauri/migrations` with date
prefixes (`202607144000_…`); there is no `src-app/server/migrations` on this
branch and no integer sequence to collide on. (See `BASE.md`.)

## OpenAPI regen

**Not required.** No Rust request/response type, route, permission, or
`SyncEntity` changes. `src-app/{ui,desktop/ui}/openapi/openapi.json` and
`src-app/{ui,desktop/ui}/src/api-client/types.ts` are untouched, so the
merge-gate C3 regen-parity check has nothing to reconcile. Recorded explicitly
because a silent missing regen is the classic failure this section exists for.

## Existing-test interaction (the reason ITEM-1's design changed mid-plan)

`src-app/ui/src/components/common/LazyDatePicker.test.ts` (a previous round's
TEST-5) asserts the wrapper's source shape and that both elicitation consumers
use it. It is a **source-contract** test: it reads `LazyDatePicker.tsx` as text
and regex-matches `forwardRef<`, `{...props}`, `ref={ref}`,
`import('@ziee/kit/kit/date-picker')`, `Suspense`, `Skeleton`.

Two consequences:

1. **It is exactly the hollow-acceptance-test shape the lifecycle warns about
   (D2).** It passes today — while the dependency it exists to keep lazy is
   sitting in `index.html`'s `modulepreload` set. It cannot fail on "the built
   output still eagerly loads react-day-picker", because it never looks at the
   built output. This is the coverage gap ITEM-2's TEST-1 fills, and it is why
   TEST-1 must run a REAL production build rather than grep source.
2. **It constrains ITEM-1's design.** The first design (delete the barrel export,
   repoint the gallery story) would have been fine for this test, but the chosen
   design (lazy barrel export) is better AND strictly safer for it: the app-side
   `LazyDatePicker.tsx`, its two consumers, and therefore all three of this test's
   assertions are left completely untouched.

## Per-item verdicts

- **ITEM-1** — verdict: CONCERN — behaviourally correct and pattern-conformant,
  but "the lazy barrel export actually removes the chunk from `modulepreload`" is
  a build-output claim that is NOT yet proven for this variant (only for the
  delete-the-export variant). Must be measured before the item is claimed; TEST-1
  is that measurement. Also requires a `KIT_MANIFEST.md` regen check.
- **ITEM-2** — verdict: PASS — mirrors the `scripts/lint-*.mjs` family; B6-safe
  (config in the product tree); the build-dependent half degrades to a skip rather
  than a false failure.
- **ITEM-3** — verdict: PASS — narrowing-only change to a shared gate, with a
  safe degradation path; mirrors sibling checks in the same file. Submodule
  (`agent-kit`) — the coordinator pushes it before the superproject pointer.
- **ITEM-4** — verdict: PASS — the fix is proven (12-then-429 → 20/20 × 200) and
  the file is machine-local scratch, so it carries no merge risk. Its durable
  value is ITEM-5.
- **ITEM-5** — verdict: PASS — a documentation addition to the skill whose own
  discipline produced the finding. Submodule (`agent-kit`).
- **ITEM-6** — verdict: PASS — deletes one unconditional, factually-wrong log
  line; the adjacent log already reports the real branch taken.
- **ITEM-7** — verdict: CONCERN — pure regeneration, but it MUST be produced by
  the same quiet-box `gate:ui` run recorded in `TEST_RESULTS.md`, or the committed
  file and the recorded gate result can disagree.
- **ITEM-8** — verdict: PASS — `[DESCOPED]` with an approved disposition
  (DEC-6). Characterised with numbers and the obvious fix disproven by
  measurement, so the descope is a finding, not an omission.
- **ITEM-9** — verdict: CONCERN — `[DESCOPED]` with an approved disposition
  (DEC-7), but this is the UI/UX half of the round's mandate. The descope is
  honest (no valid inventory exists; INV-1/INV-4 forbid inventing findings) and
  the rig defects that blocked it are themselves fixed and delivered as ITEM-4/5 —
  but the round does NOT deliver UI/UX fixes, and that must be stated plainly
  rather than papered over.
