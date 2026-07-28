# FIX_ROUND-7 — Activity Rail

Round 7. A blind re-audit of FIX_ROUND-6's diff, two auditors.

**New confirmed findings:** 14

14 confirmed and fixed; 3 `accepted-open` with rationale. All in `LEDGER.jsonl`
with `"round": 7`.

**No HIGH findings** — the first round of this loop without one. Round 6's
structural change (deleting the parser) held up: both auditors independently
confirmed the `pg_indexes` guard is sound, non-vacuous, and catches the plain and
constraint cases. What this round found is that the *replacement* shipped three
overclaims and one lost negative control.

---

## 1. "The two cannot drift" was false

Both auditors, independently. `FILTERED_LOOKUP_COLUMNS` was made `pub(crate)`
**inside `#[cfg(test)] mod tests`** — and an integration test is a **separate
crate**, linked against the lib built *without* `cfg(test)`. So it was invisible,
and `tool_call_index_test.rs` hand-duplicated the list while the docstring claimed
sharing.

A sixth narrowing added to `list_calls_for_user` would have updated one copy and
**silently narrowed a security guard** — precisely the failure the docstring said
was impossible.

Fixed by moving the const out of `cfg(test)`, re-exporting it from `lib.rs`, and
having the integration test import it. The chain is now **SQL → const → guard**
with no copy anywhere, and the const↔SQL link is itself pinned.

## 2. Two overclaims in the new guard, both reproduced live on PG17

- **INCLUDE columns.** `unnest(indkey)` yields *all* index attributes, including
  non-key INCLUDE payload. So `CREATE INDEX … (created_at) INCLUDE (server_id)`
  looked like an index covering a filtered column that does not lead with
  `user_id` and **failed** — a false RED on a legitimate covering index, and a
  **regression versus the parser it replaced**, which ignored INCLUDE lists.
  Fixed with `ON k.ordinality <= ix.indnkeyatts`.
- **Expression indexes.** The comment said they are "surfaced rather than
  skipped"; the code did the opposite — NULL `attname` became `""`, matched
  nothing in `FILTERED`, and the index was silently skipped. An auditor
  reproduced `CREATE INDEX … (lower(tool_use_id))` passing a guard advertised as
  unevadable. Now it **fails with a directive**: *"I could not tell"* must not
  read as *"it is fine"* in a security guard.

Both closed with negative controls: the INCLUDE index no longer false-REDs; the
expression index turns the guard RED.

## 3. A committed negative control was genuinely lost in the rewrite

The deleted file's
`assert_owner_leading_rejects_a_single_column_index_on_every_filtered_column`
proved the rule **fires** for each column. The replacement had none — so
weakening the assertion (`Some("user_id")` → `cols.first().is_some()`) left it
green. The six controls in `TEST_RESULTS.md` were run by hand, not committed, so
the property was unpinned going forward.

Now committed: for **every** filtered column the test creates a real violating
index on the real table, asserts it genuinely violates, asserts the owner-leading
form of the same index is accepted (so the rule is not simply rejecting
everything), and drops both.

## 4. The drift guard could pass while the const was wrong

Two mechanisms, both measured by an auditor: the hardcoded `start + 400` window
ends 87 bytes past the fifth narrowing, so a seventh lands mid-predicate and is
**silently dropped** from `found` — and if the const is *also* stale (the very
drift being guarded), `found == expected` and it passes green. Any narrowing not
spelled exactly `AND ($n … OR col = $n)` was skipped the same way.

Now bounded by the real `ORDER BY`, and **every `AND (` line must parse** — an
unparseable narrowing panics with a directive instead of being skipped into
agreement.

## 5. The self-heal branch still did not do what its comment said

Both auditors. `setResolveFailed(true)` maps to `resolve-failed`, which **by
design keeps both buttons enabled** — so the card still "offered live buttons over
an entry the provider does not have", and told the user *"That didn't go through —
try again"* about a resolve they never attempted. It also **latched**:
`resolveFailed` clears only inside `resolve()`, so the wrong message persisted on
a healthy card after the transport reinstalled.

The root cause was, again, too few states. A third one:

| state | controls | why |
|---|---|---|
| `no-transport` | disabled | nothing can carry the decision |
| **`not-registered`** (new) | **disabled** | a transport exists but holds no entry — a decision would resolve into nothing |
| `resolve-failed` | enabled | a genuine failure with an entry present; retrying is the point |

`not-registered` is derived from `elicitationExists` on every seam bump, so it
clears itself the moment the self-heal lands. Nothing latches.

Related, same file: the `stillPending` check covered only `'pending'`, not
`undefined` — and with no entry the provider's optimistic set is a no-op and its
catch returns early, so a genuinely no-op'd resolve **reported success**. Fixed.

## 6. Two tests that could not fail for what they claimed

