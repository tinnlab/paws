# PLAN_AUDIT — workflow-prompt-validation

Audited against the worktree at `9363976a2` (`origin/feat/agent-core`).

## Breakage risk

- **`load_raw_prompt`'s signature change (ITEM-3) has exactly two callers**,
  both in `dispatch.rs`: `resolve_prompt` (l.91, used by `LlmDispatcher` and by
  `agent_dispatch.rs::AgentDispatcher`) and the `llm_map` per-item loader
  (l.356). It is a private `async fn`; nothing outside the file names it.
  Dropping `&RunContext` for `&Path` is mechanically safe and both call sites
  already hold `ctx.extracted_path`.
- **Behaviour change at run, one cell, deliberately**: `prompt: ""` with NO
  `prompt_file` currently resolves to `Ok("")` and sends an empty prompt to the
  provider; after ITEM-3 it is an error. That state is already RED at validate
  (`WORKFLOW_PROMPT_MISSING`), so it cannot reach a run through the install or
  import path — and an empty LLM call is not behaviour worth preserving. See
  DEC-2.
- **`check_prompt_files`'s new `is_file` requirement (ITEM-4)** only tightens a
  branch that is already reached (a resolved path inside the bundle). A symlink
  to a real file still passes, because the check runs on the CANONICALIZED path.
  It cannot fire on the draft-validation surfaces (`/validate`, `/validate-def`),
  which pass a non-existent bundle root and take the documented `!bundle_present`
  early-continue before the existence half.
- **No new validator code**, so the round-6 invariant "every code has
  author-facing copy, enforced by a backend test" is untouched — ITEM-4 reuses
  `WORKFLOW_PROMPT_FILE_MISSING` and only changes its message text (the copy is
  keyed off the CODE, `validationCopy.ts`).
- **Kit (ITEM-6)**: `InputGroupAddon` is consumed only inside the kit itself —
  `combobox.tsx` and `command.tsx` (grep over `sdk/packages`, `src-app/ui/src`,
  `src-app/desktop/ui/src`: no app-level consumer). The optical shift is
  measured at 0.8px (button right edge moves from `groupContentRight − 3.2` to
  `groupContentRight − 4`). No Layer-B pixel baselines are committed
  (`find tests -name '*.png'` → 0), so no snapshot re-blessing is implied.
- **`promptSuppliedByFile` (ITEM-5)** has three consumers (`LlmStepForm`,
  `LlmMapStepForm`, `AgentStepForm`) plus `configErrors`. Narrowing it from
  `typeof === 'string'` to "non-empty string" only changes the `prompt_file: ""`
  case, which the backend after ITEM-4 also calls incomplete — so the change
  moves the client INTO agreement, it does not create a new divergence.
  `stepForms.test.ts:334` asserts the three forms literally call
  `promptSuppliedByFile(step)`; that source-scan is unaffected.

## Pattern conformance

- ITEM-1/2/4 sit in `validate.rs` beside `check_prompt_files` / `check_security`
  — free functions + `#[cfg(test)] mod tests` in the same file, which is exactly
  how that file is already organised (`rejects_prompt_and_prompt_file`,
  `rejects_unsafe_prompt_file` construct a `tempdir()` and call
  `validate_collecting`). The new tests reuse that shape verbatim.
- ITEM-3 keeps `resolve_prompt`'s `pub(crate)` signature (agent_dispatch depends
  on it) and changes only the private loader — minimal blast radius, matching
  the file's existing separation of "render" from "load".
- ITEM-5 mirrors the sibling predicate + the `promptField` comment block already
  in `stepForms.ts`, and its test goes in the existing `stepForms.test.ts`
  (node `--test`, the workspace's `test:unit` runner).
- ITEM-6 stays inside the existing `cva` variant strings; the design system's
  logical-direction rule (`ps`/`pe`) is what `lint:logical-direction` enforces on
  ADDED lines, and the 4px/2px-half-step rhythm is what `DESIGN_SYSTEM.md`
  prescribes. Both are satisfied by the planned replacement.
- ITEM-7 mirrors `tests/e2e/visual/form-label-starvation.spec.ts` /
  `layout.spec.ts`: `playwright.visual.config.ts`, `openGallery` from `_gallery.ts`,
  a `page.evaluate` geometry probe, no backend and no API mocking.

## Migration collisions

None. This branch adds no migration; the workflow module's highest is
`202607191200_background_run_notes.sql` and it is untouched (see `BASE.md`).

## OpenAPI regen

Not implied. No handler signature, request/response schema, permission,
`SyncEntity` or `JsonSchema` type changes — the change is inside two private
helpers, one `cva` string and one client predicate. `openapi.json` and
`api-client/types.ts` are byte-unchanged in both workspaces; re-verified at
phase 8 by `npm run check`.

## Per-item verdicts

- **ITEM-1** — verdict: PASS — a pure free function beside `check_prompt_files`
  in `validate.rs`; no new dependency, no new type escaping the module.
- **ITEM-2** — verdict: PASS — replaces the `has_prompt`/`has_file` pair with a
  `match` on the shared rule; both emitted codes and their exact message strings
  are preserved, so `validationCopy.ts` and the round-6 copy test are unaffected.
- **ITEM-3** — verdict: PASS — two private call sites, both updated; the one
  behaviour change (empty prompt alone now errors) is unreachable from a
  validated workflow and is recorded as DEC-2.
- **ITEM-4** — verdict: CONCERN — this tightens an existing verdict, so it can in
  principle turn a currently-installable bundle red. The concern is narrow and
  intended: the only newly-red bundles are ones whose `prompt_file` is empty or
  names a directory, i.e. exactly the bundles that fail at RUN today. Resolved by
  pinning both cells in TEST-2/TEST-3 rather than by narrowing the item.
- **ITEM-5** — verdict: PASS — one predicate, three consumers, all of which want
  the narrowed meaning.
- **ITEM-6** — verdict: PASS — kit-internal consumers only, 0.8px optical shift,
  no committed pixel baselines. Committed in the `sdk` submodule; not pushed.
- **ITEM-7** — verdict: PASS — a new file under `tests/e2e/visual/`, picked up by
  `playwright.visual.config.ts`'s `testDir`; nothing else references it.
- **ITEM-8** — verdict: CONCERN — lowering the tolerance makes an EXISTING
  full-stack e2e stricter, and that spec needs the whole backend + a live MCP
  mock to run. If ITEM-6 were wrong the spec goes red — which is the point — but
  it means ITEM-8 cannot be certified by the cheap gallery probe alone. Resolved
  by enumerating TEST-8 as the real run of that spec at phase 8, not by leaving
  the constant at 4.
