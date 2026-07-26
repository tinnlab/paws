# DESIGN — Rules-of-Hooks source guardrails (`lint:hooks`)

> The named upstream design this feature realizes. Written first (no prior design
> doc existed) from two REAL, already-shipped, user-facing React crashes on
> `feat/agent-core`, both of which passed every gate the repo had at the time.

## 1. The two shipped bugs (the ground truth)

### BUG-A — `usePermission(A) || usePermission(B)` (fixed in `649ae7180`)

```tsx
// BEFORE (shipped, crashed):
const canRead = usePermission(READ_PERM) || usePermission(MANAGE_PERM)
const canManage = usePermission(MANAGE_PERM)
```

`||` short-circuits: when `usePermission(READ_PERM)` is truthy the SECOND hook is
never called, so the component's hook COUNT is a function of permission state.
The moment that state flips (bootstrap `/auth/me` resolving, an admin losing a
grant, a gallery cell switching fixtures) React throws
**"Rendered more hooks than during the previous render."**

It shipped in **13 sites** — every `*Section.tsx` admin card in `file-rag`,
`memory`, and `summarization`. The fix is to call both hooks unconditionally and
OR the *results*:

```tsx
// AFTER (correct):
const canManage = usePermission(MANAGE_PERM)
const canRead = usePermission(READ_PERM) || canManage
```

### BUG-B — conditionally-evaluated store-proxy field read (fixed in `57f9fdb5b`)

```tsx
// BEFORE (shipped, crashed on opening the edit-model drawer):
const currentModel = modelId
  ? LlmProvider.providers.flatMap(p => p.llm_models || []).find(m => m.id === modelId)
  : null
```

In this codebase a reactive store-proxy field read **IS a hook**: path 4 of
`createStoreProxy` calls `useEffect` + `useStore(useShallow(...))`
(`sdk/packages/framework/src/stores.ts`, which carries its own
`rules-of-hooks` eslint-disable). Reading `LlmProvider.providers` inside the
`modelId ? … : …` ternary made the hook count jump when `modelId` flipped
`null → set` as the drawer opened → the same crash.

### Why the existing gates missed both

* `react-hooks/rules-of-hooks` is **not run** — the repo lints with Biome, and
  `biome.base.json` does not enable `useHookAtTopLevel` (`npm run lint:guardrails`
  is scoped to `--only=style/noRestrictedImports`).
* Even if it were enabled, BUG-B is **invisible** to it: `LlmProvider.providers`
  is a property read, not a `use*()` call. No off-the-shelf rule can know that a
  property access on a store proxy is a hook — only a project-specific lint can.
* Unit tests cannot catch either: both only manifest when the condition FLIPS
  between two real renders.

## 2. Non-negotiables (lifted as INV-N in PLAN.md)

1. **BUG-A's exact shape must be mechanically impossible to reintroduce** — a
   hook call that is only *conditionally evaluated* is an error, generalized
   beyond `usePermission` to ANY `use*()` call.
2. **BUG-B's exact shape must be mechanically impossible to reintroduce** — a
   store-proxy field read that is only conditionally evaluated (ternary branch,
   `&&`/`||`/`??` right-hand side, `if`/`else` body, loop body, `switch` case, or
   after an early return) is an error.
3. **The gate must be free of false positives on the current tree** — the lint
   reports ZERO on `src-app/ui/src` + `src-app/desktop/ui/src` as they stand
   (both bugs already fixed), so it can be wired into `npm run check` and stay
   green. A lint that cries wolf gets disabled.
4. **The gate must be wired into `npm run check`** in every touched frontend
   workspace, so a reintroduction fails the build rather than a review.

## 3. Rule semantics

### Shared core — "conditionally evaluated"

An expression is *conditionally evaluated* when, walking up its ancestors and
**stopping at the nearest enclosing function boundary**, it sits in one of:

| context | example |
|---|---|
| `ternary-branch` | `cond ? HERE : x` / `cond ? x : HERE` |
| `logical-rhs` | `a && HERE`, `a \|\| HERE`, `a ?? HERE` |
| `if-body` | `if (c) { HERE }` / `else { HERE }` |
| `loop-body` | `for/while (…) { HERE }` |
| `switch-case` | `case 'a': HERE` |
| `after-early-return` | a statement that follows an `if (…) return/throw` guard in the same function body |

