# TEST_RESULTS — `lint:hooks`

All commands run in this worktree (`/data/pbya/ziee/tmp/hook-lint-guardrails-wt`),
full logs under `/tmp/claude-1000/.../scratchpad/`. No test was skipped, ignored
or narrowed to go green.

## Enumerated tests

- **TEST-1**: PASS — acceptance [INV-1]. The lint fires an `H1 [logical-rhs]` on the VERBATIM pre-fix `EnableSection.tsx` from `649ae7180^` at the `usePermission(READ_PERM) || usePermission(MANAGE_PERM)` line, and is silent on the accepted fix. The generality leg (`a || useFlag('x')`) also passes.
- **TEST-2**: PASS — acceptance [INV-2]. `H2 [ternary-branch] LlmProvider.providers` on the VERBATIM pre-fix `EditLlmModelDrawer.tsx` from `57f9fdb5b^`; silent on the fix.
- **TEST-3**: PASS — acceptance [INV-3]. `analyze()` over the live roots: **0 findings across 2425 files** (registry 300 proxies / 1708 actions); the CLI exits 0; both workspace copies resolve an identical root set.
- **TEST-4**: PASS — acceptance [INV-4]. Both `package.json`s define `lint:hooks` and chain it in `check`; the wired command exits **1** on the known-bad fixture; the script references nothing under `.lifecycle/` (B6).
- **TEST-5**: PASS — all six conditional contexts detected with the right label; the walk does not cross out of a function; a conditional read inside a callback IS reported; `do/while` is not conditional; `after-early-return` covers nested-block and `switch` guards; the `hook-order-ok` marker works on the line, the line above, and in a block comment, and is rejected when bare or when spoofed by a `//` inside a string; symlinks are not followed; `--root` scopes reporting only.
- **TEST-6**: PASS — every non-firing shape stays silent (unconditional read, `.$` snapshot, action call, action by reference, action read, the five specials, a same-named import from a non-store specifier, a type-only import with a real conditional property access).
- **TEST-7**: PASS — the fixture exists and is byte-identical in both workspaces; the lint fires via the exact `--root=…__detector_fixtures__` invocation the harness uses, in both workspaces, and the stderr covers EVERY H2 sub-rule shape; the clean companion contributes zero; both harness tables carry the O1/O2 rows WITH their own `expect` regex; the script is byte-identical across workspaces; the taxonomy documents O1+O2 in both.
- **TEST-8**: PASS — `tests/e2e/14-split-chat/popout-new-tab.spec.ts` (with `llm/model-edit-delete.spec.ts`): **3 passed (1.7m)**.
- **TEST-9**: PASS — `tests/e2e/projects/detail-page-layout.spec.ts` (with `hub/hub-mcp.spec.ts`): **23 passed (7.9m)**.
- **TEST-10**: PASS — `tests/e2e/hub/hub-mcp.spec.ts`, same run as TEST-9.
- **TEST-11**: PASS — `tests/e2e/llm/model-edit-delete.spec.ts`, same run as TEST-8.
- **TEST-12**: PASS — `desktop/ui/tests/e2e/host-mount.spec.ts`: **2 passed (20.5s)**.
- **TEST-13**: PASS — `npm run test:lint-hooks` is wired and green: **56 tests, 56 pass, 0 fail**.
- **TEST-14**: PASS — `tests/e2e/visual/pdf-viewer.spec.ts` (the REAL `PdfJsBody` through the gallery): **5 passed (19.5s)**, including "renders PDF offline with no console errors".
- **TEST-15**: PASS — SDK packages in scope (>100 files, 0 findings) and both copies resolve an identical root set; `registryHealthError()` trips on a zero-file scan and below the proxy floor, null when healthy, live registry >2× the floor; every unusable `--root`/unknown flag exits **2** (distinct from 0 and 1); `parseArgs` handles repeatable and space forms; `siblingDriftError()` is null and `main()` consults it.

## Frontend gates

- `npm run check (ui): PASS`
- `npm run check (desktop/ui): PASS`
- `gate:ui (ui): PASS` — **197/197 surfaces runtime-clean**, 0 gating HIGH findings; tsc + lint + runtime-health + visual all PASS.
- `gate:ui (desktop/ui): PASS` — **52/52 surfaces runtime-clean**; tsc + lint + runtime-health + coverage all PASS.
- `tsc --noEmit`: clean in BOTH workspaces.

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
