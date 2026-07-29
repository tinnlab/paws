# FIX_ROUND-20 — Activity Rail

Round 20. **Not another predicate round — the re-scope round 19's ABORT called for.**

Blind re-audit of this round's own commit, two angles (**behavioural correctness**,
**test-quality + claim accuracy**), each scoped to that commit alone.

**New confirmed findings:** 16

16 raised across the two angles; **15 distinct** — FR20-3 was raised independently by both,
and is listed once per angle rather than silently deduped, so the per-angle counts add up.
All 15 fixed. All in `LEDGER.jsonl` with `"round": 20`. **0 `accepted-open`** — for the first
time since round 12, every finding of the round was closed inside it.

Commits: the change was audited at `ba0abb80f` and, after the audit, squashed with its fix
round into **`85bed71b1`** with a corrected message. `ba0abb80f`'s message asserted three
things its own audit refuted (FR20-6, FR20-11, FR20-12); those claims are not carried into the
branch's history, and the full trail is preserved here instead.

---

## 1. What round 19 handed over, and why a twentieth predicate was the wrong move

`FIX_ROUND-19.md` §6 is unambiguous: two audits in opposite directions (18 deleted guards,
19 restored them) each found five more spellings the other missed, and *"the next honest step
is **not** round 20's predicates."* It named a component-level harness as the destination.

This round takes a different road to the same place, because the harness was not the only
option. Restating the mechanism the earlier rounds recorded:

> `blocked` has FOUR values and only TWO are reachable from a spec, so **every** defect has a
> spelling keyed on an unreachable value.

That sentence contains its own answer. The space of *spellings* is unbounded — nineteen rounds
proved it. The space of *values* was four. So the question this round asked was not "which
predicate is missing" but **"why is that value in that type at all?"**

### The evidence that `not-registered` did not belong there

Three checks, all made before touching anything:

| claim | how it was verified |
|---|---|
| it never disabled | `elicitationIsUnactionable` was `reason === 'no-transport'`, full stop |
| it was never an error | `elicitationIsError` was `no-transport \|\| resolve-failed` |
| the component branched on it in exactly ONE place | `git show ba0abb80f^` + grep: a single `blocked === 'not-registered'`, selecting a sentence |

So a purely presentational fact was sitting in the union every action path reads. That is the
root cause, and it is the thing nineteen rounds of predicates never touched.

### The baseline defect, re-measured before the change

Round 19's FR19-10 mutation, applied verbatim to the pre-refactor component:

```
tsc --noEmit                     -> exit 0
railIsolation + transport specs  -> 21 tests, 21 pass
npm run test:unit (whole UI)     -> 962 tests, 947 pass, 15 fail (the SAME 15 files as a clean run)
```

Invisible to every test in the workspace. That is the baseline.

## 2. The change, and exactly what it closes

1. `ElicitationBlockedReason` = `'no-transport' | 'resolve-failed'`. `entryExists` stops being
   a classifier signal.
2. `elicitationNotice()` — a pure function returning `{ text, tone, status }` — owns the
   presentational half. `not-registered` survives only as a **case label** inside it.
3. `resolveElicitationVia` takes `ElicitationDecision = Exclude<ElicitationAction, 'cancel'>`.

The auditor's mutation, re-applied verbatim:

```
JsToolApprovalContent.tsx(230,72): error TS2367: This comparison appears to be unintentional
  because the types 'ElicitationBlockedReason | null' and '"not-registered"' have no overlap.
JsToolApprovalContent.tsx(230,72): error TS2345: Argument of type '"accept" | "cancel" | "decline"'
  is not assignable to parameter of type 'ElicitationDecision'.
```

Two independent barriers. And (3) generalises past the one spelling — substituting `'cancel'`
is TS2345 under **every** condition, measured on four, three of which remain writable:

