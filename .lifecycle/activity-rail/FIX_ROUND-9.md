# FIX_ROUND-9 — Activity Rail

Round 9. A blind re-audit of FIX_ROUND-8's diff, two auditors, both working by
**applied mutation** rather than inference.

**New confirmed findings:** 8

8 confirmed and fixed; 2 `accepted-open` with rationale. All in `LEDGER.jsonl`
with `"round": 9`.

---

## 0. The worst finding is mine

FIX_ROUND-8's `TEST_RESULTS` recorded a tidy-up of three assert messages. What I
actually ran was a regex over the **whole file** — and it collapsed the
indentation of **222 lines** of `mcp/tool_calls/repository.rs`, spanning
production SQL literals and `sqlx::query_as!` argument lists. That is ~466 of the
diff's changed lines: pure noise drowning the one real change, on a file whose
entire purpose is owner-scoping guarantees, and it **re-baselined the SQL text
that this same file's source-parsing guards match against**. No gate catches it
(`cargo fmt --check` is not clean repo-wide), so it would have shipped.

Both auditors found it independently.

Reverted properly: the file restored from the round-7 commit with **only** the
intended parser change re-applied. The delta versus round 7 is now **22
insertions / 10 deletions** instead of 466 lines of churn, and zero lines carry a
single-space indent. The two messages that genuinely needed repair were fixed by
**exact match** — which is what I should have done in the first place.

## 1. Four guards, four proven evasions

Every row below is a mutation an auditor **applied and ran**.

| guard | mutation | before | after |
|---|---|---|---|
| tooltip-on-disable-able Button | `<Button disabled tooltip="…">` (boolean shorthand) | **green** | **RED** |
| ditto | `{...{ disabled: … }}` (spread) | **green** | **RED** |
| ditto | a `>` inside an earlier quoted attribute | **green** | **RED** |
| ditto | rename the scanned file (with the violation in it) | **green** | **RED** |
| "only the impossible state disables" | both `disabled` props → `disabled={blocked !== null}` (the FIX_ROUND-7 latch, verbatim) | **green** | **RED** |
| `resolveStep` seam guard | a multi-branch body putting the revert at offset 417 | **green** | **RED** |

Two of these deserve naming, because they are the same mistake in two places:

- **The tooltip guard's brace-depth scan tracked braces but not QUOTES**, so any
  earlier quoted attribute containing `>` truncated the props window. And its
  `disabled` predicate required an `=`, missing the boolean shorthand — *the most
  natural spelling for a permanently-disabled control*, i.e. exactly the case
  where someone would reach for an explanatory tooltip. It now tracks quotes and
  accepts assignment, shorthand and spread.
