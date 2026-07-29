# FIX_ROUND-4 — Activity Rail

Round 4. A fresh blind re-audit of **FIX_ROUND-3's own diff** — the fixes from
round 3 are code like any other, and the coverage law does not exempt them.

**New confirmed findings:** 16

16 confirmed and fixed; 2 dispositioned as `rejected` with evidence; 1
`accepted-open`. All in `LEDGER.jsonl` with `"round": 4`.

This round earns its place: **five of its findings are defects FIX_ROUND-3
introduced or left half-done**, including one HIGH. A fix round that is not
itself audited is just a second chance to ship a bug.

---

## 1. HIGH — the corrected `FILTERED` list was wrong in both directions

FIX_ROUND-3 widened the Rust index guard's `FILTERED` from 2 columns to 5 and
declared the docstring honest. Both auditors independently checked it against the
actual query and it was **wrong twice**:

| column | in `list_calls_for_user`? | in FR3's `FILTERED`? |
|---|---|---|
| `server_id` | yes (`$2`) | yes |
| `conversation_id` | yes (`$3`) | yes |
| **`is_built_in`** | **yes (`$4::bool IS NULL OR is_built_in = $4`)** | **NO** |
| `tool_use_id` | yes (`$5`) | yes |
| `message_id` | yes (`$6`) | yes |
| **`workflow_run_id`** | **no — INSERT-only** | **yes (fictional)** |

And the two errors covered for each other: the fictional `workflow_run_id` is
what dragged `idx_mcp_tool_calls_workflow_run` into the legacy allowlist, which
is why the prose said "the two PRE-EXISTING indexes" over an array of **three**.
So the blind spot FIX_ROUND-3 claimed to close — *"the docstring claimed more than
the assertion checked"* — was still open, now with a compensating exemption hiding
it: a single-column index on `is_built_in` sailed straight through.

Fixed by reading the list off the QUERY, not the table. The allowlist is back to
two entries and is now **pinned to the exact column vector**, not the name — an
exemption keyed on a name alone would silently survive a migration that drops one
of these and re-creates the same NAME over a different, wider, still-not-owner-
leading column set.

**Negative control, run:** a single-column `CREATE INDEX … (is_built_in)` now
turns the guard RED. Under FIX_ROUND-3's version it was green.

## 2. The DDL replay parser, and the migration set it walks

- **FR4-2** FIX_ROUND-3 widened the walk to `src/modules/*/migrations` and said
  that was "the set applied at boot". It is not: `compose_merged_migrations`
  unions five named SDK crate dirs and `desktop/tauri` too — **101 of 109** files
  were seen. Now walks the same union; the vacuity assert raised to `> 100`.
- **FR4-3** four more classes of valid SQL still slipped past:
  1. the recogniser tested the **uppercased** form but extracted the name from the
     **case-sensitive** original, so a lowercase `create index …` was recorded
     under the name `"create"` — colliding across files and breaking the exact
     `owner_leading == 2` assert with a nonsense message;
  2. `CONCURRENTLY` was trimmed on `CREATE` but **not** on `DROP`, so
     `DROP INDEX CONCURRENTLY x` parsed the name as `"CONCURRENTLY"` and silently
     failed to remove the index — a false RED;
  3. `ALTER TABLE … ADD CONSTRAINT … UNIQUE (col)` creates a real backing index
     and was completely invisible;
  4. `/* … */` block comments were not stripped (only `--`), so commented-out DDL
     registered as real.

  All four handled; the `ALTER TABLE … UNIQUE` case **panics with a directive**
  rather than being ignored, because the owner-leading rule has no exception for
  a constraint.

**Negative controls, run:** lowercase DDL → **RED**; `is_built_in` single-column →
**RED**; block-commented DDL → correctly **ignored**.

## 3. The elicitation fixes were half-applied

- **FR4-4** `registerElicitation`'s new boolean was *still discarded at its only
  call site*, and the card *still* injected unconditionally — so the "pending
  forever, silently" case the return value was added to expose stayed live
  whenever a healthy transport's `register` throws. The outcome is now carried
  onto the card.
