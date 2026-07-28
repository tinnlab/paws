# FIX_ROUND-2 — Activity Rail

Round 2. Not a new blind audit: the owner reviewed FIX_ROUND-1's output and required three
of its **deliberately open** entries to be closed before the branch lands. All three are
closed here — two by fixing, one by fixing after concluding the finding was HALF right.

**New confirmed findings:** 2

Both are LOW, both were surfaced *while* closing the three, and both are recorded below with
the evidence rather than folded silently into the fixes:

1. `202607200100`'s own rationale **overstates the unindexed fallback**. It says the two
   filters "would otherwise degrade to a sequential scan over an accumulating … history
   table". Measured, that is only true on a **desktop** deployment (one user owns every
   row). On a multi-user server the fallback is a *bitmap heap scan bounded by one user's
   rows* via `idx_mcp_tool_calls_user_created`. Same conclusion (the index is worth having —
   1505 buffers → 4), different mechanism. Corrected in `202607200200`'s comment.
2. The full `npm run test:unit` suite has **14 failing files on this branch that this round
   did not cause**. Verified by running the identical suite at the untouched branch tip
   (`589cc38f0`, i.e. `HEAD~1`): **824 tests / 810 pass / 14 fail**, the *same 14 files*.
   Every one dies at import with `ERR_UNSUPPORTED_DIR_IMPORT` — the `node-test-loader`
   cannot resolve the store-kit directory-style store imports (`from './voiceModel'`). This
   is a test-infrastructure defect, not a product defect, but phase 8 recorded "42/42 PASS"
   from a *scoped* run and that reads as if the unit suite is green. It is not. Recorded,
   not fixed: it is a pre-existing loader issue across `auth` / `background` / `chat` stores
   / `scheduler` / `voice` / `workflow`, none of which this feature owns.

---

## 1. "The new partial indexes may never be used" — HALF REFUTED, then fixed anyway

**Verdict: the premise is wrong; the underlying concern is right; the index changed.**

Settled with real `EXPLAIN (ANALYZE, BUFFERS)` — no theory. PostgreSQL **18.4**, a
**300 000-row / 200-user / 4 000-conversation** fixture, 70 % chat-sourced (`tool_use_id` +
`message_id` set) and 30 % rest/workflow (both NULL), i.e. the exact population split the
partial predicate is built around.

Every plan is taken through **`PREPARE` / `EXECUTE`**, never with literals inlined. That is
the whole point: sqlx speaks the **extended protocol**, so it PREPAREs the `query_as!`
statement once per connection and re-EXECUTEs it — and the custom-plan / generic-plan split
is precisely what the finding turns on. A plan taken with inlined literals would have proved
nothing.

The harness is committed and re-runnable: **`.lifecycle/activity-rail/explain-mcp-tool-calls.sql`**.

The real production shape is `ToolCallPanel.tsx:120` —
`ApiClient.McpToolCall.list({ tool_use_id, per_page: 1 })` — i.e. `user_id = $1` plus
`tool_use_id`, every other filter NULL. (`?message_id=` has **no in-tree caller** today; it
is an API affordance. Noted rather than removed.)

### BEFORE — the indexes as shipped in `202607200100`, `(tool_use_id)` alone

```
######## B1 — single-column partial, CUSTOM plan (?tool_use_id=, per_page=1) ########
 Limit  (cost=8.45..8.46 rows=1 width=106) (actual time=0.057..0.057 rows=1.00 loops=1)
   Buffers: shared hit=1 read=3
   ->  Sort  (cost=8.45..8.46 rows=1 width=106) (actual time=0.056..0.056 rows=1.00 loops=1)
         Sort Key: created_at DESC
         Sort Method: quicksort  Memory: 25kB
         ->  Index Scan using idx_mcp_tool_calls_tool_use on mcp_tool_calls  (cost=0.42..8.44 rows=1 width=106) (actual time=0.050..0.051 rows=1.00 loops=1)
               Index Cond: ((tool_use_id)::text = 'toolu_00000000000000000001'::text)
               Filter: (user_id = '00000000-0000-4000-9000-000000000002'::uuid)
               Index Searches: 1
               Buffers: shared hit=1 read=3
 Execution Time: 0.084 ms
```

