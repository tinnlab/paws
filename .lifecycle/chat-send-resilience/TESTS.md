# TESTS — chat-send-resilience

Every test below was written to be **RED first** against the unmodified tree, for
the real reason (see `REPRO.md` for the recorded red runs and the negative
control). No test asserts "the new code runs"; each asserts the property the
design promises.

## Unit — registry fail-closed (ITEM-1, ITEM-2)

- **TEST-1** (tier: unit) [covers: ITEM-1] file: `src-app/ui/src/modules/chat/core/extensions/composeRequestFields.test.ts` — asserts: when a contributor's `composeRequestFields` rejects, composition REJECTS instead of resolving with the surviving contributors' fields (the literal defect: it must not return `fields` silently missing that contributor's keys), and the error names the extension + carries the cause + the recovery step. (Targets the pure helper `registry.tsx` delegates to — DRIFT-1.5; the registry's delegation is proven by TEST-9 + TEST-13.)
- **TEST-2** (tier: unit) [covers: ITEM-1] file: `src-app/ui/src/modules/chat/core/extensions/composeRequestFields.test.ts` — asserts: with TWO failing contributors, every contributor is still invoked in order (no short-circuit, no skipped healthy contributor) and the thrown error names BOTH failing extensions, so one failure cannot hide another; and the per-contributor `console.error` is still emitted (the log did not regress).
- **TEST-3** (tier: unit) [covers: ITEM-1] file: `src-app/ui/src/modules/chat/core/extensions/composeRequestFields.test.ts` — asserts: the all-succeed path is byte-identical to today — the merged field object is returned, later contributors override earlier keys, and nothing throws.
- **TEST-4** (tier: unit) [covers: ITEM-2] file: `src-app/ui/src/modules/chat/core/extensions/requestFieldFailure.test.ts` — asserts: the message builder names the failing extension + its underlying cause and ends with the "Reload the page and try again" recovery step; a cause with no usable message falls back rather than rendering an empty string.
- **TEST-5** (tier: unit) [covers: ITEM-2, ITEM-7] file: `src-app/ui/src/modules/chat/core/extensions/requestFieldFailure.test.ts` — asserts: when the framework has recorded a stale-build/chunk-load condition the message ADDS the "the app may have been updated" sentence, and omits it otherwise.

## Unit — lazy-dispatch recovery (ITEM-5, ITEM-6)

