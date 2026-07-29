# DESIGN — workflow-prompt-validation

Two defects the `workflow-builder-ux` blind audit found, judged out of scope for
that branch's design, and **recorded rather than silently fixed**. This document
is the design they are now being fixed against; it is derived entirely from the
two upstream records, quoted below.

Upstream records (on `origin/feat/agent-core`):

- `.lifecycle/workflow-builder-ux/FIX_ROUND-8.md` — "HIGH — the builder's own
  remedy produced a workflow that fails at run"
- `.lifecycle/workflow-builder-ux/FIX_ROUND-2.md` — "The test that could not
  fail" (the kit combobox addon overflow it uncovered)
- `src-app/ui/tests/e2e/workflows/builder-responsive.spec.ts` —
  `MAX_TOLERATED_OVERFLOW_PX`'s doc comment, which states the exit condition

---

## §1 The validate/dispatch disagreement

FIX_ROUND-8 recorded, verbatim:

> Clearing fired `patch({ prompt: v })` with `v = ''`. `Object.assign` wrote it
> through and `toWorkflowDef` serialised it verbatim. The backend then reads
> `Some("")` as **no typed prompt** (`validate.rs:681` —
> `prompt.as_ref().filter(|s| !s.is_empty())`), so:
>
> - `WORKFLOW_PROMPT_BOTH` clears,
> - `WORKFLOW_PROMPT_MISSING` does not fire (because `has_file` is true),
> - the panel goes **green** and Save is **enabled**,
> - `skip_serializing_if = "Option::is_none"` means `Some("")` **is** written to
>   `workflow.yaml`,
> - and `dispatch.rs::load_raw_prompt`, which matches only `(Some,None)` and
>   `(None,Some)`, hits its `_` arm and fails the **RUN** with
>   `step 'llm_1' has invalid prompt config` — for `llm`, `llm_map` and `agent`.
>
> So the builder instructed the author into a workflow that validates clean and
> then breaks.

Round 8 fixed the BUILDER (a cleared box now writes `null`). It did **not** fix
the backend disagreement, which is reachable by any hand-authored or imported
`workflow.yaml`, and which is a *class*, not a single cell:

| state | `validate` today | `load_raw_prompt` today |
|---|---|---|
| `prompt: "" ` + `prompt_file: p` | GREEN | Err "invalid prompt config" |
| `prompt: ""` alone | RED (`WORKFLOW_PROMPT_MISSING`) | Ok("") — runs an empty prompt |
| `prompt_file: ""` alone | GREEN (`has_file = is_some()`; `join("")` = the bundle dir, which exists) | Err "read prompt_file '': Is a directory" |
| `prompt_file: <a directory in the bundle>` | GREEN (existence-only check) | Err "Is a directory" |
| `prompt_file: <a real but non-UTF-8 file>` | GREEN (existence-only check) | Err "stream did not contain valid UTF-8" |
| `prompt_file: "prompts/../prompts/real.md"` | RED `WORKFLOW_PROMPT_FILE_UNSAFE` | **Ok** — bare `bundle_root.join(rel)`, no shape or confinement check at all |
| `prompt_file: <a symlink out of the bundle>` | RED `WORKFLOW_PROMPT_FILE_ESCAPE` | **Ok** — same |
| `prompt_file: <a zero-byte file>` | GREEN | Ok("") — ships the empty prompt to the model that the inline half refuses |
| `prompt: "x"` + `prompt_file: ""` | RED `WORKFLOW_PROMPT_BOTH` | Ok("x") |
| `prompt_file:` over 1 MiB | GREEN | Ok — an author-controlled read on every launch |
| `prompt_file: "a\\b.md"` / `"C:\\x"` | GREEN on Linux (only `..` and a leading `/` were refused) | Ok / Err depending on the host OS |

The last two rows are additional REJECTIONS this fix introduces, listed so they
are part of the design rather than a side effect: a size cap (the validator reads
every prompt file on every launch, so an uncapped read is author-controlled work
and memory), and a platform-independent shape check (a bundle authored on one OS
is validated and run on another, so a Windows-absolute path must be refused on
Linux too). Both re-verdict a definition that used to install — see DEC-11's
reasoning, which applies unchanged.

That last row is the one verdict this fix deliberately RELAXES rather than
tightens: an empty path is not a second prompt source, so the step is simply an
inline prompt, and the two sides agree on it afterwards. It is listed here so the
relaxation is part of the design rather than a side effect (DEC-5).

The last four rows were found by this branch's own phase-6 blind audit, not by the
original residual report. They are the SAME defect — two places deciding
separately — one level down: the reported cells are about which FIELD supplies the
prompt, these are about whether the named FILE can be used. Closing only the
reported cells would leave the class open and make the acceptance test assert a
promise the code does not keep. Note the `..`/symlink rows are validate-RED /
run-OK, i.e. the SECOND half of the invariant, and they are reachable with no
validation at all: `POST /workflows/{id}/test` dispatches without calling
`validate_for_install`.

The root cause is that **two independent pieces of code decide, differently,
where a step's prompt comes from and whether it can be used**: `validate.rs`'s
`has_prompt`/`has_file` pair plus its existence-only file check, and
`dispatch.rs`'s raw `match (prompt, prompt_file)` plus its unchecked
`bundle_root.join(rel)`.

### The non-negotiable