**The index IS used.** "May never be used" is refuted for the plan PostgreSQL actually
picks. Against no index at all the same query is:

```
######## A — NO tool_use/message index ########
 Limit  (cost=4162.53..4162.53 rows=1 width=106) (actual time=5.251..5.253 rows=1.00 loops=1)
   Buffers: shared hit=1183 read=322
         ->  Bitmap Heap Scan on mcp_tool_calls  (cost=23.65..4162.52 rows=1 width=106)
               Recheck Cond: (user_id = '…002'::uuid)
               Filter: ((tool_use_id)::text = 'toolu_…001'::text)
               Rows Removed by Filter: 1499
               Heap Blocks: exact=1500
               ->  Bitmap Index Scan on idx_mcp_tool_calls_user_created  (rows=1500.00)
 Execution Time: 5.268 ms
```

**1505 buffers / 5.268 ms → 4 buffers / 0.084 ms.** The migration buys something real.

But `user_id` — the **unconditional cross-user guard** — is a post-`Filter`, not an
`Index Cond`. So the scan walks index entries for *other users'* rows and discards them
after a heap fetch. Observed directly on the `?message_id=` probe:

```
######## B4 — single-column partial, ?message_id=, CUSTOM plan ########
         ->  Index Scan using idx_mcp_tool_calls_message on mcp_tool_calls  (cost=0.42..8.48 rows=1)
               Index Cond: (message_id = '…b000-000000000001'::uuid)
               Filter: (user_id = '…9000-000000000002'::uuid)
               Rows Removed by Filter: 1            ← a foreign row read, then discarded
```

*(Honest caveat: the fixture deliberately lets `message_id` collide across users. In
production a `message_id` belongs to exactly one conversation, hence one user, so that
particular discard would not occur. `tool_use_id` likewise has no UNIQUE constraint — only a
convention that the model's ids are distinct. The composite makes the guarantee structural
rather than conventional.)*

### AFTER — `202607200200`, composite `(user_id, col)`

```
######## D1 — composite partial, CUSTOM plan (?tool_use_id=, per_page=1) ########
 Limit  (cost=8.45..8.46 rows=1 width=106) (actual time=0.027..0.027 rows=1.00 loops=1)
   Buffers: shared hit=4
         ->  Index Scan using idx_mcp_tool_calls_user_tool_use on mcp_tool_calls  (cost=0.42..8.44 rows=1 width=106) (actual time=0.021..0.021 rows=1.00 loops=1)
               Index Cond: ((user_id = '…9000-000000000002'::uuid) AND ((tool_use_id)::text = 'toolu_…001'::text))
               Index Searches: 1
               Buffers: shared hit=4
 Execution Time: 0.041 ms                          ← no Filter, no foreign row touched
```

```
######## D3 — composite partial, COUNT, CUSTOM plan ########
 Aggregate  (cost=8.44..8.45 rows=1 width=8) (actual time=0.015..0.015 rows=1.00 loops=1)
   ->  Index Only Scan using idx_mcp_tool_calls_user_tool_use on mcp_tool_calls
         Index Cond: ((user_id = '…002'::uuid) AND (tool_use_id = 'toolu_…001'::text))
         Heap Fetches: 1
```

The paired COUNT becomes an **Index Only Scan** (it was `Index Scan … Filter: user_id`).

Head-to-head with **both** shapes installed, the planner picks the composite
(`######## C`, `Index Scan using idx_mcp_tool_calls_user_tool_use`, same 8.44 cost), so
keeping the superseded pair buys nothing — hence the `DROP INDEX` in `202607200200`.

No regression to the pre-existing unfiltered History page (`######## D5`): still
`Index Scan using idx_mcp_tool_calls_user_created`, 53 buffers, 0.045 ms.

