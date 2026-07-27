# TEST_RESULTS — `lint:hooks`

All commands run in this worktree (`/data/pbya/ziee/tmp/hook-lint-guardrails-wt`),
full logs under `/tmp/claude-1000/.../scratchpad/`. No test was skipped, ignored
or narrowed to go green.

## Enumerated tests

- **TEST-1**: PASS — acceptance [INV-1]. The lint fires an `H1 [logical-rhs]` on the VERBATIM pre-fix `EnableSection.tsx` from `649ae7180^` at the `usePermission(READ_PERM) || usePermission(MANAGE_PERM)` line, and is silent on the accepted fix. The generality leg (`a || useFlag('x')`) also passes.
- **TEST-2**: PASS — acceptance [INV-2]. `H2 [ternary-branch] LlmProvider.providers` on the VERBATIM pre-fix `EditLlmModelDrawer.tsx` from `57f9fdb5b^`; silent on the fix.
- **TEST-3**: PASS — acceptance [INV-3]. `analyze()` over the live roots: **0 findings across 2433 files** (registry 300 proxies / 1708 actions); the CLI exits 0; both workspace copies resolve an identical root set. (The 2425 figure recorded in an earlier revision of this file predated the rebase onto `a72553e6e`; 2433 is the count on the validated base — see the re-verification section.)
- **TEST-4**: PASS — acceptance [INV-4]. Both `package.json`s define `lint:hooks` and chain it in `check`; the wired command exits **1** on the known-bad fixture; the script references nothing under `.lifecycle/` (B6).
- **TEST-5**: PASS — all six conditional contexts detected with the right label; the walk does not cross out of a function; a conditional read inside a callback IS reported; `do/while` is not conditional; `after-early-return` covers nested-block and `switch` guards; the `hook-order-ok` marker works on the line, the line above, and in a block comment, and is rejected when bare or when spoofed by a `//` inside a string; symlinks are not followed; `--root` scopes reporting only.
- **TEST-6**: PASS — every non-firing shape stays silent (unconditional read, `.$` snapshot, action call, action by reference, action read, the five specials, a same-named import from a non-store specifier, a type-only import with a real conditional property access).
- **TEST-7**: PASS — the fixture exists and is byte-identical in both workspaces; the lint fires via the exact `--root=…__detector_fixtures__` invocation the harness uses, in both workspaces, and the stderr covers EVERY H2 sub-rule shape; the clean companion contributes zero; both harness tables carry the O1/O2 rows WITH their own `expect` regex; the script is byte-identical across workspaces; the taxonomy documents O1+O2 in both.
- **TEST-8**: PASS — `tests/e2e/14-split-chat/popout-new-tab.spec.ts` (with `llm/model-edit-delete.spec.ts`): **3 passed (1.7m)**.
- **TEST-9**: PASS — `tests/e2e/projects/detail-page-layout.spec.ts` (with `hub/hub-mcp.spec.ts`): **23 passed (7.9m)**.
- **TEST-10**: PASS — `tests/e2e/hub/hub-mcp.spec.ts`, same run as TEST-9.
- **TEST-11**: PASS — `tests/e2e/llm/model-edit-delete.spec.ts`, same run as TEST-8.
- **TEST-12**: PASS — `desktop/ui/tests/e2e/host-mount.spec.ts`: **2 passed (20.5s)**.
- **TEST-13**: PASS — `npm run test:lint-hooks` is wired and green: **61 tests, 61 pass, 0 fail**.
- **TEST-14**: PASS — `tests/e2e/visual/pdf-viewer.spec.ts` (the REAL `PdfJsBody` through the gallery): **5 passed (19.5s)**, including "renders PDF offline with no console errors".
- **TEST-15**: PASS — SDK packages in scope (>100 files, 0 findings) and both copies resolve an identical root set; `registryHealthError()` trips on a zero-file scan and below the proxy floor, null when healthy, live registry >2× the floor; every unusable `--root`/unknown flag exits **2** (distinct from 0 and 1); `parseArgs` handles repeatable and space forms; `siblingDriftError()` is null and `main()` consults it.

## Frontend gates

- `npm run check (ui): PASS`
- `npm run check (desktop/ui): PASS`
- `gate:ui (ui): PASS` — **197/197 surfaces runtime-clean**, 0 gating HIGH findings; tsc + lint + runtime-health + visual all PASS.
- `gate:ui (desktop/ui): PASS` — **52/52 surfaces runtime-clean**; tsc + lint + runtime-health + coverage all PASS.
- `tsc --noEmit`: clean in BOTH workspaces.

