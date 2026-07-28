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

The root cause is that **two independent pieces of code decide, differently,
where a step's prompt comes from**: `validate.rs`'s `has_prompt`/`has_file` pair
(which normalises an empty prompt to "absent") and `dispatch.rs`'s raw
`match (prompt, prompt_file)` (which does not normalise anything).

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

## §3 Out of scope

- The `prompt: "   "` (whitespace-only) cell. Today `validate` treats it as a
  prompt and `dispatch` runs it; the two AGREE, so it is not part of this
  defect class. Changing it would be a behaviour change with no defect behind
  it (DEC-3).
- Any other kit spacing, and any other builder surface. This branch fixes the
  two recorded residuals and nothing else.