Size, per 300k rows: `tool_use` 10224 kB → `user_tool_use` 14 MB; `message` 4464 kB →
`user_message` 10224 kB. Net **+9.5 MB**, on a retention-pruned table, minus the ~14.4 MB
dropped.

The desktop shape (one user owns all 300 000 rows) is where the index matters most:

```
######## F2 — DESKTOP shape, no tool_use/message index ########
 Limit  (cost=25098.11..25098.11 rows=1) (actual time=39.183..45.402 rows=1.00 loops=1)
   Buffers: shared hit=8799 read=13424
         ->  Gather (Workers Launched: 2)
               ->  Parallel Seq Scan on mcp_tool_calls
                     Rows Removed by Filter: 100000
 Execution Time: 45.423 ms          →  F1 (composite): 4 buffers / 0.076 ms
```

### The `($n IS NULL OR col = $n)` idiom — does the query need restructuring? **No.**

The brief asked this explicitly, so it is answered with plans, not an opinion.

**The idiom IS unsargable under a generic plan** — confirmed:

```
######## B2 / D2 — GENERIC plan (force_generic_plan) ########
 Limit  (cost=4184.80..4184.81 rows=1 width=106) (actual time=2.171..2.171 rows=1.00 loops=1)
   Buffers: shared hit=1505
         ->  Bitmap Heap Scan on mcp_tool_calls  (cost=23.67..4184.79 rows=1 width=106)
               Recheck Cond: (user_id = $1)
               Filter: ((($2 IS NULL) OR (server_id = $2)) AND … AND (($5 IS NULL) OR ((tool_use_id)::text = $5)) AND …)
               Rows Removed by Filter: 1499
               Heap Blocks: exact=1500
               ->  Bitmap Index Scan on idx_mcp_tool_calls_user_created
 Execution Time: 2.183 ms
```

**No index shape rescues it** — `D2` (composite) is byte-identical to `B2` (single-column),
same 4184.79 cost. Only rewriting the clause as a plain equality does; verified separately:

```
######## G1 — plain `user_id = $1 AND tool_use_id = $2`, GENERIC plan ########
         ->  Index Scan using idx_mcp_tool_calls_user_tool_use on mcp_tool_calls  (cost=0.42..8.44 rows=1)
               Index Cond: ((user_id = $1) AND ((tool_use_id)::text = $2))
```

*(Note what that also proves: a future restructure would need **exactly the composite index
created here**. The single-column shape would not serve it.)*

**But the generic plan is never reached.** `plan_cache_mode` defaults to `auto`, which
switches only when the generic plan is no more expensive than the average custom plan.
Observed costs:

| plan | cost |
|---|---|
| custom, `?tool_use_id=` (per_page 1) | **8.46** |
| custom, unfiltered page 50 | **189.12** |
| custom, unfiltered page 200 (the clamp) | **755.23** |
| **generic** | **4184.81** |

5.5× to 495× in favour of the custom plan across every shape the one cached statement is
executed with. Verified behaviourally as well as by cost (`######## E2`): executed the
prepared statement **seven times under the default `auto`** and explained the eighth — still
the custom plan, still `Index Cond` on both columns, 4 buffers.

So the query stays ONE static statement. Replacing it with dynamically-assembled SQL would
rewrite the cross-user guard that `filters_never_drop_the_owner_predicate` (TEST-17) pins,
to buy a plan PostgreSQL's own cost model rejects by up to 495×. Revisit only if a
deployment pins `plan_cache_mode = force_generic_plan`.

### Why a SECOND migration rather than editing `202607200100`

sqlx stores a checksum per applied migration; `Migrator::run` fails with `VersionMismatch`
when a file's bytes change after it was applied. The runtime migrator
(`core/database/mod.rs:39-40`) sets only `set_ignore_missing(true)`, which relaxes the
"applied but absent from the source dir" check — **not** the checksum check. Editing
`202607200100` in place would hard-fail boot for every developer who has already booted this
branch. On a fresh database the table is empty when migrations run, so create-then-drop
across the two files costs microseconds.

