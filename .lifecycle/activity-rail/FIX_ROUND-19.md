# FIX_ROUND-19 — Activity Rail

Round 19. A blind re-audit of FIX_ROUND-18's commit (`9ba464731`), two angles
(**test-quality**, **docs**), each scoped to that commit alone.

**New confirmed findings:** 11

11 confirmed and fixed; **6 `accepted-open`**. All in `LEDGER.jsonl` with
`"round": 19`.

Round 18 reverted a deletion its own audit had refuted. Round 19 audits *that
revert and the corrected write-up*. It produced two results that matter, in
opposite directions.

---

## 1. The revert is clean — proven byte-for-byte

The auditor did not take "restored in full" on trust. `git show
HEAD~1:…/railIsolation.test.ts` is 1598 lines; the working file is 1631; all 33
added lines (368-400) match `^ \*` and sit inside a pre-existing block comment;
and `sed '368,400d'` on the current file is **byte-identical** to the HEAD~1 file.
There is no behavioural difference of any kind. All five holes the round-18 audit
opened are RED again under the restored guards.

## 2. …and the restored guards have FIVE MORE holes, one of them worse than any yet

This is the finding of the round, and it is the strongest evidence yet for §8 of
`FIX_ROUND-18.md`. Every one is **pre-existing** — present at `HEAD~1`, not
introduced by round 18 — **tsc-clean**, **GREEN under the guards**, and **keyed on
`not-registered`, so invisible to the matrix**.

### FR19-10 — the POST's ARGUMENTS are unguarded (`accepted-open`, HIGH)

`railIsolation.test.ts` pins that `resolveElicitationVia` is called exactly once
and is the sole initializer of an `await` const — and never looks at what it is
called *with*:

```ts
resolveElicitationVia(data.elicitation_id, blocked === 'not-registered' ? 'cancel' : action)
```

`'cancel'` is a legal `ElicitationAction`, so this type-checks. **Clicking Approve
cancels the tool call.** This is strictly worse than the five holes round 18
opened: those made the card unanswerable, this silently sends a *different answer
than the one the user gave*, in a state whose own on-screen copy reads *"you can
still answer it"*. A sibling spelling swaps the id (`statusId` for
`data.elicitation_id`) so the POST lands under a nonexistent id and the suspended
script never resumes.

The guard file had already diagnosed this exact miss one rung up — its own comment
reads *"checked the classifier's CALLEE and never its arguments"* — about
`elicitationBlockedReason`, and never carried it over to the send.

### FR19-11 … FR19-14 — four more of the same shape (`accepted-open`)

| # | hole | evidence |
|---|---|---|
| FR19-11 | the CSS-inerting sweep reads `className` **only**. `style={{pointerEvents: blocked === 'not-registered' ? 'none' : undefined}}` and `hidden={blocked === 'not-registered'}` both pass — the latter is round-17's mutation F respelled from a class to an attribute. `inert`, `aria-hidden`, `onClickCapture`+`stopPropagation`, `tabIndex={-1}` likewise. | GREEN under the guards; first two tsc-verified |
| FR19-12 | **the self-heal has no guard at all** — `registerElicitation` appears 0 times in the guard file. Deleting the call plus its two now-unused imports is tsc-clean and GREEN. `not-registered` then never clears; the answer POSTs and the script resumes, but `resolved` never flips, so the outcome is never shown and both controls stay rendered **and enabled**, inviting a duplicate POST to a single-use elicitation. This is the mechanism rounds 8, 9, 10, 12 and 13 each re-fixed. `spent >= HEAL_BUDGET` → `>= 0`, and dropping `seamVersion` from the effect deps (the FIX_ROUND-8 fix itself), are also GREEN. | measured directly |
| FR19-13 | `isLiveClassifierArg` resolves each signal to a live *callee* but never its arguments, so `entryExists: elicitationExists(statusId)` is tsc-clean and pins `blocked` at `not-registered` for the life of every card. Same class as FR19-10. | GREEN under the guards |
| FR19-14 | copy / a11y / observability for the unreachable states are unguarded: blanking the `not-registered` status text; narrowing `aria-describedby` to `resolve-failed` only (so the **disabled** `no-transport` control loses its only explanation — WCAG); `data-status={resolved ?? 'pending'}`; `healExhausted = false`. | all GREEN |

