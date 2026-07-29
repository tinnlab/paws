# FIX_ROUND-3 — Activity Rail

Round 3. This IS the blind multi-angle audit FIX_ROUND-2 handed over: five fresh
diff-only auditors over `589cc38f0..HEAD` — the 32 hunks FIX_ROUND-2 added and
deliberately refused to stamp as reviewed. It also folds in the base merge that
had to happen first (the branch was 8 behind `origin/feat/agent-core`).

**New confirmed findings:** 17

17 confirmed and FIXED here; 8 more were dispositioned without a code change
(6 `accepted-open` with rationale, 2 `rejected`). Every one, fixed or not, is a
row in `LEDGER.jsonl` with `"round": 3`.

---

## 0. The base merge (prerequisite, not a finding)

`origin/feat/agent-core` had advanced 8 commits (the `control-describe-schema`
feature). Merged before auditing, so the coverage list reflects the real current
diff rather than base drift.

Two conflicts, both resolved by REGENERATING rather than by picking a side:

| conflict | resolution |
|---|---|
| `sdk` gitlink | Base moved sdk to `22d48e1`; this branch carried an **unpushed** local `89ad9d4` that regenerated `packages/kit/src/testIds.generated.ts`. Classic concurrent-regen collision. Took the base commit, re-ran `npm run gen:testid-registry`, committed the identical regen on top as `7636ad6` — so the gitlink is a **direct descendant of the base's sdk commit**, not a divergent line. |
| `src-app/{ui,desktop/ui}/openapi/openapi.json` | Generated. Took the base side, then ran `just openapi-regen` for **both** binaries. Verified semantically (sorted-key `diff`, not a line count): the regenerated spec carries both the base's `x-required-permissions` additions (430 / 443 occurrences) **and** this branch's `tool_use_id`/`message_id` filters, `McpToolCallReveal`, `always_reprompt` and `mcpToolComplete` duration — 153 content-delta lines each, no loss either way. |

`src-app/ui/src/api-client/types.ts` came out byte-identical after regen, i.e. the
merge did not silently drop a type.

**sdk is committed but NOT pushed** (this session does not push). `7636ad6` must
be pushed to `ziee-ai/sdk` *before* the superproject pointer lands, or the gitlink
dangles.

---

## 1. Fixed — the elicitation seam was defensive on reads and undefended on writes

Four auditors independently landed on the same shape: `transport.ts` guards every
READ path (`has`/`status`/`register`) and leaves both WRITE paths (`subscribe`,
`resolve`) bare — and the one place a caller could surface a failure, the boolean
return, is discarded.

- **FR3-9** `setElicitationTransport` called `provider.subscribe` outside any
  `try`. A throwing `subscribe` left an **INSTALLED transport with no change
  subscription** — every mounted card frozen at whatever status it first read —
  and the throw escaped into `mcpExtension.initialize`, where the registry only
  `console.error`s it, silently skipping the rest of mcp's per-pane wiring. Now
  it refuses the install and clears the slot, which is what the file's own
  "degrades cleanly when nothing is registered" contract already promised.
- **FR3-10** `resolveElicitationVia` awaited `provider.resolve` with no `catch`.
  Safe today only because the current provider swallows internally; the published
  `ElicitationTransport.resolve` contract promises optimistic-update-plus-rollback,
  **not** non-rejection. A second provider that rejects floats an unhandled
  rejection out of a click handler — a gating HIGH `page-error` under
  `gallery:runtime`.
- **FR3-11** `registerElicitation` swallowed everything into a comment-only
  `catch` and returned `void`. The consumer injects its card **unconditionally**
  after the call, so a dropped registration left a card pending forever with zero
  diagnostic. Now returns `boolean` and logs; all three swallow sites emit
  `console.error`.
- **FR3-7 / FR3-8** (the user-visible half) `JsToolApprovalContent` discarded
  `resolveElicitationVia`'s boolean — documented as existing *"so a caller can
  surface 'not resolvable' rather than silently claiming success"*. With no
  transport installed a click on Approve/Deny flipped a spinner and did
  **nothing**: no message, no error, no state change. That is a behavioural
  **regression** versus the direct `McpComposer.resolveElicitation` call AP-4
  replaced, which POSTed regardless of whether mcp's chat extension had
  initialized. The card now renders a `role="status"` notice, and
  `hasElicitationTransport()` pre-empts it before the first click. Separately, the
  resolved-state text gained `role="status"`: the buttons are UNMOUNTED when the
  decision lands, destroying keyboard focus and telling a screen reader nothing.
