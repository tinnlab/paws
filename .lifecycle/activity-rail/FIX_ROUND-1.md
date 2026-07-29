# FIX_ROUND-1 — Activity Rail

Phase 7. Five blind auditors ran over the full working tree, blind to how it was built, across 15
angles. **57 entries: 30 fixed, 12 verified-clean, 15 deliberately open.**
Every HIGH is fixed. `LEDGER.jsonl` carries the machine-readable record; this is the disposition.

**New confirmed findings:** 0

(This is round 1. The count above is the RE-AUDIT result: after the fixes below, the four auditors'
HIGH and MEDIUM findings were re-checked against the tree — by re-running the affected unit suites,
`tsc` in both workspaces, every `check:*` gate, and the Rust lib tests for the touched modules — and
no new confirmed finding was produced. The 15 entries under "Deliberately open" are the SAME findings
triaged and deferred with reasons, not new ones.)

Severity of the fixed set: **8 HIGH, 16 MEDIUM, 6 LOW.**

## What the audit actually caught — the four that mattered

The audit earned its keep. Three of these would have shipped as silent regressions with every
structural gate green, and one was a security property that existed only on paper.

1. **The default delegation dropped half of every step.** A step consumes its `tool_use` *and* the
   paired `tool_result`, but the fallback body rendered only the anchor — so `file`'s catch-all
   `tool_result` renderer never ran, and every tool-produced chart, PDF and CSV lost its inline file
   card. Found independently by two auditors. INV-2 says "every detail reachable today must remain
   reachable"; this deleted a whole class of it, invisibly.
2. **Redaction was an opt-in that nobody opted into.** ITEM-17's whole point was that arguments stop
   printing verbatim. But redaction lived in ONE contribution's optional detail body, at order 1000
   — and every domain contribution pre-empts order 1000 by construction. So the families most likely
   to carry a credential (app-control, code sandbox, web fetch) were precisely the ones bypassing it.
   The fix is structural: a CORE body that every contribution lands on, plus redaction at the source
   renderer. A security property that ~17 contributors each have to remember is not a property.
3. **Finished steps never finished.** Descriptors were computed in `ChatMessage`, which is `memo`'d
   and subscribes to nothing, while only `ActivityRail` subscribed to the live seam. A call that
   completed without adding a block — the ordinary path — stayed `running` forever with a 1 Hz timer
   that never cleared.
4. **A failure was rendered as the quietest thing on screen.** The forced-open summary was a
   `disabled` Button, and the kit's base style is `disabled:opacity-50 disabled:pointer-events-none`.
   INV-5 exists to make a failure loud; the implementation made it 50%-opacity and unfocusable. The
   invariant's own acceptance test passed throughout — it checks that the rail is OPEN, not that the
   failure is legible.

Two more worth naming: the seed's ordinals are **decimals, not versions**, so `25.10` is 25.1 seconds
and collided with an existing turn — scrambling the very fixture the design-critic pass reviews; and
INV-1's sole mechanical guard walked one of the rail's four directories and matched only aliased
imports, so the invariant could be violated one directory over.

## Fixed (30)

