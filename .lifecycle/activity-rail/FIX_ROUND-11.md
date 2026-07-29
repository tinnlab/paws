# FIX_ROUND-11 — Activity Rail

Round 11. A blind re-audit of FIX_ROUND-10's diff, two auditors, both mutation-
testing in their own private worktrees.

**New confirmed findings:** 7

7 confirmed and fixed; 0 `accepted-open`. All in `LEDGER.jsonl` with `"round": 11`.

Again **no product defect** — every finding is a guard that did not hold, or a
comment that had gone false. But two of them are serious, and both are the same
mistake: **round 10 relaxed a guard to fix a false positive and gave away the
mutant kills, and extracted two decisions while pinning only the functions.**

---

## 1. The guard got weaker than the round it superseded

FIX_ROUND-9 pinned the `disabled` expression by exact match. FIX_ROUND-10 relaxed
it to a `doesNotMatch` on `blocked !==`/`===` — to fix a genuine false-RED on a
hoist refactor. Both auditors mutation-proved what that gave away:

| latch spelling | round 9 | round 10 |
|---|---|---|
| `disabled={blocked !== null}` | RED | RED |
| `disabled={blocked != null}` | RED | **green** |
| `disabled={!!blocked}` | RED | **green** |
| `disabled={Boolean(blocked)}` | RED | **green** |
| `disabled={blocked ? true : false}` | RED | **green** |

All four are the same latch — the card unanswerable in `not-registered` — i.e.
the regression this file records as having shipped **three times**. One auditor's
verdict: *"the guard is now strictly weaker than the round it supersedes, on the
exact regression it is named for."*

And the file-level `elicitationIsUnactionable(` check gave no cover, because it is
satisfied by the **non-rendering** call inside `resolve()` — proven by latching
**both** controls while leaving that call alone: green.

**The fix is to stop enumerating.** Enumerating bad spellings is unbounded;
requiring the good form is not. Each `disabled` expression must now **route
through** `elicitationIsUnactionable` — directly, or via one local `const`, which
keeps the hoist refactor legal — and a spread carrying `disabled` is refused
outright, because a later spread silently overrides the checked prop.

**Seven controls run:** loose-equality, double-bang, `Boolean()`, ternary,
spread-after → **each RED**; the hoist refactor → **GREEN**.

## 2. Two extractions, pinned at the wrong end

Round 10 extracted `elicitationIsError` and `resolveDidFail` on the explicit
grounds that *"reverting the fix left every test green"* — and then pinned only
the functions. Both auditors proved that reverting either **at the call site** was
still green:

- the inline tone repaints a transient, answerable state in the destructive red
  `DESIGN_SYSTEM.md` reserves for errors;
- the inline judgement marks a **successful** approve as failed whenever the
  provider holds no entry.

Each fix was one inline expression away from being undone. A call-site guard now
pins both. **Controls run:** reverting the tone → **RED**; reverting the
judgement → **RED**.

## 3. The exhaustion flag never fired in the case it was written for

`healExhausted` read a **ref during render** while the ref was mutated inside the
effect. So it was structurally one render behind — and in the exact failure mode
the component's own comment documents (*"a failed register bumps nothing itself,
so without a trigger tied to the seam the effect never re-ran"*), the effect ran
**once**, `n` stayed at 1, and the exhausted copy could never appear. The "active
falsehood" round 10 removed survived in precisely the state it was written for.
One auditor demonstrated it under real `react-dom` and jsdom.

Now `useState` with the attempt record in the effect's deps: each failed attempt
re-renders, the budget is actually reached, and the correct copy shows. Bounded by
the budget, and no longer an impure render read under StrictMode.

## 4. A truth table that asserted only what the implementation produces

Both auditors, independently: every `hadEntry: false` row in the `resolveDidFail`
test paired with `after: undefined` — where both implementations agree. So
deleting the `hadEntry &&` conjunct, **the whole point of the function**,
survived.

The discriminating cell `{carried: true, hadEntry: false, after: 'pending'}` is
added (the published contract permits `status()` to answer while `has()` is
false), along with the terminal `cancelled` and `undefined` rows. **Control run:**
dropping the conjunct is now **RED**.

## 5. A scanner fix that traded one precision bug for another

Moving quote tracking to depth 0 fixed the apostrophe false-RED but introduced a
symmetric **false negative**: a `}` inside a string inside a prop expression
decrements `depth` early and truncates the window, missing a real violation after
it. An auditor proved it with a differential harness — the *old* scanner caught
that case and the new one did not — and noted the comment presented the change as
a pure fix.

Quotes are tracked at **every** depth again, with the apostrophe handled precisely
instead: inside a prop expression a `'` opens a string only in **expression
position**, not when it follows a letter (JSX text). **Both controls run:** the
brace-in-string violation → **RED**; the apostrophe → correctly **GREEN**.

## 6. And the same stale claim, one file over

A comment said `not-registered` *"DISABLES the controls"* — untrue since round 8,
and contradicted by the seam's own bolded **"Do NOT disable"**. It is the
**identical** stale claim round 10 corrected in the sibling test file and missed
in the file whose behaviour it describes. Corrected, and it names the miss.

## 7. What the auditors confirmed CLEAN — by mutation

- **`elicitationIsError`** is complete over its whole domain; both mutants (drop
  `resolve-failed`; widen to `reason !== null`) → RED.
- **the `healAttempts` id-keying** is correct — one auditor traced every path
  (fresh mount, conforming provider, failing register, instance reused for a
  different id, id ping-pong A→B→A): no under-count, no over-count.
- **the declaration bound** works and is **not** too short (a block body with two
  intermediate statements → GREEN; a neighbouring-statement decoy → RED).
- **the non-vacuity floor and both `catch { continue }` removals** fail loudly as
  designed — renaming the `<Button>` element, an approval surface file, or a
  TEST-36 offender each → RED.
- **the round-5 `nextDecl` tightening is a real fix, not decoration** — isolated
  and shown GREEN under the old regex, RED under the new one.
- both new exports have real production callers; no dead code; `tsc --noEmit`
  clean; `lint:hooks` 0 violations; no desktop mirror of these paths.

## 8. Observed results

| suite | observed |
|---|---|
| `railIsolation.test.ts` (now 9 tests) | **9 passed**; 4 latch spellings + spread-after + both call-site reverts → **each RED**; hoist refactor + apostrophe → correctly **GREEN**; brace-in-string violation → **RED** |
| `transport.test.ts` | **11 passed**; dropping the `hadEntry` conjunct → **RED** |
| chat unit family | **347 tests, 343 pass, 4 fail** (the pre-existing loader failures) |
| `npm run check` (ui) / (desktop/ui) | **exit 0** / **exit 0** |
