# PLAN — `lint:hooks` Rules-of-Hooks source guardrails

## Design source

Realizes `.lifecycle/hook-lint-guardrails/DESIGN.md` §2 (non-negotiables),
§3 (rule semantics H1/H2 + the shared conditional-evaluation core), §4 (home /
ziee-local vs sdk) and §5 (blast radius on the current tree).

Ground truth for the design is two real shipped crashes on `feat/agent-core`:
`649ae7180` (13 × `usePermission(A) || usePermission(B)`) and `57f9fdb5b`
(`EditLlmModelDrawer` conditional store-proxy read).

## Invariants

- **INV-1**: BUG-A's exact shape must be mechanically impossible to reintroduce — a hook call that is only *conditionally evaluated* is an error, generalized beyond `usePermission` to ANY `use*()` call.
- **INV-2**: BUG-B's exact shape must be mechanically impossible to reintroduce — a store-proxy field read that is only conditionally evaluated (ternary branch, `&&`/`||`/`??` right-hand side, `if`/`else` body, loop body, `switch` case, or after an early return) is an error.
- **INV-3**: The gate must be free of false positives on the current tree — the lint reports ZERO on `src-app/ui/src` + `src-app/desktop/ui/src` as they stand, so it can be wired into `npm run check` and stay green.
- **INV-4**: The gate must be wired into `npm run check` in every touched frontend workspace, so a reintroduction fails the build rather than a review.

## Items

- **ITEM-1**: `src-app/ui/scripts/lint-hooks.mjs` — the shared analyzer core: TS-compiler-API file walk over both UI roots, `--root=<dir>` override (fixture mode), `__detector_fixtures__` excluded from the default scan, `hook-order-ok` inline opt-out, a `condReason(node)` walker implementing the six conditional-evaluation contexts (stopping at the nearest enclosing function boundary), a `file:line [context] code` report and non-zero exit on any finding.
- **ITEM-2**: Rule **H1** — flag any `/^use[A-Z]/` call in a conditional context, excluding `after-early-return` (DEC-6).
- **ITEM-3**: Store-proxy + action registries — scan both roots for `export const X = registerLazyStore|defineStore|defineLocalStore|createStoreProxy|createNotificationsStore(…)` and `= …Def.store` (proxy names); build the action-name registry from `**/stores/**/actions/*.ts` basenames + function-valued/function-typed members declared in store files + any property observed CALLED on a proxy.
- **ITEM-4**: Rule **H2** — flag a conditionally-evaluated read of `Proxy.field` / `const { … } = Proxy`, where `Proxy` passes the two-factor test (store-module import specifier AND proxy-registry membership) and `field` is neither a special (`$`, `__setState`, `__refCount`, `__refTracker`, `__destroyed`) nor an action nor a call callee. All six contexts including `after-early-return`.
- **ITEM-5**: Known-bad fixture `src-app/ui/src/dev/gallery/__detector_fixtures__/ConditionalHooks.tsx` reproducing BOTH original bugs VERBATIM (the pre-fix `EnableSection` permission line and the pre-fix `EditLlmModelDrawer` ternary), plus a companion clean file proving the non-firing shapes (unconditional hooks, `.$` reads, action references, actions passed by reference).
- **ITEM-6**: `src-app/ui/scripts/lint-hooks.test.mjs` — `node --test` suite running the REAL lint (child process + in-process API) against the fixtures and against the live tree.
- **ITEM-7**: Mirror the lint + fixtures into the desktop workspace **byte-identically** (DEC-3/DEC-4: `src-app/desktop/ui/scripts/lint-hooks.mjs`, same `__detector_fixtures__` files) and wire `lint:hooks` into `npm run check` in BOTH `src-app/ui/package.json` and `src-app/desktop/ui/package.json`; add `test:lint-hooks` next to the existing `test:seam-codemod`; extend the desktop parity suite (`src/dev/guardrails/guardrail-parity.test.ts`) with the new gate.
- **ITEM-8**: Add taxonomy section `## O. React runtime correctness (Rules of Hooks)` with rows O1 (conditional hook call) and O2 (conditional store-proxy read) to `docs/DEFECT_TAXONOMY.md` in both workspaces, and two `kind: 'lint'` rows to BOTH `detector-acceptance.mjs` harnesses (the ui one, and the desktop server-free one) so the "trust the instrument" gate covers them.
- **ITEM-9**: Fix residual H1 violation — `src-app/ui/src/modules/file/project-extension/components/ProjectFilesManagePanel.tsx:55` (`canEdit && usePermission(FilesUpload)` — BUG-A verbatim).
- **ITEM-10**: Fix residual H2 violation — `src-app/ui/src/modules/chat/components/OpenInNewWindowAction.tsx:35` (proxy read in a ternary branch).
- **ITEM-11**: Fix residual H2 violation — `src-app/ui/src/modules/hub/modules/mcp/components/McpServerDetailsDrawer.tsx:41` (proxy read after an early return).
- **ITEM-12**: Fix residual H2 violation — `src-app/ui/src/modules/llm-provider/components/LlmModelsSection.tsx:326` (proxy read after two early returns inside a render helper).
- **ITEM-13**: Fix residual H2 violation — `src-app/desktop/ui/src/modules/host-mount/conversation-extension/components/ConversationMountsControl.tsx:28` (proxy read after an early return).
- **ITEM-14**: Fix residual H2 violation — `src-app/ui/src/modules/file/viewers/pdf/pdfjs-body.tsx:46` (`PdfHighlight.targets` read after the `if (!('file' in props)) return null` type guard). Found by the real lint during phase 5; DESIGN §5's hand-tallied blast-radius table listed 5 of the 6 (DRIFT-1.1). Fixed by the repo's component-per-case idiom: the type guard moves into a thin `PdfJsBody` wrapper so `PdfJsBodyInner`'s ~12 hooks — the proxy read included — all run unconditionally.