- **FR3-12** (performance) the transport's `subscribe` forwarded the **entire**
  mcp store, so every `addToolCall` / `updateToolCall` / `setToolCallProgress` /
  server-selection mutation re-rendered every mounted approval card — a strict
  widening over the per-property `useShallow` selector the store proxy gave the
  code it replaced. Now it notifies only when the `elicitationRequests` Map
  identity changes. Verified sound rather than assumed: the store is
  `immer: true` + `enableMapSet()`, so every elicitation mutation replaces the Map.
- **FR3-14** two dead exports (`hasElicitationTransport`,
  `__resetElicitationTransportForTests`) — the tell that a **192-line core seam
  shipped with no test file at all**. Owner-scoped teardown, re-registration
  detach, degrade-when-absent and every catch branch were unreachable from any
  test; the e2e path only ever runs with a healthy transport installed. Its
  precedent, `chat/core/rail/liveSteps.ts`, is unit-tested through exactly this
  reset helper.

New: **`chat/core/elicitation/transport.test.ts`** — 7 tests, all green, covering
degrade-with-no-transport, the happy path, version/notify/unsubscribe mechanics,
re-registration detach + idempotence, owner-scoped teardown (wrong owner must NOT
detach), the throwing-`subscribe` refusal, and a throwing provider on all four
entry points.

## 2. Fixed — `resolveStep` silently undid segmentation's key disambiguation

**FR3-6, and the only finding here that is a product bug rather than a test or
robustness one.**

`segmentRail` disambiguates a repeated `tool_use_id` to `` `${key}#${i}` ``
(`railSegmentation.ts:122`) precisely because two steps sharing a key collide on
the React key, on the per-message expansion state (`stepStateKey`), and on the
detail-panel tab id. But `ChatMessage.resolveStep` returned the **contribution's**
step wholesale, and re-resolution never re-applies that suffix — so on the
replayed-call case the disambiguation existed for, it was thrown away.

It also put the breakout's `data-step-key` (segmentation-namespaced) and a rail
row's (contribution-namespaced) in **two different namespaces**, which would have
made the new INV-3 real-stream assertion pass vacuously. `resolveStep` now
preserves the segmentation key.

## 3. Fixed — three guard tests that were narrower than their own docstrings

Both guards were green, and both were green partly for the wrong reason.

**The Rust index guard** (`repository.rs::tool_call_lookup_indexes_are_owner_leading`):

- **FR3-2** matched only `CREATE INDEX`, so the canonical violation written as
  `CREATE UNIQUE INDEX … (tool_use_id)` was **silently ignored**. Now handles
  `CREATE [UNIQUE] INDEX [CONCURRENTLY] [IF NOT EXISTS]`.
- **FR3-1** `FILTERED` listed 2 of the 5 columns `list_calls_for_user` narrows on,
  while the docstring claimed the general rule. All five are checked now, with the
  two pre-existing single-column indexes named in an explicit
  `LEGACY_SINGLE_COLUMN` allowlist — recorded rather than hidden.
- **FR3-3** it walked only `mcp/migrations`, while the set applied at boot is the
  generated union of every module's dir. Now walks every
  `src/modules/*/migrations`, globally timestamp-sorted, with a `> 50` file
  sanity assert so a wrong path cannot make the whole test vacuous.

**Negative control, run:** dropping a one-line
`CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_tool_calls_tool_use … (tool_use_id)`
into the module turns it **RED** with the index named, and green again on revert.

```
test modules::mcp::tool_calls::repository::tests::tool_call_lookup_indexes_are_owner_leading ... FAILED
  index `idx_mcp_tool_calls_tool_use` covers a filtered column ["tool_use_id"] but does not lead with user_id
```

**The AP-4 decoupling guard** (`railIsolation.test.ts`):

- **FR3-4** `importsOf` missed the bare **side-effect** form
  (`import '@/modules/mcp/stores/mcpComposer'`), so a one-line re-coupling passed.
  Not hypothetical: `js-tool/module.tsx` and `mcp/module.tsx` both write imports
  in exactly that form today. **Negative control, run:** adding a side-effect
  import to `railContribution.ts` — a *different* file from the two AP-4 fixed —
  turns it RED, green again on revert.
