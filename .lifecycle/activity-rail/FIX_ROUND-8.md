# FIX_ROUND-8 — Activity Rail

Round 8. A blind re-audit of FIX_ROUND-7's diff, two auditors.

**New confirmed findings:** 15

15 confirmed and fixed; 2 `accepted-open` with rationale. All in `LEDGER.jsonl`
with `"round": 8`.

This is the strongest round of the loop, because both auditors stopped arguing
about code and started **running mutations**. Every headline finding below is a
mutation they executed, not an inference — and four of them killed artifacts the
previous round had introduced *specifically* as guards.

---

## 0. A control I recorded as passing did not hold

FIX_ROUND-7's `TEST_RESULTS.md` recorded an e2e negative control for the tooltip
regression as **RED**. An auditor showed that result could only have come from an
**unconditional** tooltip — FIX_ROUND-5's actual regression was
`tooltip={blocked === 'no-transport' ? … : undefined}`, i.e. **conditional**, and
the spec only ever reaches the healthy state where that evaluates to `undefined`
and the accessible name is "Approve". Re-adding the real regression verbatim would
have left the spec **green**.

So the control was mis-designed: it went red for a mutation that was not the
regression. `TEST_RESULTS.md` is **corrected**, not quietly amended — the entry
now says what the control actually proved and what replaced it.

## 1. Four guards that guarded nothing — each proven by a run mutation

| guard (added in) | mutation the auditor ran | before | after |
|---|---|---|---|
| the `pg_indexes` "negative control" (round 7) | weaken the rule to `cols.first().is_some()` — **the mutation its own docstring names** | **green** | **RED** |
| `seen_legacy <= LEGACY.len()` (round 7) | add an allowlist entry naming a non-existent index | **green** | **RED** |
| the seam guard's import assertion (round 7) | drop `withSegmentationShape` from the import, add a local shadow, keep `segmentRail` imported | **green** | **RED** |
| the e2e accessible-name assertion (round 7) | re-add FIX_ROUND-5's **conditional** tooltip | **green** | **RED** (via a source guard) |

The failures were all the same shape: **the control tested something adjacent to
the property instead of the property.**

- The "negative control" created a violating index and judged it with its **own
  local helper** — two Postgres tautologies. It never invoked one line of the
  guard. Fixed by extracting the rule as `assert_owner_leading(rows)` and having
  the control drive **that**, under `catch_unwind`, on the live catalog.
- `seen_legacy <= LEGACY.len()` is **unfalsifiable**: relnames are unique per
  schema and rows are grouped by OID, so it can never exceed the length. It had
  *replaced* the only anti-rot check. Existence is required again — and the
  "don't punish dropping a legacy index" objection is answered in the message
  rather than by deleting the check: dropping the index means deleting its
  exemption in the same change, and an exemption for an index that no longer
  exists protects nothing while laundering any future one.
- The import assertion required only that ChatMessage import **something** from
  the module — and it already imports `segmentRail` from there. Now it matches the
  **named specifier**.
- The a11y property cannot be pinned by an e2e at all: no spec can reach a state
  that needs mcp's transport to be absent mid-conversation. It is pinned by a
  **source guard** — *no `tooltip` on a Button that can be `disabled`* — which
  encodes the two mechanical kit facts (a string tooltip overwrites `aria-label`;
  `disabled:pointer-events-none` means it can never render). Its first cut also
  missed its own control (a lazy `<Button[\s\S]*?>` stops at the `>` inside
  `icon={<Check />}`), so the extractor scans to the first `>` at **brace depth
  zero**.

## 2. The third latch, and the rule that ends the class

`not-registered` **latched with both controls disabled**. A failed `register`
returns `false` and bumps nothing, so nothing re-rendered, the self-heal effect
never retried, and `resolve()` early-returned — *strictly less recoverable than
round 6*, which at least left the buttons enabled with the wrong message.

Worse, disabling there **removed a recovery path that worked**:
`McpComposer.resolveElicitation` POSTs **unconditionally**, so with no local entry
the click still reaches `/respond` and still resumes the suspended script.

Two fixes, and the second is the one that matters:

1. `seamVersion` is now an effect dependency, so a failed register retries on the
   next seam change.
2. **Only the impossible state disables.** `elicitationIsUnactionable(reason)`
   returns true for `no-transport` alone — the one case where a click genuinely
   cannot leave the browser.

That second rule is the through-line of all three latches this card has grown
(rounds 4, 6, 7): *every time a state the user could still act through was
disabled, the card became unanswerable.* It is now written down in the seam and
pinned by its own test.

## 3. Two more "fails loudly" claims that were conditional

- **The SQL drift guard's panic path was reachable only for lines already
  starting with `AND (`.** An auditor verified two ordinary spellings skipping
  **silently** — a narrowing appended to the `WHERE user_id = $1` line, and two
  narrowings on one line — each leaving a stale const in agreement, green. Now it
  splits on the `AND (` **token** over the whitespace-flattened clause, so
  formatting is irrelevant, and every fragment must parse. Control run: moving an
  existing narrowing onto the `WHERE` line and removing its column from the const
  is **RED** (that was precisely the silent case).
