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

---

## Decisions added after the phase-6 blind audit

### DEC-9: The runner reads a `prompt_file:` with no path check of its own. Fold the confinement into dispatch, or keep relying on the validator having run?

**Resolution:** Fold it in. `load_raw_prompt` resolves the file through the shared
`read_prompt_file`, which does the shape check, the confinement check, the read
and the emptiness check — the same call the validator's verdict is computed from.

**Basis:** codebase — the reliance was not sound. `POST /api/workflows/{id}/test`
(`handlers/dev.rs`) reaches dispatch via `parse_workflow_yaml` alone; it never
calls `validate_for_install` the way `spawn_run`/`resume_run` do. So
`prompt_file: "../../etc/passwd"` was `WORKFLOW_PROMPT_FILE_UNSAFE` to the
validator and `Ok(<file contents>)` to the runner, with the resolved prompt then
written verbatim to the step's prompt log. That is INV-1's second half failing,
and it is also §2 of `CODING_GUIDELINES.md` (validate the untrusted path AT the
consumer). The narrowed `(step_id, &Path)` signature from ITEM-3 was the natural
place for it.

### DEC-10: How far does "the validator must answer the question the runner asks" go — `is_file()`, or actually READ the file?

**Resolution:** Actually read it. `read_prompt_file` performs
`std::fs::read_to_string` and additionally rejects an EMPTY result.

**Basis:** convention — any weaker proxy can drift from the real operation, which
is the entire failure mode this branch exists to remove. `is_file()` still said
yes to a non-UTF-8 file (the run then failed on `read_to_string`) and to a
zero-byte file (the run then shipped an empty prompt to the model, the exact
degenerate call DEC-2 refuses on the inline side). Reading IS the check, so no
gap can open between them. Cost: one small read per `prompt_file:` step per
validation; prompts are text files, and the runner reads the same bytes moments
later. The residual TOCTOU window is not a trust boundary — the bundle is
server-owned and `spawn_run`/`resume_run` re-validate immediately before dispatch.

### DEC-11: The tightened file check makes previously-installable definitions fail at launch (`validate_for_install` runs on every `spawn_run`/`resume_run`), including MOCKED steps whose `prompt_file:` is never read. Accept, or exempt mocked steps?

**Resolution:** Accept. No exemption.

**Basis:** codebase — this is not a new class. `check_prompt_files` ALREADY
reported `WORKFLOW_PROMPT_FILE_MISSING` for a mocked step whose `prompt_file:`
does not exist, and `validate_for_install` already ran on every launch, so a
mocked step with a broken `prompt_file:` already failed to launch. The change
makes the empty/directory/non-text/zero-byte cases behave like the
already-shipped missing case rather than introducing a new gate. Exempting
mocked steps would ALSO reopen INV-1 in the other direction: `force_mocks` is a
run-time flag the validator cannot see, so the exemption would have to be
unconditional.

### DEC-12: `WORKFLOW_PROMPT_FILE_MISSING` now covers four distinct causes. New code, or reworded copy?

**Resolution:** Keep the one code; REWORD the author-facing copy (ITEM-13).

**Basis:** convention — the code is the stable machine identifier and clients key
off it (`validationCopy.ts`, the crate-wide "every code has copy" guard); adding
codes for each cause multiplies that surface for no author benefit, since the
remedy is the same investigation ("look at the file this path names"). What was
genuinely wrong is that the copy named ONE remedy ("add the file") that cannot
fix three of the four causes — so the copy, not the code, is the thing to fix.
This corrects an over-claim in DEC-5, which said no copy change would be needed.

### DEC-13: The new visual guard exists but no enforced gate runs it. Wire it in, or leave it to a manual run?

**Resolution:** Wire it in (ITEM-11): add it to `gallery.config.json`'s
`visualSpecs` so `npm run gate:ui` executes it, and add `sdk` to
`visual-tests.yml`'s path filter.

**Basis:** convention — a guard nothing runs is the same failure as the tolerance
constant it replaces. `gate:ui` runs an explicit ALLOW-LIST of visual specs, so a
new spec is invisible to it by default; and the CI job that runs the visual
config unfiltered is path-gated on `src-app/ui/**`, which a kit regression — a
submodule-pointer bump, exactly this change's shape — does not match. Both are
one-line additions and both are required for the guard to mean anything.

### DEC-14: The addon's VERTICAL containment (36px addon inside a 32px group) — fix here or report onward?

**Resolution:** [DESCOPED] as ITEM-12. Report onward.

**Basis:** convention — it is pre-existing, orthogonal to the horizontal defect
the residual recorded, caused by a different rule (the addon's `py-1.5` against
the group's `h-8`), and fixing it would change the vertical rhythm of every
`InputGroup` consumer. That is a kit change deserving its own review, exactly as
`FIX_ROUND-2` treated the horizontal defect this branch is now fixing rather than
folding it into an unrelated feature branch.

- DESCOPED: ITEM-12 — the InputGroupAddon vertical-containment defect is pre-existing, orthogonal to the recorded residual, caused by a different rule, and would change every consumer's vertical rhythm; reported onward rather than folded in, mirroring how FIX_ROUND-2 handled the horizontal defect this branch is fixing [approved: task brief scopes this branch to "the two residuals" and forbids unrelated kit changes; orchestrator carries the onward report]

### DEC-15: Round-1 made the validator read the file. That read is unbounded and blocking, on a path the sandbox can write. Cap it, or move it off the validator?

**Resolution:** Keep it on the validator (DEC-10 stands — reading IS the check),
but make the read safe: `metadata()` first (never blocks, and rejects every
non-regular file), then a `MAX_PROMPT_FILE_BYTES` = 1 MiB cap, then a bounded
`take()` read, with `O_NOFOLLOW` on the final open.

**Basis:** codebase — `workflow_workspace_root` is bind-mounted read-WRITE into
the code sandbox, so a prompt-injected model can create a FIFO there and point
`prompt_file:` at it; `open(2)` on a FIFO blocks until a writer appears, and the
validator runs on every `spawn_run`/`resume_run` with nothing cancelling it. One
per core deadlocks the server. Stat-before-open removes the whole class (FIFO,
socket, device, directory) without giving up the readability guarantee, and the
cap removes the OOM and the unbounded per-launch work. `O_NOFOLLOW` additionally
closes the canonicalize→open window: the canonical path has no symlinks left in
it, so one appearing there is exactly the attack.

- DESCOPED: ITEM-14 — template references inside a `prompt_file:` BODY are unvalidated while the identical text inline is checked; it is a TEMPLATE-reference question rather than a prompt-CONFIGURATION one, and validating file bodies would re-verdict existing installed bundles [approved: task brief scopes this branch to the two recorded residuals; recorded in DESIGN §3 and reported onward]
- DESCOPED: ITEM-15 — the kit's remaining RTL debts (combobox slide directions and item gutter) and `lint:logical-direction`'s inability to see submodule files; each is a separate change with its own blast radius across every kit consumer [approved: task brief forbids unrelated kit changes ("fix this on-system", scoped to the recorded residual); recorded in DESIGN §3 and reported onward]