- **The `resolveStep` guard sliced a hardcoded 400-char window.** An auditor
  pointed out this is the same defect class the FIX_ROUND-7 comment **in this very
  file** condemns on the Rust side (*"bounded by the real `ORDER BY`, not a
  hardcoded 400-byte window"*). Now bounded by the declaration's real end, and the
  declaration itself must call the helper.

And one that was a straight contradiction: the tooltip guard's
`catch { continue }` made it vacuous on a rename — while the **same branch**, one
file over, had just argued that tolerating absence *"protects nothing and can only
ever launder a future one."* The catch is gone.

## 2. The headline rule was pinned as a predicate, not at its call sites

`elicitationIsUnactionable` had a unit test; the two JSX props that actually
render the disabled state had nothing. Re-introducing the round-7 latch left the
full UI suite, `check:state-matrix` and `tsc` green. A source guard now asserts
every `disabled` prop on the approval controls is exactly
`elicitationIsUnactionable(blocked)`.

## 3. Two hunks of round 8 contradicted each other

Round 8 stopped disabling on `not-registered` **because the provider POSTs
unconditionally** — and in exactly that state the provider holds no entry, so the
status stays `undefined`, which round 8's own `after === undefined` term recorded
as a **failure**. A *successful* approve was marked failed. Masked in the UI only
because `not-registered` outranks `resolve-failed`.

The outcome is now judged only when the provider **held an entry to judge it by**.
With no entry the POST still went out and the script still resumed; that is not a
failure, and `not-registered` already describes the card.

## 4. A termination proof that rested on an unstated contract

An auditor rendered the real hook shape under jsdom and **measured**: with the
shipped provider the `seamVersion` effect terminates at 1 register / 2 renders,
and five cards sharing the module-global seam cost 5 registers — no loop, no
storm. But a provider whose `register` notifies **without** making `has(id)` true
is permitted by the published contract, and spins to ~54 calls until React's
update-depth bail-out — with the error then **swallowed and mislabelled** by this
module's own catch.

Fixed on both sides: the `ElicitationTransport` contract now **requires**
`register` to make `has(id)` true synchronously before any notification for it
(with the measurement as the rationale), and the consumer bounds itself at three
attempts so a non-conforming provider degrades instead of spinning.

## 5. And one styling contradiction

All three blocked reasons rendered in `text-destructive` — including
`not-registered`, which the same round had redefined as transient, self-healing
and explicitly answerable (*"you can still answer it"*). The semantic split
introduced in the predicate had not reached the styling. `danger` is now reserved
for the states that genuinely stop the user.

## 6. Dispositioned without a code change

- **FR9-9 `accepted-open`** — the tooltip rule belongs in the repo's TypeScript-AST
  lint framework, which already runs repo-wide over both workspaces and would be
  immune to every evasion by construction. Correct, and the destination is named.
  But that framework lives in the **`sdk` submodule**, this branch already carries
  one unpushed sdk commit the orchestrator must land before the superproject
  pointer, and **B3** forbids reshaping shared infrastructure to serve one
  feature's problem. The local guard now survives all four proven evasions and
  fails loudly on rename, so the property is genuinely held today.
- **FR9-10 `accepted-open`** — a scope note the auditor explicitly framed as
  predating this branch: `FILTERED_LOOKUP_COLUMNS` covers the optional
  *narrowings*, so `idx_mcp_tool_calls_created` on plain `(created_at)` is never
  inspected, despite `ORDER BY created_at DESC LIMIT` making it the most
  planner-attractive non-owner-leading index on the table. Widening the rule to
  the ORDER BY column is a different and larger claim about the table's index
  strategy — the owner-leading form (`idx_mcp_tool_calls_user_created`) already
  exists, so the real question is whether the plain index should be dropped, which
  is an mcp-module migration decision, not a rail change. Recorded with the
  evidence so whoever owns that call can act on it.

## 7. What the auditors independently confirmed CLEAN

Both worked by mutation, so these are measured, not asserted:

- **the Rust work is sound.** Every FIX_ROUND-8 claim reproduced: the rule
  weakening → control RED; the stale allowlist entry → RED; an exempted index
  removed → RED; an exemption re-created over different columns → RED; the
  compliant expression index → passes; the two drift spellings → RED.
- **an auditor tried to construct a bypass and could not.** The two candidates it
  built — `(created_at DESC) INCLUDE (user_id, …)` and a partial
  `WHERE is_built_in = true` — both pass, and it verified **neither is a real
  bypass**: the INCLUDE exemption is round 7's deliberate false-RED fix and cannot
  enable an index-only scan against a 23-column select list, and a partial
  predicate can never be proven implied by the parameterised
  `($4::bool IS NULL OR is_built_in = $4)`.
- **`catch_unwind` genuinely observes the panic** — no `panic::set_hook` anywhere,
  profile is `panic = "unwind"`, and the baseline green *requires* five observed
  panics, so the mechanism is proven by the baseline itself.
- **fixture isolation holds** — per-test UUID database cloned from a template and
  dropped on `Drop`; verified empirically by running the two tests concurrently at
  `--test-threads=2` six times.
- **no render loop** for the shipped provider (measured, see §4).
- the `AND (`-token parser's one remaining gap (`AND(` with no space) is covered
  from the other side by `filters_never_drop_the_owner_predicate`, which turns RED
  on the same mutation — an auditor checked the pair and did not file it.
- security-authz across the SQL hunks: every read owner-scoped;
  `find_raw_tool_use_input` scoped through `conversations.user_id`; the prune
  deliberately deployment-wide.
- no dead code; `tsc --noEmit` clean; `check:state-matrix` in sync.

## 8. Observed results

| suite | observed |
|---|---|
| Rust lib — `mcp::tool_calls::` | **18 passed, 0 failed** |
| `railIsolation.test.ts` (now 8 tests) | **8 passed**; shorthand / spread / quoted-`>` / rename / latch / multi-branch revert → **each RED** |
| `transport.test.ts` | **9 passed** |
| chat unit family | **344 tests, 340 pass, 4 fail** (the pre-existing loader failures) |
| `npm run check` (ui) / (desktop/ui) | **exit 0** / **exit 0** |
| `repository.rs` single-space-indent lines | **0** (222 before this round) |
| delta of `repository.rs` vs FIX_ROUND-7 | **22 insertions / 10 deletions** (466 lines of churn before) |
