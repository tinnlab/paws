# FIX_ROUND-5 — final round

Angles: **correctness** + **design-conformance** (required), both blind, over
**round 4's diff only** (`777431e0f..HEAD`).

## What the round found

7 rows. The correctness angle reported **no defect introduced by the range** and
mutation-tested its way to that conclusion rather than asserting it. The
design angle declared the surviving-surface sweep **clean** for the first time:
across all 41 UI modules, the desktop workspace and the shared api-client, it
found no new instance of the copy/tooltip/empty-state/fetch class that the four
previous rounds each turned up.

**One judgement of mine was overturned, correctly.** I had gated the
`workflow agent steps` clause and deliberately left the `scheduler's horizon
backstop` sentence, reasoning that the scheduler horizon "still applies
server-side". The auditor pointed out that is equally true of workflow — it is
also a hide-only row, so its API and agent step kind stay live too. The
distinction I drew did not exist. Both are gated now, and the comment records the
correction rather than the original rationalisation.

**A vacuous pair I had inherited and then vouched for.** Two "code span"
assertions in the citation test never exercised `CODE_SEGMENT_RE` at all — in
both, `[1]` is preceded by a word character, so the lookbehind alone blocks them;
deleting the entire code-splitting stage left the suite green. They were
pre-existing, but the doc comment I added in round 4 presented them as
tokenization-rule coverage. Added ``see `a [1] b` here`` and **verified by
mutation**: a never-matching `CODE_SEGMENT_RE` now turns the suite RED where it
previously stayed green.

Also closed: the disabled-side built-in wait (it settled on the first row to
land, so a late-arriving offender could have slipped through — it now polls until
two consecutive reads agree), and the citation-chip *consumer*, which I marked
`wontfix` in round 4 and which came back in round 5; closing it was cheaper than
defending it a third time.

## Escalated, not absorbed

**The citations built-in auto-attaches to every tool-capable chat**
(`mcp/chat_extension/mcp.rs:252` — "always available, no admin enable / provider
gate"), verified in current code. With citations hidden, the model still receives
six citation tools, calls them unprompted, and writes a bibliography the user can
never view. That is **past** the design's stated limitation: it answers "a user
who knows the URL", whereas here the hidden feature surfaces itself to a user who
did nothing.

Both available fixes are out of scope: an attach gate needs something the SERVER
knows about the reduction (the server-side kill switch for a UI-only item the
design defers), and the alternative — revoking `citations::use` — was tried in
round 1 and withdrawn because it breaks chat for every non-admin. Goes to the
owner with `control_mcp` as one coherent limitation.

## Verification

- `tsc --noEmit` clean; `check:state-matrix` up to date.
- citation unit **3/3**, and now falsifiable on the code-span stage.

## Termination

**Loop terminates. Reason: CONVERGED.**

- Profile: **26 → 25 → 16 → 11 → 7**, monotonic across five rounds on
  progressively smaller diffs.
- **No new product defect in the range**, per the correctness angle's own
  verdict, and the design angle's surviving-surface sweep came back **clean** —
  the first round where the search that had produced findings every previous time
  produced none.
- What remains is two escalations (owner decisions, not fixes) and one known-red
  gate (DEC-13, blocked on an external merge). The open set is otherwise empty.
- GUARD-SUB never fired in any round.

Five rounds, HEAVY tier, monotonic decay, a clean sweep, and no unresolved work
inside this branch's control. Proceeding to phase 8.

**New confirmed findings:** 7
