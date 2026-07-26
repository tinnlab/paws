# PLAN_AUDIT — `lint:hooks`

Audited against the real tree at `feat/hook-lint-guardrails` (base
`origin/feat/agent-core` @ `60b0db310`), with a calibration run of a prototype
detector over `src-app/ui/src` + `src-app/desktop/ui/src` before any code landed.

## Breakage risk

- **`npm run check` gains a gating step in BOTH workspaces.** The only way this
  breaks the build is a false positive. Calibrated blast radius on the current
  tree is **5 findings, 0 false positives** (DESIGN §5); all five are fixed by
  ITEM-9..13, taking the tree to 0. Risk accepted BECAUSE it was measured before
  planning, not asserted.
- **`--root=` fixture mode must bypass the default-scan exclusion**, exactly as
  `lint-icon-action.mjs` does, or `detector-acceptance` can never see the fixture.
- **The fixture files are compiled by `tsc`** (they live under `src/`), so they
  must be type-valid — the existing `__detector_fixtures__/*.tsx` are, and both
  workspaces carry their own copy of that dir. My fixtures land in the **ui**
  copy only; the desktop copy is untouched (its `check` runs the same single
  implementation, whose default scan excludes both fixture dirs).
- **`biome.json` already excludes `**/dev/gallery/__detector_fixtures__/**`** from
  the grit plugins, so an intentionally-bad fixture cannot trip `lint:guardrails`.
- **The 5 component fixes are hoists, not behavior changes.** Each moves a read
  above a branch/guard; the value consumed downstream is byte-identical. The two
  with the widest blast radius are `OpenInNewWindowAction` (split-chat pop-out,
  covered by `tests/e2e/14-split-chat/popout-new-tab.spec.ts`) and
  `LlmModelsSection` (covered by `tests/e2e/llm/`). Hoisting a store read above a
  guard means the component now *subscribes* in states where it previously did
  not — that is precisely the point (a stable hook count) and costs one extra
  subscription, never a render-output change.
- **Desktop wiring by relative path** (`node ../../ui/scripts/lint-hooks.mjs`)
  introduces a desktop→ui script dependency. Precedent exists: desktop's
  `lint:colors` already reaches out with `node ../../../sdk/packages/config/...`.
  The alternative (a byte-identical duplicated copy, as `lint-icon-action.mjs`
  does) was rejected — see DEC-3.

## Pattern conformance

| item | reference mirrored | conforms |
|---|---|---|
| ITEM-1..4 | `scripts/lint-icon-action.mjs` — header doc block, `createRequire`+`typescript`, `findFiles` walk, `--root=` override, `HERE`-relative default roots, finding lines + non-zero exit | yes |
| ITEM-1 opt-out marker | `sdk/packages/config/src/lint/logical-direction.mjs` `rtl-ok` inline marker | yes |
| ITEM-5 | `src/dev/gallery/__detector_fixtures__/{IconActionMismatch,NativeScroll}.tsx` + its `README.md` | yes |
| ITEM-6 | `scripts/seam-codemod.test.mjs`, `scripts/gen-override-registry.test.mjs` (`node --test`, a `test:*` package script) | yes |
| ITEM-7 | the `lint:icon-action` (ziee-local) + `lint:colors` (relative cross-package) entries already in both `check` chains | yes |
| ITEM-8 | taxonomy row **N1** (`[L]` source lint, names its script + opt-out) and the two existing `kind: 'lint'` acceptance rows (`#10b` C11, `#17` J8) | yes |
| ITEM-9 | the post-`649ae7180` shape in `file-rag/.../EnableSection.tsx` | yes |
| ITEM-10..13 | the post-`57f9fdb5b` shape in `llm-models/EditLlmModelDrawer.tsx` (hoist the read, comment WHY) | yes |

Deviation, deliberate: **no duplicated desktop copy** of the lint script (DEC-3).

## Migration collisions

None. This branch adds no migration and touches no `migrations/` directory in
either the SDK crates or `src-app/desktop/tauri`. See BASE.md.

## OpenAPI regen

Not implied. No Rust handler, no `JsonSchema` type, no route change; neither
`openapi/openapi.json` nor `src/api-client/types.ts` is touched in either
workspace, so `just openapi-regen` is a no-op for this diff.

## Pre-existing base condition (not introduced here)