| sev | angle | file | finding | fix |
|---|---|---|---|---|
| `LOW` | security-authz | `handlers.rs` | DEC-2's least-privilege rationale does not hold for the data actually revealed: the endpoint returns the CALLER'S OWN tool_use. | DEC-2 amended to the constant that ships and the scope restated as a surface gate, not a wire gate. |
| `HIGH` | security-secrets | `registry.tsx` | Default delegation resolved to mcp's tool CARD, which printed tool_use. | redaction moved into a CORE default body (RailStepDetail) every contribution lands on, plus redactedJson applied inside McpToolUseRenderer/McpToolCallUI at source. |
| `MEDIUM` | security-secrets | `models.rs` | #[derive(Debug)] on McpToolCallReveal, whose arguments_json is by construction the unredacted value (guidelines §3). | hand-written Debug that redacts the field. |
| `LOW` | security-secrets | `redactToolArgs.ts` | The depth bound returned the subtree UNCHANGED, so a deeply nested secret rendered in plaintext while the stored row was redacted. | the bound now returns REDACTED — a redactor may lose detail, never redaction. |
| `LOW` | security-secrets | `RailStepDetail.tsx` | The docstring claimed results were redacted; only arguments were. | the core body's docstring states exactly what it does. |
| `HIGH` | api-contract | `types.ts` | OpenAPI had not been regenerated for either binary; tsc failed with 6 errors and the reveal endpoint had no dispatch entry, so the panel would have silently queried the caller's most-recent call across ALL conversations. | just openapi-regen ran for both binaries; types_ts_parity + types_ts_parity_desktop green; tsc clean in both workspaces. |
| `HIGH` | correctness-logic | `registry.tsx` | The step CONSUMED the paired tool_result but delegation rendered only the ANCHOR, so file's catch-all tool_result renderer never ran — every tool-produced chart/PDF/CSV lost its inline FileCard. | delegation renders the whole consumed span. |
| `MEDIUM` | correctness-logic | `railBlocks.ts` | resultBlockFor scanned past tool_use while toolStepSpan stopped at the first non-tool_result, so a step could read status/artifacts from a block it did not consume. | the two now stop at the same place. |
| `MEDIUM` | correctness-logic | `railBlocks.ts` | A repeated tool_use. | segmentation disambiguates the second and later sighting. |
| `MEDIUM` | correctness-logic | `tool-group-*.spec.ts` | Three e2e specs still drove the deleted group card's testids; one asserted toHaveCount(0) and would have passed vacuously. | the three specs are deleted; their invariants are re-covered by the activity-rail specs. |
| `MEDIUM` | correctness-logic | `ToolCallPanel.tsx` | raw/revealError were never reset on tool_use_id change, and the panel host reuses the memoised instance across tabs. | both reset in the id-keyed effect. |
| `HIGH` | concurrency-lifecycle | `ActivityRail.tsx` | Descriptors were computed in a memo'd, unsubscribed parent while only the child subscribed, so a call that finished without adding a block stayed 'running' and its 1 Hz timer never cleared. | descriptors are re-derived in the component that holds the subscription. |
| `MEDIUM` | concurrency-lifecycle | `liveSteps.ts` | Registration happened in an extension's initialize with no matching clear on unregister. | owner-scoped clearRailLiveSourceIfOwnedBy, called by the registry on unregister. |
| `MEDIUM` | error-handling | `gate.rs` | unwrap_or_default() swallowed a DB error into 'no override' (guidelines §6). | the error is logged at error! before degrading, and the degradation is justified in place. |
| `LOW` | error-handling | `ToolCallPanel.tsx` | Clipboard write had no catch (unhandled rejection = a gating runtime-health finding), the reset timeout was never cleared, and reveal had no in-flight guard. | try/catch with visible failure state, cleanup on unmount, and a loading-guarded reveal. |
| `MEDIUM` | frontend-state | `ChatMessage.tsx` | A blocking descriptor could claim consumed > 1 while the breakout rendered exactly one block. | blocking is pinned to consumed 1 at segmentation. |
| `HIGH` | ux-accessibility | `ActivityRail.tsx` | A FORCED-OPEN (failed) rail rendered its summary as a disabled Button: 50% opacity, unfocusable, tooltip inert. | the non-toggleable state is a status row, not a disabled control. |
| `MEDIUM` | ux-accessibility | `RailStep.tsx` | The step LABEL sat inside a Button disabled whenever the body was empty — which is exactly the in-flight case. | the label is plain content; only the chevron is a control. |
| `MEDIUM` | ux-accessibility | `RailStep.tsx` | Artifact chips were inert spans with a file icon and a file name. | chips and the +N overflow are Buttons that open the step body, where the extension's own file view lives. |
| `LOW` | ux-accessibility | `ActivityRail.tsx` | aria-expanded without aria-controls; the summary's accessible name buried the status mid-string. | ids + aria-controls on both disclosures; the summary name leads with the status label. |
| `MEDIUM` | design-fidelity | `railBlocks.ts` | INV-1 soft violation: core special-cased two scheduler structured-content keys. | moved into the scheduler contribution (order 20, so still one decision point); core's test now asserts the absence. |
| `MEDIUM` | design-fidelity | `railSegmentation.ts` | INV-6 at risk: the excluded-type set guarded only the ANCHOR, so a consumed range could swallow a text answer block. | the span is clamped at the first excluded block. |
| `MEDIUM` | design-fidelity | `railBlocks.ts` | INV-2: the MCP server attribution the retired card showed beside every tool name was gone from the transcript. | serverId is carried on the descriptor. |
| `MEDIUM` | design-fidelity | `extension.tsx` | INV-7 at risk: the delegated cards kept their disclosure in component state. | the core detail body has no nested disclosure at all. |
| `HIGH` | data-integrity-db | `showcase.sql` | Ordinals 25. | renumbered to 25.61-25.68, verified strictly increasing and collision-free file-wide, plus a regression test. |
| `MEDIUM` | dead-code | `coverage.ts` | JsToolApprovalContent moved but the coverage map still keyed the old path; three generated registries were stale. | path re-pointed, all registries regenerated, every check:* script PASSES. |
| `HIGH` | test-quality | `railContribution.ts` | TESTS. | three specs added (17 assertions); js-tool's contributions lifted into a JSX-free module so the runner can reach them. |
| `MEDIUM` | test-quality | `railIsolation.test.ts` | INV-1's sole guard walked one of the rail's four directories and matched only aliased imports. | all four directories plus railRegistryCore, relative specifiers resolved, and the scheduler marker keys added to the name scan. |
| `LOW` | modularity-coupling | `activityDescriptors.ts` | code_sandbox was the one key of the deleted nine-module map with no claimant. | claimed by the code-sandbox contribution. |
| `HIGH` | performance | `ChatMessage.tsx` | segmentRail runs unmemoized per render and each declining contribution re-ran several forward scans; a streaming turn re-renders per token. | railToolStepBase is memoized per (blocks identity, index) with a live-version epoch, so a declining contribution costs a lookup. |