- **FR3-5** it matched only `@/modules/mcp/` (trailing slash), and
  `resolvedModulePath` returns `null` for every `@/` specifier, so the **barrel**
  form `@/modules/mcp` was caught by neither branch. Both branches now match the
  exact barrel path too.

## 4. Fixed — core still named an extension after the AP-4 move

**FR3-13.** AP-4 moved the formatter into core but kept the extension's name in
the core API: `chat/core/utils/serverLabel.ts` exported **`mcpServerParenLabel`**.
That is core naming an extension — the thing the rail's own INV-1 guard exists to
prevent, one directory over. The function has zero mcp domain knowledge (it wraps
a name in parens unless it already has one, and suppresses raw UUIDs). Renamed to
**`serverParenLabel`**; all five call sites repointed; `STATE_MATRIX` regenerated.

## 5. Fixed — the new INV-3 acceptance spec could go RED on a conformant render

**FR3-15 is the serious one.** Step 5's `expect(activity-rail-steps).toHaveCount(0)`
sat **outside** the `aria-expanded === 'true'` branch. `ActivityRail` sets
`toggleable = !hasFailure && !isStreaming`, and the non-toggleable path renders
the summary as a plain `<div>` with no `aria-expanded` and no collapse control —
i.e. exactly the FORCED-OPEN state INV-4 ("open while the turn is working") and
INV-5 ("a failure forces the rail open") mandate, and the state a turn awaiting
approval is in. No click happened, the steps container was still rendered, and the
INV-3 acceptance test would have failed on a **design-conformant** rendering of
INV-4/INV-5. The collapse assertion now lives inside the toggleable branch; the
forced-open case asserts what INV-3 actually governs there.

**FR3-16 / FR3-17** — five non-falsifiable clauses, removed or made real rather
than left reading as coverage:

| clause | why it proved nothing | now |
|---|---|---|
| `getByRole('button', {name: /^(collapse\|hide)/})` → count 0 | matches nothing the kit renders | removed; the two real collapse affordances (`activity-rail-summary`, `rail-step-toggle`) carry the claim |
| full-width vs own parent | restated `w-full`, a class the same commit added | also compared against a real `rail-step` row's width |
| `byTestId(page, 'mcp-tool-approval-card')` | page-scoped, while the claim was "inside the breakout" | scoped to `breakout` |
| `getComputedStyle(button).opacity` | CSS opacity composites down the ancestor chain, so an `opacity-50` wrapper still reads `1` | effective opacity walked up the whole chain |
| `getByTestId('activity-rail').first()` | could select the quiet-single shape, which renders no summary — silently no-opping the whole block | filtered to a rail that HAS a summary |
| disclosure loop | count cached before the first click (a disclosure revealed by expanding another was never actuated); `click({force:true})` bypassed actionability | re-reads the set each iteration, clicks without force, bounded |

## 6. Dispositioned without a code change

Recorded in full in `LEDGER.jsonl`; the reasoning, not just the verdict:

- **FR3-18 `accepted-open`** — `idx_mcp_tool_calls_server` / `_conv` are
  single-column, so the same `user_id`-as-post-`Filter` shape occurs on the
  `?server_id=` / `?conversation_id=` probes. **PRE-EXISTING** (`202607140180`).
  Fixing it means a new migration rewriting indexes this feature never touched —
  scope growth, not scope completion. Named in `LEGACY_SINGLE_COLUMN` so it is
  recorded rather than hidden, and any NEW index on those columns is now forced
  owner-leading.
- **FR3-19 `rejected`** — `202607200100`'s prose is stale, but it **cannot** be
  fixed in place: sqlx stores a checksum per applied migration and `Migrator::run`
  fails with `VersionMismatch` when a file's bytes change after it was applied
  (`set_ignore_missing(true)` does not relax that). Editing it would hard-fail
  boot for every developer already on this branch — which is exactly why
  `202607200200` exists as a second file. The forward pointer lives there.
- **FR3-20 `accepted-open`** — the generic-plan cliff. Measured in FIX_ROUND-2
  with `EXPLAIN` evidence: generic costs 4184.81 against 8.46–755.23 for every
  custom shape, so `plan_cache_mode=auto` never switches (verified behaviourally
  over 8 executions). Restructuring the query would rewrite the cross-user guard
  TEST-17 pins, to buy a plan PostgreSQL's own cost model rejects by up to 495×.
- **FR3-21 `accepted-open`** — the HMR register/unregister asymmetry is the
  PRE-EXISTING shape shared with `setRailLiveSource`, which this seam deliberately
  mirrors. Dev-only; changing one of the two would desynchronise them.