### Disposition: recorded, NOT patched

**Adding five more predicates is the treadmill this round exists to stop.** Rounds
13-17 are the experiment: each round closed the spellings the last audit found and
the next audit found more. FR19-10 through -14 are simply the next five, and the
guard file's own comment shows the argument-checking miss was already *known* one
rung up and still not generalised.

Every one of them is closed **by construction** by the component harness named in
`FIX_ROUND-18.md` §8 — construct `not-registered`, click Approve, assert the POST
carries `accept` under the right id, assert the controls are reachable. That is one
harness versus an unbounded predicate sequence.

They are therefore `accepted-open` with the destination named. **They are
pre-existing**, so this is not a regression this branch introduces; it is a gap
this branch has now *measured* instead of assuming closed.

## 3. An undisclosed hollow claim in the matrix spec — fixed (FR19-15)

`run-js-inner-approval.spec.ts`'s accessible-name assertion carried the comment
*"Re-adding it turns this red."* It does not. FIX_ROUND-5's tooltip was
**conditional** on the degraded state, and this test runs at `blocked === null`
where it evaluates to `undefined`. Measured: re-adding it in its historical
spelling leaves the whole file **GREEN (3 passed)**, while the same mutation is
**RED** under `railIsolation.test.ts`'s FIX_ROUND-8 guard.

This is `FIX_ROUND-8.md` §0 recurring verbatim — *a control recorded as RED for a
mutation that was not the regression* — in a comment round 18 shipped. The comment
now states what the line actually pins (an unconditional tooltip; distinct names in
the healthy state) and which guard holds the real property.

A second, milder one fixed alongside (FR19-16): the `resolve-failed` docstring
credited `toBeVisible()` + `toBeEnabled()` with proving the controls are *"still
reachable (no `pointer-events-none`)"*. Neither assertion can observe
`pointer-events-none` — what proves it is the `approve.click()` two lines later,
whose actionability check times out on an inert control. Attribution corrected.

## 4. Nine inaccuracies in round 18's corrected write-up — all fixed

None changes a result; all are the same class the branch keeps re-committing — **a
checkable number or citation asserted rather than derived.**

| # | as shipped | truth |
|---|---|---|
| FR19-1 | "the commit has them at 57/148/205" | those were the SUPERSEDED commit's lines, and the artifact had dropped the commit id — so the sentence was wrong about the commit a reader holds. ("+21 lines inside the M1 region" was also wrong: the FILE HEADER.) Fixed as a **procedure, not a number** — re-run the spec after every edit to it and check Playwright's printed line numbers against `grep -n '^  test(' `. Round 19 edited the spec again and the numbers moved again (67/169/232), which is exactly why three digits in prose was the wrong fix |
| FR19-2 | "zero `.test.tsx` files" | there is exactly **one** (`seam-parity.test.tsx`). The substantive claim survives and is now stated precisely: it mounts nothing, there is no `@testing-library/*` dep, and `vitest.config.ts` scopes `include` to `src/**/*.store.test.ts` |
| FR19-3 | "433 lines" | `--numstat` is `170 431` — **431** deleted, net −261 |
| FR19-4 | the five holes "each verified GREEN under the reduced guards AND the matrix" | only the RED half was logged here. Now split by who measured what, and the matrix half is re-measured in `rail18-holes-vs-matrix.log` |
| FR19-5 | "each was re-run" | false for `rail18-mutations.log` (predates the final spec edit). Now labelled per-row |
| FR19-6 | commit message: "leaves the guards RED" | the GREEN half was logged, the RED half was not — §9 had **no** row for the 16 restored-guard controls. The row FR18-12 flagged as unlogged had been resolved by *deleting* it. Now logged (`rail18-unit-mutations.log`) |
| FR19-7 | mutation D is "the FIX_ROUND-7 latch verbatim" | `FIX_ROUND-7.md`'s own table ships `resolve-failed` → **enabled**; it is the **FIX_ROUND-4** latch. The M2 docstring in the same commit had it right — two prose artifacts in one commit disagreeing |
| FR19-8 | `railIsolation.test.ts:399` cites "§6" | it is **§8**; §6 is "Corrections to this round's own prose". The dangling-citation class §6.7 itself raises |
| FR19-9 | §9's `tsc`/biome rows claim "exit 0" | neither log contained an exit code and `rail18-tsc-final.log` was **0 bytes** — indistinguishable from a command that never ran. All suites re-run with explicit `*_EXIT=` markers |