- **TEST-16**: PASS — repeated `analyze()` calls in one process never answer from a stale AST: a TARGET edited between calls is re-read (0 → 1 → 0), and a NON-target REGISTRY file edited between calls is re-read (1 → 0 → 1).

## Mutation evidence (the tests are not tautological)

Each mutation was applied to a copy of the lint and the suite re-run; all went RED:

| mutation | result |
|---|---|
| drop `logical-rhs` from the context walk | RED (6 failures incl. TEST-1) |
| drop `ternary-branch` | RED (7 failures incl. TEST-2) |
| disable `after-early-return` | RED (4 failures) |
| narrow `HOOK_NAME` to `^usePermission$` | RED |
| disable the per-proxy action registry | RED (TEST-3 live tree) |
| accept a reasonless opt-out marker | RED |
| neuter the hook-handle (`handle.store.x`) rule | RED (3 failures) |
| neuter the element-access rule | RED (3 failures) |
| drop aliased-factory resolution | RED (1 failure) |
| replace the comment scanner with an empty set | RED (2 failures) |
| drift guard never consulted (`null && siblingDriftError()`) | RED |
| `PROXY_REGISTRY_FLOOR = 0` (guard disabled) | RED |
| `isTypeOnly` dropped (element, and import clause) | RED (each) |
| `resolveSpecifier` → `[]` (factor 1 back to path-shape) | RED |
| SDK roots removed from `ROOT_CANDIDATES` | RED |
| inner-function boundary skip undone (the FP) | RED |
| `catch-clause` context removed | RED |
| cache disk-stamp ignored | RED |
| empty `--root=` accepted | RED |

## Known-red, PRE-EXISTING on the base (not caused by this branch, B3: not worked around here)

`npx vitest run src/dev/guardrails` in `desktop/ui` is **3 failed / 21 passed**.
The same three fail identically on a pristine `origin/feat/agent-core` worktree
(**3 failed / 18 passed** there — the delta is the 3 assertions this branch adds,
all passing): `detector-acceptance.mjs exits 0`, `gallery-geometry-audit.mjs is
byte-identical`, `overlay-registry generator + manifest present`. Root cause is a
pre-existing drift between the two copies of `gallery-geometry-audit.mjs` plus a
missing desktop `overlays.tsx` — neither touched by this diff. The desktop
detector-acceptance table reports the new `crash-A O1` and `crash-B O2` rows as
`OK ✓`. None of these is in a `check` chain or in CI. See DRIFT-1.5.

---

## Re-verification (fresh session, independent of the run that wrote the sections above)

The agent that produced the results above ended on a session limit mid-phase-8.
Everything it had done was committed; this section is a **from-scratch re-run of
the gates** by a second agent that read only the artifacts, plus three checks the
first run had not made.

### Base validated against

`feat/hook-lint-guardrails` @ `584eb4b5b`. `git merge-base HEAD
origin/feat/agent-core` = **`a72553e6e`** — i.e. the branch was ALREADY rebased
onto the current integration tip (the N+1 batch endpoint + llm-model coalescing
catalog + theme fix + OpenAPI regen commit); `git rev-list --count
HEAD..origin/feat/agent-core` = **0**. No rebase was needed and none was done, so
every number below is measured against the CURRENT tree. The branch is
fast-forward-landable onto `origin/feat/agent-core`.

### Working-tree hygiene

`src-app/ui/src/dev/gallery/RUNTIME_FINDINGS.md` was left MODIFIED in the
worktree (247+/110-). It is **not** in `origin/feat/agent-core...HEAD` — it is
generated `gallery:runtime` output, and the modification is the product of a
DEGRADED run (2449 gating HIGH, 2784 `request-failed` — the backend was not up),
not a real regression. Discarded with `git checkout --`, restoring the committed
base content, which is the convention this repo already established in
`2871b4d22` and in the base's own `a72553e6e` ("restore the generated
RUNTIME_FINDINGS report (gate:ui output, not product code)"). The tree is now
clean apart from the pre-existing untracked `src-app/server/vendor/pgvector`
submodule entry, which predates this branch.

### Gates re-run

