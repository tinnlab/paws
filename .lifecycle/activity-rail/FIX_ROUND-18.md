# FIX_ROUND-18 — Activity Rail

Round 18. **A hypothesis was tested and REFUTED.** Round 17 §7 diagnosed why
rounds 10-17 could not converge and prescribed a fix: replace the syntactic
guards with a behavioural e2e. This round built that e2e, deleted the guards it
appeared to make redundant — and its own blind re-audit proved the deletion
removed real cover. **The deletion was reverted in full.** The e2e is kept, as a
complement.

**New confirmed findings:** 15

15 confirmed and fixed. All in `LEDGER.jsonl` with `"round": 18`. Three blind
auditors (test-quality, correctness-logic, docs), each scoped to this round's own
diff. Their central finding invalidated this round's own plan; the write-up below
is the corrected one — the version claiming a clean 0-finding round was written
before they reported and is superseded.

---

## 1. Why the loop was stopped rather than continued

Findings per round: `0,2,17,16,20,12,14,15,8,10,7,8,6,8,5,15,21`. Flat-to-rising,
ending higher than it started. Rounds 13-17 put **46 of 59 findings on one file**
(`railIsolation.test.ts`); round 17 was **21 of 22**. Across rounds 10-17, 64 of
87 entries are on that file and **21 (24%) are on product files** — so "essentially
every finding was in the guards" would be an overstatement; the concentration is
real but not total.

Round 17 §7's diagnosis is correct as far as it goes: those guards try to prove a
**semantic** property — *the handler POSTs in exactly the states the control
renders actionable* — by **syntactic** pattern-matching, over an unbounded space
of spellings.

A flat/rising profile is an ABORT — re-scope. This round re-scoped. What it got
wrong was *which* re-scope the diagnosis licensed.

## 2. The behavioural matrix (kept)

`src-app/ui/tests/e2e/chat/run-js-inner-approval.spec.ts` drives the **reachable**
half of `blocked ∈ {null, no-transport, not-registered, resolve-failed}` × click,
asserting only observable behaviour: **did a POST leave the browser, and is the
control actionable.**

| id | state | drives | asserts |
|---|---|---|---|
| **M1** | `blocked === null` | `dblclick` Approve | distinct accessible names (`/approve/i`, `/deny/i`); both enabled; no `aria-describedby`; POST carries `accept`; `data-status` → `approved`; exactly one POST |
| **M2** | `resolve-failed` | first POST rejected 500 (store rolls back to `pending`), then retry | `data-status` → `resolve-failed`; both controls still **visible and enabled**; the retry **genuinely POSTs**; `data-status` → `approved` |
| **M3** | `blocked === null` | click Deny | POST carries `decline`; `data-status` → `denied` |

This is real added value and it stays. It measures by construction what no source
guard can, and it caught something the guards could not — see §3.

## 3. Mutation results — measured, and one of them broke the plan

Eight mutations applied to the shipped component, each run and reverted.
Log: `/data/pbya/ziee/tmp/lifecycle-logs/rail18-mutations.log`.

| # | mutation | result |
|---|---|---|
| A | delete the single `setSubmitting(true)` | **GREEN — NOT CAUGHT** |
| B | `if (resolveFailed) { focus(); return }` latch | RED |
| C | `const carried = blocked === null ? await resolveElicitationVia(…) : false` | RED |
| D | `disabled={blocked !== null}` (the FIX_ROUND-7 latch verbatim) | RED |
| E | swap the controls' visible text, test ids left on their handlers | RED |
| F | `className={blocked ? 'mt-3 hidden' : 'mt-3'}` | RED |
| G | invert the failure judgement (`!resolveDidFail(…)`) | RED |
| H | decided-const replaced by a local **optimistic** `useState` | RED |

**Scope correction (docs auditor):** each mutation above ran against ONE test via
`-g`, not the whole file — A and E against M1, the rest against M2. Mutation A was
therefore re-run against **all three** tests; result in §9.

**Mutation A is the important negative result.** The hand-off predicted the
`dblclick` assertion would pin the in-flight flag. It does not:
`McpComposer.resolveElicitation` performs its optimistic `set()` **synchronously**
before its first `await`, so the entry flips to `accepted`, the seam bumps and both
controls un-render inside the first discrete event — with or without a re-entrancy
gate. The assertion's stated subject is broader than what it can enforce, and the
spec now says so in place.

