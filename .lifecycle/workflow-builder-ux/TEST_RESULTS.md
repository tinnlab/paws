# TEST_RESULTS — workflow-builder-ux

Every line below is transcribed from a run observed in this session. Nothing is
inferred. Commands and full logs are named per tier; logs live under
`/data/pbya/ziee/tmp/lifecycle-logs/`.

The previous revision of this file recorded the e2e tier as **NOT RUN** (a
session limit). All of it is now written and executed.

---

## Tier 1 — backend unit (`cargo test -p ziee --lib workflow::validate::`)

```
test result: ok. 35 passed; 0 failed; 0 ignored; 0 measured; 1362 filtered out; finished in 0.10s
```
Includes `humanisation_contract::validation_codes_are_registered_and_humanised`,
`::validation_codes_registry_is_well_formed`, and the round-2 addition
`::scanner_reads_awkward_source_shapes`.

- **TEST-1**: PASS — acceptance (INV-1). 41 emitted codes; every one registered
  AND carrying a `HUMAN_COPY` **key** (round 1 replaced a raw substring search,
  which a code left in a comment could satisfy). Drift proven RED-then-GREEN by
  simulating: an unregistered code in a new file, a deleted `HUMAN_COPY` entry
  with the code left in a comment, an unknown layer, a struct-literal
  construction, a non-literal code argument, and both alias dialects.
- **TEST-15**: PASS

## Tier 1 — frontend unit (node:test)

```
validationCopy.test.ts       pass 22   fail 0
toolSchemaForm.test.ts       pass 25   fail 0
noFreeTextEntityRef.test.ts  pass  3   fail 0
```
- **TEST-3**: PASS — acceptance (INV-3), the class scan + its negative control.
- **TEST-8**: PASS
- **TEST-9**: PASS
- **TEST-10**: PASS
- **TEST-11**: PASS
- **TEST-12**: PASS
- **TEST-13**: PASS
- **TEST-14**: PASS

## Tier 1 — frontend unit (vitest / jsdom)

```
npx vitest run src/modules/workflow/stores/ToolCatalog.store.test.ts \
               src/modules/workflow/stores/WorkflowBuilder.store.test.ts
Test Files  2 passed (2)
     Tests  49 passed (49)
```
- **TEST-16**: PASS — the earlier SCOPE NOTE (which claimed the fetch-once cache
  and in-flight guard could not be proven headlessly) was wrong and has been
  removed: `react-dom/client` + `act` under the existing jsdom env now mount the
  real store and the real components. This file also carries the round-2
  component probes for the previously-untested interactive machinery (template
  latch across a tool change, clear-ref reversal, number/JSON commit-on-blur,
  stale enum option, the additional-arguments row merge).

## Tier 2 — backend integration

