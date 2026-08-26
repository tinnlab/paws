# FIX_ROUND-2 — upstream-pulldown

Round 2 ran ONE fresh blind angle, **tests-quality**, deliberately different in kind
from round 1's correctness/security pair, and scoped to round 1's diff (the two test
fixes) per the phase-7 rule that a fix round is audited over ITS OWN diff, not the
whole feature again.

## The question this angle existed to answer

Round 1 changed a failing assertion so it passes. That is the single most dangerous
edit in this whole branch: it is indistinguishable, from the outside, from making a
test agree with broken code. So the angle was pointed straight at it — for each
changed or added assertion, derive the correct value INDEPENDENTLY from the
function's purpose and its call sites, then name the one-line production change that
would turn it red. An assertion with no such change is vacuous.

**Verdict: the diff is sound.** All five asserted values were re-derived by hand from
`capability_probe_url` (utils.rs:456-496) and matched. Each has a named red-maker:
delete the `author` append → the `/custom` case fails; restore the origin-collapse →
the `/models` case fails; drop `trim_end_matches('/')` → the no-path case yields
`//api/models` and fails. The no-path case is the CONTROL (it is deliberately
unchanged from the old behaviour) and the `/models` case is the DISCRIMINATOR, so the
pair is well-formed rather than redundant. No assertion was deleted. Both added
fixtures are real production inputs, independently corroborated by the acceptance
suite in `tests/llm_repository/capability_probe_test.rs`.

The angle also checked the thing I had not: whether the `default_example()` swap makes
any test lean on its `unwrap_or` fallback and thereby mask a `KIND_CONTRACTS`
misconfiguration. It does not — `tools.rs:1909-1915` separately asserts that
`default_example()`'s JSON contains a `spec` key, which goes red if the table entry
ever disappears. And no sibling test contradicts the change: the three other
`BACKGROUND_SPEC_EXAMPLE` sites all belong to the MALFORMED-spec refusal, which still
routes through `coerce_arg(..., BACKGROUND_SPEC_EXAMPLE)` unchanged.

## Findings: 3, all the same defect class round 1 already caught twice

Every finding is **comment drift left behind by upstream's `beae7c7fb`** — doc
comments that the same commit made false and did not sweep. That is precisely the
class that produced the stale test in the first place ("the comment described a fix
that was never applied"), so leaving them would invite the next reader to revert the
corrected assertions on the strength of the docs next to them.

- `utils.rs:381-390` — `is_usable_repository_base`'s doc claimed the probe
  "necessarily queries that kind's fixed API host … NOT the row's own URL" and that
  Unknown's "probe already targets its own origin". Both false since `beae7c7fb`.
- `utils.rs:399-407` — the same function recorded the nonexistent-org problem as a
  "KNOWN GAP … out of scope here", naming `…/api/models?author=<org>` as the fix that
  would close it. That fix SHIPPED in the same commit. A reader trusting this would
  believe a closed issue was open and might weaken the author filter.
- `utils.rs:450-452` — `capability_probe_url`'s OWN doc still said Unknown probes "the
  repository's OWN origin", contradicting both its body and the assertion round 1
  added.

All three rewritten to state what the code now does and why. `cargo test --lib -p ziee
-- llm_repository:: background_mcp::` still exits 0.

## Termination

Round 1: 2 promotable (both oracle-confirmed), 9 confirmed-but-out-of-scope.
Round 2: 3 confirmed, **0 oracle-confirmed, 0 functional** — every one is a comment,
none can change behaviour, and the angle's overall verdict was that the code and
assertions are correct.

The profile is decaying on both axes that matter: severity (high/medium functional →
medium/low documentation) and kind (a red test suite → prose that disagrees with
green code). The Chapman T1 estimator still declines — round 1 had only 1 corroborated
finding, below its ≥2 floor — so the **decay rule decides alone**, and it says
converged. The GUARD-SUB tripwire does not fire: the concentration is on the feature's
own SOURCE file, which the rule explicitly calls normal work, not on a guard being
played whack-a-mole with.

Round 3 is not run: it would audit a diff consisting solely of corrected prose.

**New confirmed findings:** 0
