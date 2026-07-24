# DRIFT-1 — implementation vs plan

The original plan (ITEM-1..5) targeted the TWO breakages the brief named
(A: AppLayout seam + TextStore; B: desktop kit-manifest + 5 MISSING_EXPORT).
During implementation the desktop `npm run check` and desktop prod build each
revealed a CASCADE of additional PRE-EXISTING failures that were MASKED on the
base: the failing checks/build errors short-circuit at the FIRST failure, so
fixing the named breakage unmasks the next. All share ONE root cause — the
SDK/monorepo migration (kit → `@ziee/kit`, generators → shared SDK, store
migration `Stores.X` → `X`) left desktop tooling + several committed generated
files behind. These are `impl-wins` drifts: the plan was incomplete about the
true scope of "make the gates green," so PLAN.md + TESTS.md were amended
(ITEM-6..10, TEST-5) and phases 1–3 re-gated.

- **DRIFT-1.1** — verdict: impl-wins — desktop `check:design-spec` used default
  paths (pre-SDK), resolving a nonexistent `desktop/ui/DESIGN_SYSTEM.md`. Amended
  PLAN with ITEM-6 (point at the shared root spec + desktop css, mirroring the
  server `ui` script). Masked on base behind `check:kit-manifest` (ITEM-4).

- **DRIFT-1.2** — verdict: impl-wins — the desktop LOCAL `gen-overlay-registry.mjs`
  only recognized `@/components/ui` imports, so a controlled Popover from
  `@ziee/kit` (`ConversationMountsControl`) was no longer detected as a host,
  making its allow-list entry "stale." Amended PLAN with ITEM-7 (teach the local
  gen `@ziee/kit`; regen returns the generated file to the base's 1-host state).

- **DRIFT-1.3** — verdict: impl-wins — `stateMatrix.generated.ts` was stale in
  BOTH workspaces (base store-migration refactor changed source without
  regenerating). Amended PLAN with ITEM-8 (regen both). The web regen also folds
  in ITEM-3's new registry branch signals (legitimate own-diff drift).

- **DRIFT-1.4** — verdict: impl-wins — the desktop `GALLERY_SEED_MANIFEST.md` was
  stale (a new base `tunnelAuth` module never folded in). Amended PLAN with ITEM-9
  (regen).

- **DRIFT-1.5** — verdict: impl-wins — the desktop prod build failed on
  `virtual:ziee-module-manifest` from `ui/src/loader.ts` after ITEM-5 fixed the
  MISSING_EXPORTs: `ui/src/index.ts`'s barrel re-exported `loadModules` via a
  RELATIVE `./modules/loader`, bypassing the desktop `localOverridePlugin` and
  dragging the web `loader.ts` into the desktop bundle. Amended PLAN with ITEM-10
  (use the `@/`-aliased specifier). Masked on base behind the MISSING_EXPORTs.

- **DRIFT-1.6** — verdict: resolved — the register-time async `import().then()`
  fallback in `registry.tsx` is RETAINED (not removed) for the out-of-order-load
  edge; matches the plan's ITEM-3 intent (synchronous PRIMARY seed, async only as
  a safety net). No re-implementation needed.

**Unresolved drifts:** 0