### Regression guard

`repository.rs::tool_call_lookup_indexes_are_owner_leading` walks the module's real migration
directory in application order, replays its `CREATE INDEX` / `DROP INDEX` statements, and
asserts every surviving index covering `tool_use_id` / `message_id` leads with `user_id` —
so it fails on a re-added single-column index **or** on a reverted drop, not just on the two
filenames that exist today. It also pins the count at 2, so a rename cannot make it vacuous.

Verified in the build DB after the migration ran:

```
idx_mcp_tool_calls_user_message  … USING btree (user_id, message_id)  WHERE (message_id IS NOT NULL)
idx_mcp_tool_calls_user_tool_use … USING btree (user_id, tool_use_id) WHERE (tool_use_id IS NOT NULL)
(idx_mcp_tool_calls_tool_use / _message: gone)
```

---

## 2. The INV-3 acceptance spec drove a MOCKED stream — now there is a REAL one

**Verdict: valid. Closed by adding a real-stream proof, not by weakening either spec.**

The concern was exactly right, and FIX_ROUND-1 already recorded why it matters: **INV-5's
acceptance test passed the entire time the implementation rendered a failure as a `disabled`,
50 %-opacity, unfocusable button — the exact inverse of the invariant** — because it checked
the MECHANISM ("is the rail open?") rather than the RENDERED OUTCOME.

New spec: **`tests/e2e/chat/activity-rail-breakout-real.spec.ts`**. It drives the whole
production path:

```
real bridge model (tool-capable, qwen3.6-35b-a3b)
  → real chat/generation loop
    → real EXTERNAL MCP server (a live Node HTTP process on a non-loopback IP)
      → real manual_approve gate → real tool_use_approvals row
        → real SSE approval frame
          → the rendered approve/deny surface
```

There is **not one `page.route()` in the file** (coding-guidelines §14 forbids it for e2e).
`ExternalMcpMockServer` is a real server standing in for a third-party host — the external
boundary, not our stack. It reuses the existing `HAS_BRIDGE` env gate, so it self-skips
cleanly where no bridge exists (the one skip class A3 permits).

**A real stream means the spec cannot hardcode the `tool_use_id` — the model generates it.**
So `ChatMessage` now renders the breakout with the **same `data-step-key` a rail row would
carry** (`RailStep` already renders `data-step-key={step.key}`). The spec reads the identity
off the breakout and then proves no rail step anywhere on the page holds it. That is INV-3
stated as a falsifiable structural claim about the real, server-chosen identity — and it made
the invariant *more* testable, not just this spec.

It asserts the rendered outcome, targeting the exact failure mode INV-5 suffered:

- approve/deny **visible, enabled, computed `opacity` ≥ 0.99, and keyboard-focusable**
- the breakout's `data-step-key` matches **zero** `rail-step` elements, and zero descendants
  of `activity-rail-steps`
- no `rail-breakout` nested inside any `activity-rail`
- **full width** relative to its parent
- every `[aria-expanded]` control inside it is actuated, and the decision survives each
- the real external-server disclosure came through (`approval-tool-args` contains the
  arguments the model actually chose)
- **the decision RESOLVES through the real backend**: it clicks Deny and asserts the request
  clears — the half a mocked stream cannot reach at all

The mocked sibling (`activity-rail-breakout.spec.ts`) is **kept**, for the one thing it does
better: a deterministic three-step shape (two completed tools + one pending approval) that
makes the *structural* "not inside the rail" assertions non-vacuous. On a real stream the
model decides how many tools it calls, so the real spec's sibling-of-rail assertion is
conditional on a rail existing — stated explicitly in the spec rather than hidden.

**Observed:** `1 passed (2.1m)`, the test itself `17.9s`. The backend log confirms the path
was genuine, on a model-generated id:

```
Processing approval decision: tool_use_id=call_eeafaaa572a946d59f69f1af, decision=deny, branch_id=e8b02915-…
Denied tool use: call_eeafaaa572a946d59f69f1af
All 1 tool approvals were denied, skipping LLM call
```

