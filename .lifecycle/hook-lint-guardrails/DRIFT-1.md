# DRIFT-1 — implementation vs plan / design

Authored DURING phase 5, item by item, as each landed (FB-18).

- **DRIFT-1.1** — verdict: plan-wins — **The blast-radius table under-counted by one.**
  DESIGN §5 listed 5 residual violations (hand-tallied from the prototype run);
  the REAL lint found **6** — `src-app/ui/src/modules/file/viewers/pdf/pdfjs-body.tsx:46`
  (`PdfHighlight.targets` read after the `if (!('file' in props)) return null`
  type guard) was missed when transcribing the prototype output. INV-3 ("ZERO on
  the current tree") is a design invariant, so the instrument wins over my tally:
  PLAN gained **ITEM-14**, TESTS gained **TEST-14** (+ ITEM-14 into TEST-3's
  covers list), and phases 1-3 were re-gated green. No invariant was relaxed to
  accommodate it. Fixed with the repo's component-per-case idiom (`PdfJsBody`
  wrapper + `PdfJsBodyInner`), which additionally makes that component's other
  ~12 hooks unconditional.

- **DRIFT-1.2** — verdict: plan-wins — **The desktop workspace needed a
  byte-identical COPY, not a relative cross-workspace call.** PLAN_AUDIT's
  breakage section leaned toward one implementation invoked from desktop by
  relative path. Implementation found the desktop parity contract
  (`src/dev/guardrails/guardrail-parity.test.ts` asserts the desktop `check`
  chain owns each gate; `detector-acceptance.test.ts` asserts the desktop copies
  of the detector scripts + fixtures EXIST and are byte-faithful), which a
  cross-workspace call would break. Resolved in DEC-3 (copy + a byte-identity
  drift guard) and DEC-4 (candidate-relative roots so ONE file scans both roots
  from either location); PLAN ITEM-7 + `Files to touch` amended to match. This
  also avoids inheriting the stale `../../desktop/ui/src` root in the desktop
  copy of `lint-icon-action.mjs`, which resolves nowhere.

- **DRIFT-1.3** — verdict: impl-wins — **`ConditionalHooks.tsx` uses a local
  fixture store, not a real app store.** PLAN ITEM-5 said the fixture reproduces
  the originals "VERBATIM". A verbatim copy would import `@/modules/llm-provider/
  stores/llmProvider`, which does not resolve identically in both workspaces and
  would couple a lint fixture to app internals. The fixture keeps the SHAPES
  verbatim but binds them to a self-contained
  `__detector_fixtures__/stores/fixtureStore.ts`. The verbatim-source obligation
  is discharged where it actually matters — the ACCEPTANCE tests (TEST-1/TEST-2)
  lint the real pre-fix blobs extracted from `649ae7180^` / `57f9fdb5b^`.
  Recorded as DEC-12; no plan amendment needed beyond that clarification.

- **DRIFT-1.4** — verdict: none — **The `OpenInNewWindowAction` fix went further
  than "hoist the read".** PLAN_AUDIT ITEM-10 flagged that BOTH ternary branches
  read a proxy (`pane.store.conversation` and `Chat.conversation`) and that only
  the second is visible to the lint. Hoisting cannot fix the first (there is no
  `pane.store` when `pane` is null), so the item was implemented as
  component-per-case (`OpenInNewWindowInPane` / `OpenInNewWindowSinglePane` /
  a shared `OpenInNewWindowButton`), which the audit itself called for. Plan and
  implementation agree; recorded so the wider-than-a-hoist diff is not a surprise
  at review.

- **DRIFT-1.5** — verdict: none — **Three desktop guardrail vitest failures are
  pre-existing on the base, not caused by this branch.**
  `detector-acceptance.test.ts` ("exits 0"), `guardrail-parity.test.ts`
  ("gallery-geometry-audit.mjs is byte-identical"), and
  `overlay-registry.test.ts` ("overlays.tsx present") fail identically on a
  pristine `origin/feat/agent-core` worktree (verified by running the same three
  files there: `3 failed | 18 passed` both before and after). The root cause is a
  pre-existing drift in `gallery-geometry-audit.mjs` (the desktop copy lacks the
  web copy's `resolveGalleryPort` import) plus a missing desktop
  `overlays.tsx` — both untouched by this diff. My two new rows in the desktop
  acceptance harness report `OK ✓`. Not fixed here: repairing another feature's
  drift inside this branch would be exactly the shared-infra workaround B3
  forbids.

**Unresolved drifts:** 0
