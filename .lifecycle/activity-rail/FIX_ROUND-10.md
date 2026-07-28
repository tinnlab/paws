# FIX_ROUND-10 — Activity Rail

Round 10. A blind re-audit of FIX_ROUND-9's diff, two auditors, both working by
**applied mutation in their own private worktrees**.

**New confirmed findings:** 10

10 confirmed and fixed; 2 `accepted-open` with rationale. All in `LEDGER.jsonl`
with `"round": 10`.

**No product defect this round.** Every finding is about the *guards* — their
precision, their vacuity floors, and comments that no longer matched the code.
That is a meaningful shift: rounds 3–9 each found something a user could hit;
this one did not.

---

## 1. The one that mattered: round 9's behaviour changes were unpinned

An auditor reverted **all three** FIX_ROUND-9 production changes simultaneously —
the heal-budget cap, the `hadEntry &&` failure judgement, and the status tone —
and ran the full 843-test suite. The failing-file set was **byte-identical to
baseline**. The only e2e drives the healthy transport and never reaches a blocked
state, so it could not see any of them either.

Two of the three are described by round 9's own comments as bug fixes ("marks a
SUCCESSFUL approve as failed", "contradicted its own copy"). On a branch whose
stated method is to pin every regression, that is the finding.

Fixed the way the seam already demonstrates — the decision extracted as a pure
function, because this workspace's runner cannot mount JSX and the decision is the
part it *can* test:

- **`elicitationIsError(reason)`** — drives the tone. `not-registered` is
  transient, self-healing and answerable, so it is not an error.
- **`resolveDidFail({carried, hadEntry, after})`** — judged only when the provider
  held an entry to judge by.

**Mutation controls run:** reverting the tone rule → **RED**; reverting the
failure judgement → **RED**.

## 2. Guards without a floor, and a principle applied to one of two identical constructs

| finding | proven by | fix |
|---|---|---|
| the tooltip guard had **no non-vacuity floor** — it keys on the literal `<Button`, so renaming the element to `<ApprovalButton` **with the defect injected** left all 8 tests green | mutation | asserts each surface renders ≥1 `<Button>` |
| the `catch { continue }` that round 9 removed **still stood verbatim 240 lines up** in TEST-36, in the same file — renaming `LiteratureToolResultCard.tsx` and re-adding the forbidden import was green | mutation | removed there too; the rename is now **RED** |

The second is the sharper one: round 9 argued that tolerance "did not deserve an
exception here" — and left an identical construct untouched twelve lines of scroll
away.

## 3. A pin that punished correct refactors and missed a real revert

The call-site pin used **exact string equality** on the `disabled` expression. Two
auditors independently showed both failure directions:

