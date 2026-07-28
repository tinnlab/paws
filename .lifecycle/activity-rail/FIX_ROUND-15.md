# FIX_ROUND-15 — Activity Rail

Round 15. A blind re-audit of FIX_ROUND-14's diff, two auditors, both mutation-
testing in private worktrees.

**New confirmed findings:** 5

5 confirmed and fixed; 2 `accepted-open`. All in `LEDGER.jsonl` with
`"round": 15`.

**No product defect.** Every finding is in the guards. Both auditors converged on
the same single highest-value fix, and it closed four of the five at once.

---

## 1. The new guard was the anti-pattern this branch had just removed

FIX_ROUND-14 added a guard for `resolve()`'s early-return — and wrote it as a
**regex over `getText()`**, which is precisely what this file's own FIX_ROUND-13
block says the AST rewrite exists to stop. Both auditors defeated it:

| mutation | effect | round 14 |
|---|---|---|
| `!elicitationIsUnactionable(blocked)` | returns early exactly when the card IS actionable — **no decision ever POSTs** | **green** |
| `\|\| blocked` | the raw-reason latch its own message warns about | **green** |
| `\|\| Boolean(blocked)` | control renders **enabled**, status says "you can still answer it", click silently no-ops | **green** |
| `\|\| resolveFailed`, `\|\| healExhausted` | same class | **green** |

The `Boolean(blocked)` case is the worst, and the e2e cannot see it — it only
exercises the healthy state.

**The fix both auditors named:** run the gate's **operands** through `isExactCall`,
the same AST predicate the JSX attribute already uses, which rejects negations and
wrappers by construction. No other operand may mention the card's
blocked / failure / heal state.

That one change also removed a false-RED: because the guard now collects operands
rather than matching a shape, it no longer cares **how** the clauses are split
across `if`s.

## 2. A binding check that checked the spelling after all

`isBlockedReasonBinding` ended `return ok || name === fallback`, and both call
sites passed the literal `'blocked'` — the name the component uses. So the
argument-**binding** check short-circuited to the old spelling check and was
**vacuous for the shipped code**, while its comment claimed the opposite.

Proven two ways: deleting the classifier and hand-rolling `const blocked = …`
passed; and `let blocked = classifier(); if (!hasTransport) blocked = null` — which
kills the one state that is supposed to disable — passed, because the argument
path had no reassignment check (unlike the identifier path).

The fallback is gone and the binding must be a `const` that is never reassigned.

## 3. Guards that punish correct refactors get edited away

Three false-REDs on behaviour-preserving changes to the same handler: splitting
the compound guard into two `if`s, writing `resolve` as a function declaration,
and renaming the **unrelated** local `submitting`. An auditor's verdict:

> *a guard that reds on a rename of an unrelated local and on a guard-clause split
> will be edited away rather than obeyed.*

The guard now collects the operands of **every** early-return in the handler and
locates `resolve` as a declaration **or** a function statement.

### The decisive run

| | result |
|---|---|
| inversion, `\|\| blocked`, `\|\| Boolean(blocked)`, `\|\| resolveFailed`, `\|\| healExhausted`, a fake classifier, a reassigned binding | **each RED** |
| split guard clauses, `function resolve(…)`, renaming `submitting` → `busy` | **each correctly GREEN** |

## 4. And a third copy of the same stale claim

The "kit `Button` derives `aria-label` **unconditionally**" claim survived a third
time, in the component, in the exact wording round 14 corrected twice elsewhere. A
tree-wide grep for the word now returns nothing. Also fixed: two helpers inserted
between a JSDoc block and the function it documented, and a module-specifier match
that would false-RED on an explicit `.js` extension.

## 5. Dispositioned without a code change

- **FR15-6 `accepted-open`** — the "live signals" check inspects only the object
  literal's syntactic shape, so one identifier hop (`const carried = false` above
  the call) defeats it. The auditor's own analysis is the disposition: *"the guard
  cannot see provenance without a type/symbol resolver"* — a parsed file can see
  that a property is not a literal, but not what an identifier was bound to two
  statements earlier. The comment is narrowed to what the check does rather than
  left overstating, and the case is bounded by the siblings: `resolveDidFail` is
  unit-tested over its whole truth table, and the binding check catches the same
  trick on the disable predicate, where it matters most.
- **FR15-7 `accepted-open`** — in `not-registered` there is no state in which the
  user learns they answered: with no local entry the status stays `undefined`, so
  the card renders byte-identical after a click that genuinely resumed the script.
  The auditor flagged it **inherited, not introduced**. Fixing it from here means
  the card asserting an outcome the provider has not recorded — the latched
  client-state mistake rounds 5 and 8 removed. The honest fix is for the provider
  to record an entry on a successful resolve it did not hold, an mcp store change
  outside this feature's surface. Recorded with that destination named.

## 6. What the auditors confirmed CLEAN — by mutation

- **both corrected kit claims are factually right**, checked against
  `sdk/packages/kit/src/kit/button.tsx:96-97` and the base class.
- **the THEN-branch assertion works** — the `else` inversion it was written for is RED.
- **the `importedFromSeam` assertions work** — a same-named local shadow is RED.
- **dropping `|| hasSpread(el)` is safe** — a separate `!hasSpread` assert covers
  every Button, and adding a spread is RED.
- **the pre-existing AST guards are solid**: `disabled` negation RED, `|| latch`
  RED, an extra `danger` branch RED, a tone polarity inversion RED, and a pure
  rename correctly GREEN.
- **the component's rewritten comment block is accurate** — a failed `register`
  bumps nothing; `hasTransport`/`entryExists` are live through `seamVersion`; the
  id-keyed budget handles React instance reuse; neither message claims in-flight
  work; no dangling reference to the removed string anywhere in the tree.

## 7. Observed results

| suite | observed |
|---|---|
| `railIsolation.test.ts` | **10 passed**; 7 evasions → **each RED**; 3 legitimate refactors → **each GREEN** |
| `transport.test.ts` | **11 passed** |
| chat unit family | **348 tests, 344 pass, 4 fail** (the pre-existing loader failures) |
| `npm run check` (ui) / (desktop/ui) | **exit 0** / **exit 0** |