- **TEST-6** (tier: unit) [acceptance] [invariant: INV-2] [covers: ITEM-5] file: `sdk/packages/framework/src/lazy-dispatch.test.ts` — asserts: a dispatcher whose MODULE IMPORT rejects through a whole dispatch's retry budget still succeeds on a LATER dispatch once the blip clears — i.e. a transient chunk-load blip does NOT permanently brick the action for the session; and the rejection is never memoized however many times it fails. Would fail under the shipped one-retry-then-memoize-forever policy.
- **TEST-7** (tier: unit) [covers: ITEM-5, ITEM-7] file: `sdk/packages/framework/src/lazy-dispatch.test.ts` — asserts: a deterministic FACTORY (impl-build) throw is STILL memoized after the retry budget — the module is not re-imported and the factory is not re-run on subsequent dispatches — preserving the documented "an authoring bug must fail fast, not loop forever" rationale (the negative control for TEST-6's relaxation); and, in the same file, that a NULLISH module namespace — exactly what a preventDefaulted `vite:preloadError` produces — is classified as a retryable IMPORT failure instead of being misfiled as a memoized factory bug.
- **TEST-8** (tier: unit) [covers: ITEM-5, ITEM-6] file: `sdk/packages/framework/src/lazy-dispatch.test.ts` — asserts: the happy path memoizes exactly once (one import, one factory call across N dispatches) and `preload()` warms without invoking the action — the store-kit contract the two-stage signature must preserve.

## Unit — chunk-load recovery listener (ITEM-7)

- **TEST-11** (tier: unit) [covers: ITEM-7] file: `sdk/packages/framework/src/chunk-recovery.test.ts` — asserts: `installChunkLoadRecovery` subscribes to `vite:preloadError`, flips `isStaleBuild()` true, and **does NOT call `preventDefault()`** (which would make Vite's helper resolve the import promise with `undefined` instead of rejecting, silently defeating both the dispatcher retry and the caller's error handling — DRIFT-1.7); and returns an uninstall that removes the listener, with a double install registering exactly one listener.

- **TEST-16** (tier: unit) [covers: ITEM-8] file: `src-app/ui/src/main.entry-wiring.test.ts` — asserts: BOTH app entries (`src-app/ui/src/main.tsx` and `src-app/desktop/ui/src/main.tsx`) import `installChunkLoadRecovery` from the framework and CALL it at module scope. Desktop ships a hand-written entry that does not fall back to core UI, so "forgot the desktop half" is the real, precedented failure mode (R2-3) and only a cross-workspace source assertion catches it. Mirrors the existing file-reading unit test `src-app/ui/src/index.css.auth-backdrop.test.ts`.

## Unit — send-path guards (ITEM-3, ITEM-4)

- **TEST-9** (tier: unit) [acceptance] [invariant: INV-1] [covers: ITEM-3] file: `src-app/ui/src/modules/chat/core/stores/chat/sendMessage.store.test.ts` — asserts: with a registry whose contributor fails (driven through the REAL registry, not a stubbed method), `sendMessage` issues ZERO send requests and leaves `store.error` set to an actionable message that names the failing extension and does not read like a server validation string — the design's "must not produce a silent invalid send; surface a user-visible, actionable error instead of a raw 422".
- **TEST-10** (tier: unit) [acceptance] [invariant: INV-3] [covers: ITEM-4] file: `src-app/ui/src/modules/chat/core/stores/chat/sendMessage.store.test.ts` — asserts: when `composeRequestFields` RESOLVES (throws nothing) but omits `model_id`, `sendMessage` still issues ZERO send requests and surfaces an error — so the pre-POST presence check is proven independently of the fail-closed registry. Also asserts the same for a missing `content`.
- **TEST-12** (tier: unit) [covers: ITEM-3] file: `src-app/ui/src/modules/chat/core/stores/chat/sendMessage.store.test.ts` — asserts: the in-flight latch is released after a composition abort (a second, healthy send goes through), so the fail-closed path cannot wedge the composer.

## E2E — the deterministic production repro (ITEM-1..ITEM-4)

- **TEST-13** (tier: e2e) [acceptance] [invariant: INV-1] [covers: ITEM-1, ITEM-2, ITEM-3, ITEM-4] file: `src-app/ui/tests/e2e/chat/send-field-composition-failure.spec.ts` — asserts: with a real backend, a real provider+model seeded, and the `model` extension's lazily-imported `getModelId`/`defaultModelId` ACTION MODULES blocked at the network layer (a static ES-module URL, never an `/api/` route), pressing Enter in the composer issues ZERO `POST /api/conversations/{id}/messages`, shows a visible error surface whose text is actionable (names the model extension / tells the user to reload) and is NOT the raw `missing field \`model_id\`` 422 string, and raises no uncaught page error. This is the literal reported chain — a dynamic import fails → the contributor rejects → the send must not proceed.
- **TEST-14** (tier: e2e) [covers: ITEM-5, ITEM-6] file: `src-app/ui/tests/e2e/chat/send-field-composition-failure.spec.ts` — asserts: after the module block is LIFTED, a subsequent send from the same page (no reload) succeeds and issues the POST — proving the transient blip did not permanently brick the lazy action for the session, through the real store-kit → lazy-dispatch → Vite module path rather than a unit double.
- **TEST-15** (tier: e2e) [covers: ITEM-3] file: `src-app/ui/tests/e2e/chat/send-field-composition-failure.spec.ts` — asserts: the composer is still usable after the aborted send (textarea enabled, send button enabled, the typed text preserved) — a fail-closed abort must not wedge or clear the composer.

## Migrated pre-existing specs (DRIFT-1.1 / DRIFT-1.2)

Not new TEST-IDs — recorded so phase 8 runs them and the audit can see why they
changed:

- `src-app/ui/src/api-client/lazy-dispatch.test.ts` — migrated to the two-stage
  `createLazyDispatcher(importModule, buildImpl)`. Its
  `'a TRANSIENT chunk failure is retried'` spec was a **test that certified the
  bug** (it failed the loader exactly ONCE — the only case the shipped one-retry
  policy survived) and is widened to fail through two whole dispatch retry
  budgets; its `'a DETERMINISTIC resolve failure is memoized'` sibling now drives
  the BUILD stage explicitly instead of the conflated combined loader.
- `src-app/ui/src/api-client/shared-infra.test.ts` — signature migration only.
- `src-app/ui/src/modules/chat/core/stores/chat/sendMessage.store.test.ts` — the
  shared `stubRegistry()` default now composes a VALID body
  (`content` + `model_id`); it had been modelling a structurally invalid request
  as the normal case (DRIFT-1.3).

## E2E — prefetch failures are not page errors (ITEM-9)

- **TEST-17** (tier: e2e) [covers: ITEM-9] file: `src-app/ui/tests/e2e/chat/send-field-composition-failure.spec.ts` — asserts: across the whole blocked-chunk journey NO uncaught page error is raised (`page.on('pageerror')` is empty). A distinct property from TEST-13/14/15 and a distinct assertion: the boot-time lazy-action PREFETCH warms every chunk fire-and-forget, so a blocked chunk used to produce unhandled rejections from `autoWarmLazyActions` alone — which is exactly how this leg first failed.

## Notes on gates

- **A10 / `[negative-perm]`**: not applicable — this branch introduces no
  permission (no `modules/*/permissions.rs` change, no migration grant).
- **UI e2e requirement**: satisfied by TEST-13/14/15 (`src-app/ui/**` is touched).
- **`check:state-matrix`**: no new conditional render state is introduced (see
  PLAN's UI-surface checklist), so no gallery cell is added.
- **R2-5**: the e2e adds no `/api/` route mock. Its only `page.route` targets a
  static ES-module URL under `/src/modules/...`, asserted non-`/api/` in the spec.