**Validation must be at least as strict as dispatch.** A definition the
validator reports GREEN must not fail at run for a prompt-configuration reason;
and a definition the validator reports RED must not quietly succeed at run with a
degenerate prompt. The two sides must derive the prompt source from ONE shared
rule, so they cannot drift again.

### Direction

`validate.rs`'s semantics ("an empty prompt is not a prompt") is the canonical
one — it predates the branch, the round-6/7/8 client mirror and the author-facing
copy are all written against it, and the alternative (making `validate` reject
`prompt: ""` beside a `prompt_file:`) would re-create the false red on exactly
the state the builder's own remedy produces. So **dispatch moves to validate's
rule**, via a shared function both call. See DEC-1/DEC-2/DEC-3.

## §2 The kit combobox addon overflow at 390px

`builder-responsive.spec.ts` recorded, verbatim:

> at 390px the kit combobox's `InputGroup` inline-end addon
> (`sdk/packages/kit/src/shadcn/{combobox,input-group}.tsx`, `role="group"
> data-slot="input-group-addon" data-align="inline-end"`) renders 4px past its
> own group, so the step-config panel reports `scrollWidth 370 / clientWidth
> 366`. It is in the KIT, not in this feature's files.
>
> Bounded at exactly that 4px so it cannot silently grow: a 5px regression, and
> anything that genuinely clips content, still fails. **Lower this to 1 once the
> kit addon is fixed.**

Measured in this worktree against the gallery (recorded in
`REPRO.md`): every `[data-slot="input-group"]` reports `scrollWidth - clientWidth
= 5`, and the inline-end addon's right edge sits **3.8px past the group's
border-box right edge** — at 1280px as well as 390px, because the cause is a
fixed negative margin, not a breakpoint.

Cause: `inputGroupAddonVariants`' `inline-end` variant is
`order-last pr-2 has-[>button]:mr-[-0.3rem] has-[>kbd]:mr-[-0.15rem]`. In a flex
row a negative `margin-right` on the last item shrinks its outer size, so its
border box ends `|margin|` past the container's content box — an overflow that is
present unconditionally, forces a horizontal scrollbar on any `overflow-auto`
ancestor, and poisons every ancestor-chain overflow probe. `-0.3rem` / `-0.15rem`
are also off-grid arbitrary values, which the design system forbids.

### The non-negotiable

The addon must sit **inside** its group. Fix it on-system — grid-aligned
(4px-base, kit 2px half-steps) logical-direction padding, not a magic offset —
and return `MAX_TOLERATED_OVERFLOW_PX` to 1.

### §2 scope note (amended after the phase-6 audit)

The `inline-end` addon is the one the residual named, but the two inline variants
are written as a symmetric PAIR in one `cva` block and carried the same defect, so
both are fixed — guarding one alone lets the other rot. Converting the addon's own
padding to logical properties additionally EXPOSED a latent bug one line above it:
`InputGroup`'s root compensates the input with PHYSICAL `pl`/`pr` keyed off the
LOGICAL `data-align`, previously masked by the addon's own physical padding.
Measured in `dir=rtl`, that left the input's clearance on the side AWAY from the
addon. It is in scope because this change is what made it observable.

## §3 Out of scope

- The `prompt: "   "` (whitespace-only) cell. Today `validate` treats it as a
  prompt and `dispatch` runs it; the two AGREE, so it is not part of this
  defect class. Changing it would be a behaviour change with no defect behind
  it (DEC-3).
- The `InputGroupAddon`'s VERTICAL containment (its `py-1.5` makes it 36px tall
  inside a 32px group). Real, pre-existing, and orthogonal to the horizontal
  defect the residual recorded — reported onward rather than folded in, exactly
  as FIX_ROUND-2 did for the defect this branch is now fixing.
- **The DRAFT-validation surfaces' file verdicts.** `POST /validate` and
  `POST /validate-def` deliberately pass a bundle root that does not exist, so
  `check_prompt_files` SKIPS every question that needs a real bundle. A bad
  `prompt_file:` therefore still shows a green panel there and fails later. That
  is not this defect: answering it in the draft surfaces is what
  `workflow-builder-ux` FIX_ROUND-4 removed as a FALSE finding (it reported
  `WORKFLOW_PROMPT_FILE_MISSING` for every `prompt_file:` step and permanently
  disabled Save), and install/`spawn_run`/`resume_run` re-validate authoritatively
  against the real bundle. The shape check, which needs no bundle, DOES run there.
- **Template refs inside a `prompt_file:` BODY.** An inline `prompt:` is scanned
  by `check_template_refs`; a prompt file's contents are not, so
  `{{ inputs.missing }}` in a prompt FILE validates green and fails at render.
  Adjacent and real, but a TEMPLATE-reference question rather than a
  prompt-CONFIGURATION one, and fixing it would pull template validation into
  this branch and re-verdict existing bundles. [DESCOPED] as ITEM-14; reported
  onward.
- **The kit's other RTL debts** — `combobox.tsx`'s physical slide directions keyed
  off a logical `data-[side=inline-*]`, its item gutter, and the fact that
  `lint:logical-direction` cannot see submodule files at all (it diffs the parent
  repo), so DESIGN_SYSTEM's "enforced on new/changed code" claim does not hold for
  the kit. Real, pre-existing, and each is a separate change with its own blast
  radius. [DESCOPED] as ITEM-15; reported onward.
- Any other kit spacing, and any other builder surface. Beyond the two residuals,
  this branch changes only what its own fix made wrong or left unguarded.