`lifecycle-check` **A1** ("a branch may carry exactly ONE `.lifecycle` feature
dir") fails on this branch because the base `origin/feat/agent-core` already
carries 7 feature dirs (`git ls-tree -d origin/feat/agent-core .lifecycle/`
lists agent-orchestration, e2e-render-serving, frontend-perf,
smart-module-loading, streamdown-html-renderer, workflow-kind-agent,
worktree-isolation). Deleting them would put an unrelated 7-feature deletion in
this diff. Recorded as DEC-8; every phase gate below is read as "the
phase-specific check is green; A1 is inherited".

## Per-item verdicts

- **ITEM-1** — verdict: PASS — mirrors `lint-icon-action.mjs` structurally; the `condReason` walker was prototyped against the real tree before planning, so the six contexts are calibrated, not guessed.
- **ITEM-2** — verdict: PASS — H1 with `after-early-return` excluded measures 1 finding tree-wide (the real ProjectFilesManagePanel bug); with it included it measures 21, i.e. 20 pre-existing type-guard sites. The exclusion is what makes INV-3 attainable without an unrelated refactor (DEC-6).
- **ITEM-3** — verdict: PASS — registries measured on the tree: 297 proxy names, 595 action names. Suppressing actions is load-bearing: without it the only 2 false positives in the whole tree are action-by-reference props (`onClose={Auth.clearAuthenticationError}`).
- **ITEM-4** — verdict: PASS — the two-factor proxy test (store-module specifier AND proxy-registry membership) is required, not belt-and-braces: `EditLlmModelDrawer` is BOTH a store-proxy export and a component name, so a name-only registry would false-flag component imports.
- **ITEM-5** — verdict: CONCERN — the fixture must reproduce the ORIGINAL code verbatim (D2: assert the design's promise, not the code's behavior). A hand-simplified snippet would let the lint pass while the real shape slips through. Mitigation: the fixture is copied from `git show 649ae7180^:…EnableSection.tsx` and `git show 57f9fdb5b^:…EditLlmModelDrawer.tsx` and cited inline. Also: fixtures live under `src/` so they must satisfy `tsc` — verified in phase 8's `npm run check`.
- **ITEM-6** — verdict: PASS — `node --test` script tests already exist (`seam-codemod.test.mjs`); the loader (`scripts/node-test-loader.mjs`) is only needed for TS sources, and a `.mjs` test needs none.
- **ITEM-7** — verdict: PASS — additive one-token edits to both `check` chains. B6 satisfied: the lint reads nothing from `.lifecycle/` (its only inputs are the two `src` roots), so it survives the merge strip.
- **ITEM-8** — verdict: CONCERN — `detector-acceptance.mjs` launches chromium for the geometry rows, so the two new `kind: 'lint'` rows cannot be verified without booting the gallery. Phase 8 already boots the gallery for `gate:ui` (A7), so this is sequenced there; if the harness proves unrunnable the rows are still statically verified by TEST-3 (the unit test runs the identical `--root=<fixture-dir>` invocation the harness uses). Also note the taxonomy doc exists in BOTH workspaces (`ui/docs` and `desktop/ui/docs`); only the ui copy is authoritative for a ui-scoped detector, matching how N1/C11 are documented.
- **ITEM-9** — verdict: PASS — `ProjectFilesManagePanel.tsx:55` is BUG-A verbatim (`canEdit && usePermission(Permissions.FilesUpload)`); the fix is the exact post-`649ae7180` shape. Covered by `tests/e2e/projects/detail-page-layout.spec.ts`.
- **ITEM-10** — verdict: CONCERN — `OpenInNewWindowAction.tsx` reads a proxy in BOTH ternary branches (`pane.store.conversation` vs `Chat.conversation`); only the second is a bare-identifier proxy read the lint sees. The fix must hoist BOTH (the `pane.store` per-instance read is the same hazard) or the file is only half-correct. `pane` is context-derived and stable per mounted instance, so this is latent-not-live — fix it properly rather than opt out. Covered by `tests/e2e/14-split-chat/popout-new-tab.spec.ts`.
- **ITEM-11** — verdict: PASS — hoist `HubCatalog.catalog` above `if (!server) return null`. Note the component ALSO calls no other hook, so the hoist is trivially safe.
- **ITEM-12** — verdict: CONCERN — the read sits inside the nested render-helper `getRefreshButton = () => {…}` behind two early returns. Hoisting must move the read into the COMPONENT body (above the helper), not merely above the helper's guards, or the helper still owns a conditional hook when called from a conditional branch. Covered by `tests/e2e/llm/`.
- **ITEM-13** — verdict: PASS — desktop-only file; hoist `ConversationHostMounts.byConversation` above `if (!conversationId) return null` and index it afterwards. Desktop `npm run check` (tsc) covers compilation; there is no desktop e2e for this control, so unit-level coverage is the lint itself plus `tsc`.
