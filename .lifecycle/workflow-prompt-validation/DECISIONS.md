# DECISIONS — workflow-prompt-validation

Every human/product input this fix needs, resolved up front.

### DEC-1: Which side of the validate/dispatch disagreement is correct — should `prompt: ""` beside a `prompt_file:` be REJECTED at validate, or TOLERATED at run?

**Resolution:** TOLERATED at run. `validate.rs`'s existing semantics — "an empty
prompt is not a prompt" — is canonical, and `dispatch.rs` moves to it. Concretely:
`prompt: ""` beside a `prompt_file:` is a legitimate, complete step whose wording
comes from the file, and the run must read the file.

**Basis:** codebase — three independent reasons, in order of weight.
(1) **Fail-closed direction.** The rule that must hold is "validate is at least
as strict as dispatch". The reported bug is validate-GREEN/run-RED, and there are
exactly two ways to close it: relax dispatch, or tighten validate. Relaxing
dispatch closes it without creating any new red. Tightening validate would make
`prompt: "" + prompt_file:` a `WORKFLOW_PROMPT_BOTH` error — which is precisely
the FALSE red that `workflow-builder-ux` rounds 5-7 spent three fix rounds
removing, and it would re-break the state the builder's own `WORKFLOW_PROMPT_BOTH`
remedy tells the author to produce ("clear the prompt box here to use the file").
(2) **It is already the codebase's rule everywhere else.** `validate.rs:681`
(`prompt.as_ref().filter(|s| !s.is_empty())`) predates this branch; the client
mirror (`stepForms.ts`, rounds 5-7) is written against it and quotes it in a
comment block; and round 8's builder fix (a cleared box writes `null`) was chosen
BECAUSE empty means absent. `dispatch.rs`'s raw `match (prompt, prompt_file)` is
the single outlier.
(3) **The alternative needs new author-facing surface.** Tightening validate
would need either a reused-but-now-wrong `WORKFLOW_PROMPT_BOTH` (misleading: the
author did not supply two prompts) or a NEW code — and every code needs
author-facing copy, enforced by a backend test (round 6). Relaxing dispatch needs
none.

### DEC-2: `prompt: ""` with NO `prompt_file` resolves to `Ok("")` today — after the fix it errors. Is that acceptable, or must the old behaviour be preserved?

**Resolution:** It errors. Not preserved.

**Basis:** convention — that state is ALREADY `WORKFLOW_PROMPT_MISSING` (RED) at
validate, so it cannot reach a run through install or import; it is only reachable
by bypassing validation. The second half of INV-1 ("a definition the validator
reports RED must not quietly succeed at run with a degenerate prompt") requires the
error. Silently sending an empty prompt to a provider — and paying for it — is not
behaviour worth preserving; §6 of `CODING_GUIDELINES.md` ("never silently swallow")
points the same way.

### DEC-3: Should the shared rule normalise on `is_empty()` or on `trim().is_empty()`?

**Resolution:** `is_empty()`. A whitespace-only prompt (`"   "`) stays a PRESENT
prompt.

**Basis:** convention — `validate.rs:681` already uses `is_empty()`, and the two
sides currently AGREE on that cell (validate: `has_prompt` → `WORKFLOW_PROMPT_BOTH`
beside a file, or green alone; dispatch: `Ok("   ")`). It is therefore not part of
this defect class, and changing it would be an unforced behaviour change with no
defect behind it (DESIGN §3, out of scope). The client mirror uses the same
boundary, so client and server stay in lockstep.

### DEC-4: How is the RUN side of INV-1 proven — an HTTP run test, or a direct test of the dispatch decision?

**Resolution:** A direct test of the REAL `load_raw_prompt` against a REAL bundle
directory on disk (TEST-1, TEST-6). No HTTP run test.

**Basis:** codebase — the decision executes before any provider call, and neither
HTTP path can reach it in a gate: a mocked run is short-circuited in
`runner.rs:767` (`run_mock_step`) BEFORE the dispatcher is entered, so the mock
path never evaluates a prompt at all; an unmocked run needs a live LLM provider,
which would make the test key-gated and therefore not actually run (forbidden —
"never `#[ignore]`/skip to go green"). TEST-1/TEST-6 execute the real function
against real files, so the run-side decision is genuinely run.

### DEC-5: Does `prompt_file: ""` / a `prompt_file:` naming a directory belong in this fix, or is it separate scope?

**Resolution:** In scope (ITEM-4).

**Basis:** convention — both are the SAME defect (validate GREEN, run RED with
"Is a directory"), reachable from the same authored YAML, and both would survive
a fix that only touched the reported cell. INV-1 is stated as a class ("a
definition the validator reports GREEN must not fail at run for a
prompt-configuration reason"), and TEST-1 asserts the class over a matrix — a
partial fix would leave that acceptance test red. No new validator code is needed
(`WORKFLOW_PROMPT_FILE_MISSING` is reused), so the author-facing-copy surface does
not grow.

### DEC-6: The kit addon fix — remove the negative margins, or compensate for them (e.g. give the group extra padding)?

**Resolution:** Remove the cause. `inline-start`/`inline-end` become
`ps-2 has-[>button]:ps-1 has-[>kbd]:ps-1.5` / `pe-2 has-[>button]:pe-1
has-[>kbd]:pe-1.5` — grid-aligned, logical-direction, no negative margin.

**Basis:** convention — `DESIGN_SYSTEM.md` forbids off-grid arbitrary spacing
(`-0.3rem` = 4.8px, `-0.15rem` = 2.4px are both off the 4px base and its 2px kit
half-step) and requires logical-direction utilities on new/changed code
(`lint:logical-direction`, taxonomy N1) — `pr`/`mr` do not flip under RTL, which
is a second, latent defect in the same two lines. Compensating on the group would
leave the negative margin (and its RTL bug) in place and add a magic offset, which
the brief explicitly rules out. Measured optical cost of removing it: the button's
right edge moves 0.8px inward (from `groupContentRight − 3.2` to
`groupContentRight − 4`).

### DEC-7: Is any operational tunable introduced that should be an admin-configurable setting rather than a constant?

**Resolution:** No tunable is introduced. The only constants involved are
`MAX_TOLERATED_OVERFLOW_PX` (a TEST tolerance, which this branch REMOVES the need
for by lowering it to the 1px jitter floor) and the kit's spacing scale (a design
token set, already centralised in `DESIGN_SYSTEM.md`/`index.css`). No limit,
retention period, quota, threshold, toggle or model selection is added, so the
configurable-settings rule has nothing to bind to here.

**Basis:** convention — the mandatory configurable-settings DEC is answered
explicitly rather than by omission.

### DEC-8: Where does the kit change get committed, and is it pushed?

**Resolution:** Committed IN the `sdk` submodule on its checked-out branch
`sdk/agent-core-and-perf`. **Neither the submodule nor the parent is pushed** by
this branch; the parent's gitlink is updated in a parent commit so the tree is
self-consistent, and the orchestrator publishes sdk before the parent pointer.

**Basis:** user — stated verbatim in the task brief ("commit in the submodule and
say so clearly; do not push — the orchestrator publishes sdk before the parent
pointer").
