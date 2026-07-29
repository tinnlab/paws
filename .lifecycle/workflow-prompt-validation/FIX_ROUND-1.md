# FIX_ROUND-1 — workflow-prompt-validation

Input: `LEDGER.jsonl` — six blind agents over 16 angles, **115 rows: 73 confirmed,
42 explicitly rejected**. Per-agent ledgers preserved as `ledger-round1-{a..f}.jsonl`.

The audit was worth more than the original fix. It found that the change closed
the *reported* cells of the disagreement while leaving the *same class* open one
level down, and that both acceptance tests could pass without proving what they
claimed. Everything below is a fix or a recorded rejection; nothing was dismissed
by assertion.

---

## The class was still open: the runner had no path rule of its own

Three agents converged on the same gap from different angles (correctness,
security, design-conformance). `load_raw_prompt` used the shared rule to pick
WHICH field supplies the prompt, and then did a bare `bundle_root.join(rel)` +
read — no shape check, no confinement, no readability parity. So:

| state | validator | runner (as fixed in phase 5) |
|---|---|---|
| `prompt_file: "prompts/../prompts/real.md"` | RED `WORKFLOW_PROMPT_FILE_UNSAFE` | **Ok(contents)** |
| `prompt_file: <symlink out of the bundle>` | RED `WORKFLOW_PROMPT_FILE_ESCAPE` | **Ok(contents)** |
| `prompt_file: <non-UTF-8 file>` | GREEN (`is_file()`) | Err at run |
| `prompt_file: <zero-byte file>` | GREEN | Ok("") → an empty prompt to the model |

That is INV-1 failing in BOTH directions, and the security agent showed it is
reachable with no validation at all: `POST /api/workflows/{id}/test`
(`handlers/dev.rs`) dispatches via `parse_workflow_yaml` alone — it never calls
`validate_for_install` the way `spawn_run`/`resume_run` do.

→ **Fixed by moving the whole file question into one shared function.**
`validate::read_prompt_file(bundle_root, rel) -> Result<String, PromptFileError>`
does the shape check, canonicalize + confinement, the READ, and the emptiness
check; `check_prompt_files` turns its `Err` into a finding (the error carries its
own `code()`/`layer()`/`message()`), and `load_raw_prompt` uses its `Ok`. Reading
the file IS the check, so no weaker proxy can drift from the operation the runner
performs (DEC-10). `is_file()` was exactly such a proxy, and it was already wrong
for two of the four rows above.

Recorded as DEC-9 / DEC-10; PLAN ITEM-1/3/4 amended; DESIGN §1's case table
extended with the four rows.

## Both acceptance tests could pass without proving their claim

- **TEST-1** advertised "the whole authorable state space" and listed
  `WORKFLOW_PROMPT_FILE_UNSAFE`/`ESCAPE` in `PROMPT_CODES`, but its `files` array
  contained no path that could produce either — i.e. it excluded precisely the
  rows where the implication failed. The design-conformance agent added
  `Some("prompts/../prompts/real.md")` and turned it red on the spot.
  → Matrix widened from 60 to **108** cells (`..`, absolute-shaped, escaping
  symlink, zero-byte, non-UTF-8). Two further holes the agents named are also
  closed: an explicit **non-vacuity floor** (18 cells must legitimately RUN, or
  the implication could hold because nothing validates clean), and a new
  `prompt_codes_list_covers_every_prompt_verdict_the_validator_emits` test that
  scans `validate.rs` and fails if the validator gains a `WORKFLOW_PROMPT_*` code
  the matrix silently stops covering.
  → The fixture was also wrong: its "outside" symlink target lived UNDER the
  bundle root, so the escape row resolved cleanly and both sides agreed for the
  wrong reason. The bundle root is now a subdirectory of the temp dir. This is
  what the anti-vacuity count caught (24 rows ran, not the expected 18).
- **TEST-7**'s falsifiability control injected an UNCONDITIONAL
  `margin-inline-end`, while production had it conditional on a `> button` child;
  and its anti-vacuity guard counted any inline-end addon, including the empty
  ones a combobox renders when its trigger/clear flags are off. A green control
  therefore did not prove the probe would catch a real revert.
  → The control now injects the EXACT reverted selector (`:has(> button)`), and
  the guard counts addons that actually carry that child.

## The direction-inverting mutation TEST-1 cannot catch

The design-conformance agent tried the one mutation that matters most and it was
**not caught**: making the validator adopt dispatch's OLD rule (drop the inline
emptiness filter) leaves all cells in agreement, while violating DESIGN §1's
stated Direction. This is correct and not a defect — TEST-1 asserts AGREEMENT,
which is the invariant; the DIRECTION is asserted by TEST-2 and TEST-3, which do
go red under that mutation. Recorded here rather than "fixed" because the split is
deliberate: one test per promise, and the agent verified the other two catch it.

## The kit fix introduced one real regression, measured

The UI agent measured, live, in `dir=rtl`: converting the addon's own padding to
logical properties removed the accidental masking of a latent bug one line above
— `InputGroup`'s root compensates the input with PHYSICAL `pl-1.5`/`pr-1.5` keyed
off the LOGICAL `data-align`. RTL input→child clearance went 3.20px → **0.00px**.

