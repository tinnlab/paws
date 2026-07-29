# FIX_ROUND-14 — Activity Rail

Round 14. A blind re-audit of FIX_ROUND-13's diff, two auditors, both mutation-
testing in private worktrees and both driving the real component under React 19 +
jsdom.

**New confirmed findings:** 8

8 confirmed and fixed; 1 `accepted-open`. All in `LEDGER.jsonl` with
`"round": 14`.

---

## 1. The AST rewrite worked — and left a soft underbelly

Both auditors independently confirmed the round-13 thesis. Auditor A tried to
break the AST guards twelve ways (including `satisfies`, a generic arrow in TSX, a
regex literal containing `<Button…>`, and a template literal containing
`<Button disabled tooltip="x"> }` plus an apostrophe) and reported *"the AST is
unfazed and still catches the injected violation."* Auditor B ran eight mutations
and found the rewrite *"correct and materially more mutation-resistant than what
it replaced."*

Both also found the same soft spot, and named it in the round-13 header's own
words: **presence is not determinism.** `isExactCall` learned that lesson; three
neighbouring checks did not.

| finding | mutation | before | after |
|---|---|---|---|
| the `if` guard checked WHICH `if`, not WHICH BRANCH | `if (resolveDidFail(...)) {} else setResolveFailed(true)` | **green** | **RED** |
| the callee was matched by TEXT, not binding | a same-named local function; the same name from a sibling module (both tsc-clean) | **green** | **RED** |
| `resolveDidFail`'s ARGUMENT was unpinned | `{carried: false, hadEntry: true, after: 'pending'}` — constant-true | **green** | **RED** |

The first is a **regression from round 13**: the regex it replaced required
adjacency and *did* catch the `else` inversion. Fixed by asserting the judging
call's span lies inside `guard.thenStatement`. The second by requiring each
predicate to be **imported from** `core/elicitation/transport`. The third by
requiring every property of the signals object to be a shorthand or an identifier
reference — never a literal.

## 2. The guards were watching the wrong half of the component

**Auditor A's highest-severity finding, and the most interesting one of the
round.** Every guard inspected the JSX `disabled` attribute. But `resolve()`'s
re-entrancy early-return is what decides whether the POST actually happens — and
it was unguarded.

Latching *there* reintroduces the FIX_ROUND-4 bug in a **worse** form: the control
still **renders enabled**, so the user clicks, and the click **silently no-ops**
with no visual signal at all. All nine guards stayed green and `tsc` was clean.
The auditor confirmed the behaviour under jsdom, not just the guard's silence.

A tenth guard now pins `resolve()`'s gate on the same seam predicate and forbids
re-deriving from the raw blocked reason.

## 3. A guard that punished a rename

The guards hardcoded the local name `blocked` as the required argument, so a pure,
type-clean rename false-RED **both** of them — with a message ("a different
argument … changes which states disable") that is untrue for a rename.

The argument is checked by **binding** now: it must be the local initialised from
`elicitationBlockedReason(...)`. So a rename is legal and a substituted expression
(`blocked ?? 'no-transport'`, `f ? 'no-transport' : blocked`) still is not.
**Control run:** renaming `blocked` → `blockedReason` throughout is **GREEN**.

## 4. Copy that claimed work in flight

Removing the dep in round 13 was right, but it had a consequence auditor B caught:
each retry needs a **separate seam bump**, and a failed register bumps nothing — so
between attempts the card sat at 1-of-3 showing the present-progressive
*"Reopening this request…"* while nothing was in flight **or scheduled**. The
terminal copy exists precisely to prevent that active falsehood and had become
markedly harder to reach.

**Neither message claims work in flight now.** Both state the condition (*the
request is not open locally*) and what the user can do (*answer it anyway*); the
exhausted one adds the reload hint. The copy is true at every point in the budget,
which removes the whole class rather than re-tuning when the terminal state
appears.

## 5. Comment accuracy, again

The round-13 comment claimed kit `Button` derives `aria-label` from a string
tooltip **unconditionally**. It is conditional —
`ariaLabelProp ?? (typeof tooltip === 'string' ? … )` — and the kit's own adjacent
comment says so. The round also added a **second** copy of the inaccurate claim,
giving it two places to drift from. Both corrected to state the condition and why
it holds here (these controls give no explicit `aria-label`).

Also cleaned: a vestigial `|| hasSpread(el)` disjunct that could never affect the
outcome, a doc comment documenting a parameter the function does not have, and a
merged doc comment left on the wrong const.

## 6. Dispositioned without a code change

- **FR14-9 `accepted-open`** — because the budget counter lives in a ref (which
  survives StrictMode's simulated remount), a dev-mode mount consumes 2 of 3
  attempts instead of 1. Measured; production unaffected (1 → 2 → 3, capped). The
  auditor's own verdict is *"worth only a comment."* The ref is what makes the
  retry cadence work at all — state-in-deps was the round-12 regression — so
  moving back is not available, and 2 remaining attempts still exceed the 1 a
  conforming provider needs.

## 7. What the auditors confirmed CLEAN — by running it

- **the round-13 product fixes are correct and non-vacuous.** Auditor A drove the
  real component against a fake transport: `registerElicitation` fires **exactly
  once** per attempt; a failed register costs **one** attempt per seam change
  (1 → 2 → 3, capped); the budget-spent copy is observable in the DOM. Reverting
  to the parent turns 3 of those 4 probes RED — it issued **2** registers per
  attempt and burned **10** at mount.
- **the `typescript` import is legitimate, not a hoisting accident.** It is a
  direct devDependency of `@ziee/ui-core`, and `scripts/lint-hooks.mjs` and
  `lint-icon-action.mjs` already do exactly this. **No material slowdown**: ~470 ms
  on one test process, in a per-file-parallel runner.
- **parse-error recovery does not produce a vacuous pass** — the non-vacuity
  asserts hold.
- every other comment in the diff checks out literally, including the twelve-item
  evasion list and the `isExactCall` rejection list.
- no leftover reference to any of the four deleted helpers; no export without a
  consumer; `tsc`, `lint:guardrails`, `lint:hooks` clean; no INV-1..9 contradiction.

## 8. Observed results

| suite | observed |
|---|---|
| `railIsolation.test.ts` (now 10 tests) | **10 passed**; else-inversion, handler latch, constant args, local predicate → **each RED**; a pure rename of `blocked` → correctly **GREEN** |
| `transport.test.ts` | **11 passed** |
| chat unit family | **347 tests, 343 pass, 4 fail** (the pre-existing loader failures) |
| `npm run check` (ui) / (desktop/ui) | **exit 0** / **exit 0** |
