# FIX_ROUND-13 — Activity Rail

Round 13. A blind re-audit of FIX_ROUND-12's diff, two auditors, both mutation-
testing in private worktrees, both additionally running the component under real
React 19 + jsdom.

**New confirmed findings:** 6

6 confirmed and fixed; 0 `accepted-open`. All in `LEDGER.jsonl` with
`"round": 13`.

Two of the three serious findings are **my own errors**, and the third is the root
cause of the last six rounds. This round stops patching and removes the cause.

---

## 1. The fix I documented was never applied

FIX_ROUND-12's headline was *"restore the retry cadence"*. It added a long comment
saying `healAttempts` is **"deliberately NOT a dep"** — and left it in the
dependency array. Both auditors caught it, both measured it:

| | at mount | after a later seam change |
|---|---|---|
| shipped (`healAttempts` still a dep) | 3 registers, budget spent | **0 retries, entry never opened** |
| dep removed | 1 register | retries, **entry opened** |

So the suspended `run_js` script could never be resumed — the exact regression the
commit claimed to fix. Nothing caught it: `lint:hooks` does not check
exhaustive-deps.

**And I left a duplicate call.** FIX_ROUND-12 added
`registerElicitation(runJsElicitationInit(data))` intending to hoist it out of the
state updater, and did not delete the original. Every attempt registered **twice**,
firing two seam bumps, re-rendering every mounted approval card twice, and
doubling exactly the churn the mcp `subscribe` narrowing exists to avoid. Both
auditors verified against the parent commit, which has one.

Both are fixed. Both were mine, and both are recorded as such.

## 2. The root cause: parsing TypeScript with regexes

The guards have been patched in every round since 8, and every subsequent audit
found another spelling. The full list, accumulated:

> boolean-shorthand `disabled` · a spread · a `>` inside a quoted attribute ·
> `!!x` · `x != null` · `Boolean(x)` · `x ? true : false` · `pred(x) || latch` ·
> `!pred(x)` · a `let` reassigned later · a hop with `=== false` · a second
> ternary branch reaching `'danger'` · a non-literal `setResolveFailed` argument ·
> a non-identifier argument to the predicate itself

Round 13 found four more. Each round's fix enumerated one more case — which is
**the unbounded-enumeration mistake these guards' own docblock condemned in the
guard they replaced.** Round 12 wrote "requiring the GOOD form is bounded" and
then bounded it with a hand-listed set of forbidden trailing operators.

The cause is not any one regex. It is that a regex cannot parse TypeScript.

**So the guards now parse a real AST.** The compiler is already a dependency — it
runs on every `npm run check` — so they ask *it* what the code says. An AST knows
a JSX attribute from prose, a spread from a prop, and an expression's exact shape
from a substring of it. Every evasion above is answered **by construction**, not
by enumeration:

- `isExactCall` requires a `CallExpression` with the right callee **and argument**
  — so `!p(x)`, `p(x) || latch`, `p(x) === false` are rejected for being Prefix /
  Binary expressions, and `p(blocked ?? 'no-transport')` is rejected for its
  argument. The one local hop requires a `const` whose sole initializer is that
  call and which is **never reassigned**.
- The tone guard checks the **whole ternary** — condition, true branch and false
  branch — so a second branch reaching `'danger'` cannot slip past.
- The judgement guard counts **every** `setResolveFailed` call that is not the
  `(false)` reset, then walks up to its governing `if`, tolerating a braced
  consequent.

### The decisive run

All **14** evasions accumulated across rounds 8–13, re-applied against the AST
guards:

| | result |
|---|---|
| shorthand, spread, `\|\| latch`, inversion, `!= null`, `!!x`, argument-nullish, argument-ternary, `let`+reassign, hop-`=== false`, tone second branch, tone `\|\|`, non-literal `setResolveFailed`, inline judgement | **each RED** |
| wrapped hoist, braced consequent, element-valued prop before the testid, `'til '90s, don't` in JSX text | **each correctly GREEN** |

## 3. Comment accuracy

An auditor called this the round's worst dimension: **seven** comments
misdescribed the code they annotate, two asserting the opposite of what shipped —
including `// STATE, not a ref (FIX_ROUND-11)` sitting three lines above a newly
added ref, and a StrictMode rationale for a change the diff did not make.

The ref/state pair now carries **one** comment explaining why both exist (the ref
is the effect's input so the cadence survives; the state is the render's so the
copy is observable) and why they cannot diverge (the same object is stored in
both, in adjacent statements). The rest went with the regex scanner they
described.

Also corrected: a guard's failure messages that misdiagnosed the failures they
could produce, and an invented past-tense claim (`<ButtonGroup` "were being
scanned") that a tree-wide grep matched only in the comment itself.

## 4. What the auditors confirmed CLEAN

- **every mutation FIX_ROUND-12 claimed to close is genuinely closed** — `||`
  latch, leading-`!` inversion, a bad hoisted local, an `||`-widened tone, a
  second literal `setResolveFailed(true)`, a widened `if` condition, `<Button`
  prefix-matching. Each RED post-diff, each GREEN pre-diff.
- **the ref and state cannot diverge in value** — the same object is assigned to
  both in adjacent statements, keyed identically. The defect was never
  divergence; it was the residual dependency.
- **the effect terminates** — no infinite loop in any provider mode either auditor
  tried (conforming, silently failing, contract-violating, unstable `data`
  identity).
- **the `buttonProps` work was effective for what it covered**: a real `tooltip`
  on a disabled button was caught even with `Don't wait 'til '90s` JSX text in an
  earlier prop.
- no leftover reference to any removed symbol; every new symbol has a consumer;
  nothing touches INV-1..INV-9 or the design-system tokens.

## 5. Observed results

| suite | observed |
|---|---|
| `railIsolation.test.ts` (AST-based) | **9 passed**; 14 accumulated evasions → **each RED**; 4 legitimate refactors → **each GREEN** |
| `transport.test.ts` | **11 passed** |
| chat unit family | **347 tests, 343 pass, 4 fail** (the pre-existing loader failures) |
| `npm run check` (ui) / (desktop/ui) | **exit 0** / **exit 0** |