- **The expression-key assert ran before the filtered-column filter**, so it
  hard-failed for *any* expression key — including a fully compliant
  `CREATE INDEX … (user_id, lower(tool_name))`. The same false-RED class the
  INCLUDE fix removed one round earlier. Now asked **only when the index does not
  already lead with `user_id`** — i.e. only when the guard genuinely cannot
  decide. Two controls run: the compliant expression index **passes**; a
  non-compliant one still turns it **RED**.

## 4. The rest, fixed

- `registerElicitation`'s boolean has no production consumer again; its docstring
  now says what is true — it is a **diagnostic**, not the mechanism. A consumer
  that needs to know whether an entry exists asks the **seam**, because that
  answer is live and this one is a snapshot. Routing it through caller state is
  what produced a latch twice.
- the revert regex was scoped **per line** in round 7, which fixed a false-RED and
  introduced a false-GREEN (a line-wrapped revert). Now scoped to the `resolveStep`
  **declaration** and collapsed within it — **both** spellings run, both RED.
- `assert!(FILTERED.contains(&col))` was tautological (`col` came from
  `for col in FILTERED`); the control now asserts the fixture index is actually in
  the catalog, which is a real precondition.
- the `leading_column_of` helper swallowed query errors via `.ok()`, so a broken
  helper read as "correctly violates". It is gone; `index_rows` uses `.expect(...)`.
- the `after === undefined` term is defensive, not observed — the comment now says
  so, and says why it stays (the seam's contract permits `undefined`, so a
  conforming provider that deletes on resolve must not read as success).
- three assert messages carried ~20-space runs from a reflow, visible in real
  failure output. Collapsed.

## 5. Dispositioned without a code change

- **FR8-11 `accepted-open`** — the drift parser reads only the SELECT half; a
  narrowing added to the COUNT half alone is invisible. Bounded and covered from
  the other side: `filters_never_drop_the_owner_predicate` (TEST-17) asserts the
  predicate list appears in **both** statements. The residual is a narrowing added
  *only* to COUNT, which cannot change which rows are returned — only the total —
  and would surface in the pagination tests. Parsing both halves means two anchors
  plus a divergence check between them, which is the duplication this round
  removed elsewhere.
- **FR8-17 `accepted-open`** — `extends RunJsApprovalIdentity` dedupes the type
  but not the producer: the SSE handler still builds the block as a bare literal
  cast `as unknown as MessageContent`. That cast exists because a streaming block
  is assembled as a `MessageContent` with an untyped JSON payload — the shape
  **every** chat extension uses. Typing that channel is a chat-core change
  affecting every extension, and doing it from js-tool would be exactly the
  cross-module reach this feature exists to remove. The three identity FIELDS are
  single-sourced through the factory both sides call, which closes the part that
  is actionable from here.

## 6. What the auditors independently confirmed CLEAN

- `elicitationBlockedReason` — total, no unreachable branch, correct precedence,
  and **mutation-verified RED** on dropping the `not-registered` arm;
- `withSegmentationShape`'s new assertions — **mutation-verified RED** on dropping
  either the `consumed` or the `blocking` term;
- `filtered_lookup_columns_match_the_query` — **mutation-verified RED** on a wrong
  column, with the anchor confirmed to resolve to the list query and the count
  query and the test's own string literal both outside the window;
- the four `pg_index` corrections (`indnkeyatts`, `nspname`, `GROUP BY i.oid`,
  refusing NULL keys) — all real, all correctly implemented;
- **test isolation**: every `TestServer::start()` gets a `test_db_<uuid>` cloned
  via `CREATE DATABASE … TEMPLATE`, so the control's `CREATE INDEX` cannot
  contaminate the guard test or the template even under parallel threads, and a
  mid-loop failure leaks nothing beyond a per-test DB the harness reaps;
- the `FILTERED_LOOKUP_COLUMNS` move and re-export — visibility chain intact, the
  duplicate genuinely gone, following the existing test-only re-export precedent;
- `aria-describedby` conditionality; the `perLine` narrowing's original intent;
- no leftover reference to any removed symbol; `tsc --noEmit` and
  `cargo check -p ziee --tests` clean.

## 7. Observed results

| suite | observed |
|---|---|
| Rust lib — `mcp::tool_calls::` | **18 passed, 0 failed** |
| Rust integration — `mcp::tool_call_index` (guard + control) | **2 passed, 0 failed** |
| …MR2 (weaken the rule) | **RED** — "THE RULE DID NOT REJECT …" |
| …MR3 (stale allowlist entry) | **RED** — "names an index that does not exist" |
| …compliant expression index | **passes** (it false-RED before) |
| …non-compliant expression index | **RED** |
| …drift control (narrowing moved onto the `WHERE` line) | **RED** (silent before) |
| `railIsolation.test.ts` | **7 passed**; shadow mutation → RED; both revert spellings → RED; conditional tooltip → RED |
| `transport.test.ts` | **9 passed** |
| `railSegmentation.test.ts` | **14 passed**; both `shapeIntact` mutants → RED |
| `npm run check` (ui) / (desktop/ui) | **exit 0** / **exit 0** |
