# FIX_ROUND-6 — Activity Rail

Round 6. A blind re-audit of FIX_ROUND-5's diff, two auditors.

**New confirmed findings:** 12

12 confirmed and fixed; 3 `accepted-open` with rationale. All in `LEDGER.jsonl`
with `"round": 6`.

This round did not just fix defects — it **deleted the mechanism that kept
producing them**.

---

## 1. The parser is gone

An auditor was asked to construct a migration that adds a non-owner-leading index
on a filtered column and still passes the guard. **It succeeded:**

```sql
ALTER TABLE mcp_tool_calls
  ADD CONSTRAINT pk PRIMARY KEY (id),
  ADD CONSTRAINT u  UNIQUE (message_id);
```

replays to `{pk: [id]}` with **zero violations** — a real unique index on
`message_id` shipping clean past a guard whose entire purpose is to stop that.

That is the seventh distinct evasion found in four rounds. The full list, one per
audit round:

| round | evasion found |
|---|---|
| 2 | (guard introduced) |
| 3 | `CREATE UNIQUE INDEX`; only one module's dir walked; 2 of 5 columns checked |
| 4 | lowercase DDL; `DROP INDEX CONCURRENTLY`; `ALTER TABLE … UNIQUE`; block comments |
| 5 | multi-action `ALTER`; column-level `UNIQUE`; `CREATE TABLE` inline constraint; `$body$`; UPPERCASE table name; a `*/` after a `--` discarding a whole file |
| 6 | **a working end-to-end bypass** |

The lesson is not "harden it an eighth time." **A text replay of SQL is unsound by
construction**, and a *security* guard that is unsound by construction is worse
than no guard, because it reads as coverage in every review.

So the guard moved to where the truth is. **`tests/mcp/tool_call_index_test.rs`
queries `pg_indexes` on a really-migrated database.** No parser. Nothing to evade.
It sees index creation by **any** route — explicit DDL, a table or column
constraint, a primary key, or anything a future migration invents — because it
asks the database what exists rather than guessing from text.

~200 lines of parser deleted. What remains in-source is the column list plus a
drift guard asserting it equals `list_calls_for_user`'s **actual** optional
narrowings (so the two cannot silently diverge).

**Six negative controls, all run against the new guard** — including both
bypasses that defeated the parser:

| control | result |
|---|---|
| `ALTER TABLE … ADD CONSTRAINT … UNIQUE (message_id)` | **RED** |
| the multi-action `ALTER` bypass (`ADD COLUMN … DEFAULT ('x'), ADD CONSTRAINT … UNIQUE (message_id)`) | **RED** |
| `CREATE INDEX … ON MCP_TOOL_CALLS (message_id)` (uppercase table) | **RED** |
| `create index … on mcp_tool_calls (is_built_in)` (lowercase, and the column round 4 had missed) | **RED** |
| `DO $$ BEGIN CREATE INDEX … END $$;` | **RED** |
| dropping a column from the filtered list (drift guard) | **RED** |

Every one green again on removal.

## 2. HIGH — the a11y "fix" was an a11y REGRESSION

The tooltip FIX_ROUND-5 added to explain the disabled buttons did two harmful
things, both mechanical:

1. **It clobbered the accessible names.** kit `Button` computes
   `ariaLabel = ariaLabelProp ?? (typeof tooltip === 'string' ? tooltip : undefined)`
   and applies it **unconditionally** — so both Approve and Deny announced as
   *"The approval channel is unavailable right now"* and became indistinguishable
   to a screen reader. WCAG 2.5.3 (Label in Name) and 4.1.2.
2. **It could never render.** `disabled` becomes the native attribute and the base
   class carries `disabled:pointer-events-none`, so the trigger receives neither
   hover nor focus. The repo's own `SettingsFormActions` documents the
   focusable-wrapper pattern and warns about exactly this.

Removed rather than wrapped: the reason is already on screen in the status region
that `aria-describedby` points at, and that description is now set **only when
there is something to describe** (it previously pointed at an empty string in the
ordinary pending state).

## 3. HIGH — the round-5 clamp was unpinned

The whole point of round 5's change to `withSegmentationShape` — clamping
`consumed` and `blocking`, not just `key` — **survived its own test unchanged**.
The fixture had `consumed` equal on both sides and `blocking` undefined on both,
so the key-only body satisfied every assertion.

Fixed by making the fixture differ on all three. **Two negative controls run:** the
key-only revert → RED; dropping *just* `consumed` → RED.