- **`shapeIntact` guard branch.** The round-6 fixture pinned the merge branch but
  not the guard: dropping the `consumed` (or `blocking`) term from `shapeIntact`
  produced byte-identical results and stayed **green** — while the mutant is a
  real bug (a matching key with an unclamped `consumed` returned verbatim,
  breaking ITEM-5). Two same-key/differing-field fixtures added; **both mutants
  now turn it RED**, each proven by running it.
- **The a11y property flip-flopped across two rounds with nothing pinning it.**
  Round 5 added the tooltip, round 6 removed it, and re-adding it turned nothing
  red (`lint:tooltip-placement` only checks side-uniformity). The run_js approval
  e2e now asserts the **accessible names** (`/approve/i`, `/deny/i`), that both
  controls are enabled on a healthy transport, and that `aria-describedby` is
  absent when there is nothing to describe.
  **Negative control run:** re-adding `tooltip` fails with
  `toHaveAccessibleName → Expected pattern /approve/i`.

## 7. The rest, fixed

- the revert-regex collapsed the whole file to one line, so its lazy `.*?` was no
  longer newline-bounded; and the same hunk had dropped the import assertion, so
  the seam guard no longer distinguished the real import from a local shadow.
  Both fixed; the real revert spelling still turns it RED.
- `RunJsApprovalIdentity` was a **third** declaration of the identity triple —
  `JsToolApprovalData` now extends it.
- `let _ = legacy_cols;` dead binding removed.
- `assert_eq!(seen_legacy, LEGACY.len())` made the security-**correct** action
  (dropping a legacy single-column index) fail the suite. Relaxed to `<=`:
  exemptions may shrink, never grow.
- the `pg_indexes` query is scoped to the `public` schema and grouped by index
  OID, so a same-named relation in another schema cannot merge attributes into one
  ambiguous array.

## 8. Dispositioned without a code change

- **FR7-15 `accepted-open`** — desktop-only migrations are no longer scanned. The
  auditor verified nothing under `desktop/tauri/migrations` touches
  `mcp_tool_calls`, and the desktop binary applies the SERVER's merged set, so
  only a desktop-EXCLUSIVE migration is outside. Covering it means a second full
  `TestServer` boot for one SELECT.
- **FR7-16 `accepted-open`** — a future migration could launder a new bad index by
  reusing a legacy exemption NAME. Inherent to any name-based exemption; keying on
  OID is not stable across a rebuilt test DB; and reusing the name over a
  *different* column set is already caught by the column-vector pin.
- **FR7-17 `accepted-open`** — the guard costs ~3s because the harness has no
  DB-only entry point. The auditor's own verdict: *"correct tradeoff for
  soundness."* Adding one is a change to SHARED test infrastructure, which **B3**
  forbids doing to serve one feature's problem.

## 9. What the auditors independently confirmed CLEAN

- the `pg_indexes` guard is **not vacuous**: it sees 8 indexes, exempts 2, checks
  2, and `unnest(indkey) WITH ORDINALITY` genuinely gives the leading column
  (verified on PG17);
- the `useEffect` dependency question: **no loop.** `data` is `content.content`, a
  prop-derived object, not a per-render literal — and the `elicitationExists`
  guard plus React's same-value bailout mean even a repeatedly-failing register
  cannot loop;
- the `elicitationStatus(...) === 'pending'` read after the await is **not racy**:
  the provider's rollback is a synchronous zustand `set` inside the awaited
  promise;
- `elicitationInit.ts` is a real factory with two real production consumers, in
  the right module, **with no inline literal left behind**;
- the kit-Button claims in the round-6 comment are **factually true** — a string
  `tooltip` does derive `aria-label` unconditionally, and
  `disabled:pointer-events-none` does mean it can never render;
- `xpath=..` scoping in the e2e is correct — the breakout and the rail really are
  direct children of one container;
- **security-authz: clean.** No authorization surface is touched; the backend
  hunks are test-only.

## 10. Observed results

| suite | observed |
|---|---|
| Rust lib — `mcp::tool_calls::` | **18 passed, 0 failed** |
| Rust integration — `mcp::tool_call_index` (guard + its committed negative control) | **2 passed, 0 failed** |
| …INCLUDE-index control | no longer false-REDs |
| …expression-index control | turns the guard **RED** |
| `railSegmentation.test.ts` | **14 passed**; both `shapeIntact` mutants → RED |
| `railIsolation.test.ts` | **6 passed**; the real revert spelling → RED |
| `transport.test.ts` / `liveSteps.test.ts` | **8** / **6** passed |
| chat unit family | **341 tests, 337 pass, 4 fail** (pre-existing loader failures) |
| `npm run check` (ui) / (desktop/ui) | **exit 0** / **exit 0** |
| e2e — `run-js-inner-approval` with the new a11y assertions | **2 passed** |
| …a11y negative control (re-add the tooltip) | **RED**, `toHaveAccessibleName` |