## Files to touch

- `src-app/ui/scripts/lint-hooks.mjs` (new) + byte-identical `src-app/desktop/ui/scripts/lint-hooks.mjs` (new)
- `src-app/ui/scripts/lint-hooks.test.mjs` (new)
- `src-app/ui/src/dev/gallery/__detector_fixtures__/ConditionalHooks.tsx` (new) + desktop mirror
- `src-app/ui/src/dev/gallery/__detector_fixtures__/ConditionalHooksClean.tsx` (new) + desktop mirror
- `src-app/ui/src/dev/gallery/__detector_fixtures__/stores/fixtureStore.ts` (new) + desktop mirror
- `src-app/ui/scripts/detector-acceptance.mjs` + `src-app/desktop/ui/scripts/detector-acceptance.mjs`
- `src-app/ui/docs/DEFECT_TAXONOMY.md` + `src-app/desktop/ui/docs/DEFECT_TAXONOMY.md`
- `src-app/ui/package.json`
- `src-app/desktop/ui/package.json`
- `src-app/desktop/ui/src/dev/guardrails/guardrail-parity.test.ts`
- `src-app/desktop/ui/src/dev/guardrails/detector-acceptance.test.ts`
- `src-app/ui/src/modules/file/project-extension/components/ProjectFilesManagePanel.tsx`
- `src-app/ui/src/modules/chat/components/OpenInNewWindowAction.tsx`
- `src-app/ui/src/modules/hub/modules/mcp/components/McpServerDetailsDrawer.tsx`
- `src-app/ui/src/modules/llm-provider/components/LlmModelsSection.tsx`
- `src-app/desktop/ui/src/modules/host-mount/conversation-extension/components/ConversationMountsControl.tsx`
- `src-app/ui/src/modules/file/viewers/pdf/pdfjs-body.tsx`

## Patterns to follow

| area | mirror this |
|---|---|
| AST source lint (structure, header doc, `--root=` override, `findFiles`, exit code) | `src-app/ui/scripts/lint-icon-action.mjs` (taxonomy C11) — the closest existing ziee-local guardrail |
| second reference for a gating source lint + inline opt-out marker | `sdk/packages/config/src/lint/logical-direction.mjs` (taxonomy N1, `rtl-ok` marker) |
| known-bad fixture placement + `--root` acceptance wiring | `src-app/ui/src/dev/gallery/__detector_fixtures__/{IconActionMismatch,NativeScroll}.tsx` + the `kind: 'lint'` rows in `scripts/detector-acceptance.mjs` |
| `node --test` script test | `src-app/ui/scripts/seam-codemod.test.mjs` / `gen-override-registry.test.mjs` (+ their `test:*` package scripts) |
| `check` chain wiring in both workspaces | the existing `lint:icon-action` (ziee-local) and `lint:colors` (relative cross-package) entries in both `package.json`s |
| taxonomy row style for a source lint | `docs/DEFECT_TAXONOMY.md` row **N1** (`[L]`, detector script named, opt-out marker documented) |
| the correct fixed form for BUG-A | `src-app/ui/src/modules/file-rag/components/sections/EnableSection.tsx` (post-`649ae7180`) |
| the correct fixed form for BUG-B | `src-app/ui/src/modules/llm-provider/components/llm-models/EditLlmModelDrawer.tsx` (post-`57f9fdb5b`) |

## UI-surface checklist

This feature adds **no UI surface** — it is build tooling plus five mechanical
hoists inside existing components. No page, drawer, card or panel is added,
removed, or restyled; no new render state, no new list, no new responsive
behavior, no new permission. The five fixes are pure hook-order hoists that
preserve rendered output exactly (each moves a read above a branch; the value
consumed downstream is identical).

Consequently: precedent / scale / device-size / populated-render / progress /
input-economy / JTBD / multi-instance / URL-focus / platform-affordance sections
are **N/A**, and the "verify it still renders identically" job is discharged by
the existing e2e specs that already cover the five touched surfaces (TEST-8..11)
plus the gallery runtime/`gate:ui` canary.

## Non-goals (this round)

- Not a general `rules-of-hooks` replacement: `after-early-return` for plain
  `use*()` calls (~20 pre-existing sites) is out of scope — DEC-6.
- Not a type-aware analysis: no `ts.Program`/checker; the two-factor registry
  heuristic is what keeps it fast and dependency-free.
- Not promoted into `sdk/packages/config/src/lint/` this round — DEC-2.
- No `.map()`/callback-boundary hook detection (a separate, already-known
  "reactive-read-in-loop" audit angle) — DEC-7.