---

## 3. AP-4: the coupling was INVERTED, not removed — confirmed, and now actually removed

**Verdict: a relocated violation. Removed via dependency inversion.**

First, precisely which rule: this is **not** an INV-1 violation. INV-1 governs *the rail*
(core) never importing, naming or special-casing an extension, and core still names nobody —
`railIsolation.test.ts` walks all four rail directories plus `railRegistryCore` and is green.
What AP-4 produced is an **extension → extension** edge, forbidden by
**coding-guidelines §9** on two counts: a cross-module store read, and a deep import past a
module's public surface.

The three edges (all of `js-tool`'s non-host imports):

| file | edge |
|---|---|
| `js-tool/chat-extension/extension.tsx` | `McpComposer` from `@/modules/mcp/stores/mcpComposer` |
| `js-tool/…/components/JsToolApprovalContent.tsx` | `McpComposer` from `@/modules/mcp/stores/mcpComposer` |
| `js-tool/…/components/JsToolApprovalContent.tsx` | `mcpServerParenLabel` from `@/modules/mcp/chat-extension/serverLabel` |

FIX_ROUND-1 deferred it as "the elicitation transport is genuinely shared". That is true —
and it is an argument for **inverting** the dependency, not for keeping it. A suspended
`run_js` script really does resume through the side-channel elicitation `/respond` endpoint,
because a live script stack cannot survive a turn boundary. So the fix is not to re-move the
code.

**The seam already existed in this feature's own code.** `chat/core/rail/liveSteps.ts` has
exactly this shape, and its docstring states the principle: *"the dependency is INVERTED
rather than reversed: core declares the shape and the extension PUSHES a source in."* The fix
follows it verbatim:

- **new** `chat/core/elicitation/transport.ts` — core-owned, extension-fed. Declares
  `ElicitationTransport { has, status, register, resolve, subscribe }` plus safe module-level
  wrappers, a monotonic `version` + `subscribe` pair for `useSyncExternalStore`, an
  owner-scoped `setElicitationTransport` / `clearElicitationTransportIfOwnedBy`, and a
  test reset. Degrades cleanly when nothing is registered (unit test, gallery render, mcp
  disabled) instead of throwing inside a transcript render.
- **mcp** registers the implementation in its `initialize`, right beside `setRailLiveSource`.
- **the registry's `unregister`** calls `clearElicitationTransportIfOwnedBy(name)`,
  symmetric with the rail live source — otherwise a torn-down provider leaves a module-level
  transport another extension's card keeps resolving through.
- **js-tool** consumes `elicitationExists` / `registerElicitation` / `elicitationStatus` /
  `resolveElicitationVia` through core. Reactivity is preserved via
  `useSyncExternalStore(subscribeElicitation, elicitationVersion)` — the same pattern
  `ActivityRail` uses — so the optimistic-update-and-rollback behaviour on a failed POST is
  unchanged.
- `mcpServerParenLabel` is a **pure string formatter with zero mcp domain knowledge** (it
  wraps a name in parens unless it already has one, and suppresses raw UUIDs). It lived under
  `mcp/` by history only. Moved to `chat/core/utils/serverLabel.ts`; all five call sites
  repointed.

`js-tool` now imports only `@/modules/chat/**` (its host) and `@/modules/settings/**`. mcp
imports nothing of js-tool's.

**Bound against regrowth** — `railIsolation.test.ts` gains
`FIX_ROUND-2 #3 (AP-4): js-tool and mcp are decoupled in BOTH directions`, checking alias
AND relative-escape imports each way. Its scope is stated in the test: it pins the AP-4
**pair**, not a repo-wide "no extension imports another extension" rule — many other
cross-module edges exist today (`mcp → code-sandbox`, `knowledge-base → file`,
`scheduler → workflow`, …) and a blanket guard would be red for reasons this change did not
create.

**Negative control run** (the guard must not be vacuous): re-adding
`import { McpComposer } from '@/modules/mcp/stores/mcpComposer'` to
`js-tool/chat-extension/railContribution.ts` — a *different* file from the two fixed — turned
it red with the exact edge named, then it went green again on revert.

```
✖ FIX_ROUND-2 #3 (AP-4): js-tool and mcp are decoupled in BOTH directions
  AssertionError: AP-4 must not re-couple js-tool and mcp in either direction:
  modules/js-tool/chat-extension/railContribution.ts → @/modules/mcp/stores/mcpComposer
```

---

## Observed test results (this round)

Every number below is from a run watched to completion. Nothing was `.skip`ped to go green.

| suite | command | observed |
|---|---|---|
| Rust unit (mcp tool_calls, incl. the new index guard) | `cargo test --lib -p ziee mcp::tool_calls::` | **18 passed, 0 failed** (1366 filtered out) |
| Rail unit (incl. the new AP-4 guard) | `node --test src/modules/chat/components/rail/*.test.ts` | **39 passed, 0 failed** |
| `railIsolation.test.ts` alone | `node --test …/railIsolation.test.ts` | **5 passed, 0 failed** |
| AP-4 guard negative control | (temporary re-coupling) | **1 failed** as designed, then green on revert |
| UI check gate | `npm run check` | **exit 0** (tsc + 9 lints + 10 registry/coverage checks) |
| **INV-3 REAL-stream e2e** | `playwright test activity-rail-breakout-real.spec.ts --workers=1` | **1 passed (2.1m)**; test 17.9s |
| Rail e2e family (all 9 `activity-rail-*.spec.ts`) | `playwright test … --workers=1` | **18 passed, 0 failed (6.1m)** |
| mcp tool-call integration | `cargo test --test integration_tests mcp::tool_call -- --test-threads=4` | **22 passed, 1 failed** (2356 filtered out) |
| UI unit suite, this branch | `npm run test:unit` | **825 tests / 811 pass / 14 fail** |
| UI unit suite, untouched `HEAD~1` (baseline) | `npm run test:unit` | **824 tests / 810 pass / 14 fail — the same 14 files** |

The unit-suite delta is therefore **+1 test, +1 pass, +0 failures**. The 14 failures are the
pre-existing `ERR_UNSUPPORTED_DIR_IMPORT` loader defect recorded as new finding #2 above.

The **one** failing integration test is `mcp::tool_call_history_test::chat_path_tool_call_records_source_chat`,
and it is CLASS A on CLAUDE.md's known test-environment floor (genuinely-blocked missing dep),
verified from the log signature, not assumed:

```
panicked at server/tests/mcp/tool_call_history_test.rs:657:10:
ANTHROPIC_API_KEY required (source tests/.env.test): NotPresent
```

`src-app/server/tests/.env.test` **does not exist in this worktree**, so the test panics on the
missing key before any product code runs. It is a real-LLM test in a file this round never
touched, and no server change here can affect it. Note it *panics* rather than self-skipping —
which is arguably the right call for a real-LLM assertion, but it means the mcp integration
suite cannot report clean on a box without the key. Not fixed here (weakening it to a skip
would be exactly the "`.skip` to go green" move the brief forbids); recorded.

`npm run gen:state-matrix` was re-run and committed (the generated matrix went stale from the
`JsToolApprovalContent` + moved-file changes); `check:state-matrix` is green.

## Lifecycle gate state after this round — phases 6 and 7 are RED, deliberately

`node .claude/lifecycle/lifecycle-check.mjs --phase N --repo $PWD --dir .lifecycle/activity-rail
--base origin/feat/agent-core`:

| phase | result |
|---|---|
| 1 PLAN | **EXIT 0** |
| 2 PLAN_AUDIT | **EXIT 0** |
| 3 TESTS | **EXIT 0** |
| 4 DECISIONS | **EXIT 0** |
| 5 IMPLEMENT | **EXIT 0** |
| 6 BLIND_AUDIT | **EXIT 1** — 29 hunks with 0 angles; need ≥ 3 |
| 7 FIX_LOOP | **EXIT 1** — "fix loop not converged — 2 new confirmed finding(s) in the final round" |
| 8 TEST_RESULTS | **EXIT 0** |
| 9 HUMAN_FEEDBACK | **EXIT 0** |

Both failures have ONE root cause and it is not a technicality: **this round added 32 hunks of
code that no blind audit has seen.** `AUDIT_COVERAGE.tsv` was last regenerated at `e9784056c`
("re-gate phases 2 + 6 after the branch advanced") for the tree as of `589cc38f0`; the two
commits above moved past it.

**`AUDIT_COVERAGE.tsv` was deliberately NOT regenerated.** `gen-coverage.mjs` assigns angles
per FILE-GROUP prefix from `angles.json`, which records what the five auditors *actually*
reviewed — its own header says it "does not invent coverage". Re-running it would stamp
`chat/core/elicitation/transport.ts`, the new migration and the new e2e spec as reviewed by
angles whose auditors ran before those files existed. That is making the mechanism green
while the property is false — the precise failure this feature's own FIX_ROUND-1 caught twice
(INV-5's green-throughout acceptance test; the deleted-group-card spec that asserted
`toHaveCount(0)` vacuously). Not repeating it here.

Phase 7 is the same cause seen from the other end: the round honestly reports 2 new confirmed
findings, and the gate correctly refuses to call that converged.

**Both close together, and only one way:** a blind multi-angle audit of `589cc38f0..HEAD`,
then a `FIX_ROUND-3` dispositioning whatever it returns (expected to be small — the diff is
one migration, one core seam, three consumer edits, two tests and one spec). Spawning blind
auditors was outside this session's authority, so it is handed over rather than faked.

Uncovered hunks, by file:

```
14  src-app/ui/src/modules/mcp/chat-extension/extension.tsx      (4 new + 10 re-anchored by the insert)
 5  src-app/ui/src/modules/js-tool/.../JsToolApprovalContent.tsx
 3  src-app/ui/src/modules/chat/core/extensions/registry.tsx
 2  src-app/ui/src/modules/chat/components/ChatMessage.tsx
 1  src-app/ui/tests/e2e/chat/activity-rail-breakout-real.spec.ts
 1  src-app/ui/src/modules/mcp/.../ToolCallPendingApprovalContent.tsx
 1  src-app/ui/src/modules/mcp/.../ToolCallPendingApprovalCancelContent.tsx
 1  src-app/ui/src/modules/chat/core/elicitation/transport.ts
 1  src-app/server/.../202607200200_mcp_tool_calls_lookup_index_owner_leading.sql
```

## Self-review notes (NOT a substitute for the blind audit above)

Recorded so the auditor has the author's own known-cost list rather than discovering it cold:

- The elicitation seam adds a **second whole-store subscription** to `McpComposer`, alongside
  the rail live source's. FIX_ROUND-1 already carries the narrowing of that pattern as a
  deliberately-open MEDIUM. The new one is strictly cheaper in practice: it re-renders only
  mounted `JsToolApprovalContent` cards, which exist only while a `run_js` script is
  suspended.
- The transport's `has`/`status` read through `McpComposer.$` (the NON-reactive accessor).
  That is deliberate: they are called from a plain function, and a reactive proxy read outside
  a component render is an illegal hook call. Reactivity comes from `useSyncExternalStore`.
- `?message_id=` still has no in-tree caller; `idx_mcp_tool_calls_user_message` is built for
  an API affordance, not a shipped code path. Kept (the filter is public API and the migration
  that added it is already on the branch), but it is index weight nothing currently reads.

## Still open (unchanged from FIX_ROUND-1)

The other 12 deliberately-open entries in FIX_ROUND-1 are untouched by this round and remain
as recorded there — notably the `HIGH` performance entry (`renderStepDetail` evaluated
eagerly for collapsed steps; mitigated by the base memo, lazy thunk still owed) and the
per-tool_use_id narrowing of the live-step seam.