- **FR4-5** the banner said the request could not be answered while Approve and
  Deny stayed **mounted, enabled and clickable** — contradicting the docstring
  FIX_ROUND-3 itself wrote (*"Consumed by JsToolApprovalContent to **disable** +
  explain"*). Clicking still spun and did nothing. Now genuinely disabled, and
  `resolve()` early-returns.
- **FR4-6** both new `role="status"` regions were **mounted together with their
  text**. A live region that enters the accessibility tree already carrying its
  content is announced unreliably by NVDA/JAWS/VoiceOver — it must pre-exist and
  then change. The FIX_ROUND-3 comment asserted the opposite, so the code *read*
  as covered. And focus still fell to `<body>`. Now: **one** always-mounted
  region whose contents change, `tabIndex={-1}`, focused on the
  pending→resolved transition — which fixes announcement and focus restoration
  together.
- **FR4-7** `unresolvable` was latched in state and cleared only at the start of
  the next `resolve()`, so a transport installed after a failed attempt left the
  banner up permanently. Now derived from `hasElicitationTransport()`, which
  re-reads on every seam bump, so it clears itself.
- **FR4-14** FIX_ROUND-3 turned the silent no-transport no-ops into
  `console.error` — and `runtime-health.mjs` grades a console **error** as a HIGH
  **gating** finding, so the gallery state that exists precisely to *show* the
  degraded card would have failed `gate:ui`. The documented degraded state now
  logs at `warn`; a provider that **throws** stays at `error`.
- **FR4-15** `__resetElicitationTransportForTests` still called `unsubscribe`
  unguarded while the production path in the same file wrapped it — a throwing
  unsubscribe would abort the reset with `transport` still set and leak it into
  the next spec.

## 4. The twin seam was left behind — twice

FIX_ROUND-3 hardened `elicitation/transport.ts` and cited
`chat/core/rail/liveSteps.ts` as its precedent. It did not touch it. Both are
registered from the SAME `mcp` `initialize`, **two statements apart**:

- **FR4-8** `setRailLiveSource` still had a bare `unsubscribe` and a bare
  `subscribe`, so the identical failure was live — a live source installed with
  no change subscription (every rail step frozen at its first status) and the
  throw aborting the rest of mcp's wiring, *including the elicitation transport
  registered immediately after*.
- **FR4-9** it also kept the whole-store `subscribe` that FIX_ROUND-3's own
  rationale condemned — and it costs **more** there: every `configModalVisible`
  toggle, `userDefaults` load and server-selection change bumped
  `railLiveVersion`, re-rendering every mounted `ActivityRail`, each re-running
  `resolveStep` over every step through the whole contribution registry.

Both fixed identically. Narrowing verified sound rather than assumed:
`addToolCall` / `updateToolCall` / `setToolCallProgress` all write through
`state.toolCalls.set(...)` under `immer: true` + `enableMapSet()`, so Map
identity changes on every relevant mutation and on nothing else.

## 5. Two e2e "fixes" reintroduced the class they closed

- **FR4-10** the width probe FIX_ROUND-3 added to replace a tautology used a
  **document-wide** `querySelector('[data-testid="rail-step"]')` — it can match
  another message's row, and it goes **falsely RED** against the quiet-single rail
  shape, whose row is full bubble width **by design** (DEC-3). Now scoped to an
  indented rail (`[data-rail-shape="rail"]`) inside the same bubble — the only
  shape for which "not laid out as a rail row" is a claim at all.
- **FR4-11** the `isSibling` probe was left on the **unfiltered** first rail while
  the locator two lines above was narrowed, so the branch could be entered on rail
  A and assert siblinghood of rail B.

## 6. The most behaviour-affecting fix had no test

**FR4-12.** `resolveStep`'s key preservation — the one genuine product bug
FIX_ROUND-3 fixed — was pinned by nothing: the one-line revert `return resolved`
turned no test red. Fixed properly by extracting the rule as a pure exported
helper, **`withSegmentationKey`** (*segmentation owns the identity, re-resolution
owns the state*), used by `ChatMessage` and pinned by two `railSegmentation`
tests.

**Negative control, run:** reverting the helper body turns the suite **RED**
(`AssertionError: segmentation owns the identity`), green on restore.

**FR4-13** also corrected the comment's over-claim: the disambiguation protects
the React key and `stepStateKey`, **not** the detail-panel tab id (`toolCallTabId`
derives from `step.toolUseId`, never from `step.key`).

## 7. The decoupling guard, again

**FR4-16** two holes remained after FIX_ROUND-3's widening: `foo();import 'x'`
(valid JS, but the regex was line-anchored) evaded both guards, and — the other
direction — because `importsOf` did not strip comments, a documentation *example*
of the forbidden import would have been a **false positive** failing the guard for
prose.

**Four controls, run:** bare side-effect import → RED; mid-line no-space
`;import'…'` → RED; barrel `@/modules/mcp` → RED; a block-commented example →
correctly green.

## 8. Dispositioned without a code change

- **FR4-17 `accepted-open`** — block 5's "collapsing the rail does not hide the
  request" clause is unexercised in this spec: at the pending-approval moment the
  turn is still streaming, so INV-4/INV-5 force the rail open and non-toggleable,
  and there is nothing to click. Correct as designed — and now **stated in the
  spec** rather than implied. A real stream cannot guarantee a settled toggleable
  rail; the deterministic collapse proof is owned by the mocked sibling
  (`activity-rail-breakout.spec.ts`), which can. Forcing it here would mean either
  a flaky assertion or mocking the stream — the thing this spec exists to avoid.
- **FR4-18 `rejected`** — "the fix pins `key` but not `consumed`/`blocking`". By
  design, and load-bearing: ITEM-5's whole point is that segmentation decides a
  message's SHAPE exactly once, so the span/render desync is structurally
  impossible; shape is read from the segments array, never from a re-resolved
  descriptor. `key` is *identity* (segmentation's), which is why it is pinned;
  `consumed`/`blocking` are not consulted for shape after segmentation. Pinning
  them would change no rendering and would blur the separation the fix restores.
- **FR4-19 `rejected`** — "dropping `force: true` means an un-actionable control
  hangs to the 300s test timeout because `actionTimeout` is unset". The premise is
  false: `playwright.config.ts` sets `use.actionTimeout: 10000` globally and this
  spec does not override it. An un-actionable disclosure fails in 10s with
  Playwright's actionability report — which is exactly why `force` was dropped.

## 9. What the re-auditors independently confirmed CLEAN

Recorded because a clean verdict from a blind reviewer is evidence too:

- the `subscribe` narrowing is **sound, not too narrow** — one auditor ran the
  workspace's own immer 11.1.8 with `enableMapSet` and verified `Map.set`, a
  nested `req.status = …`, and the rollback all produce a new Map identity, while
  an unrelated `set` preserves it;
- `hasElicitationTransport()` read during render **is** reactive —
  `setElicitationTransport` ends in `bump()` on both install and clear, which
  drives the component's `useSyncExternalStore`;
- store-access discipline: `.$` snapshots in non-render code, no reactive proxy
  read in a loop or handler;
- the `mcpServerParenLabel` → `serverParenLabel` rename is a **genuine**
  decoupling — no `mcp` token survives in the core util, all call sites updated,
  no stale references repo-wide;
- design-system conformance: `type="danger"` → the semantic `text-destructive`
  token, 4px-scale spacing, logical `ms-2`; no raw hue, arbitrary value or inline
  style colour anywhere in the diff;
- desktop drift: `src-app/desktop/ui` aliases `@/*` into `../../ui/src/*` and
  holds no local copy of any file here, so there is no counterpart to update.

## 10. Observed results (this round)

| suite | observed |
|---|---|
| Rust lib — `mcp::tool_calls::` | **18 passed, 0 failed** |
| Index guard — 3 negative controls | lowercase → RED, `is_built_in` → RED, block-comment → correctly ignored |
| `railSegmentation.test.ts` (incl. 2 new) | **14 passed, 0 failed** |
| `withSegmentationKey` negative control | **RED** on revert, green on restore |
| `railIsolation.test.ts` | **5 passed, 0 failed**; 3 re-coupling forms → RED, commented example → green |
| `transport.test.ts` | **7 passed, 0 failed** |
| chat unit family | **333 tests, 329 pass, 4 fail** — all 4 among the 14 pre-existing loader failures, none in a file this feature owns |
| `npm run check` (ui) | **exit 0** |
| `npm run check` (desktop/ui) | **exit 0** |
| `cargo check --workspace` (lib+bin) | **exit 0** |
| e2e: rail family + `run-js-inner-approval`, bridge ON | **21 passed, 0 failed** |

### One pre-existing compile failure, proven not ours

`cargo check --workspace --all-targets` fails on
`agent-core/tests/real_llm_loop.rs` (`missing fields isolate_children and
schedule in initializer of AgentCore`). **Pre-existing on the base**, proven not
argued: `git diff --stat origin/feat/agent-core...HEAD -- src-app/agent-core` is
**empty**, so the agent-core sources on HEAD are byte-identical to the base and
any error there exists there too. Both responsible commits (`069d88448`,
`b4b24e070`) are ancestors of `origin/feat/agent-core`. Not fixed here: it is
another feature's test target and touching it would be scope this branch has no
business taking.