| condition | verdict |
|---|---|
| `blocked === 'not-registered' ? 'cancel' : action` (the auditor's) | TS2367 **+** TS2345 |
| `resolveFailed ? 'cancel' : action` | TS2345 |
| `!elicitationExists(data.elicitation_id) ? 'cancel' : action` | TS2345 |
| `healExhausted ? 'cancel' : action` | TS2345 |

### …and what it does NOT close — the round's own worst claim, refuted by its own audit

`ba0abb80f` claimed *"Closes round 19's FR19-10 … by construction."* **That is false**, and
the test-quality angle proved it with two tsc-clean, GREEN mutations (FR20-3):

- `resolveElicitationVia(id, blocked === 'resolve-failed' ? 'decline' : action)` — the user
  clicks **Approve** on a `resolve-failed` card and a **decline** is POSTed. Strictly *more*
  reachable than the mutation the type change closed: `resolve-failed` is one of only two
  spec-reachable states, and the product deliberately keeps both buttons live there.
- `resolveElicitationVia(statusId, action)` — FR19-10's own second sentence.

Both are valid values of the right type. A type cannot express "this argument must be *that*
binding". FR19-10 is therefore closed by a **guard** added in the fix round that pins the
send's two arguments — the id the card derives its own resolved state from, and the handler's
decision parameter verbatim. That is two pinned arguments with nothing left to enumerate, not
a twentieth predicate in an open sequence.

## 3. Findings — all 16, all fixed in-round

### Angle A — behavioural correctness (3)

The angle built a 48-cell cross-product harness importing the **real shipped**
`elicitationNotice`, diffed against a verbatim transcription of the old inline JSX. **All five
hard invariants HELD**: only `no-transport` disables (0/48 cells disable while a transport
exists), the not-open condition still shows accurate copy / self-heals / is not destructive,
the click still POSTs in every state but `no-transport` (0/48 suppressed), the `data-status`
value SET is unchanged, and no disabled control lost its explanation.

| # | sev | finding | disposition |
|---|---|---|---|
| FR20-1 | LOW | precedence divergence in 2 of 48 cells (`resolve-failed` now outranks the not-open sentence) | **DEFENSIBLE, kept.** The angle independently confirmed it is unreachable with the in-tree provider (that provider catches everything, so `carried` is never false, and it never deletes an entry) — reachable only via a throwing provider, which the seam contract permits. Recorded as DEC-13 and asserted in `transport.test.ts`. |
| FR20-2 | LOW | `aria-describedby` differs in 4 resolved-state cells; zero DOM effect today because those buttons only render under `resolved === null` | **Fixed** by the always-mounted-region assertion (FR20-7 / FR20-9), which pins the gate the safety depends on. |
| FR20-3 | MED | the commit shipped a regenerated `RUNTIME_FINDINGS.md` flipping gating HIGH 0→1, unmentioned in the message | **Fixed** by un-bundling: the artifact is reverted out of the commit (any `gate:ui` run regenerates it, and its HIGH belongs to an unrelated surface). The branch's real HIGH=1 is recorded in `TEST_RESULTS.md` with its base attribution. |

### Angle B — test quality + claim accuracy (13), every one mutation-proven

| # | sev | finding | fix |
|---|---|---|---|
| FR20-4 | **HIGH** | **`elicitationNotice`'s PRECEDENCE was untested.** Moving the `no-transport` branch below `!entryOpen` was tsc-clean and left all 21 tests green. Not an exotic cell: `elicitationExists()` returns false whenever there is no transport, so `{no-transport, entryOpen:false}` is the **dominant** no-transport cell — the mutated build never shows the no-transport sentence at all, and the DISABLED card reads *"you can still answer it"* in non-error tone. Verbatim the FIX_ROUND-9 divergence. The deleted `elicitationBlockedReason` ordering assertion had **no replacement**. | a total-order precedence block in `transport.test.ts` (resolved > no-transport > resolve-failed > not-open), incl. tone |
| FR20-5 | **HIGH** | the new guard pinned `elicitationNotice`'s **callee and never its arguments** — the identical miss this file's own FIX_ROUND-16 comment describes for `elicitationBlockedReason`, reintroduced one rung down. `elicitationNotice({resolved, blocked: null, entryOpen: true, healExhausted})` blanks the text, freezes `data-status` at `pending`, and strips the DISABLED control's only explanation | a four-signal argument check, each signal resolved to its live source |
| FR20-6 | **HIGH** | FR19-10 not closed (see §2) | the two-argument send guard |
| FR20-7 | **HIGH** | the new guard anchored on the first `<Text data-testid={statusId}>` **in the whole file** (`elements` not `elementsIn`) and checked no render conditions — a conforming decoy defeated everything at once | scoped to the component, **exactly one** region required, and it must be unconditionally mounted (FIX_ROUND-4's own requirement) |
| FR20-8 | MED | a spread could override the pinned attributes; `hasSpread` already exists and is used by the sibling guard | `!hasSpread(status)` |
| FR20-9 | MED | the status region could be render-gated away entirely — the disabling state left with two dead buttons, no explanation, and a dangling `aria-describedby` | covered by FR20-7's always-mounted assertion |
| FR20-10 | MED | dangling cross-reference: `FIX_ROUND-20.md` did not exist (round 19's own FR19-8 class) | this file |
| FR20-11 | MED | *"~35 lines → 3 property reads"* **false in direction**: deleted block 41 lines, added 78; the test grew 127→163; the file grew 1642→1714. Assertion count unchanged 6→6 | message corrected; §4 states the real accounting |
| FR20-12 | MED | internal contradiction — the message claimed FR19-14's copy/probe half closed while the guard comment said FR19-14 was still open, and FR20-5/7/9 proved the comment was the true half | closed for real by FR20-5 + FR20-7; both texts reconciled |
| FR20-13 | MED | stale comments describing code that no longer exists: `railIsolation.test.ts` *"all four `blocked` values"*; `JsToolApprovalContent.tsx` *"`entryExists` above derives the `not-registered` state"* (no such binding); and the e2e spec's *"`blocked` has four values"* / *"`blocked === 'not-registered'`"* prose the commit had revised in one file and not the other | all four sites corrected |
| FR20-14 | LOW | FR19-13 relocated, not closed: `entryOpen: elicitationExists(statusId)` stayed green; and the new comment's *"the worst a wrong argument can do is show the wrong sentence"* understated it | closed by FR20-5; comment corrected to say what the worst actually is |
| FR20-15 | LOW | the added unit test pinned sentences by loose substring — three harmful rewrites stayed green, incl. dropping both recovery instructions from the only disabling state | whole-sentence equality |
| FR20-16 | MED | the regenerated `RUNTIME_FINDINGS.md` gating flip — **the same finding as FR20-3**, reached independently by the other angle | un-bundled; see FR20-3 |

### What the audits attacked and could NOT break

- The central claim is **true**: the auditor's verbatim mutation fails with exactly TS2367 + TS2345, and only tsc catches it — as stated.
- A component-local `elicitationNotice` shadowing the import → RED. An unconditional spread → RED (TS2783). Dropping the `resolve-failed` case → RED. Flipping the not-open tone to `danger` → RED.
- **The deleted seam assertions are legitimately unrepresentable** and need no replacement — the one deletion in this round that both angles endorsed without qualification. `elicitationIsUnactionable` remains exhaustively pinned over both members plus `null`.
- Verified true: *"the component read it in exactly one place"*; *"nothing in-tree ever asked this helper to cancel"*; *"green under all 10 source guards"*; *"only `no-transport` disables"*; `ElicitationAction` is not dead (still the provider port's signature).
- No other caller of `resolveElicitationVia` anywhere in `src-app` (incl. `desktop/ui`); no dead code; identical hook sequence and count; no new render-time side effect.

## 4. Honest accounting — this round did NOT shrink the guard file

Derived per file, comments excluded, `ba0abb80f^ → 85bed71b1`:

| file | code −/+ |
|---|---|
| `JsToolApprovalContent.tsx` | −22 / +12 — the component genuinely shrank |
| `transport.ts` | −6 / +44 — the notice function; `elicitationIsError` deleted |
| `transport.test.ts` | −27 / +81 — behavioural coverage grew |
| `railIsolation.test.ts` | −26 / +165 — the file went **1642 → 1905** lines (1714 at `ba0abb80f`, before the fix round added the four HIGH fixes) |

**The source-scanning guard file grew, and the fix round grew it further.** Saying otherwise
was FR20-11 — and the first draft of THIS section then asserted "1740" without deriving it,
when `wc -l` says **1905**. Both are the same defect class the branch keeps re-committing (a
checkable number asserted rather than derived), the second one caught by re-deriving every
figure in this file before publishing it.

What shrank is the space of *representable* defects. What grew is coverage: the replacement
wiring check also closes FR19-13 and FR19-14's copy/probe half — both recorded open by round
19, neither ever covered by any guard — plus the send-argument guard that actually closes
FR19-10. Trading ~165 lines of guard for four HIGH holes closed is the trade this round is
willing to defend; pretending it was a reduction is not.

## 5. Convergence

**This round found 16 and fixed 16, with 0 `accepted-open`.** Round 19's six carried entries:
FR19-10 and FR19-13 are **closed** (§2, FR20-5/6); FR19-14's copy/probe half is closed
(FR20-5/7); FR19-11 (`style`/`hidden`/`inert` inerting), FR19-12 (the self-heal has no guard)
and FR17-22 are **untouched by this round and remain open** — they are unrelated to the
behavioural/presentational split and are not claimed here.

Phase 7 requires the FINAL round to record **0** new confirmed findings. This one records 16,
so **it does not close phase 7**, and it should not: two independent angles found real holes,
four of them HIGH, three of which this round itself opened. The gate is right to say so.

What is different from rounds 13-19 is the *shape* of the remainder. Those rounds each closed
the spellings the last audit found and the next audit found more of the same class. This round
removed a value from a type and pinned two arguments; the class that produced FR19-10, FR19-13
and half of FR19-14 has no remaining member that is both representable and unguarded. The next
round audits a 98-line fix diff whose subject is guards, not product code — the same position
round 15 was in, but with the underlying type defect removed rather than predicated around.

## 6. Observed results — every row names its log and carries an exit marker

All logs under `/data/pbya/ziee/tmp/`. Full detail in `TEST_RESULTS.md` §"Round 20".

| suite | observed | log |
|---|---|---|
| the auditor's mutation, pre-change | **`TSC_EXIT=0`**, 21/21 pass, 962/947/15 — invisible | `rr20-baseline-mutation-fullunit.log` |
| the same mutation, post-change | **`TSC_EXIT=2`** — TS2367 + TS2345 | §2 |
| `'cancel'` substitution class (4 conditions) | **4/4 TS2345** | §2 |
| guard + seam specs | **21 tests, 21 pass, 0 fail**, `UNIT_EXIT=0` | — |
| mutation controls — the 8 defects the audits proved GREEN | **8/8 now RED** | `rr20-controls2.log` |
| the decoy-region attack (FR20-7) | **RED** — *"must render exactly ONE `data-testid={statusId}` region, found 2"* | — |
| original controls, re-run against the fixed guards | **7 defects RED, 1 refactor GREEN** | `rr20-controls.log` |
| refactor-tolerance controls (rename the handler; rename its decision param) | **2/2 GREEN** | — |
| full UI unit suite | **962 tests, 947 pass, 15 fail** — failing-file set **identical** to the pre-change run, i.e. zero new failures | `rr20-fullunit2.log` |
| `npm run check` (ui) | **`CHECK_UI_EXIT=0`** | `rr20-check-ui.log` |
| `npm run check` (desktop/ui) | **`CHECK_DESKTOP_EXIT=0`** | `rr20-check-desktop.log` |
| e2e — the card's own matrix, final content | **3 passed (1.3m)**, `E2E2_EXIT=0`; prints tests at 72/175/238, matching `grep -n '^  test('` on the committed spec (the FR19-1 procedure) | `rr20-e2e2.log` |

### Two pre-existing conditions, attributed by measurement (neither introduced here)

Both re-measured at the branch tip with this round's change **stashed**; both reproduce
identically, so neither is attributable to it.

- `gate:ui` — 187/188 surfaces PASS, one gating HIGH on `seeded-s5-project-form-loading`
  (`Internal React error: Expected static flag was missing`, dark theme). Same surface, same
  finding, without this change.
- e2e `run-js-tool-scripting` *"renders ONE run_js card"* — fails identically at the base
  (and twice in a row with the change, so not flake).

### BLOCKING and out of scope: the branch does not compile

`cargo build --bin ziee` fails: `server/src/modules/mcp/chat_extension/helpers.rs:2036: this
file contains an unclosed delimiter`. A delimiter scan that skips strings and comments shows
the file ends at **brace-depth 1** — exactly ONE `}` missing; the first item starting at the
wrong depth is line **1782**, so `fn approval_is_always_reprompt_matches_the_gate()` (opened
at 1696) swallows the six `#[test]` fns after it. Substituting the BASE version of that one
file makes the parse error vanish, which proves the breakage was introduced on this branch
(last touched by merge commit `610c04c8c`). Round 20's diff is UI-only. Not fixed here because
the brace's placement decides whether those six test bodies are siblings or nested, and a wrong
guess silently merges two tests — an owner call, with the exact line named.

## 7. Coverage bookkeeping

`AUDIT_COVERAGE.tsv` was regenerated (`gen-coverage.mjs origin/feat/agent-core`, 393 hunks /
393 rows) so the phase-6 hunk map matches the post-round-20 diff — the same mechanism the
branch used after the base merge. Stated plainly so it is not mistaken for more than it is:
that file records which **phase-6** angles reviewed each FILE GROUP, and round 20's new hunks
inherit their group's mapping. The hunks introduced by *this* round were reviewed by the two
round-20 angles named at the top of this file, blind, over the committed diff.

## 8. Method note

The two angles were run **in parallel in one worktree**, and the correctness angle observed a
transient `tsc` failure that was actually the other angle's in-flight mutation. Its results
were re-verified against a byte-identical tree, and every measurement in §6 was re-run
**serially** afterwards. Future rounds: run mutation-testing angles sequentially, or give each
its own worktree.