## 4. MEDIUM — the seam guard's negative assertion could not fire

`/resolveRailStep\([^)]*\)\?\.step\s*\?\?\s*placed\.step/` cannot cross the inner
`)` of `railCtx(placed)`, so it did not match the real revert spelling at all. It
also matched **raw** file text, so a doc comment mentioning the helper would keep
it green after a real revert.

Comments stripped, regex whitespace-normalised and non-greedy. **Negative control
run with the ACTUAL revert spelling → RED.**

## 5. MEDIUM — `resolve-failed` was unreachable, so the real silent path was still silent

`resolveElicitationVia` returns `false` only when there is no transport or the
provider **throws**. The shipped provider catches everything internally and
signals a rejected POST by **rolling the entry back to `pending`**. So the failure
a user actually hits still rendered an **empty** status region — the original
silent-failure symptom this whole thread started from, unchanged. Round 5 had
replaced a reachable-but-latched state with an unreachable one.

The card now also treats *a settled resolve that left the entry `pending`* as the
failure — which is precisely how the shipped provider reports a rejected POST.

## 6. The rest, fixed

- `registerElicitation`'s boolean had **zero** production consumers again (round 5
  deleted the only one) while its docstring justified itself by a contract that
  round had removed. Consumed at the self-heal site: a self-heal that itself fails
  puts the card into the blocked state rather than offering live buttons over an
  entry the provider does not have.
- the registration payload was **duplicated verbatim** between the SSE handler and
  the card's self-heal effect, which must stay in lockstep because the card
  reconciles against the entry the handler opens. One `runJsElicitationInit()`
  factory now.
- the e2e sibling probe was breakout-anchored but its **gate** was not, so an
  unrelated earlier turn's rail could open the block and force a false RED. Gate
  scoped to the breakout's own bubble.
- the seam guard's import assertion restated a fact any compiling `ChatMessage`
  must satisfy. Removed — decoration reading as coverage is what this round is
  removing everywhere else.

## 7. Dispositioned without a code change

- **FR6-13 `accepted-open`** — both seams share a half-install hole: a `subscribe`
  that registers its listener and *then* throws leaks it. Narrow (neither shipped
  provider can do this — both are a single `store.subscribe(...)` that returns or
  throws before registering) and not soundly fixable from the seam side: there is
  no unsubscribe to call, because the provider never returned one. The honest fix
  is an interface change (a subscribe must not register before it can succeed),
  beyond this feature. The auditor's own finding notes the "genuinely symmetric"
  claim HOLDS — the hole is shared, not one-sided.
- **FR6-14 `accepted-open`** — the self-heal effect has no notion of staleness, so
  for a request the SERVER already discarded the card shows live controls. The
  auditor verified the bounds: the provider never deletes entries (so no answered
  card resurrects in-session) and the block is client-injected (so it cannot
  survive a reload). For a discarded request, clicking resolves through the real
  endpoint's `404 → 'cancelled'` mapping and renders "Denied." Letting the SERVER
  adjudicate beats a client guess at staleness — which is the latched-client-state
  mistake round 5 removed.
- **FR6-15 `accepted-open`** — none of the component's degraded RENDER branches is
  exercised: no JSX unit runner, the gallery marks the surface `kind: 'via'` so
  `gate:ui` never renders it, and the e2e drives the healthy path. Stated plainly,
  because it is how FR6-3's aria-label clobber got in. The **decisions** are now
  pinned as pure functions (`elicitationBlockedReason`, `runJsElicitationInit`, and
  the seam's own tests) — that is the part this workspace can test. A gallery
  fixture for the card is the standing gap; it is recorded, not claimed as done.

## 8. Observed results

| suite | observed |
|---|---|
| Rust lib — `mcp::tool_calls::` | **18 passed, 0 failed** |
| Rust integration — the NEW `pg_indexes` guard | **1 passed, 0 failed** |
| …its 6 negative controls | every one **RED**, green on removal |
| `railSegmentation.test.ts` | **14 passed, 0 failed**; 2 clamp reverts → RED |
| `railIsolation.test.ts` | **6 passed, 0 failed**; the real revert spelling → RED |
| `transport.test.ts` / `liveSteps.test.ts` | **8** / **6** passed, 0 failed |
| chat unit family | **341 tests, 337 pass, 4 fail** (the pre-existing loader failures) |
| `npm run check` (ui) / (desktop/ui) | **exit 0** / **exit 0** |
| e2e — rail family + `run-js-inner-approval`, bridge ON | **21 passed, 0 failed** |
