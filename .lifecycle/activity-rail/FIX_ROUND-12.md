# FIX_ROUND-12 — Activity Rail

Round 12. A blind re-audit of FIX_ROUND-11's diff, two auditors, both mutation-
testing in private worktrees.

**New confirmed findings:** 8

8 confirmed and fixed; 1 `accepted-open`. All in `LEDGER.jsonl` with
`"round": 12`.

Both auditors converged on **one sentence**: *requiring the good form to be
PRESENT is not requiring it to DECIDE.* Three of the four guards round 11 wrote
fell to a one-line change of the class they were written to catch — and one
auditor proved all three named historical regressions revertible **simultaneously**
with the suite green.

Plus one real behaviour regression, which I introduced in round 11.

---

## 1. The behaviour regression

Round 11 fixed a stale-copy bug by moving the heal counter from a ref to state —
and added `healAttempts` to the effect's dependency array. Every `set` allocates a
new object, so **the effect re-ran itself and burned the whole budget in one tick
at mount**, after which no later seam change could retry at all. That is the
opposite of what round 8 added the seam trigger for, and two in-file comments still
described the old cadence.

An auditor measured it under real `react-dom` + jsdom:

| | at mount | per later seam bump |
|---|---|---|
| ref (round 10) | 1 register | +1 |
| state-in-deps (round 11) | **3 registers** | **0, forever** |

Fixed by carrying the count in **both**: a ref for the effect (so no dep, and the
cadence survives) mirrored into state for the render (which is what made the
"budget spent" copy observable in the first place). The `register` call stays
**out** of the state updater — React may invoke an updater twice under StrictMode,
and an updater must be pure.

## 2. Presence is not determinism

| guard | mutation | round 11 | now |
|---|---|---|---|
| `disabled` routes through the predicate | `elicitationIsUnactionable(blocked) \|\| blocked !== null` | **green** | **RED** |
| ditto | `!elicitationIsUnactionable(blocked)` — a full inversion, disabling every recoverable state | **green** | **RED** |
| tone routes through `elicitationIsError` | a conforming `type={}` on any **earlier** element + revert the status region | **green** | **RED** |
| ditto | `type="secondary"` → `type={'secondary'}` on an unrelated element (behaviour-preserving) | **RED**, misdiagnosed | **GREEN** |
| judgement routes through `resolveDidFail` | `if (!hadEntry) setResolveFailed(true)` beside the conforming call | **green** | **RED** |
| all three reverted at once | | **green** | **RED** |

Three changes, one idea each:

- **`isExactly`** replaces `routesThrough`: the whole expression must **be** the
  call, or a local whose **sole** initializer is the call. Any `||`, `&&`, `?` or
  leading `!` means something else participates in the decision — and the guard
  refuses rather than guesses.
- **The tone check is anchored** to the element carrying `data-testid={statusId}`,
  scanned the way `buttonProps` scans a `<Button>`. Taking the file's *first*
  `type={…}` pinned nothing and false-RED on unrelated elements.
- **`setResolveFailed(true)` must occur exactly once**, as the direct consequent
  of the `resolveDidFail(...)` condition. Presence of the good call said nothing
  about a second judgement sitting beside it.

## 3. Three precision fixes, all mutation-checked in both directions

- **The one-line hop.** `[^\n]*` confined a local's initializer to one line, so a
  Prettier-wrapped hoist false-RED — *the very refactor that motivates hoisting*.
  Now matched on whitespace-collapsed source with a negative lookahead for a
  following operator: a wrapped initializer counts, `= pred(x) || latch` does not.
- **Leading apostrophes.** Round 11's "follows a letter" heuristic still let
  `'til`, `'90s`, `'em` open a phantom string and run the window to EOF. Keyed on
  the enclosing **region** instead — JSX text lives between a `>` and the next `<`,
  so an apostrophe there is prose whatever precedes it. The brace-in-string
  violation the heuristic exists alongside still fires.
- **`<Button` prefix-matched `<ButtonGroup`** / `<ButtonLink`, scanning a
  different component. Now requires a non-identifier character after the tag.

And `APPROVAL_SURFACES[0]` is named `APPROVAL_SURFACE_WITH_CONTROLS`, so inserting
a surface at index 0 cannot silently retarget the guards.

## 4. Dispositioned without a code change

- **FR12-9 `accepted-open`** — the guards pin js-tool's internal identifiers from
  inside the rail-isolation test, deepening that file's remit. **Third time this
  has been raised** (FR9-9, FR10-11, FR12-9) and the answer is unchanged and
  deliberate: the right home is a per-surface spec or the repo's AST lint
  framework, and the latter lives in the `sdk` submodule this branch already has
  one unpushed commit in. Relocating mutation-proven guards immediately before
  hand-off trades a held property for churn in files the orchestrator is about to
  merge. Recorded a third time so the follow-up is unambiguous rather than
  forgotten.

## 5. What the auditors confirmed CLEAN — by mutation

- **the `resolveDidFail` truth table is now discriminating.** One auditor killed
  all 8 mutants including drop-the-`hadEntry`-conjunct, and verified against the
  *pre-diff* test file that the same mutant was green there — so round 11's claim
  was true, not stale.
- **the ref→state conversion was a real fix, not cosmetic.** The same auditor
  re-ran its harness against the pre-fix code with a silently-failing provider and
  got 1 attempt and `healExhausted=false` forever — exactly the permanent
  "Reopening this request…" lie round 11 described.
- **all four of round 11's primary call-site reverts really were newly caught** —
  each RED post-diff, each GREEN pre-diff.
- **the `buttonProps` quote rewrite has no false positive** and the disabled scan
  iterates *every* `<Button>`, so it never had the first-match hole the tone check
  did.
- **performance is fine** — on the healthy path the ref→state conversion adds
  **zero** renders (measured); the degraded path is bounded at 4.
- no dead code; no leftover reference to a removed symbol; `check:state-matrix`
  in sync; `lint:hooks` clean.

## 6. Observed results

| suite | observed |
|---|---|
| `railIsolation.test.ts` | **9 passed**; or-latch, inversion, tone-decoy+revert, tone-or, second-`setResolveFailed`, hoist-carrying-a-latch, brace-in-string → **each RED**; wrapped hoist, `'til`, `'90s`, `<ButtonGroup>` → correctly **GREEN** |
| `transport.test.ts` | **11 passed** |
| chat unit family | **347 tests, 343 pass, 4 fail** (the pre-existing loader failures) |
| `npm run check` (ui) / (desktop/ui) | **exit 0** / **exit 0** |