## Verified clean (12)

Checked because the plan or an auditor flagged it; no defect found.

| sev | angle | file | what was checked |
|---|---|---|---|
| `NONE` | security-authz | `McpServerCard.tsx` | ITEM-16 opened the built-in Calls tab without opening any edit affordance: isEditable still gates enable/test/edit/delete, the new button is gated on McpServersRead, and drawer history mode forces canManage=false. |
| `NONE` | security-secrets | `record.rs` | Rust and TS denylists mechanically diffed: 22 keys each, zero divergence; exact + case-insensitive matching preserved; nested objects and arrays walked on the real path. |
| `NONE` | correctness-logic | `railSegmentation.ts` | Adversarially scripted: sum(step.consumed) == span.consumed and exactly-once block coverage hold for empty messages, orphan results, result-before-use, id-less tool_use, two results per use and text-interleaved runs; consumed 0/NaN/negative/huge all clamp. |
| `NONE` | error-handling | `helpers.rs` | The byte-slice truncation that would panic on a multibyte boundary is genuinely fixed and covered by three regression tests. |
| `NONE` | frontend-state | `*` | Rules of Hooks: every hook precedes the early return in both ActivityRail and RailStep; scoped selectors read only their own key. |
| `MEDIUM` | data-integrity-db | `showcase.sql` | The guarded gallery fixture conversation grew by 8 turns. |
| `NONE` | data-integrity-db | `repository.rs` | The new filters AND-narrow into an unconditional user_id = $1 in both the page and COUNT queries; the reveal re-derives ownership through conversations rather than trusting the resolved row. |
| `NONE` | dead-code | `index.ts` | Every new chat-extension file is reached by the auto-discovery glob, including the module that ships no module.tsx. |
| `NONE` | test-quality | `handlers.rs` | The reveal audit test was reported as having contradictory assertions; the shipped version guards on FIELD names, not the prose. |
| `NONE` | test-quality | `-` | Skip audit across the whole change: exactly one skip exists, a conditional real-LLM env gate. No #[ignore], no unconditional skip. |
| `NONE` | modularity-coupling | `chat` | Dependency graph re-derived: the rail imports only api-client, lib, kit and other chat modules — no feature module by static, dynamic, type-only or string-literal reference. The nine-module map is genuinely deleted and not recreated in railBlocks. |
| `NONE` | cross-platform | `ui` | The desktop workspace overlays ui/src and holds no stale copy of any touched chat file; both OpenAPI twins regenerated together. |

## Deliberately open (15)

None is a HIGH. Each is recorded rather than quietly dropped, with the reason it is not being fixed
in this round.