## 4. The deletion, and why it was reverted

On the strength of B-H the round deleted `FIX_ROUND-14` in full plus
`FIX_ROUND-9`'s `loading`/action/label/render-gate/CSS checks (433 lines,
commit `867a78b9e`). **Two auditors independently proved that was wrong, and the
finding was reproduced in this session's own harness before being accepted.**

### The mechanism, stated once

`blocked` has **four** values; only **two** are reachable from a spec. So for every
defect these guards cover there is a spelling **keyed on an unreachable value**
that the matrix cannot see. B-H were RED only because each mutation's condition
happened to discriminate a *reachable* state.

Five holes were opened, each verified **GREEN under the reduced guards AND the
matrix, RED under the restored guards**:

| # | mutation (keyed on `not-registered`) | harm |
|---|---|---|
| 1 | `{resolved === null && blocked !== 'not-registered' && (<controls/>)}` | both controls vanish in a state whose own copy reads *"you can still answer it"* |
| 2 | `const carried = blocked === 'not-registered' ? false : await resolveElicitationVia(…)` | never POSTs in a state the seam documents as answerable, then latches on *"That didn't go through"* |
| 3 | `loading={submitting \|\| blocked === 'not-registered'}` on **Deny only** | Deny inert (`pointer-events-none`, `onClick`→`preventDefault`) while the card invites the click |
| 4 | `className={blocked === 'not-registered' ? 'mt-3 hidden' : 'mt-3'}` | controls hidden in the same state |
| 5 | `if (healExhausted) return` in the handler | the click silently no-ops with both controls rendering ENABLED |

Hole 3 also exposed a structural weakness in the reduction: `approvalControlNames`
derived from `controls[0]` only, so **Deny's `loading` was checked by nothing**.
And no `loading` mutation appeared in A-H at all — that guard was deleted outside
the round's own stated justification.

`not-registered` is production-reachable, not hypothetical: mcp's `initialize` is
`async` and awaits a dynamic import **before** `setElicitationTransport`, so a
`runJsApprovalRequired` frame landing in that window is dropped. That window is the
documented reason the card's self-heal effect exists.

### Disposition

**`railIsolation.test.ts` is restored to its pre-round-18 content**, plus a header
comment recording this result so the deletion is not re-attempted. Five regression
controls prove the restore closes all five holes (§9).

The two deletions the auditors agreed *were* genuinely covered (the
dispatched-action check and the visible-label check) were **also restored** — they
are state-independent today, but nothing prevents a state-keyed spelling of either,
and this round has already demonstrated the cost of reasoning "the matrix covers
it" one step too far.

## 5. Findings against the round's own new guard

The reduced round-18 guard was itself defective, which is further evidence the
reduction was not ready:

- **Dead-gate class re-opened** — its `scan()` set `leaves = true` for a `return`
  anywhere in the then-branch subtree, so
  `if (elicitationIsUnactionable(blocked)) { if (never) return }` counted as a
  returning guard with the seam gate dead. The deleted implementation mapped each
  exit to its *nearest enclosing* `if` and additionally swept non-returning `if`s
  mentioning the predicate — it rejected exactly this shape. Moot on revert.
- **A failure message asserting an impossible consequence** — it claimed that
  without the guard "a programmatic dispatch POSTs in `no-transport`". It cannot:
  `resolveElicitationVia` returns `false` before touching the network when no
  transport is installed. The real (milder) harm is that `resolveDidFail` then
  records a failure for an attempt that never left the browser. Moot on revert;
  recorded so the wrong property is not defended later.

## 6. Corrections to this round's own prose

Every claim below was written by this round and was **false or overstated**; each
is corrected in the shipped comments and above.

1. **"the mcp card has no behavioural test at all"** — false, stated four times.
   `tests/e2e/chat/mcp-tool-approval-optimistic.spec.ts` has four tests that click
   the card's real controls (`tool-approval-approve-once` / `-deny` /
   `-approve-conv`), and five further specs drive the same test ids. Both defects
   FR17-22 names would turn the optimistic-deny test RED. FR17-22's own text says
   only *"not held to the invariants the js-tool card is"*; this round escalated
   that to "no behavioural test" and then used the escalation to justify a
   retention decision. The narrow tooltip/accessible-name hazard genuinely is
   uncovered — the retention survives, the premise does not.
