# TESTS — `lint:hooks`

Tiering mirrors the repo: `node --test` script tests next to the lint
(`scripts/*.test.mjs`, as `seam-codemod.test.mjs` / `gen-override-registry.test.mjs`
do), desktop parity in `vitest` (`src/dev/guardrails/*.test.ts`), and Playwright
specs for the surfaces the five code fixes touch.

The three acceptance tests do NOT use a hand-simplified snippet: they extract the
**verbatim pre-fix source** of the two real bugs out of git
(`git show 649ae7180^:…EnableSection.tsx`, `git show 57f9fdb5b^:…EditLlmModelDrawer.tsx`)
and run the REAL lint over it. That is what makes them fail if the rule is
narrowed to a special case — a test written against my implementation could not.

## Acceptance tests (design-invariant proofs)

- **TEST-1** (tier: unit) [acceptance] [invariant: INV-1] [covers: ITEM-1, ITEM-2] file: `src-app/ui/scripts/lint-hooks.test.mjs` — asserts: the lint reports an **H1** finding on the VERBATIM pre-fix `file-rag/.../EnableSection.tsx` (extracted from `649ae7180^`) at the `usePermission(READ_PERM) || usePermission(MANAGE_PERM)` line with context `logical-rhs`, and reports NOTHING on the post-fix version of the same file — i.e. the shipped BUG-A would have been caught, and its accepted fix is not flagged.
- **TEST-2** (tier: unit) [acceptance] [invariant: INV-2] [covers: ITEM-3, ITEM-4] file: `src-app/ui/scripts/lint-hooks.test.mjs` — asserts: the lint reports an **H2** finding on the VERBATIM pre-fix `llm-provider/.../EditLlmModelDrawer.tsx` (extracted from `57f9fdb5b^`) at the `modelId ? LlmProvider.providers…` line with context `ternary-branch`, and reports NOTHING on the post-fix version — i.e. the shipped BUG-B would have been caught. Uses the REAL proxy/action registries built from the live roots, so it also proves `LlmProvider` is recognised as a proxy and `providers` is not mistaken for an action.
- **TEST-3** (tier: unit) [acceptance] [invariant: INV-3] [covers: ITEM-9, ITEM-10, ITEM-11, ITEM-12, ITEM-13, ITEM-14] file: `src-app/ui/scripts/lint-hooks.test.mjs` — asserts: running the REAL lint with its default roots over the live `src-app/ui/src` + `src-app/desktop/ui/src` yields exactly **0 findings** and exit code 0. This is the zero-false-positive invariant AND the regression proof for all five code fixes: reverting any one of them turns this test red.
- **TEST-4** (tier: unit) [acceptance] [invariant: INV-4] [covers: ITEM-7] file: `src-app/ui/scripts/lint-hooks.test.mjs` — asserts: BOTH `src-app/ui/package.json` and `src-app/desktop/ui/package.json` define a `lint:hooks` script AND chain `run lint:hooks` inside `check`; and that invoking the wired command against a tree containing a known-bad file exits **non-zero** (a reintroduction fails the gate, not merely prints). Also asserts the lint reads nothing from `.lifecycle/` (B6: it survives the merge strip).

## Rule-behavior tests

- **TEST-5** (tier: unit) [covers: ITEM-1] file: `src-app/ui/scripts/lint-hooks.test.mjs` — asserts: the conditional-evaluation core — each of the six contexts (`ternary-branch`, `logical-rhs` for `&&`/`||`/`??`, `if-body`, `loop-body`, `switch-case`, `after-early-return`) is detected with the right label; the walk STOPS at the nearest function boundary (a hook/proxy read inside an `onClick={() => …}` or `useEffect(() => …)` callback is NOT reported as conditional by these rules); an inline `hook-order-ok` marker on the line or the line above suppresses the finding; `--root=<dir>` scopes REPORTING to that dir while the proxy/action registries still come from the full roots.
- **TEST-6** (tier: unit) [covers: ITEM-3, ITEM-4] file: `src-app/ui/scripts/lint-hooks.test.mjs` — asserts: the non-firing shapes stay silent — an unconditional proxy read; a `.$` snapshot read in any conditional; an action CALL (`Store.doThing()`) and an action passed BY REFERENCE inside a conditional (`{err && <Alert onClose={Auth.clearAuthenticationError} />}` — the shape that is the only source of false positives without the action registry); the five hook-free specials; and a same-named identifier imported from a NON-store specifier (`EditLlmModelDrawer` is both a proxy export and a component name — the two-factor test must not confuse them).
- **TEST-7** (tier: unit) [covers: ITEM-5, ITEM-8] file: `src-app/desktop/ui/src/dev/guardrails/detector-acceptance.test.ts` (extended) + `src-app/ui/scripts/lint-hooks.test.mjs` — asserts: the known-bad fixture exists in BOTH workspaces' `src/dev/gallery/__detector_fixtures__/` and the lint FIRES on it via the exact `--root=src/dev/gallery/__detector_fixtures__` invocation the acceptance harness uses; both `detector-acceptance.mjs` tables carry the O1 + O2 `kind: 'lint'` rows; the desktop (server-free) `detector-acceptance.mjs` still exits 0 with the new rows; the lint script is byte-identical between the two workspaces (drift guard, mirroring the geometry-detector identity check).
- **TEST-13** (tier: unit) [covers: ITEM-6] file: `src-app/ui/package.json` (`test:lint-hooks`) — asserts: the suite is wired as a runnable package script (`node --test scripts/lint-hooks.test.mjs`) alongside `test:seam-codemod`, and every case above passes when run through it.

