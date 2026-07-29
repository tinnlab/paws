# HUMAN_FEEDBACK — review ledger

Feedback received from the reviewing coordinator during the round, recorded as
it arrived. Each entry quotes the ask, then states how it was addressed.

**Provenance caveat:** these came through the orchestrating agent relaying the
owner's review, not directly from the owner in this session. They are recorded
as review feedback, not as owner sign-off. The Phase-9 sign-off against the
`[acceptance]` tests is still owed to the owner.

- **FB-1** [status: resolved] — "When coercion or validation FAILS, the model must get actionable feedback so it can correct itself. A silent failure, an empty form, or a bare 'invalid schema' is not acceptable… every rejection path must return a tool result whose text states three things: what was received, what is expected, and a concrete corrective example the model can copy." → Made structural rather than per-site: `common/tool_args.rs` OWNS the message construction, so a call site supplies only its literal-JSON example and cannot ship a weaker error. All four causes (not-JSON / decoded-to-wrong-type / received-wrong-type / over-the-unwrap-bound) carry the triple, and `ask_user`'s PRE-EXISTING rejections (empty `message`, oversized schema) were rewritten to match. Pinned by `every_refusal_carries_received_expected_and_example` (unit, asserts all four causes) and `ask_user_every_rejection_is_actionable` (unit, all nine `ask_user` paths). [generalizable: yes — an error-path test must assert the message is USEFUL to its consumer, never merely that an error occurred; `isError == true` is asserting the mechanism, not the outcome]

- **FB-2** [status: resolved] — "The USER must not be left staring at a dead card either. If the form genuinely cannot render, the chat surface needs to show something meaningful rather than an empty shell." → `normalizeElicitationSchema` + a dedicated no-fields card: the user now sees WHY there is nothing to fill in (including the backend's own `x-ziee-error` reason, which the UI previously minted and threw away), and the accept action is labelled "Accept without values" instead of a bare Submit that fabricated `content: {}`. Also fixed a latent render CRASH on the same path (`new Set(3)` on a non-iterable `required`, which blanked the whole chat tree). Covered by 5 vitest cases + `ask-user-degraded-schema.spec.ts`, and seeded into the gallery so the state is reviewable with real content.

- **FB-3** [status: resolved] — "Determine why the existing tests did not catch this, and close that gap — not just fix the bug… name the principle… add that CLASS of test, not merely one test pinned to the owner's exact payload." → `TEST_GAP_ANALYSIS.md`. Hypothesis CONFIRMED with evidence (all eight `schema` fixtures are `json!({...})`; zero pass a string) and one sharper mechanism found that the hypothesis did not name: the suite fed `json!("just a string")` to `stamp_ask_user_marker` and asserted it "passes through unchanged" — it tested the defect's exact input and CERTIFIED the broken behaviour. The class added is the shared conformance battery (one canonical shape distribution driven through each site's own extraction), guarded against tautology by a test requiring it to FAIL against the code as it shipped. [generalizable: yes — a fixture set is a hypothesis about the input distribution; when the producer is a language model the author's hypothesis is wrong by default, so test the producer's distribution, not the consumer's expectation]

- **FB-4** [status: resolved] — "Generalize — this is the important half." → 12 sibling call sites fixed, not just the reported one. Three were SILENT WRONG ANSWERS the user would never have noticed: `format_citations` formatting the entire library, `remove_citations` reporting "0 citation(s) deleted." as success, and `invoke_capability` running the wrong query and returning a plausible 200. [generalizable: yes — when a defect is a CLASS, audit outward across every site of that class before fixing the reported one; the reported instance is rarely the worst]

- **FB-5** [status: resolved] — "`npm run check` currently FAILS (`check:state-matrix`)… That is ITEM-18 and it blocks phase 8. Close it." → Regenerated the state matrix + testid registry for the new named render fork and added a POPULATED gallery cell (`deep-chat-elicitation-no-fields`). `npm run check` now exits 0 (verified).

- **FB-6** [status: resolved] — "Write and run the outstanding tests you enumerated honestly… make sure the tautology guard (that it FAILS against the shipped code) is itself exercised, not just asserted." → The guard is an executable test, not a claim: it drives the battery against a closure reproducing `helpers.rs:302-305` verbatim and asserts that panics. Integration tests written and RUN (16 passed / 0 failed); e2e specs written, including the deterministic OpenAI-stub acceptance proof.

- **FB-7** [status: resolved] — "I am out of subagent quota… if your own sub-agent spawns fail, do the audit yourself with deliberately adversarial framing and SAY that you did it single-handed." → A spawn was attempted and refused (200/200). `FIX_ROUND-1.md` opens with an explicit provenance section stating it is a SELF-audit, naming what that cannot cover (an author cannot see their own wrong mental model — the same failure the gap analysis documents), and recording that an independent pass is still owed. Three of the findings were caught only by RUNNING something, not by re-reading.

## Harvest candidates for the shared lifecycle skill

Three `generalizable: yes` rules above are not specific to this feature and are
offered for the orchestrator to fold into the skill:

1. **Assert the outcome, not the mechanism** — an error-path test must assert the
   message is actionable for its consumer. (From FB-1; the concrete near-miss is
   in FIX_ROUND-1: a test that read the stub's truncated echo would have passed
   on a refusal whose corrective example was cut off.)
2. **Fixtures are a hypothesis about the input distribution** — when the producer
   is an LLM, test its distribution rather than the author's imagination of it.
   (From FB-3.)
3. **A leaf's tolerance is not the system's correctness** — when a unit test
   asserts "handles a weird input without panicking", something must ALSO assert
   what that input means at the surface the user sees, or the tolerance silently
   becomes the bug. (From the `stamp_ask_user_marker` finding.)