2. **"mcp's `initialize` installs the transport unconditionally / nothing exposes a
   removal seam"** — false. `setElicitationTransport` refuses the install if the
   provider's `subscribe` throws, and `clearElicitationTransportIfOwnedBy` is wired
   into the registry's `unregister` (the HMR path). The accurate claim, now
   shipped, is that **no browser-driven spec can invoke either**.
3. **"each run against the matrix"** — each mutation ran against one test (§3).
4. **A tally that did not add up** — "11+5+3+3+1" over a 22-row table; the correct
   split is 11 / 4 / 3 / 3 / 1 = 22, and the section head said "21 findings" while
   enumerating FR17-1…FR17-22 (21 `confirmed` + 1 `accepted-open`).
5. **Unlogged results presented as observed** — the unit, mutation-control, `tsc`
   and lint rows had no log behind them. On a branch where `FIX_ROUND-8` §0 and
   `-9` §0 are both *"the prose claimed a RED control that was GREEN"*, that is the
   exact claim class that has already failed twice here. **Every row in §9 now
   names a log file**, and each was re-run.
6. **The quoted e2e result was not produced by the committed spec** — the run
   predates comment edits inside the M1 region (Playwright reported the tests at
   lines 36/119/176; the commit has them at 57/148/205). The spec was **re-run
   after the final edit** and §9 quotes that run.
7. **`FIX_ROUND-18.md` was untracked** while four shipped comments cited it as the
   rationale for a 433-line deletion — a dangling citation for anyone checking out
   the branch (coding-guidelines §17). It is committed alongside the comments that
   cite it.
8. **Closure mis-attributed** — the old §5 credited the matrix for FR17-1/-2/-3 and
   FR17-20, whose real closure is a **retained round-17 guard fix**
   (`isSeamSpecifier` resolving module identity; `declarationsOf` handling
   `ObjectBindingPattern`). And "any shadow that changes the answer shows in M1/M2"
   is false — a shadow differing only in the unreachable values is invisible.
9. **§1's guard-only concentration overstated** — corrected in §1 with the real
   24% product-file share.

## 7. The 21 round-17 findings — corrected disposition

With the guards restored, **all 21 remain closed by the round-17 fixes that are
still in the file.** What changed is the claim about *what* closes them: the matrix
independently covers the reachable-state spelling of FR17-2, -4, -8, -12, -16, -17
and the js-tool half of -18, which is defence in depth, not replacement. FR17-11
(the in-flight raise) is measured **not** covered by the matrix (§3, mutation A).
FR17-22 stays `accepted-open`, with its premise corrected per §6.1.

## 8. What would actually retire these guards

Not an e2e. `blocked`'s unreachable half is unreachable *because nothing in a
browser session can construct it*. The structural answer is a **component-level
harness** that mounts the card against a stubbed transport, constructs all four
`blocked` values directly, and clicks. `FIX_ROUND-14` records that auditors already
drove this component under React 19 + jsdom in private worktrees, so it is
demonstrably feasible; this repo has no such harness committed (zero `.test.tsx`
files). That is the recommendation, and it is deliberately **not** attempted in
this round — this round's lesson is that removing cover before the replacement is
proven is how a guard family loses its subject.

## 9. Observed results — every row names its log

All logs under `/data/pbya/ziee/tmp/lifecycle-logs/`.

| suite | observed | log |
|---|---|---|
| `railIsolation.test.ts` (restored) | **10 tests, 10 pass, 0 fail** | `rail18-unit-final.log` |
| restore regression controls (the 5 holes) | **5/5 RED** | `rail18-restore-controls.log` |
| e2e — the state matrix, committed content | **3 passed, 0 failed (1.2m)**, exit 0 | `rail18-e2e-final.log` |
| matrix mutation controls (8, `-g`-scoped) | **7 RED, 1 GREEN (A)** | `rail18-mutations.log` |
| mutation A vs **all three** tests | **3 passed, exit 0 — still GREEN**; the negative result holds file-wide, not just for M1 | `rail18-mutA-allthree.log` |
| `tsc --noEmit` (ui) | **exit 0** | `rail18-tsc-final.log` |
| biome lint (touched files) | **exit 0** | `rail18-biome-final.log` |