Stopping at the function boundary is what keeps callbacks (`onClick={() => …}`,
`useEffect(() => …)`) out of scope — their body is not the render path of the
enclosing component.

### Rule H1 — conditionally-evaluated hook call

Any call to an identifier matching `/^use[A-Z]/` in a conditional
*expression* position (`ternary-branch`, `logical-rhs`) or statement position
(`if-body`, `loop-body`, `switch-case`).

`after-early-return` is **deliberately excluded from H1**: it is the classic
type-guard pattern (`if (!('file' in props)) return null` then hooks), present at
~20 pre-existing sites, and is the standard `rules-of-hooks` rule's territory —
including it would make the gate un-green-able without a large unrelated refactor.
Recorded as a known, deliberate gap (DEC-6).

### Rule H2 — conditionally-evaluated store-proxy read

A read of `Proxy.field` (or a destructure `const { … } = Proxy`) in ANY of the six
contexts, where `Proxy` is a **store proxy** and `field` is **not** an action and
not a hook-free special.

Store-proxy identification is a two-factor test (both must hold — this is what
buys the zero-FP budget):

1. the local binding is imported from a **store module specifier**
   (`…/stores/…`, `…/store`, `*.store`, `@ziee/framework/stores`), AND
2. its *original* exported name is in the **proxy registry** — every
   `export const X = registerLazyStore(…) | defineStore(…) | defineLocalStore(…) |
   createStoreProxy(…) | …Def.store` found by scanning the same roots.

Not a hook (never flagged):

* the five special properties `$`, `__setState`, `__refCount`, `__refTracker`,
  `__destroyed` — they return synchronously (path 1 of `createStoreProxy`).
* **actions** (path 2) — resolved from `getState()`, safe anywhere, including when
  passed by reference (`onClose={Auth.clearAuthenticationError}` — the shape that
  otherwise produces the only false positives). The action registry is the union of
  (a) file basenames under `**/stores/**/actions/*.ts` (the `import.meta.glob`
  action convention), (b) function-valued / function-typed members declared in
  store files, and (c) any property observed being CALLED on a proxy anywhere.
* a member that is itself the callee of a call — `Proxy.doThing()`.

### Escape hatch

A genuinely-stable conditional (a value that cannot flip for the lifetime of a
mounted component) opts out with an inline **`hook-order-ok`** marker on the
offending line or the line above — mirroring the repo's existing `rtl-ok` /
`data-allow-icon` idiom. It must carry a reason. Ships with **zero** uses.

## 4. Home

`src-app/ui/scripts/lint-hooks.mjs`, ziee-local, matching the two existing
ziee-local AST guardrails (`lint-icon-action.mjs` taxonomy C11,
`lint-native-scroll.mjs` taxonomy J8): TypeScript-compiler-API AST, `--root=`
override for fixtures, a `__detector_fixtures__` known-bad instance, and a row in
the detector-acceptance table.

The newer shared lints live in `sdk/packages/config/src/lint/` and are called from
both workspaces by relative path. That is the natural long-term home for H2 in
particular (the store-proxy-is-a-hook rule is a property of the SDK's store-kit,
not of ziee). It is NOT used here because `sdk` is a git submodule pinned to a
branch that cannot be pushed in this round — a lint committed there would leave
the ziee branch pointing at an unpushed submodule commit and un-landable. The
promotion is a mechanical move (the script is dependency-free apart from
`typescript`); recorded as DEC-2.

## 5. Blast radius on the current tree

Running the calibrated detector over `src-app/ui/src` + `src-app/desktop/ui/src`
yields **5 findings, 0 false positives** — all five are genuine, still-unfixed
instances of the two bug classes that survived the original fixes. They must be
fixed for INV-3 to hold:

| # | site | class |
|---|---|---|
| 1 | `file/project-extension/components/ProjectFilesManagePanel.tsx:55` | H1 `canEdit && usePermission(FilesUpload)` — BUG-A verbatim |
| 2 | `chat/components/OpenInNewWindowAction.tsx:35` | H2 ternary — BUG-B verbatim |
| 3 | `hub/modules/mcp/components/McpServerDetailsDrawer.tsx:41` | H2 after `if (!server) return null` |
| 4 | `llm-provider/components/LlmModelsSection.tsx:326` | H2 after two early returns |
| 5 | desktop `host-mount/…/ConversationMountsControl.tsx:28` | H2 after `if (!conversationId) return null` |