## 5. What the docs angle verified TRUE

Every statistic (the per-round series against each `FIX_ROUND-*.md`; 46/59; 21/22;
64/87; the 24% product-file share), "+33 lines of comment", "restored in full",
`restore-controls.py`'s faithfulness to all five holes (including that R3's anchor
uniquely targets the **Deny** button and R5's `healExhausted` is a real in-scope
const), §6.1 (four mcp tests plus five further specs driving those ids), §6.2 (both
halves), the §4/§5 mechanism claims, §2's M1/M2/M3 table assertion-for-assertion,
§6.4's arithmetic, §6.8's symbols, §8's `FIX_ROUND-14` citation, and that the
`867a78b9e` → `HEAD` spec diff is comment-only.

Its bottom line: **the round did not repeat the round-8/9 failure mode in its
headline results** — every §9 number it could check is real and reproducible from
the named log.

## 6. Convergence

**Not converged, and this round says why rather than projecting a round 20.**

The in-diff findings (FR19-1 … FR19-9, FR19-15, FR19-16) are fixed. The six
`accepted-open` entries (FR19-10 … FR19-14, plus FR17-22 carried forward) are
**pre-existing gaps in a guard family this branch has now demonstrated, twice with
measurements, cannot be closed by adding predicates**:

- Round 18 deleted guards on the strength of seven RED mutations, and its audit
  found five spellings the mutations missed.
- Round 19 restored them, and its audit found five *more* — including one
  (FR19-10) that is worse than anything the deletion opened, and one (FR19-12)
  covering a mechanism five earlier rounds each re-fixed.

Two independent audits, opposite directions, same result. The next honest step is
**not** round 20's predicates; it is the component-level harness (`FIX_ROUND-18.md`
§8), which closes FR19-10 … FR19-14 by construction. That is scoped work with a
named owner-decision attached, and it is **out of scope for this round** — the
lesson of round 18 is precisely that you do not move cover before the replacement
is proven.

## 7. Observed results — every row names its log and carries an exit marker

All logs under `/data/pbya/ziee/tmp/lifecycle-logs/`.

| suite | observed | log |
|---|---|---|
| `railIsolation.test.ts` | **10 tests, 10 pass, 0 fail**, `UNIT_EXIT=0` | `rail18-unit-final.log` |
| restored-guard mutation controls (16) | **12 defects RED, 4 refactors GREEN**, `UNIT_MUTATIONS_EXIT=0` | `rail18-unit-mutations.log` |
| restore regression controls (the 5 round-18 holes) | **5/5 RED**, `RESTORE_CONTROLS_EXIT=0` | `rail18-restore-controls.log` |
| the 5 holes bundled vs the **matrix** | **3 passed, `HOLES_VS_MATRIX_EXIT=0`** — all five live at once and the matrix is fully green | `rail18-holes-vs-matrix.log` |
| e2e — the state matrix, final committed content | **3 passed, 0 failed (1.4m)**, `FINAL_SPEC_EXIT=0`; prints tests at 67/169/232, matching `grep -n '^  test(' ` on the committed spec | `rail18-e2e-final.log` |
| matrix mutation controls (8, `-g`-scoped) | **7 RED, 1 GREEN (A)** — predates the final comment edit; mutates the COMPONENT against unchanged assertions | `rail18-mutations.log` |
| mutation A vs all three tests | **3 passed, `MUT_A_ALLTHREE_EXIT=0`** | `rail18-mutA-allthree.log` |
| `tsc --noEmit` (ui) | **`TSC_EXIT=0`** | `rail18-tsc-final.log` |
| biome lint (touched files) | **`BIOME_EXIT=0`** | `rail18-biome-final.log` |