```
source tests/.env.test
cargo test --test integration_tests mcp::list_tools_for_builder_test -- --test-threads=1
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 2367 filtered out; finished in 7.99s
```
- **TEST-17**: PASS — `GET /api/mcp/servers/{id}/tools` payload contract
  (`name` / `description` / non-null object `input_schema`, and the `search`
  tool's `properties` + `required` field-for-field), plus **both** 403 gates:
  no `mcp_servers::read` → `INSUFFICIENT_PERMISSIONS`; has the permission but
  not access → `USER_NO_ACCESS`, asserted against a non-admin (an admin bypasses
  the per-server check via `has_admin_access`, which would make it vacuous) and
  preceded by a **positive control** — the same user gets 200 on a server they
  own.

## Tier 3 — e2e (Playwright)

```
cd src-app/ui && TEST_RUN_ID=wfb-r2b E2E_SKIP_SERVER_WARMUP=1 \
  npx playwright test tests/e2e/workflows/builder-tool-picker.spec.ts \
                      tests/e2e/workflows/builder-validation-attribution.spec.ts \
                      tests/e2e/workflows/builder-responsive.spec.ts \
                      tests/e2e/workflows/builder-step-kinds.spec.ts --workers=1

  9 passed (3.2m)
```
Log: `/data/pbya/ziee/tmp/lifecycle-logs/wfb-e2e-final.log`.
No `page.route()` mocking of ziee endpoints — the specs drive the real backend
and register a real loopback MCP server serving three distinct tools
(`tests/e2e/workflows/helpers/builder-tools-mock-server.ts`).

- **TEST-2**: PASS — acceptance (INV-2). Two steps invalid for DIFFERENT codes
  with a third, valid step SELECTED; findings name each broken step, the step
  list marks exactly those two (`toHaveCount(2)`, counts 1/2/0), and two goto
  clicks land on two different step kinds.
- **TEST-4**: PASS — acceptance (INV-3). Picker options compared **set-equal**
  to the server's three real tool names; an arbitrary typed name matches nothing
  and does not commit.
- **TEST-5**: PASS — acceptance (INV-4). One labelled control per declared
  property with declared requiredness/description/default; zero free
  `argument name` boxes; switching tools regenerates from the OTHER schema.
- **TEST-6**: PASS — acceptance (INV-5). `{{ inputs.query }}` into the INTEGER
  field, saved through the real validator, survives reload.
- **TEST-7**: PASS — acceptance (INV-6). Unreachable server → visible reason
  naming the server, zero enumerated options, free text that really commits, and
  a schema-undeclared key surviving edit→save→reload twice.
- **TEST-18**: PASS — the owner's literal defect: a human sentence renders and
  the page text contains no `prompt_file` / `prompt:` (with a positive control
  that the text was actually captured).
- **TEST-19**: PASS — the tool step offers a server picker AND a tool PICKER;
  inline required-field errors appear and clear; a valid config still saves.
  This spec previously asserted the free-text tool field was correct — that
  assertion was DELETED, which is the point of the item.
- **TEST-20**: PASS — 390/768/1280. **Rewritten in round 2**: the original probe
  was structurally unfalsifiable (the builder sits inside `overflow-hidden` + an
  OverlayScrollbars host, so `document.scrollingElement.scrollWidth -
  clientWidth` is always 0 and a 900px child at 390px would be clipped while the
  test passed). The replacement walks the ancestor chain and was proven RED
  under an injected over-wide element and GREEN without.
- **TEST-21**: PASS — the gallery validation fixture's codes/messages are
  compared against what live `POST /api/workflows/validate-def` actually emits.
  This was the one RED test at the start of the session; it was red for a real
  reason (the fixture's warning was prose the backend cannot produce).

- **TEST-22**: PASS — verified via `npm run check:gallery-coverage` +
  `check:state-matrix` + `gallery:check-fixtures` inside `npm run check` below,
  after the coverage claim was corrected (it had cited a surface that renders a
  *different* step form) and a cell that genuinely renders `ToolStepForm` with a
  resolved server + schema-driven form was added.

### One transient e2e failure, disclosed

An earlier full-suite run showed `1 failed / 8 passed`, TEST-7 failing on the
edit→save→reload leg. Classified as transport contention, not a product defect,
on three pieces of evidence: TEST-7 passes in ISOLATION (`1 passed (46.8s)`);
the full four-spec suite passes on re-run (`9 passed`); and the failing run's log
carries `GET /api/mcp/servers: TypeError: Failed to fetch` plus sync/chat-stream
`network error` — i.e. the save request itself failed. Recorded as a finding
rather than papered over: **`saveBuilder` (a shared e2e helper) does not verify
the save SUCCEEDED**, so a failed POST surfaces later as a confusing value
assertion. Not fixed here — it is shared harness (rule B3); flagged for its owner.

## Static gates

```
npm run check (ui): PASS
npm run check (desktop/ui): PASS
```
Both full chains: tsc + guardrails + colors + settings-field + adjacent-inline +
icon-action + hooks + logical-direction + tooltip-placement + kit-manifest +
testid-registry + design-spec + gallery-coverage + gallery-crawl +
gallery-fixtures + state-matrix + overlay-registry + override-registry +
gallery-seed-registry + store-actions. Exit 0 for both.

`lint:hooks` is called out specifically: it caught a real Rules-of-Hooks defect
introduced by a round-2 fix (`McpServer.isInitialized || !!McpServer.error` put a
store-proxy read — which IS a hook — on the right of a `||`, so the hook count
varied with `isInitialized`). Fixed; now `0 violations across 2481 file(s)`.

## A7 — boot / runtime canary

```
gate:ui (ui): PASS
gate:ui (desktop/ui): PASS
```

- `gate:ui (desktop/ui)`: `51/51 PASS`, `runtime-health: 552 findings (HIGH 0
  gating / MEDIUM 262 / LOW 290)`, `✅ GATE PASSED`.
- `gate:ui (ui)`: `198/198 PASS`, `runtime-health: 520 findings (HIGH 0 gating +
  2 harness-noise + 2 baselined / MEDIUM 158 / LOW 358)`, `✅ GATE PASSED`.

**The earlier red runtime-health result on the web workspace is explained and
resolved, not waived.** Earlier runs in this session reported 1003–3237 gating
HIGH across a
*shifting* set of 2–16 surfaces, every one of them `net::ERR_NETWORK_CHANGED` on
`/@fs/…` dev-transport URLs. The cause was Vite's **dep optimizer re-bundling
mid-run**, which invalidates in-flight module requests. `rm -rf
node_modules/.vite` before the run (plus killing this worktree's own stale Vite)
makes it reproducibly clean. All 8 `seeded-wf-builder-*` surfaces were clean in
every run, including the noisy ones — their only findings are LOW
`spacing-grid` (the kit's documented 2px half-steps, never gating).

`RUNTIME_FINDINGS.md` is the artifact of the clean 0-gating-HIGH run; its
`## Baselined (documented pre-existing — non-gating)` section and triage note are
present and match the base branch's (2 entries). An intermediate revision on this
branch had committed a stale-Vite run (2393 gating HIGH) *and deleted* the
baselined section — that regression is reverted.

## Pre-existing baseline failures (NOT caused by this diff)

- `npx vitest run src/modules/workflow/stores/` → `WorkflowRun.store.test.ts`
  fails to LOAD with `TypeError: registerLazyStore is not a function`. Proven
  pre-existing, not assumed: `git diff origin/feat/agent-core...HEAD` is EMPTY for
  both `WorkflowRun.store.test.ts` and `stores/workflowRun/`, and
  `workflowRun/index.ts` is byte-identical on the base. It is a suite-load
  failure under vitest's module resolution; all 49 tests that run, pass.
- `cargo test -p ziee --lib workflow::` (wider than this feature's scope) shows
  `178 passed; 1 failed` — `models::tests::job_kind_parses_round_trips_and_is_orthogonal`
  (`unknown variant 'subagent'`). Proven pre-existing by reverting `validate.rs`
  and re-running; `models.rs` / `job_kind.rs` are untouched by this branch.

## Known coverage gaps (disclosed, not hidden)

The blind test-quality audit (`ledger-tests.jsonl`) recorded these; they are real
and remain:

- TEST-1 binds code-key PRESENCE, not human LANGUAGE — copy shaped
  `"CODE": ({message}) => message` would satisfy it. TEST-8 screens a
  trailing-colon regex + a token denylist, which such copy passes.
- TEST-3's paired-picker carve-out means inverting `usePicker` (free text becoming
  the default) would leave both bindings in source and stay green.
- TEST-21's regex requires a `location:`, so the workflow-level
  `WORKFLOW_SANDBOX_FLAVOR_REQUIRED` fixture entry is never compared to the live
  backend.
- TEST-20 carries a documented `MAX_TOLERATED_OVERFLOW_PX = 4` allowance for a
  **pre-existing kit defect** the new probe surfaced: the combobox inline-end
  addon (`sdk/packages/kit/src/shadcn/input-group.tsx`) overflows its group by 4px
  at 390px. Bounded at exactly the observed value, so a 5px regression still
  fails. **New finding for the kit owner.**
