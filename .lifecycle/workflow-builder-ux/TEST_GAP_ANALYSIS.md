# Why nothing caught this

The owner opened `/settings/workflows/:id/edit` and found four defects in one
screen. The workflow builder is not untested — it has **7 e2e specs**, a
**gallery entry**, a **coverage record**, and it passes `npm run check` and
`gate:ui`. Every one of those gates was green while the defects were live.

This is the analysis of how, with concrete evidence per gate.

---

## The four defects, and what each gate said about them

| Defect | e2e | gallery/design review | 24/7 rig | `npm run check` |
|---|---|---|---|---|
| Tool name typed from memory | **asserted it as correct** | never rendered | never visited | n/a |
| Arguments invented by hand | **asserted it as correct** | never rendered | never visited | n/a |
| `step has neither prompt: nor prompt_file:` | never asserted any message | **reviewed a prettier fake** | never visited | n/a |
| Finding not attributed to a step | never asserted attribution | reviewed with no steps seeded | never visited | n/a |

---

## Gap 1 — the e2e spec asserted the defect *as the desired behavior*

`src-app/ui/tests/e2e/workflows/builder-step-kinds.spec.ts` did not miss the tool
step. It drove it, and asserted it was right:

```ts
// Typed fields, NOT a raw JSON box: a server Select (combobox), a tool
// Input, and a key/value argument editor.
await expect(byTestId(page, 'wf-builder-tool-name')).toBeVisible()
await byTestId(page, 'wf-builder-tool-name').fill('search')
```

The spec's own comment names the standard it was checking: **"not a raw JSON
box."** That was the previous round's defect, and against it the free-text field
was an improvement. So the test encoded *"better than the last defect"* as
*"correct"*, and from then on the free-text field was **protected by a passing
test**. Any agent who later changed it to a picker would have broken a green
spec and, most likely, changed it back.

**The generalizable failure: a test written to confirm a fix is a test written
to the fix's ceiling.** "Not a JSON blob" and "not typed from memory" are
different bars; the spec asserted the mechanism it had just built rather than
the outcome the user needs.

**What this branch did about it:** the spec is rewritten to assert the picker
(and, since its seeded server URL is unreachable, the documented fallback), and
the rule is pinned by a **class** test rather than a field test —
`noFreeTextEntityRef.test.ts` scans **every** builder step form for a free-text
control bound to any field the system can enumerate (`server`, `tool`, `model`,
`assistant`, `flavor`). A future step form that adds a free-text `model` field
fails it. It carries a negative control asserting the scanner still catches the
exact pre-change shape, so it cannot rot into a vacuous pass.

## Gap 2 — the gallery fixture was *nicer than reality*

The design-critic pass reviews gallery screenshots. For workflow validation it
was reviewing this (`src-app/ui/src/modules/workflow/gallery.tsx`, before):

```ts
errors: [{
  code: 'unresolved_reference',          // ← no such code exists
  layer: 'graph',                        // ← no such layer exists
  message: 'Step "Summarise the findings" references {{ agent_1.output }}, but the
            agent step produces no named output — give the agent a Structured
            output or reference its text result.',
}]
```

Every part of that is invented. The backend's real codes are all `WORKFLOW_*`
with layers `schema|semantic|security`, and its real message for the owner's case
is `step has neither prompt: nor prompt_file:`. **The fixture was written in the
voice the product should have had.** A reviewer looking at that screenshot sees
a well-written, human, specific error and correctly concludes the validation
panel is fine — while the live app renders wire vocabulary.

A fixture that flatters the product hides the exact defect the review exists to
find. This is worse than having no fixture: it actively produced a false pass.

**Fixed:** the fixture now carries verbatim `validate.rs` / `ref_check.rs`
findings, and a Rust test (`humanisation_contract`) fails the **backend** suite
if any code the validator can emit lacks author-facing copy in the UI — so the
copy cannot silently regress and a NEW code cannot ship raw.

## Gap 3 — a `via` coverage claim that nothing verifies

`src/dev/gallery/coverage.ts` recorded:

```ts
"modules/workflow/components/builder/ToolStepForm": { kind: 'via',
  reason: 'workflow builder/run component - covered via the seeded-wf-builder-*
           gallery surfaces + the 11-workflows builder e2e + gate:ui 193/193' }
```

The only populated builder surface seeded `agent → llm → elicit → sandbox` and
selected `agent_1`. **There was no tool step in it**, so `StepConfigPanel` never
dispatched to `ToolStepForm` and no gallery cell ever rendered it. The claim was
false, and `check:gallery-coverage` cannot detect that: it verifies an ENTRY
EXISTS for every surface, never that the named surface actually renders it.
`kind: 'via'` + a prose `reason` is **self-attestation**, and the reason string
even cites a passing gate ("gate:ui 193/193") as evidence for a claim that gate
never evaluated.

Same shape, one layer over: `seeded-wf-builder-validation-error` seeded
`validation` but **no `def`**, so every finding resolved to "Whole workflow". The
surface that exists to review the validation panel could not have shown a
step-attributed finding even if attribution had worked — which is also why
nobody noticed attribution was missing.