| gate | result |
|---|---|
| `node scripts/lint-hooks.mjs` (ui) | `OK — 0 violations across 2433 file(s) (registry: 300 store proxies, 1708 actions)`, **exit 0** |
| `node scripts/lint-hooks.mjs` (desktop/ui) | identical line, **exit 0** |
| byte-identity of the two copies | `cmp` → IDENTICAL |
| resolved roots | `ui/src`, `desktop/ui/src`, `sdk/packages` — all three actually scanned (2433 files, 0 findings) |
| `npm run test:lint-hooks` | **61 tests / 61 pass / 0 fail / 0 skipped** (34.5 s) |
| `npm run check` (ui) | **exit 0**; `lint:hooks` runs inside the chain and prints the 0-violation line |
| `npm run check` (desktop/ui) | **exit 0**; same |
| `tsc --noEmit` | clean in both (it is the first link of each `check` chain) |
| `lint-hooks.mjs --root=…/__detector_fixtures__` | **6 findings / exit 1** — 1× `H1 [logical-rhs]`, 5× `H2` covering `ternary-branch`, `after-early-return`, `if-body` (destructure), element-access `FixtureStore['items']`, hook-handle `handle.store.items` |

### Three checks the first run had not made

1. **The zero-FP is not achieved by suppressions.** `grep -rn "hook-order-ok"`
   over `src-app/ui/src`, `src-app/desktop/ui/src` and `sdk/packages` returns
   **zero** hits outside the lint script itself — not one opt-out marker exists in
   product code (nor even in the fixtures). The 0/2433 is the rule genuinely
   finding nothing, not the escape hatch being used.
2. **The DEFAULT full-tree gate catches each real bug re-introduced into its real
   product file** (the fixture run only proves the rule fires on a file written to
   be caught). Re-introducing the shipped `BUG-B` shape into the live
   `EditLlmModelDrawer.tsx` — `modelId ? LlmProvider.providers.flatMap(…) : null`
   — made the plain `node scripts/lint-hooks.mjs` (no `--root`) report
   `H2 src/modules/llm-provider/components/llm-models/EditLlmModelDrawer.tsx:39
   [ternary-branch] LlmProvider.providers`, exit 1. Re-introducing `BUG-A` —
   `usePermission(READ_PERM) || usePermission(MANAGE_PERM)` in the live
   `EnableSection.tsx` — reported `H1 …/EnableSection.tsx:31 [logical-rhs]`,
   exit 1. Both files were restored byte-for-byte afterwards (`git status` clean).
3. **The three known-red desktop guardrail vitest cases are confirmed
   base-inherited, not branch-caused.** `npx vitest run src/dev/guardrails`
   (desktop) is again **3 failed / 21 passed**, matching DRIFT-1.5. Root causes
   re-proved directly against the base rather than by assertion:
   `src-app/desktop/ui/src/dev/gallery/overlays.tsx` does not exist on
   `origin/feat/agent-core` at all; the two `gallery-geometry-audit.mjs` copies
   already differ on the base (`md5 ee00585d…` vs `1ec0a8fd…`); and
   `git diff --name-only origin/feat/agent-core...HEAD` shows this branch touches
   **neither** file. The desktop `detector-acceptance.mjs` failure is exactly one
   check — `#1-21 G* geometry-identity FAIL` (that same pre-existing drift) — while
   this branch's own row reports `crash-A O1 lint OK ✓`.

### `lifecycle-check`

`node .claude/lifecycle/lifecycle-check.mjs --all --dir
.lifecycle/hook-lint-guardrails --base origin/feat/agent-core`:

```
✓ phase 1 PLAN   ✓ phase 2 PLAN_AUDIT   ✓ phase 3 TESTS   ✓ phase 4 DECISIONS
✓ phase 5 IMPLEMENT+DRIFT   ✓ phase 6 BLIND_AUDIT   ✓ phase 7 FIX_LOOP
✓ phase 8 TEST_RESULTS   ✓ phase 9 HUMAN_FEEDBACK
✗ phase 0 GLOBAL — A1: .lifecycle/ has 9 feature dirs
```

Every phase gate 1–9 passes individually as well (each `--phase N` run reports its
own phase `OK`). The single remaining failure is **A1, inherited from the base**:
`git ls-tree --name-only origin/feat/agent-core .lifecycle/` lists **8** feature
dirs before this branch adds its 1st — so A1 cannot be satisfied by any feature
branched off `feat/agent-core` without deleting 8 unrelated features' artifacts.
This is DEC-8, decided and unchanged.

**Note on the default base.** `lifecycle-check` defaults to `--base origin/main`;
run without `--base origin/feat/agent-core` it also fails phases 3 and 6, because
it then attributes the whole `feat/agent-core` integration diff (agent-core,
background_mcp, the agent module, …) to this branch. `--base
origin/feat/agent-core` is the correct surface per BASE.md and per the
merge-base-not-HEAD rule.