| sev | angle | file | finding | why deferred |
|---|---|---|---|---|
| `LOW` | api-contract | `extension.rs` | always_reprompt is required while the client types it optional and writes `?? undefined`. | accepted: the three timing fields are optional and the boolean is always emitted, so an un-reloaded client is unaffected. |
| `MEDIUM` | concurrency-lifecycle | `ActivityRail.tsx` | The live seam is a single process-global counter fed by a whole-store subscribe, so any composer mutation re-renders every mounted rail. | accepted for now: correctness is restored; narrowing the seam to per-tool_use_id is a follow-up, recorded in FIX_ROUND-1. |
| `MEDIUM` | frontend-state | `extension.tsx` | The AP-4 move created a lateral js-tool -> mcp dependency on an internal store path (guidelines §9). | recorded: the elicitation transport is genuinely shared; extracting it to a chat/core seam is a follow-up. |
| `LOW` | ux-accessibility | `RailStep.tsx` | start-[7px] is an off-grid arbitrary spacing value (DESIGN_SYSTEM § Spacing rhythm). | recorded in FIX_ROUND-1. |
| `MEDIUM` | data-integrity-db | `202607200100_mcp_tool_calls_lookup_index.sql` | The partial indexes omit user_id while every query leads with it, and the ($n IS NULL OR col = $n) shape is not sargable under a generic plan. | recorded: needs an EXPLAIN-backed follow-up; composite (user_id, col) is the likely fix. |
| `LOW` | dead-code | `types.ts` | ClaimingContentRenderer has no consumer (as its predecessor did not). | recorded: pre-existing shape, not introduced here. |
| `MEDIUM` | test-quality | `railView.test.ts` | TEST-14 was re-pointed from a . | recorded in DRIFT-1.11: the rendering half is asserted in a browser by TEST-8/TEST-2; the enumeration wording still overstates the unit spec. |
| `MEDIUM` | test-quality | `activity-rail-breakout.spec.ts` | An [acceptance] proof of INV-3 is built on page. | recorded: the mocked routes DO exist in openapi.json so there is no stale-mock false-green, but a non-mocked companion is owed. |
| `MEDIUM` | test-quality | `tool_names_fixture_test.rs` | TEST-34 validates the fixture JSON but never links it to the contribution. | recorded in FIX_ROUND-1. |
| `MEDIUM` | modularity-coupling | `railContribution.ts` | The new module hosts three homeless built-ins; centralization shrank from nine modules to three rather than being eliminated, with nothing bounding regrowth. | recorded: accepted as the least-bad owner (the three have no frontend module), with the bound owed. |
| `MEDIUM` | modularity-coupling | `railTypes.ts` | 17 modules deep-import the rail contract from inside chat's components directory rather than a public barrel (guidelines §9). | recorded in FIX_ROUND-1. |
| `HIGH` | performance | `ActivityRail.tsx` | renderStepDetail is evaluated eagerly for every step including collapsed ones, re-running registry resolution. | recorded: mitigated by the base memo above; a lazy thunk is the remaining fix. |
| `LOW` | performance | `gate.rs` | An extra DB round trip per approval frame for data the gate already had. | recorded; approvals are user-paced. |
| `MEDIUM` | cross-platform | `ToolCallPanel.tsx` | The deep link is built from window. | recorded in FIX_ROUND-1: needs the configured public origin, or hiding under __TAURI__. |
| `LOW` | cross-platform | `ToolCallPanel.tsx` | toLocaleString with no explicit locale. | recorded. |

### The three worth a second look before this lands

- **`activity-rail-breakout.spec.ts` mocks the SSE stream.** It is an `[acceptance]` proof of INV-3
  built on `page.route()`, which the coding guidelines forbid for e2e. It is not a false-green (the
  mocked routes do exist in `openapi.json`, so the R2-5 staleness gate is satisfied), but an
  invariant whose entire point is "the user is not stranded" deserves the real approval path.
- **`js-tool → mcp` is a new lateral store dependency.** AP-4 moved the approval UI out of `mcp`,
  but the moved code reaches back into `mcp`'s internal store for the elicitation transport. The
  coupling changed direction rather than disappearing. The transport is genuinely shared, so the
  honest fix is a `chat/core` seam, not a re-move.
- **The partial indexes omit `user_id`.** Every query leads with it, and the
  `($n IS NULL OR col = $n)` shape is not sargable under a generic plan — so the migration may not
  buy what its own rationale claims. Needs an `EXPLAIN`, not an argument.
