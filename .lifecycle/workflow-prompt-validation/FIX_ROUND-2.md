# FIX_ROUND-2 — workflow-prompt-validation

Input: five blind agents over 17 angles against the round-1 tree —
**116 rows: 76 confirmed, 40 explicitly rejected** (`ledger-round2-{a..e}.jsonl`).

Round 2 was the round that mattered most. It found that round 1 shipped a
**failing test**, that its central security fix had opened a denial-of-service,
that half of the new acceptance test could not fail, and that the one CI change
meant to catch this defect class was inert. Two independent agents reached the
first two findings by different routes.

---

## The branch was RED and I had not seen it

`validation_codes_are_registered_and_humanised` — this module's own crate-wide
drift guard — **failed**. Round 1 replaced literal `ValidationError::at("security",
"WORKFLOW_PROMPT_FILE_UNSAFE", …)` sites with computed `e.layer()`/`e.code()`.
The guard parses those call sites TEXTUALLY to prove every emitted code is
registered and has author-facing copy; a computed argument is invisible to it, so
the three `WORKFLOW_PROMPT_FILE_*` codes silently dropped out of BOTH halves —
while ITEM-13 was rewording one of them.

I did not see it because I ran `cargo test -- workflow::validate::tests
workflow::dispatch::tests` and the guard lives in a sibling module
(`validate::humanisation_contract`). **A filter chosen to be "scoped to what I
touched" was scoped to the wrong thing**: the tests that cover a change are not
the tests that live next to it. Every run since is unfiltered at the module level
(`-- workflow::`).

→ Fixed with `prompt_file_finding()`, a `match` whose every arm calls
`ValidationError::at` with LITERAL layer/code arguments, and a comment saying why
it may not be collapsed into the computed form.

## The FIX_ROUND-1 security fix opened a denial-of-service

Making the validator READ the file (DEC-10) was right, but the read was
unbounded, un-timed, and preceded by nothing:

- `open(2)` on a **FIFO** blocks until a writer appears. `workflow_workspace_root`
  is bind-mounted **read-write into the code sandbox**, so a prompt-injected model
  can `mkfifo prompts/p.md`, point `prompt_file:` at it, and call the
  `validate_from_workspace` MCP verb: canonicalize succeeds, confinement passes,
  the open never returns. Once per core and the HTTP server is gone —
  permanently, since nothing cancels it.
- An 8 GiB file OOM-kills the process instead. And the validator runs on EVERY
  `spawn_run`/`resume_run`, so the work is author-controlled and repeated.

→ Fixed by **stat-before-open**: `metadata()` (which never blocks) must report a
REGULAR file — rejecting FIFOs, sockets, devices and directories before anything
is opened — then a `MAX_PROMPT_FILE_BYTES` (1 MiB) size check, then a bounded
`take()` read that stays bounded even if the file grew after the stat, then
UTF-8. The final open uses `O_NOFOLLOW` on unix, which also closes the
canonicalize→open TOCTOU the agents flagged: the canonical path has no symlinks
left in it by construction, so one appearing there IS the attack.

Also hardened the shape check, which was Unix-shaped: `..`, a leading `/`, ANY
backslash, and a `X:` drive prefix are all refused, on every platform. A bundle
authored on one OS is validated and run on another; `Path::is_absolute()` would
have given a different answer on each.

## Half of the acceptance test could not fail

The design-conformance agent ran the mutations rather than reasoning about them:

| mutation | round-1 result |
|---|---|
| kit addon variants back to the physical negative margins | LTR red — **both RTL cases PASSED with the defect fully restored** |
| root clearance `ps/pe-1.5` → `pl/pr-1.5` (reverts ITEM-9 entirely) | **5/5 PASSED** |
| `prompt_file_ref` trims instead of `is_empty()` | **not caught** |

The RTL legs were asserting the same property as the LTR legs — a physical margin
does not overflow under RTL, so they could only ever restate what LTR already
proved, and the RTL regression ITEM-9 exists to fix had NO guard.

→ The RTL legs got their own subject: the control's inline padding must be
TIGHTENED on the addon's side, measured in the writing direction. `InputGroup`
picks that side from the LOGICAL `data-align`, so applying it physically is
invisible in LTR and lands on the wrong side in RTL — exactly what only an RTL
render can falsify. Getting this right needed a measurement, not a guess: my first
version asserted the padding was LARGER on the addon side and went red against
correct code, because the group TIGHTENS there (the addon supplies the gap).
Measured −4 (10px base → 6px) in both directions when correct; +4 in RTL when
physical.
**Proven falsifiable**: reverting ITEM-9 now fails both RTL cases and neither LTR
one — precisely the mutation that used to pass 5/5.
→ `prompt_source`'s file half gained its own whitespace cell in TEST-2, so a
`trim()` creeping into either half is now red.

## The CI change was inert