→ Fixed (`ps-1.5`/`pe-1.5`), and verified by measurement afterwards: the input's
padding now mirrors correctly (LTR `padStart 10 / padEnd 6`, RTL `padStart 6 /
padEnd 10`). TEST-7 gained **RTL legs at both viewports** and now probes BOTH
`inline-start` and `inline-end` in the writing direction — the agents noted the
`inline-start` variant had no test that any revert could turn red.

## Guards that nothing ran

Two agents independently found that ITEM-7's spec was not reached by any enforced
gate: `gate:ui` runs an explicit ALLOW-LIST (`gallery.config.json` `visualSpecs`)
that did not include it, and the CI job that runs the visual config unfiltered is
path-gated on `src-app/ui/**` — which a kit regression, arriving as an `sdk`
submodule-pointer bump, does not match. A guard nothing runs is the same failure
as the tolerance constant it replaced.

→ Spec added to `visualSpecs`; `sdk` added to `visual-tests.yml`'s path filter
(DEC-13).

## The two languages had no drift guard

`validate::prompt_source` and `stepForms.ts::promptSuppliedByFile` now implement
one rule in two languages, and the TS test could only assert its own side. This
module already ships the right mechanism for exactly this (`validationCopy.ts` is
read by a Rust test that fails the backend suite on drift) and the new rule did
not get one.

→ `client_prompt_file_predicate_mirrors_prompt_source` reads `stepForms.ts` at
test time and fails the BACKEND suite if the predicate stops rejecting `""` or
starts trimming. **Proven falsifiable**: reverting the client predicate to
`typeof pf === 'string'` turns it red; restored, green.

## Smaller confirmed fixes

- `PromptSource::Missing` and `Both` were collapsed into one opaque runtime
  message; the enum knows which it is, and this arm is only reachable when
  validation was bypassed — i.e. when the operator has least context. Now
  distinguished.
- `WORKFLOW_PROMPT_FILE_MISSING`'s author copy ("isn't in the workflow — add the
  file") is a remedy that cannot fix three of its four causes. Reworded (DEC-12,
  ITEM-13) — this corrects an over-claim in DEC-5, which said no copy change
  would be needed.
- `stepForms.ts`'s `promptField` doc still transcribed the DELETED rule
  (`has_file = prompt_file.is_some()`) with a stale line reference, and claimed
  `'   '` reads as "no typed prompt" to the backend — contradicted by this
  branch's own test. Corrected, including the whitespace boundary and why
  field-level requiredness and step-level exclusivity are different questions.
  The `promptSuppliedByFile` JSDoc was also orphaned (a second block sat between
  it and the function); moved onto the function.
- The kit comment quoted the deleted utility class names verbatim — Tailwind
  scans source TEXT, so the comment re-emitted the removed CSS. Reworded to
  describe the values without naming the classes.
- Three different magnitudes were quoted for one measurement across three files
  (5px / ~4px / 3.8px). All three now state the same measured pair and say why
  they differ (`clientWidth` excludes the 1px borders).
- The `(prompt, prompt_file)` pair was extracted by hand at each site with silent
  fallthroughs, so a NEW step kind carrying a prompt would have been skipped by
  the validator and the runner alike. Replaced with an exhaustive
  `StepConfig::prompt_fields()` beside the existing `kind_str()`.

## Explicit rejections (the ones worth naming)

- **"The tightened file check breaks already-installed workflows at launch,
  including MOCKED steps"** (medium, correctness). Real observation, rejected as a
  new class: `check_prompt_files` ALREADY reported `WORKFLOW_PROMPT_FILE_MISSING`
  for a mocked step whose `prompt_file:` does not exist, and
  `validate_for_install` already ran on every `spawn_run`/`resume_run`. The change
  makes empty/directory/non-text/zero-byte behave like the already-shipped missing
  case. Exempting mocked steps is also impossible without reopening INV-1
  (`force_mocks` is a run-time flag the validator cannot see). DEC-11.
- **"`stepForms.test.ts:254` pins a client/server divergence"** (medium). The
  client asserts `prompt: '   '` beside a `prompt_file:` is field-clean while the
  backend calls it `PromptSource::Both`. Not a divergence: the FIELD answers "must
  the author type something here" (no — there is text), and the step-level
  exclusivity is reported by the validation PANEL. Different questions, different
  surfaces. The doc now says so explicitly rather than leaving it to be
  rediscovered.
- **The addon's VERTICAL containment** (36px addon in a 32px group). Real,
  pre-existing, orthogonal, and it would change every consumer's vertical rhythm.
  [DESCOPED] as ITEM-12 with a recorded disposition, and reported onward —
  mirroring how FIX_ROUND-2 handled the horizontal defect this branch fixes.
- **Blocking `std::fs` inside the sync validator on a tokio worker** (low).
  Pre-existing shape (`is_dir`/`canonicalize` were already there); the new read is
  one more small stat+read on the same path. The runner's side, which is async,
  was moved onto `spawn_blocking` as part of the fix.
- Several `pub` → `pub(crate)` nits: the new items sit beside `validate_collecting`
  and `parse_workflow_yaml`, which are `pub` for the same in-crate reasons.
  Consistency with the file beat a visibility narrowing with no caller change.

**New confirmed findings:** 73
