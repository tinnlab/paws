# FIX_ROUND-17 — Activity Rail

Round 17. A blind re-audit of FIX_ROUND-16's diff (`fa01f2bb9`), two auditors,
each in a private worktree, both mutation-testing.

**New confirmed findings:** 21

21 confirmed and fixed; 1 `accepted-open`. All in `LEDGER.jsonl` with
`"round": 17`. Every finding was re-proven in this session's own harness before
being accepted.

---

## Read this before writing round 18

Round 16 closed 24 mutations and still had **21 holes**, including one it
introduced. That is the third round in a row where a guard that looked airtight
fell to a spelling nobody had thought of. The pattern is not "the last fix was
sloppy" — it is structural, and it is stated in §7 below. **Do not open round 18
by writing more AST predicates without reading that section first.**

## 1. The regression round 16 introduced (FR17-4)

FIX_ROUND-16 defined an early return as *a bare `return`, or a block holding
exactly ONE statement that is a return.* So this was not an early return at all,
and its operands were never screened:

```tsx
if (!elicitationExists(data.elicitation_id)) {
  statusRef.current?.focus()
  return
}
```

`if (state) { reset(); return }` is the idiomatic guard spelling — the conforming
gate sits two lines above `setSubmitting(true)` in the same handler. Three latches
passed this way, plus `throw`, plus a `switch` that returns (FR17-5). **Verified
RED against the pre-round-16 guard**, so round 16 traded a denylist hole for a
shape hole.

**The fix stops looking at guard SHAPE.** It enumerates the handler's **exits** —
every `return`/`throw`, skipping nested function bodies — and walks up to the
enclosing `if`. How the guard body is spelled no longer matters.

## 2. Four ways the guarded thing wasn't the shipped thing

| finding | the evasion |
|---|---|
| FR17-6 | `const resolve = healExhausted ? noop : async (…) => {…}` — every inner guard intact and correct, the click simply never delivered |
| FR17-7 | the gate hoisted into `const shouldSkip = () => {…}`; the `return` leaves the HELPER, so every gate is dead |
| FR17-8 | `const carried = blocked === null ? await resolveElicitationVia(…) : false` — the `try` body was never inspected at all |
| FR17-2 | a sibling `js-tool/…/core/elicitation/transport.ts`; `endsWith` accepted it as the seam |

FR17-8 is the sharpest: `not-registered` is documented in the transport as
answerable — *"the provider POSTs unconditionally, so a click still reaches
`/respond`"* — and this made it never POST, then latch the card at *"That didn't
go through — try again"* forever.

## 3. The provenance and liveness checks, again

- **FR17-1** — the liveness pin looked up the hardcoded name `hasTransport`, so a
  rename made it iterate zero declarations and return true on an empty check.
  Both auditors found it independently. Now every signal is resolved *through the
  property's value* to its declaration.
- **FR17-3** — `const { elicitationIsUnactionable } = localPolicy` shadows the
  import completely, but a destructuring declaration's name is an
  `ObjectBindingPattern`, so the shadow check never saw it.
- **FR17-10** — `useState(() => !hasElicitationTransport())` is still "a bare
  useState flag." Because the allowlist *permits whatever the derivation returns*,
  seeding it that way froze the card inert from mount. The rename-proofing was
  turned against the guard.
- **FR17-12** — the decided-const's shape was checked, its provenance was not; a
  local optimistic `useState` left *"Approved — script resumed."* on screen after
  a failed POST.

## 4. Four false-REDs — three of them contradicting round 16's own principle

FIX_ROUND-16 §5 says the allowlist derives its names from the JSX *because "a
guard that reds on a rename gets edited away rather than obeyed."* The same round
then hardcoded the handler name `resolve` twice (FR17-14), matched `onClick` by
source text so `() => void resolve('accept')` went RED (FR17-19, a form this repo
writes in 18 places), accepted only `function` components so an arrow conversion
reported *"found 0"* (FR17-15), and walked the whole file for Buttons so an
unrelated `<Button disabled>Copy</Button>` hijacked the derivation and blamed the
wrong control (FR17-13).

