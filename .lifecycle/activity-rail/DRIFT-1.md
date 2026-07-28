# DRIFT-1 — Activity Rail

Round 1 of the implement + drift-convergence loop. Every place the tree disagreed with the plan, the
decisions or the test enumeration, and how it was resolved. Plan-wins means the code changed;
impl-wins means the artifact changed and says why.

**Unresolved drifts:** 0

---

## Plan-vs-repo factual errors (the plan described a tree that isn't there)

- **DRIFT-1.1** — verdict: impl-wins — **`DECISIONS.md` DEC-2 names a permission that does not exist.** DEC-2 resolves the reveal gate as "reuse the existing `mcp_servers::manage`". A repo-wide grep finds no `mcp_servers::manage` and no `McpServersManage`; the mcp module uses split verbs `mcp_servers::{read,create,edit,delete}` plus an admin tier `mcp_servers_admin::{read,create,edit,delete}`. DEC-2's *substance* — "no new permission, no migration; reuse the one whose holder can already read and set a server's configured secret headers" — plus DEC-1's "**admin**-gated" wording both point at `McpServersAdminEdit` (`mcp_servers_admin::edit`, "Edit system MCP servers"). That is what ships. This is a naming correction, not a relitigation: no new permission was minted, no migration was added, and the chosen constant is strictly *narrower* than `mcp_servers::edit` (which an ordinary user can hold for their own servers).

- **DRIFT-1.2** — verdict: impl-wins — **`PLAN.md` § Files-to-touch puts the MCP SSE frames in `chat/core/services/streaming.rs`.** That file does not exist. `SSEChatStreamMcpToolStartData` / `…CompleteData` are declared in `mcp/chat_extension/extension.rs` (L105-147) and constructed solely by `send_tool_complete_event` in `mcp/chat_extension/helpers.rs`. ITEM-14 landed there instead. Same work, correct address.

- **DRIFT-1.3** — verdict: impl-wins — **ITEM-17's reveal cannot read `mcp_tool_calls`.** The plan assumes a "canonical detail source" from which raw arguments can be revealed. But `record.rs::cap_arguments` redacts BEFORE the insert, so `arguments_json` never held the raw value — a reveal over that column would return `[redacted]` and the affordance would be theatre. The raw arguments live only in the paired `message_contents` `tool_use` block. The endpoint reads THAT, owner-scoped through the conversation. Consequence recorded honestly on the handler and in DESIGN_FIDELITY INV-2: this gates the SURFACE (which is what DEC-1 asks for), not the wire — the owner's own conversation payload still carries the block.

- **DRIFT-1.4** — verdict: impl-wins — **ITEM-25/AP-3 is not a pure frontend deletion.** The plan says "remove `mcp`'s hardcoded `control_mcp` UUID + tool name". Deleting the literal alone would delete the BEHAVIOUR it gates (hiding "Approve for this conversation" for a server that always re-prompts, where the button is a silent no-op). The honest inversion is that the SERVER declares its own re-prompt policy, so a boolean `always_reprompt` was added to `SSEChatStreamMcpApprovalRequiredData` and the client reads it. Scope grew by one wire field; the anti-pattern is genuinely gone rather than relocated.

- **DRIFT-1.5** — verdict: impl-wins — **ITEM-25/AP-4 understates the coupling.** The plan says mcp owns "`js_tool`'s approval UI". mcp also owned the `runJsApprovalRequired` SSE handler that INJECTS the `run_js_approval` block, and the `run_js_approval` content-type registration. All three moved to a new `modules/js-tool/chat-extension/`. `modules/mcp` now contains zero `run_js` literals, pinned by TEST-36. (The moved handler still writes the shared `elicitationRequests` entry, because resolution genuinely goes through the side-channel elicitation transport — that is a real dependency, not ownership, and is documented at the call site.)

## Design/plan gaps that implementation exposed

- **DRIFT-1.6** — verdict: plan-wins — **the rail needs live state that no persisted block can express.** `pending-approval`, a start instant to tick from (DEC-9), and "finished before the result block lands" exist only in the SSE-fed store, which belongs to an extension — and INV-1 forbids the rail importing one. Resolved by a CORE-owned seam, `chat/core/rail/liveSteps.ts`: core declares `RailLiveSource`, the extension that owns the frames PUSHES one in during `initialize`. Dependency points core ← extension, never the reverse; with no source registered (unit test, reload, gallery) the rail degrades to block-derived status. Same inversion shape as the registry's existing `setPrimaryChatStateAccessor`. Not in PLAN's file list; added.