`visual-tests.yml` gained `sdk` in its path filter so a kit gitlink bump triggers
the visual job — but the job's `actions/checkout@v4` has no `submodules:
recursive` (three sibling workflows set it). Root `package.json` globs
`sdk/packages/*` as npm workspaces and the lockfile links `@ziee/kit` there, so
with `sdk/` empty `npm ci` cannot complete and the Playwright config cannot even
load. The one CI change made to catch this defect class fired a job that
structurally could not run.

→ `submodules: recursive` added, with the reason in a comment so it is not
"tidied" away.

## The conversion was not complete

`command.tsx` overrides the addon slot with `*:data-[slot=input-group-addon]:pl-2!`
— a physical `padding-left` with `!important`, keyed off the very logical slot the
fix had just converted. Measured live: in LTR it beat `has-[>button]:ps-1`, so the
tightening was dead inside any `CommandInput`; in RTL `ps-2` resolved to
`padding-right` while `pl-2!` still painted `padding-left` and the two **stacked**
— the search-icon addon rendered 32px in RTL against 24px in LTR, with a spurious
8px gap. The kit comment named "physical padding does not flip under RTL" as the
reason for the fix and then left the only in-tree override of that slot physical.

→ `pl-2!` → `ps-2!`.

## Smaller confirmed fixes

- `Missing`/`Both` messages were hand-written a second time in `dispatch.rs`,
  duplicating `validate.rs` — the exact drift shape this branch exists to remove,
  reintroduced by round 1's own error-message split. Both now read
  `PROMPT_{BOTH,MISSING}_MESSAGE` from one definition.
- `StepConfig::prompt_source()` added: calling `prompt_source(a, b)` directly puts
  two adjacent, same-typed, opposite-meaning arguments at every call site, and
  swapping them compiles.
- `prompt_codes_list_covers_…` scanned validate.rs INCLUDING its own test module,
  so it compared the tests to themselves. Rebased onto `VALIDATION_CODES`, the
  module's canonical registry (which `humanisation_contract` already proves
  complete). This one was mine and it was genuinely broken — the naive fix
  (splitting the source at the first `#[cfg(test)]`) kept 16 KB of 156 KB and
  found zero codes.
- Two comments in this branch contradicted each other about whether the runner may
  assume validation ran. Both rewritten to state the actual position: `spawn_run`/
  `resume_run` DO re-validate, `POST /workflows/{id}/test` does NOT, so the runner
  may not treat validation as a precondition — and the double-checking on the
  common path is what makes the remaining window not a trust boundary.
- Three builder forms still described `load_raw_prompt` matching
  `(Some,None)/(None,Some)` and failing with "invalid prompt config" — code this
  branch deleted. Rewritten. `validationCopy.ts` cited `check_prompt_files` for a
  reject that moved to `check_prompt_file_shape`. `gallery.tsx` cited three
  `validate.rs:NNN` line numbers that this branch shifted; replaced with function
  names, which do not rot.
- `promptField`'s doc claimed to mirror `prompt_source` while using
  `.trim().min(1)`. It is deliberately STRICTER on the inline half (a
  whitespace-only prompt is a typo, and catching it in the FORM is safe where
  catching it in the backend would not be). Now stated, with both whitespace cases
  spelled out.

## Explicit rejections (the ones worth naming)

- **"The empty-file rejection is only caught by a hard-coded count, not the
  implication"** — correct, and correct BY DESIGN. Removing that check leaves both
  sides agreeing (they share the rule), so the implication genuinely still holds;
  what changed is how many states legitimately run, which is what `ran_ok == 18`
  measures. The agent's own mutation table confirms the count fired.
- **"TEST-1 does not catch the DIRECTION-inverting mutation"** — also correct and
  by design. TEST-1 asserts AGREEMENT (the invariant); the DIRECTION is asserted
  by TEST-2/TEST-3, which do go red. One test per promise.
- **"`/validate-def` still shows a green panel for a bad `prompt_file:`"** — real,
  and deliberately so: the draft surfaces have no bundle, and answering that
  question there is what `workflow-builder-ux` FIX_ROUND-4 removed as a FALSE
  finding (it disabled Save on every `prompt_file:` workflow). Now stated in
  DESIGN §3 as a known boundary rather than left to be rediscovered.
- **Template refs inside a prompt-file BODY** are unvalidated while the identical
  text inline is checked — a genuine adjacent defect, but a TEMPLATE-reference
  question rather than a prompt-CONFIGURATION one, and fixing it re-verdicts
  existing bundles. [DESCOPED] ITEM-14, recorded and reported onward.
- **The kit's other RTL debts** (`combobox.tsx` slide directions, item gutter) and
  the fact that `lint:logical-direction` cannot see submodule files at all —
  each a separate change with its own blast radius. [DESCOPED] ITEM-15.
- **`job_kind_parses_round_trips_and_is_orthogonal` fails.** NOT this branch:
  `models.rs` and `job_kind.rs` are byte-identical to `origin/feat/agent-core`
  (whole-file `diff` against the base blob), and the failure is a `JobKind` serde
  variant-name mismatch (`subagent` vs `sub_agent`) with no relation to prompts.
  Pre-existing on the integration line; reported onward, not silenced.

**New confirmed findings:** 76