- **False RED** on behaviour-preserving refactors — hoisting the value to a local,
  renaming the local — with a message ("must derive `disabled` from the seam
  predicate") that *misdiagnosed* code still doing exactly that.
- **False GREEN** on a real revert: a JSX spread placed **after** the conforming
  prop (`{...{ disabled: blocked !== null }}`) wins at runtime and fully reverts
  the decision, while the exact-match check saw only the first prop.

Replaced with a **property**: the card must use the seam predicate somewhere, and
no element may re-derive `disabled` from the raw blocked reason, in a prop *or* a
spread. **Three controls run** — the hoist refactor is **GREEN**, and both latch
forms are **RED**.

## 4. Two scanner defects, opposite directions

- **False positive:** the quote-tracking added last round treated an apostrophe in
  JSX *text* (`icon={<span>Don't…`) as a string opener, swallowing the next
  element and failing with a misleading count. JSX text is not a JS string
  literal. Quotes are now tracked only at brace depth 0 — the attribute list
  itself. The quoted-`>` evasion it was added for is still **RED**.
- **False negative:** the declaration bound terminated only on a 2-indent
  `const`/`function`/`return`, so an `if`/`for`/`useEffect` after the declaration
  was swallowed into the window and a `withSegmentationShape(` in a *neighbouring*
  statement satisfied the check — reopening the "merely the file" hole at a
  smaller radius. Now terminates on any 2-indent construct.

## 5. Copy and comments that had gone false

- **The heal budget's copy.** Once the budget is spent the self-heal has
  **stopped**, but the card kept rendering *"Reopening this request…"* — a
  present-progressive claim about work that had ceased. The user was never stuck
  (the controls stay live and still POST), but they were told something untrue.
  There is a distinct message now, keeping the true clause and dropping the false
  one.
- **A comment contradicting the code three lines below it**, created by round 9:
  it deleted the `|| after === undefined` clause but left the paragraph explaining
  why that clause was *kept*. Alongside it, two near-verbatim round-6 paragraphs
  sat back to back — a 26-line stack over one `if`, three rounds of which
  described rules no longer in force. Replaced by one paragraph describing the
  current rule and naming the supersessions. Same treatment for a
  `transport.test.ts` comment still claiming `not-registered` disables.
- **The heal budget itself** was a bare `useRef` never reset on
  `data.elicitation_id`, so an instance React reuses for a *different* elicitation
  inherited a spent budget and got zero attempts. Now keyed to the id, named
  `HEAL_BUDGET` with a rationale for the **value** (not just for having a cap),
  and its per-mount scope stated as deliberate.

## 6. Dispositioned without a code change

- **FR10-11 `accepted-open`** — the kit-a11y and elicitation-seam guards live in
  the rail-isolation test, whose header defines it as the INV-1 guard, so a rename
  of `JsToolApprovalContent.tsx` now fails a test in `chat/components/rail/`. Fair.
  The better destination (FR9-9) is the repo's AST lint framework, which would be
  repo-wide and immune to every evasion by construction — but it lives in the
  **`sdk` submodule** this branch already has one unpushed commit in, and
  relocating guards right before hand-off trades a mutation-proven property for
  churn in files the orchestrator is about to merge. Both destinations are
  recorded so the follow-up is unambiguous.
- **FR10-12 `accepted-open`** — the drift guard splits on the `AND (` token, so a
  narrowing that abandons the idiom entirely (`AND COALESCE($9, col) = col`) is
  invisible rather than loud. Bounded: every narrowing the codebase writes uses the
  `($n IS NULL OR col = $n)` idiom, which `filters_never_drop_the_owner_predicate`
  itself pins — so abandoning it is a deliberate rewrite of the cross-user guard's
  shape that the sibling test forces the author to confront. Making the parser
  total over arbitrary SQL is the unsound direction this branch already abandoned
  once, at length, for exactly this reason.

## 7. What the auditors confirmed CLEAN — by mutation, not assertion

- **all seven of round 9's claimed closures are real**, each re-applied and RED:
  the one-line revert, the multi-branch revert past the old window, the tooltip
  boolean-shorthand / spread / quoted-`>` evasions, the rename, and the call-site
  latch. None overclaimed.
- **the `repository.rs` restore lost nothing.** `git diff -w` round-8→HEAD is
  *only* message reflows; round-7→HEAD is *exactly* round 8's parser hunk. An
  auditor transcribed all three guards into a standalone binary against the real
  file: 3/3 green and **8/8 named mutations behave as claimed** — drop the owner
  predicate from COUNT, OR-widen past the owner, a 6th narrowing with a stale
  const, the two formatting spellings, `= ANY`, drop the reveal join's user scope,
  reveal reading the redacted column. `rustfmt` cleanliness improved 449→107.
- **the `healAttempts` bound is correct**, simulated: a conforming provider costs
  exactly one attempt; a violating one stops at exactly three; the counter
  increments only when `register` is actually called, so a late-installed
  transport burns nothing; and exhaustion cannot strand the user, because
  `elicitationIsUnactionable('not-registered')` is false and pinned.
- **the three-state classifier walk** — `no-transport` and `resolve-failed` are
  each internally coherent across copy, tone, disabled-ness and aria; and the
  premise the design rests on was verified (mcp's `resolveElicitation` POSTs
  unconditionally).
- **a false alarm chased and cleared:** the branch's `node-test-hooks.mjs` rewrite
  is not a regression — the same 14 files fail at the merge-base, and the branch
  hook is strictly better (14 failing / 831 passing vs 15 / 823).

## 8. Observed results

| suite | observed |
|---|---|
| `transport.test.ts` (now 11 tests) | **11 passed**; tone revert → RED; failure-judgement revert → RED |
| `railIsolation.test.ts` | **8 passed**; latch → RED; spread-after → RED; hoist refactor → **GREEN** (correctly); apostrophe → **GREEN** (correctly); `<Button>` rename → RED; TEST-36 file rename → RED |
| chat unit family | **346 tests, 342 pass, 4 fail** (the pre-existing loader failures) |
| `npm run check` (ui) / (desktop/ui) | **exit 0** / **exit 0** |