- **DRIFT-1.7** — verdict: plan-wins — **ITEM-5 is only satisfied by deleting the grouping seam, not by adding a better one.** Leaving `contentSpan` / `blocks` / `index` in place while the rail also groups would have left TWO grouping mechanisms and re-admitted the exact desync the item exists to remove — and, with `McpToolUseGroup` retired, `contentSpan` would have had zero production implementors (dead mechanism, §15). So `renderContent` now returns `ReactNode | null`, `ContentRendererProps` loses `blocks`/`index`, and `GroupingContentRenderer` became `ClaimingContentRenderer` (`contentMatch` only). Blast radius was 3 call sites, all of which this feature already touches.

- **DRIFT-1.8** — verdict: plan-wins — **`resetViewState(messageIds)` would have leaked rail state across conversation switches.** The scoped reset deleted only `collapsed[id]`. Rail and step keys are `<messageId>#…`-prefixed, so `forgetRailKeys` was added to evict them with the same split-pane scoping guarantee. Found by the entity-lifecycle walk (INFRA_INTEGRATION § E2), not by a test — which is the point of doing the walk.

- **DRIFT-1.9** — verdict: plan-wins — **a pruned `mcp_tool_calls` row left the panel in an indefinite skeleton.** Retention (`tool_call_retention_days`) can delete the row while a persisted panel tab still references it. The panel now renders an explicit "No stored record" state naming retention as the likely cause. Also found by the entity-lifecycle walk (§ E3).

- **DRIFT-1.10** — verdict: plan-wins — **`registry.tsx` is JSX, so nothing in it is unit-testable here.** TEST-10 must pin rail resolution order and the enable-gate, which would have been unreachable from `node --test`. The resolution logic was extracted to a pure `chat/core/extensions/railRegistryCore.ts` and `registry.tsx` keeps a field plus three thin delegations — which also keeps the change to that hot file genuinely additive, as ITEM-1 requires.

## Test-plan drift (form changed; assertions did not weaken)

- **DRIFT-1.11** — verdict: impl-wins — **TEST-14 was enumerated as `RailStep.test.tsx`, a component-render spec. This workspace cannot run one.** `test:unit` is `node --test "src/**/*.test.ts"` with type-stripping only; the loader's own comment records that node "cannot parse JSX", there are ZERO `.test.tsx` files in the tree, and neither jsdom nor Testing Library is a dependency of `src-app/ui`. Rather than introduce a second runner mid-feature, every decision the row makes (label truncation, elapsed formatting, artifact overflow, the summary sentence and its status precedence, the accessible name, the view-state keys) was extracted into the pure `railView.ts` and is asserted in `railView.test.ts`; the RENDERED row is asserted in a real browser by TEST-8 (single line box + `scrollWidth > clientWidth` at 390px) and TEST-2. Net: strictly more assertions than the enumerated spec, and the rendering claim is proven in a browser rather than in jsdom. `TESTS.md` updated to the real path; the TEST-ID and its subject are unchanged.

- **DRIFT-1.12** — verdict: impl-wins — **`TESTS.md` put 17 unit specs under `__tests__/` directories. This repo has none.** Every one of its 106 unit specs sits ADJACENT to its source; `__tests__/` would have been a new convention introduced by this feature alone. Paths in `TESTS.md` were rewritten to the adjacent form. The runner glob matches both, so this is convention conformance, not a functional change. No TEST-ID was added, dropped or re-scoped.

## Verified NON-drift (checked because the plan flagged it, found accurate)

- **DRIFT-1.13** — verdict: none — the `tool_result` catch-all really is `literature@75` (no `contentMatch`), not `knowledge-base@70`. PLAN_AUDIT's correction of the sweep was right.
- **DRIFT-1.14** — verdict: none — `mcp_tool_calls` really has five indexes and NONE on `tool_use_id` or `message_id`; the `UNIQUE (message_id, tool_use_id)` at migration line 165 belongs to `tool_use_approvals`. ITEM-13's index is genuinely required.
- **DRIFT-1.15** — verdict: none — `McpToolCompleteData` really carries no timing field of any kind, so ITEM-14 is real work and the dual-binary regen is unavoidable.
- **DRIFT-1.16** — verdict: none — `ChatMessage.tsx` really computes `isObservation` and forces it full-width; segmentation excludes it explicitly (plus `text`/`thinking`/`file_attachment`/`image`), pinned by TEST-11.