## 5. Two mistakes this round made and caught itself

Recorded because the next round should not have to rediscover them:

- Recursing `hasTextChildren` into child elements (FR17-18) made an **icon-only**
  `<Button tooltip=… />` RED — a self-closing element's `.parent` is the
  *containing* element, whose children belong to somebody else. Caught by an
  icon-only control case added in the same change.
- The CSS-inerting check (FR17-17) initially never fired: ancestors are
  `JsxElement`s, and their attributes live on `.openingElement`.

## 6. The decisive run — 54 cases across five batteries

| | cases | result |
|---|---|---|
| defects that must be caught | 41 | **each RED** |
| behaviour-preserving refactors that must not | 13 | **each GREEN** |

The 41 include every round-15 and round-16 control plus all of this round's:
multi-statement guards, `throw`, `switch`, the ternary-selected handler, the
nested-helper hoist, the conditional seam call, the sibling module, the
destructuring shadow, the renamed-and-pinned signal, the seeded flag, the deleted
`setSubmitting(true)`, the local decided-const, the ternary un-render, the swapped
labels, and both CSS inertings. The 13 include the arrow-component conversion, the
`void` wrapper, the handler rename, the unrelated `disabled` Button, and an
icon-only `tooltip` Button.

## 7. Why this is not converging, stated plainly

These guards try to prove a **semantic** property — *the handler POSTs in exactly
the states the control renders actionable* — by **syntactic** pattern-matching.
Every round the auditors find another spelling of the same defect, because the
space of spellings is not finite. The progression is visible in the rounds
themselves: round 13 moved regex → AST; round 15 left a regex in the half nobody
re-read; round 16 added scope and an allowlist; round 17 found that exits, the
`try` body, the JSX ancestry, the CSS, and the handler's own identity were all
still outside the pattern. Each round's fix is correct and each round's guard is
stronger — and the next audit still finds holes.

**The structural answer is a behavioural test, and it does not exist yet.** There
is exactly one state matrix that matters — `blocked ∈ {null, no-transport,
not-registered, resolve-failed}` × click — and the assertion is one sentence: *did
a POST happen, and was the control actionable?* A test that renders the card in
each state and clicks would close FR17-1, -3, -6, -7, -8, -9, -10, -11, -12, -16
and -17 **by construction**, because it does not care how the code is spelled.

The existing behavioural layer is the **e2e**, and round 15 already recorded its
limit: *"the e2e cannot see it — it only exercises the healthy state."* There is
no jsdom/RTL harness in this repo (`railView.test.ts` documents that deliberately;
zero `.test.tsx` files exist), so the honest options are (a) extend
`run-js-inner-approval.spec.ts` to drive the three degraded states, or (b) stand
up a component-test harness. **(a) is the recommendation** — it reuses the layer
that already exists and is where the states are actually reachable.

Until that lands, these AST guards are the best available proxy and should be kept
— but round 18 should spend its effort on the behavioural matrix, not on a
nineteenth predicate.

## 8. Accepted-open

**FR17-22** — the mcp approval card's approve/deny wiring is not held to these
invariants: an auditor proved that wiring its Deny button to `handleApproveOnce`,
and adding a bare `disabled` to it, are each GREEN. This branch does touch that
file, so the gap is in scope. It is recorded rather than papered over: the mcp
card has a different structure (named handlers, no elicitation seam, no `blocked`
classifier), so these guards do not lift verbatim. The FIX_ROUND-8 tooltip guard
does cover both surfaces and was widened this round. Destination named: a shared
approval-control contract, or a sibling guard against the mcp card's own shape.

## 9. Observed results

| suite | observed |
|---|---|
| `railIsolation.test.ts` | **10 passed, 0 failed** |
| mutation batteries (5) | **41/41 RED, 13/13 GREEN** |
| `transport.test.ts` | **11 passed, 0 failed** |
| chat unit family | **348 tests, 344 pass, 4 fail** (pre-existing loader failures) |
| `npm run check` (ui) / (desktop/ui) | **exit 0** / **exit 0** |
| e2e — rail + run_js family | see `TEST_RESULTS.md` |