- **FR3-22 `accepted-open`** — `transport.ts` is a structural clone of
  `liveSteps.ts`; a `createOwnedSeam<T>()` factory would remove ~60 duplicated
  lines. A refactor candidate, not a defect — both copies are correct and both are
  now unit-tested; extracting it touches the rail live source, which is
  load-bearing for INV-4/INV-9.
- **FR3-23 `accepted-open`** — `ExternalMcpMockServer.start()` throws on a
  loopback-only host and binds `0.0.0.0`. Inherited verbatim from the pre-existing
  consumer (`07-mcp/external-approval-full-disclosure.spec.ts`). A capability skip
  belongs in the SHARED fixture, and **B3** forbids editing shared test
  infrastructure to route around this feature's problem.
- **FR3-24 `rejected`** — the `mcp → js-tool` direction of the AP-4 pair is an
  idle control today, by design: AP-4's failure mode was the coupling **inverting**
  rather than disappearing, so a guard pinning only the live direction would not
  catch it inverting back.
- **FR3-25 `rejected`** — `data-step-key` on the breakout is test-affordance
  markup of the same class as every `data-testid` the kit ships and the registry
  gates. It is what makes INV-3 falsifiable against a model-chosen identity, and
  FR3-6 fixed the namespace bug that would have made that assertion vacuous.

## 7. Coverage

`AUDIT_COVERAGE.tsv` regenerated by `gen-coverage.mjs`. Unlike FIX_ROUND-2 — which
deliberately refused to regenerate, because the auditors on record had run before
those files existed — regenerating is honest now: the five auditors in this round
covered the **full union** of angles `angles.json` assigns to every touched
prefix, applied to the current diff.

| auditor | angles |
|---|---|
| 1 | security-authz, security-secrets, api-contract, data-integrity-db |
| 2 | correctness-logic, concurrency-lifecycle, error-handling |
| 3 | frontend-state, performance, modularity-coupling |
| 4 | ux-accessibility, design-fidelity (against `DESIGN.md` + the nine INVs), cross-platform |
| 5 | test-quality, dead-code |

## 8. Observed results (this round)

Every number transcribed from a run watched to completion.

| suite | command | observed |
|---|---|---|
| Rust lib — tool_calls (incl. the widened index guard) | `cargo test -p ziee --lib mcp::tool_calls::` | **18 passed, 0 failed** (1386 filtered out) |
| Index-guard negative control | temporary `CREATE UNIQUE INDEX` | **1 failed** as designed, green on revert |
| AP-4 guard | `node --test …/railIsolation.test.ts` | **5 passed, 0 failed** |
| AP-4 guard negative control | temporary side-effect import | **1 failed** as designed, green on revert |
| Elicitation seam (NEW) | `node --test …/elicitation/transport.test.ts` | **7 passed, 0 failed** |
| Rail unit family | `node --test …/components/rail/*.test.ts` | **39 passed, 0 failed** |
| UI unit — full | `npm run test:unit` | **825 tests, 811 pass, 14 fail** — the same 14 pre-existing loader failures (`ERR_MODULE_NOT_FOUND` / `ERR_UNSUPPORTED_DIR_IMPORT`), none in a file this feature owns |
| `npm run check` (ui) | | **exit 0** |
| `npm run check` (desktop/ui) | | **exit 0** |
| `just openapi-regen` (both binaries) | | **exit 0** |
| Rail e2e family, no bridge | `playwright … activity-rail-*.spec.ts --workers=1` | 19 tests — **17 passed, 2 skipped** (the two bridge-gated) |
| The two bridge-gated acceptance specs, **bridge ON** | same, with `OPENAI_BASE_URL`/`ZIEE_TEST_LLM_MODEL` set | **2 passed (3.0m)** — INV-3 real-stream 19.1s, INV-4 lifecycle 34.2s |

The 2 skips in the no-bridge run are `activity-rail-breakout-real` (INV-3) and
`activity-rail-lifecycle` (INV-4) — both `[acceptance]` tests, so a skip is not
acceptable as a result. The local Qwen bridge (`localhost:4000`,
`qwen3.6-35b-a3b`) was reachable; the env seam simply was not set. Both were then
**run for real against it and passed**, and the full family was re-run with the
bridge on. No `.skip` was added anywhere; the two skips were resolved by supplying
the dependency, not by accepting them.
