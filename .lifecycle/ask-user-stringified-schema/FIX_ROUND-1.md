# FIX_ROUND-1 — resolving the phase-6 findings

## Provenance of this round — READ THIS FIRST

**This audit was performed SINGLE-HANDED by the implementing author, not by
fresh blind sub-agents.** The session's sub-agent quota was exhausted (200/200)
when phase 6 began; a spawn was attempted and refused. The lifecycle asks for
blind reviewers precisely because an author cannot un-know their own reasoning,
so this artifact is labelled honestly rather than presented as a blind round.

Concretely, what that costs: the findings below are the ones an author is
*capable* of finding. The class it cannot cover is "the author's mental model is
wrong in a way they cannot see from inside it" — which is exactly the failure
mode `TEST_GAP_ANALYSIS.md` documents for the ORIGINAL bug. A genuinely
independent pass over this diff is still owed and should be run before merge.

To compensate as far as a self-audit can, the review was run **against the diff
file** (`git diff origin/feat/agent-core...HEAD`), angle by angle, with each
claim checked by GREP OR BY RUNNING something — never by "I remember writing
that correctly". Three findings below were caught only because a test was run
and failed.

## Confirmed findings and their fixes

- **LEDGER `coerce_args_in_place` used `slot.take()`** (correctness, medium) —
  left the failing key as `Null` on the error path. Not reachable today (all four
  callers pass a clone and propagate with `?`), but the helper must not depend on
  its callers' discipline. **Fixed**: clone-then-assign, with the clone confined
  to the already-wrong path. **Pinned** by a new assertion that the failing key
  is left intact.

- **The actionable-feedback integration test asserted the wrong artifact**
  (tests-quality, high) — it read the assistant text assembled from the chat
  stream, i.e. what the STUB chose to echo, and the stub truncates its echo to
  200 chars (`last_tool_result_text`). The refusal itself was correct; the test
  was measuring the fixture's echo policy. It would have PASSED on a refusal
  whose corrective example was cut off — the precise failure the owner's
  requirement exists to prevent. **Fixed**: retargeted to the continuation
  request's `all_text` (the bytes the backend actually sent the model) and added
  an explicit untruncated-example assertion. Found by RUNNING it.

- **`validate_body` initially rejected every non-object body** (behaviour-change,
  high) — would have broken any route taking `Json<Vec<T>>`. **Fixed** during
  implementation by narrowing to scalars; recorded as DRIFT-1.5. Verified
  `validate_body` has exactly ONE production caller, so the blast radius is
  contained.

- **`lit_search` inner-element decoding was claimed but not implemented**
  (plan-coverage, high) — TESTS.md TEST-32 asserted coverage the code did not
  have. **Fixed**; recorded as DRIFT-1.6.

- **The bounded-unwrap test hung** (tests-quality, medium) — the FIXTURE grew
  ~2^n through escaping. Dangerous because the symptom mimics the defect under
  test; a hasty reading would have "fixed" the production loop. **Fixed**;
  recorded as DRIFT-1.8.

- **The citations conformance extractor compared against `Debug` output**
  (tests-quality, medium) — escaped quotes can never match the raw example, so a
  correct message failed. The tempting weaker fix would have gutted the only
  mechanism enforcing the actionable-message rule at all thirteen sites.
  **Fixed** by reading `.message`; recorded as DRIFT-1.4.

- **Whitespace / empty-string behaviour was unverified** (correctness, low) —
  resolved by PROBING rather than reasoning, and kept as a test.

## Verified-correct (checked, no change needed)

The `x-ziee-askuser` strip ordering (the decode is provably before the strip);
the raw-first size measurement (an oversized string is never parsed); the
unwrap bound being a `for` loop rather than a `while let`; the refusal text
carrying only serde's POSITION and never the payload's content (now pinned by a
test, because "I checked" is not evidence); the anti-tautology guard actually
running red against the shipped code; and no `JsonSchema` type changing shape,
so no OpenAPI regen is implied.

## Accepted, not fixed (with reasons)

- `lit_search`'s inner-element `unwrap_or` swallows the `ArgError` — deliberate.
  Failing a whole batch because one record is malformed would be a regression;
  such a record still lands in the pre-existing `dropped`/`skipped` counters.
- A root-level `oneOf`/`anyOf` `ask_user` schema is rejected by the
  zero-`properties` rule. SEP-1330 elicitation is a flat object of properties and
  the renderer reads only `properties`, so such a schema could not render either
  way.
- A 400 on an unusable elicitation `content` leaves the elicitation PENDING. That
  is correct — the user has not answered — and is what the new tests exercise.


(That zero is the count for a SECOND pass over the same diff after the fixes
above; it is not a claim that an independent reviewer would find zero. See the
provenance note.)

## Addendum — findings from the phase-8 runs

Two more, both caught by RUNNING rather than reading, and both worth recording
because in each case the PRODUCT was correct and the TEST was wrong — the
failure mode that most easily gets "fixed" in the wrong place.

- **The e2e used `provider_type: 'custom'`** (tests-quality, high). The API
  accepts the row, but no model under it reaches the chat model dropdown, so the
  spec timed out at model selection having proved nothing. Diagnosed from the
  failing run's own error (`waiting for locator('[role="listbox"]')` resolving to
  an empty listbox), then switched to the established `openai` + explicit
  `base_url` BRIDGE pattern, which routes to the same OpenAI-compatible client.

- **The acceptance assertion demanded text the wizard does not show on step 1**
  (tests-quality, high). It asserted the card contained "project name" (the first
  property's `title`). The rendered card was
  `"assistant is requesting input · step 1 of 3 · what would you like to name
  this new project? · brief description (optional) · decline · next"` — i.e. the
  decode WORKED and produced a three-step wizard; the rich UX simply renders the
  elicitation MESSAGE as step 1's question rather than the field title. The
  assertion was failing a CORRECT render.

  Retargeted to the decisive signal: **"step 1 of 3"**. The wizard renders one
  step per `properties` entry, so that string can only appear if all three
  properties were decoded out of the string — and on the pre-fix backend
  `properties` is `{}`, so there are no steps at all. Kept a second assertion on
  a title from the decoded schema ("brief description") so an unrelated
  elicitation still cannot satisfy the spec.

  Recorded because the tempting reaction to "the assertion failed" is to weaken
  it (drop the text check entirely); the right one was to find the signal that is
  BOTH true of a correct render and false of the defect.

**New confirmed findings:** 0
