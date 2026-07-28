# FIX_ROUND-3 — re-audit of the round-2 fixes

## Provenance

A third independent agent, again with no prior context and no sight of the two
earlier rounds' reasoning, was asked to verify each round-2 fix actually landed
and to hunt for defects the fixes themselves introduced. It found one — in a fix
written the round before — plus a stale piece of EVIDENCE in `TEST_RESULTS.md`,
which is the more interesting catch.

## Verification of the round-2 fixes

All CLOSED, each with a traced justification rather than a diff-read:

- **R2-1** (wizard step total instead of a field count) — CLOSED, and confirmed
  non-vacuous: the regex miss yields `0`, so a parse failure cannot pass; the
  indicator renders only under `total > 1`; and `total === 0` is independently
  excluded by the no-fields-card assertion.
- **R2-2** (bound-exhausted message pinned) — CLOSED. `"JSON-encoded more than"`
  is emitted by exactly one site in the tree (`tool_args.rs:194`).
- **R2-5** (the false "may render inline rather than as a wizard" comment) —
  CLOSED.
- **R2-6** (`settled_assistant_total`) — landed and passing, but STILL-OPEN on
  the merits. See below.

## Findings and dispositions

| # | Sev | Finding | Disposition |
|---|---|---|---|
| 1 | MED | `settled_assistant_total` returned on the first pair of equal reads. `N, N` is produced identically by "the detached template clone already landed" and by "it has not started yet", so on a loaded box the helper samples a PRE-clone number and reintroduces the race it was written to remove. Its comment ("the only writer completes in a single burst") justified the wrong thing: burst-atomicity of the writer says nothing about whether the writer has started. | FIXED — replaced with `total_after_template_clone`, which waits on a POSITIVE condition (the user owns ≥1 assistant; exactly one default template is seeded) before sampling, and the comment now states that reasoning. |
| 2 | LOW | The degraded-card comment claimed reaching that card "would mean good input is now being rejected" — not exhaustive: a model that omits `schema` entirely falls back to a bare `{"type":"object"}` and legitimately renders that card. Same overclaim class as R2-5. | FIXED — comment now names both causes. |
| 3 | LOW | `stepTotal >= 2` conflates model choice with mangling: a model answering with one combined property fails the leg. | ACCEPTED, and stated as such in DEC-21's tradeoff. Mitigated by `retries: 2` and a directive prompt. The alternative — comparing against the schema the backend actually decoded — has no accessible seam from the browser (`ask_user` is intercepted before `call_tool`, so it is never written to `mcp_tool_calls`). Recorded rather than hidden. |

## The stale-evidence catch (the one worth keeping)

The re-audit noticed that `TEST_RESULTS.md` claimed "5 of the 6 legs go RED; the
sixth stays green by design" while citing `test24-tautology-guard2.log` — a log
timestamped BEFORE round 2 added the bound-exhausted assertion to that sixth leg.
The claim was never re-measured after the code changed.

Re-measured (`test24-tautology-guard3.log`): with `decode_invoke_args` neutered,
**all 6 legs now fail** — round 2's fix made the sixth discriminating and nobody
noticed, so the record understated the suite. `TEST_RESULTS.md` was corrected.

This is the same defect class the feature itself is about, applied to our own
artifacts: a claim that was true when written, left standing after the thing it
described changed. Evidence has to be re-taken when the code under it moves.

**New confirmed findings: 1**
