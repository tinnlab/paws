# FIX_ROUND-16 — Activity Rail

Round 16. A blind re-audit of FIX_ROUND-15's diff (`2017b0e09`), two auditors,
each in a private worktree, both mutation-testing.

**New confirmed findings:** 15

15 confirmed and fixed. All in `LEDGER.jsonl` with `"round": 16`.

Every finding below was **re-proven independently** in this session's own harness
before being accepted — applied to the shipped component, suite run, reverted —
because one auditor disclosed that its first harness had briefly executed against
the other's worktree. Nothing here rests on an auditor's report alone.

---

## The trajectory reversed, and the reason matters

Rounds 10-15 found only guard-precision issues, and round 15 closed with 5. This
round found **fifteen, ten of them defects that pass GREEN**, including a
**regression round 15 introduced itself**. That is not noise: rounds 10-15
audited the guards *as written*, and this round attacked them *as a defender
would* — with aliases, decoys, shadows, an import rename, and a second disabling
prop. The guards had never been tested that way.

The single root cause, stated plainly: **round 13 moved these guards from regexes
to the AST, but an AST walk without SCOPE and without BINDING resolution is the
same unbounded-enumeration mistake one rung up.** Round 15's own fix left a
`getText()` denylist of three identifier spellings in the half of the check
nobody re-read, and wrote a comment saying both halves had moved to the AST.

## 1. The denylist that could never terminate (FR16-1)

FIX_ROUND-15 selected the seam operand by substring and screened every OTHER
operand with `assert.doesNotMatch(text, /\bblocked\b|\bresolveFailed\b|\bhealExhausted\b/)`.
Four latches walked straight past it — each leaving the control rendering
**ENABLED**, the status copy still inviting the click, and the click a silent
no-op:

| evasion | why the regex missed it |
|---|---|
| `const alreadyTried = resolveFailed; … \|\| alreadyTried` | one alias |
| `if (!elicitationExists(data.elicitation_id)) return` | identifier outside the vocabulary |
| `if (healAttempts.n >= HEAL_BUDGET) return` | identifier outside the vocabulary |
| pure rename `blocked` → `blockedReason` | retires the whole vocabulary at once |

**The fix is a polarity inversion, not another spelling.** Every operand of every
early return must now BE one of exactly three permitted forms — the seam call, the
controls' own in-flight flag, or `<decided> !== null`. Enumerating what is
forbidden cannot terminate. Enumerating what is permitted terminated immediately,
and it closed all four at once.

## 2. Three ways the guard's subject could be moved out from under it

- **`&&` vs `||` (FR16-2).** `flatten` recursed through both, so
  `if ((submitting || resolved !== null) && elicitationIsUnactionable(blocked)) return`
  yielded an identical operand set. The re-entrancy guard is then dead and a
  double-click POSTs twice to a single-use elicitation — the one thing the
  handler's own comment says it exists to prevent.
- **The guard need not RETURN (FR16-3).** Nothing looked at `thenStatement`. A
  non-returning `if` on the predicate reduced the guard's entire subject to a
  no-op while reporting green. **This one is a regression this branch introduced
  in round 15** — verified RED against `2017b0e09^` and GREEN after.
- **A decoy relocates it (FR16-4).** `findResolve` kept the LAST file-wide match,
  so a dead `resolve` placed after the component captured the whole guard and the
  real, latched handler passed. The comment claimed an unrelated local could not
  move it.

## 3. The provenance checks proved less than their comments claimed

`importedFromSeam` matched the LOCAL binding name and ignored `propertyName`, and
never looked for a shadow (FR16-5). Two tsc-clean edits reinstated FIX_ROUND-4
verbatim: `elicitationIsError as elicitationIsUnactionable` (identical signature,
so `resolve-failed` disables both controls and the disable gates its own reset)
and a component-local `const elicitationIsUnactionable = () => true`. And the
CLASSIFIER that feeds the predicate was never checked for provenance at all
(FR16-7) — a hand-rolled local of the same name answered whatever it liked.

`isBlockedReasonBinding` checked the classifier's callee and never its **arguments**
(FR16-6), so `{ hasTransport: false, … }` pinned `blocked` at `'no-transport'` and
the card became permanently unanswerable — the exact failure mode this whole guard
family exists for, one token from the binding it did verify.

## 4. Two disable channels the guards never looked at