## Surface-regression tests for the five code fixes

- **TEST-8** (tier: e2e) [covers: ITEM-10] file: `src-app/ui/tests/e2e/14-split-chat/popout-new-tab.spec.ts` — asserts: the pop-out affordance still renders and still opens the right conversation from BOTH a split pane and single-pane after the store reads are hoisted out of the `pane ? … : …` ternary (the surface whose conditional proxy read this item fixes).
- **TEST-9** (tier: e2e) [covers: ITEM-9] file: `src-app/ui/tests/e2e/projects/detail-page-layout.spec.ts` — asserts: the project files manage panel still renders + its upload affordance still respects permission after `usePermission(FilesUpload)` is called unconditionally.
- **TEST-10** (tier: e2e) [covers: ITEM-11] file: `src-app/ui/tests/e2e/hub/hub-mcp.spec.ts` — asserts: the hub MCP server details drawer still opens and shows the curated title (the value derived from the hoisted `HubCatalog.catalog` read).
- **TEST-11** (tier: e2e) [covers: ITEM-12] file: `src-app/ui/tests/e2e/llm/model-edit-delete.spec.ts` — asserts: the LLM models section still renders its model rows + action buttons after `LlmProvider.refreshingModels` is hoisted out of the `getRefreshButton` helper into the component body.
- **TEST-14** (tier: e2e) [covers: ITEM-14] file: `src-app/ui/tests/e2e/visual/pdf-viewer.spec.ts` — asserts: the REAL `PdfJsBody` (real pdfjs-dist PDFViewer, real canvas + text layer, run through the backend-free gallery drawer surface) still renders its document, toolbar, text layer, page-nav, zoom and find after the type guard moves into the `PdfJsBody` wrapper and the body becomes `PdfJsBodyInner` — and records ZERO `pageerror`s, which is exactly the crash class this item removes.
- **TEST-12** (tier: e2e) [covers: ITEM-13] file: `src-app/desktop/ui/tests/e2e/host-mount.spec.ts` — asserts: the desktop host-mount module still registers and its policy surfaces still render after the `ConversationHostMounts.byConversation` hoist. (The conversation-mounts control itself has no gallery/e2e surface today — DEC-9 records that gap and why the pure-hoist risk is accepted.)

## Coverage map (every ITEM → ≥1 TEST)

| ITEM | covered by |
|---|---|
| ITEM-1 | TEST-1, TEST-5 |
| ITEM-2 | TEST-1 |
| ITEM-3 | TEST-2, TEST-6 |
| ITEM-4 | TEST-2, TEST-6 |
| ITEM-5 | TEST-7 |
| ITEM-6 | TEST-13 |
| ITEM-7 | TEST-4 |
| ITEM-8 | TEST-7 |
| ITEM-9 | TEST-3, TEST-9 |
| ITEM-10 | TEST-3, TEST-8 |
| ITEM-11 | TEST-3, TEST-10 |
| ITEM-12 | TEST-3, TEST-11 |
| ITEM-13 | TEST-3, TEST-12 |
| ITEM-14 | TEST-3, TEST-14 |

No new permission is introduced by this diff (no `permissions.rs`, no migration
grant), so A10's `[negative-perm]` restricted-user e2e does not apply. ITEM-9
*touches* a permission-gated surface but neither defines nor grants a permission
— the gate there is unchanged (`Permissions.FilesUpload` is still consulted; only
the hook's call position moves).