## Self-inflicted defect caught by the user-experience walk

- **DRIFT-1.18** — verdict: resolved — the first cut routed a BREAKOUT through the step's inline
  detail body (`renderRailDetail`), which for a pending approval would have rendered mcp's light
  arguments/result panel instead of the approve/deny card — i.e. INV-3 would have been structurally
  satisfied (the request is outside the rail, non-collapsible) while the user was handed a surface
  with no decision controls on it. Every structural gate would have stayed green. Breakouts now
  render through the ORDINARY content path (`ContentRenderer`), because a request for input is not a
  "detail" — it is the surface itself. Caught by walking the affordances of the approval surface
  (INFRA_INTEGRATION § 1), not by a test; TEST-3 now covers it.

- **DRIFT-1.19** — verdict: resolved — the rail's view-state key started life as `<messageId>#<spanOrdinal>`. During a streaming turn a span can appear EARLIER in the message than one already rendered, which shifts every later ordinal and silently re-collapses a rail the user had opened — the precise failure INV-7 exists to prevent, arriving through the back door of an unstable key rather than through component state. Re-keyed on the span's FIRST STEP (`tool_use_id`), which is stable for the life of the call. TEST-7 exercises the unmount/remount half; this is the insertion half.

## Incidental defect found and fixed while in the file

- **DRIFT-1.17** — verdict: resolved — `send_tool_complete_event` truncated its result with `format!("{}...[truncated]", &r[..2000])` — a BYTE slice that panics on a multibyte UTF-8 boundary, i.e. any non-ASCII tool result crossing 2000 bytes. ITEM-14 rewrites that exact line, so it was fixed char-safely with a reproducing test rather than re-landed intact.

## Late-round drift (found while integrating the parallel workstreams)

- **DRIFT-1.20** — verdict: plan-wins — **default delegation resolves to the WRONG extension for a card-owning tool.** ITEM-11 says the rail delegates a step's body via `renderContent({content})`. But a step is anchored at the **`tool_use`** block, and `tool_use` is owned by mcp — so the default delegation renders mcp's generic tool card, never the knowledge-base / literature / workflow card that lives on the paired `tool_result` block. TEST-39 ("expanding a knowledge-base step renders the knowledge-base card body") would have been unsatisfiable. Those three contributions therefore supply a `renderDetail` that hands their OWN already-registered component the paired result block. Still delegation, still no cross-module import, still no re-implementation — the plan's mechanism was right, its default target was wrong for half the cases.

- **DRIFT-1.21** — verdict: plan-wins — **INV-3 was one contribution away from being silently lost.** `blocking` started on mcp's generic contribution only. A domain contribution at order 40 pre-empts the generic one at order 1000, so the moment a tool family claimed its own tools, its pending-approval steps stopped being marked blocking and would have been folded into a collapsible rail row — with every structural gate still green. Moved into `railToolStepBase`, so every contribution inherits it and none can forget. Pinned by a new assertion in `describeActivity.test.ts`. (Found by reviewing a parallel workstream's report, not by a test; the contributions had independently patched it locally, which is what made the systemic hole visible.)

- **DRIFT-1.22** — verdict: none — pre-existing unit failures confirmed NOT caused by this branch, verified by `git stash`-ing the feature's files and re-running: `chat/core/stores/MessageViewState.store.test.ts`, `chat/core/stores/SplitView.store.test.ts`, `chat/core/stores/chat/sendMessage.store.test.ts`, `chat/stores/ChatHistory.store.test.ts`, `workflow/stores/WorkflowBuilder.store.test.ts`, `workflow/stores/WorkflowRun.store.test.ts` — all `ERR_UNSUPPORTED_DIR_IMPORT` / `ERR_MODULE_NOT_FOUND` on extensionless relative imports that the node loader resolves only inside the SDK tree. They are Vitest-targeted `*.store.test.ts` specs caught by a `node --test` glob. Recorded as the baseline, not fixed here.