- **`loading` (FR16-8).** The kit computes `isDisabled = surfaceDisabled || loading`,
  adds `pointer-events-none`, and swaps `onClick` for a preventDefault. So
  `loading={submitting || blocked !== null}` makes the card inert in exactly the
  states whose copy reads *"you can still answer it"* and *"try again."*
- **Not rendering at all (FR16-9).** The JSX ancestor conditions were unguarded, so
  one added `&&` clause removed both controls in an answerable state. Vanishing is
  strictly worse than disabling: there is no affordance left.

And nothing pinned **which action each control dispatches** (FR16-10) — swapping
Deny's handler so that clicking **Deny approves the tool call** was green.

## 5. Guards that punish correct refactors get edited away

Round 15 fixed three false-REDs of this class and introduced/left three more.
Fixed here: the hoist that `isExactCall`'s own doc blesses was rejected for the
gate while accepted for the attribute (FR16-11); an inert, scope-blind
reassignment scan RED on any unrelated local named `blocked` (FR16-12); a
hardcoded `setResolveFailed` RED on a rename with a message that read as "the
judgement was deleted" (FR16-14).

**This is why the new allowlist does not name `submitting` or `resolved`.** It
derives both from the CONTROLS themselves — the flag they pass to `loading`, the
const their render gate tests for `null`. That is the actual invariant (*the
handler must act in exactly the states the control renders actionable*) and it is
rename-proof by construction.

## 6. Two inherited findings, fixed rather than deferred

FR16-14 above, and FR16-15: `FIX_ROUND-8` flagged a tooltip only when the Button
could ALSO be disabled, but hazard (a) — a string tooltip replacing the accessible
name of a button that already has one from its visible text, the literal
FIX_ROUND-5 regression — needs no `disabled`. The larger half was unguarded on
**both** approval surfaces. Widened and proven RED on each; safe because neither
surface carries a tooltip today.

## 7. And the stale claim, a fourth time (FR16-16)

The round-15 commit message states *"a tree-wide grep now returns nothing."* A
fourth copy survived in `run-js-inner-approval.spec.ts:71`. Checked against
`sdk/packages/kit/src/kit/button.tsx:96-97` — the truth is
`ariaLabelProp ?? (typeof tooltip === 'string' ? tooltip : undefined) ?? wrappedLabel`.
Corrected; the grep now genuinely returns nothing.

## 8. The decisive run — 33 cases, one harness

Every case applied to the shipped component, suite run, reverted.

| | cases | result |
|---|---|---|
| **defects that must be caught** | 24 | **each RED** |
| **behaviour-preserving refactors that must not** | 9 | **each GREEN** |

The 24 include all five round-15 controls (polarity inversion, `\|\| blocked`,
`\|\| Boolean(blocked)`, `\|\| resolveFailed`, `\|\| healExhausted`), the four
denylist evasions, the `&&` conjunction, the non-returning guard, the decoy, the
import alias, the local-function shadow, the pinned classifier arguments, the
pinned `hasTransport`, the `loading` channel, the un-render, the Deny-approves
swap, the spread, and a dropped `disabled`.

The 9 include the three round-15 controls (split clauses, function declaration,
unrelated-local rename) plus the hoist-into-const-used-by-both, the JSX-only hop,
`blocked`→`blockedReason`, `submitting`→`busy`, `resolved`→`decided`, and a braced
return body.

## 9. Observed results

| suite | observed |
|---|---|
| `railIsolation.test.ts` | **10 passed, 0 failed** |
| mutation battery | **24/24 RED, 9/9 GREEN** |
| `transport.test.ts` | **11 passed, 0 failed** |
| chat unit family | **348 tests, 344 pass, 4 fail** (the pre-existing loader failures) |
| UI unit — full | **849 tests, 835 pass, 14 fail** (the same pre-existing set; no rail spec among them) |
| `npm run check` (ui) / (desktop/ui) | **exit 0** / **exit 0** |
| e2e — rail + run_js family, bridge ON | see `TEST_RESULTS.md` |

## 10. What the next round must do

Round 17 is a blind re-audit of THIS round's diff. It is a large diff and it
rewrote the guard helpers, so it deserves the same adversarial treatment: attack
the allowlist, the scope resolution, the derived names, and the two widened
checks. Phase 7 closes only when a round genuinely returns zero.