**Fixed:** the populated def now contains a tool step; two dedicated surfaces
render the tool form (schema-driven + fallback); a new
`seeded-wf-builder-problems` surface renders the step list WITH its invalid
markers; and the validation fixture seeds its def.

**Not fixed (recommended):** `kind: 'via'` should name the covering surface slug
in a checkable field rather than free prose, so the gate can assert the cited
surface exists and imports the component. Today the strongest part of the
coverage system is a comment.

## Gap 4 — the 24/7 rig has never opened this page

`agent-kit/skills/live-ui-audit/live-ui-audit.mjs` enumerates routes explicitly.
It has:

- `['settings-workflows', '/settings/workflows']` (:476) — the LIST page
- `['settings-workflows-admin', '/settings/workflows-admin']` (:722)

and **zero matches for `builder`**. Neither `/settings/workflows/builder` nor
`/settings/workflows/:id/edit` is in the list. The rig that runs continuously
against the live app has never rendered the surface the owner was looking at.

A hand-maintained route list silently omits every route added after it was
written. Nothing reconciles it against the router.

**Recommendation (descoped here — DEC-9, it lives in the `agent-kit` submodule
and a pointer bump would collide with 16 sibling branches):** add the two
builder routes, and, more durably, derive the rig's route list from the app's
registered routes so a new page is visited by default and omission is opt-out.

## Gap 5 — no detector in any rig is *semantic*

Even had the rig visited the page, it would have passed it. Its finding
categories are entirely mechanical:

`console-error` · `page-error` · `request-failed` · `contrast` · `a11y-name` ·
`overflow-x` · `broken-image` · `zero-size-control` · `clipped-control` ·
`control-collision` · `palette-drift` · `spacing-grid` · `mixed-variant` ·
`stuck-loading` · `network/*` · `permission/*`

A free-text field where a picker belongs is a perfectly-rendered, accessible,
correctly-contrasted, correctly-spaced input. Developer vocabulary leaking into
user copy is a correctly-contrasted string. **Neither is expressible in that
vocabulary**, and I do not think either should be a runtime detector — they are
static properties, better caught where this branch now catches them (a source
scan for the picker rule; a cross-language contract test for the copy rule).

The honest conclusion: **the automated rigs can only find defects of rendering,
never defects of judgment.** The judgment layer is the design-critic vision pass
— which is why Gap 2 matters so much. It was the one gate positioned to catch
defects 3 and 4, and it was fed a fixture that had already fixed them.

## Gap 6 — no test ever read a validation message

Across all 7 builder e2e specs, `wf-builder-errors` is referenced **zero** times.
The only validation assertion in the whole suite is the helper:

```ts
export async function waitBuilderValid(page: Page) {
  await expect(byTestId(page, 'wf-builder-valid')).toBeVisible({ timeout: 20000 })
}
```

— i.e. every spec asserts only the ABSENCE of errors, because errors are an
obstacle on the way to testing something else. The error path is the one a
struggling user actually lives in, and it had no coverage at all. Backend-side,
`WORKFLOW_PROMPT_MISSING` had no test either (only `WORKFLOW_TOOL_NO_SERVER`
asserts a code).

**Structural cause:** tests are written along the happy path because that is what
"the feature works" means to the author. The failure path needs to be an explicit
deliverable, not a byproduct.

---

## What would have caught it, ranked

1. **A populated render of every surface, reviewed against real data** — the
   single highest-value fix. Three of the four defects are visible in one
   screenshot of a tool step with real arguments and a real validation error.
   The lifecycle already requires this ("Populated-render review"); it was
   satisfied on paper by a fixture with no tool step and no def.
2. **Fixtures must be real** — a fixture's data should be copied from, or
   generated by, the actual producer. Where that is impossible, a contract test
   should tie them together (this branch's `humanisation_contract` is the
   pattern: the backend test fails if the UI cannot say what the backend emits).
3. **Rules encoded as class tests, not instance tests** — "this field is a
   picker" protects one field; "no enumerable field is free text" protects the
   rule. The second costs about the same to write.
4. **Coverage claims must be machine-checkable** — `kind: 'via'` with prose is a
   promise; it should name a slug the gate can verify.
5. **Route lists derived, not hand-maintained** — omission should be opt-out.
6. **Failure-path coverage as a deliverable** — for each surface, at least one
   test that reads what the user is told when something is wrong.

## The uncomfortable summary

Every gate did what it was built to do. The defects survived because:

- the **e2e** asserted the implementation, not the need;
- the **fixture** described the product we intended, not the one we shipped;
- the **coverage record** was self-attested prose citing an unrelated gate;
- the **rig** never had the route, and could not have judged it anyway.

None of these is a missing test. All four are tests, fixtures, and records that
were **written from the builder's point of view rather than the user's** — which
is exactly the same fault as the feature itself, where the tool name and the
argument keys were asked of the user because they were easy for the code to
accept.
