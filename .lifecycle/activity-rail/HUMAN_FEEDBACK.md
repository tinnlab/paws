# HUMAN_FEEDBACK — Activity Rail

## Entries

- **FB-1** — DEC-1, owner, 2026-07-27 — *"redact tool arguments, or keep the raw block the chat card renders today?"* → **Redact + admin reveal**, not redact-everywhere. **Resolved:** redaction is structural in the core `RailStepDetail` body every contribution lands on, plus `redactedJson` at mcp's own render sites; the raw value stays reachable through the permission-gated reveal endpoint. Pinned by TEST-41 (both permission legs) and TEST-42.
- **FB-2** — DEC-3, owner, 2026-07-27 — *"what does a SINGLE completed tool call render as?"* (84% of tool-using messages) → **One quiet muted line**: no spine, no summary row, no collapse control, still expandable. **Resolved:** `isQuietSingle` drives the `data-rail-shape="single"` branch in `ActivityRail`.
- **FB-3** — DEC-4, owner, 2026-07-27 — *"how does the group card's retirement land — cutover, flag, or per-extension?"* → **Hard cutover in one commit**; the rail and the group card never coexist. **Resolved:** `McpToolGroupCard` / `McpToolUseGroup` / `collectToolRun` and the whole `contentSpan` grouping seam are deleted in the same change; the three e2e specs that tested the group card are retired with it.
- **FB-4** — DEC-5, owner, 2026-07-27 — *"how does a very long rail render?"* (worst observed turn = 44 blocks) → **Render every step**, no cap, no middle-collapse, because any cap risks hiding a failed step. **Resolved:** no cap exists anywhere in `ActivityRail`; TEST-38's C16 case renders a five-step rail.
- **FB-5** — scope, owner, 2026-07-27 — all four scope edges chosen **IN** rather than deferred (SSE per-step duration incl. the dual-binary regen, non-admin built-in call history, the redaction canonicalisation, and the `bio_mcp` live sidecar probe). **Resolved:** all four shipped; the probe genuinely ran against the real 29 MB binary and observed exactly one tool (`biomcp`), captured as a committed fixture.
- **FB-6** — design, owner, 2026-07-27 — Direction C approved over Directions A and B; `DESIGN.md`'s nine non-negotiables are binding and must be lifted verbatim. **Resolved:** lifted verbatim into `PLAN.md` § Invariants, each given a phase-2 fidelity verdict and pinned by an `[acceptance]` test (TEST-1 … TEST-9), all PASS. INV-2's verdict was re-opened after the blind audit and re-argued rather than inherited.
- **FB-7** — coordinator, mid-flight — *"commit the 113 uncommitted files now; re-establish the two dead sub-agents' work by INSPECTING the tree rather than trusting their last reported state."* **Resolved:** committed before any other work, with the sibling-lifecycle deletion check run before each commit (always empty). Both agents were verified directly against the tree: the Rust agent's self-reported broken audit assertion had in fact landed correctly and passes; the e2e agent's nine specs existed and were subsequently run to green.

## Feedback received during phases 1–8

**Product/design decisions** — the owner resolved four option-pickers on 2026-07-27, before
implementation, and they are recorded verbatim in `DECISIONS.md` with the code that realizes each:

| # | question | resolution | where it lands |
|---|---|---|---|
| DEC-1 | redact tool arguments, or keep the raw block the chat card renders today? | **Redact + admin reveal** (not redact-everywhere) | core `RailStepDetail` + `redactToolArgs` + the gated reveal endpoint |
| DEC-3 | what does a SINGLE completed tool call render as? (84% of tool-using messages) | **One quiet muted line** — no spine, no summary, no collapse control | `isQuietSingle` → the `data-rail-shape="single"` branch |
| DEC-4 | how does the group card retire — cutover, flag, or per-extension? | **Hard cutover in one commit**; the rail and the group card never coexist | `McpToolGroupCard` deleted in the same change |
| DEC-5 | how does a very long rail render? (worst observed turn = 44 blocks) | **Render every step** — no cap, no middle-collapse | no cap exists in `ActivityRail` |

**Scope** — the owner explicitly chose all four scope edges IN rather than deferring them
(`PLAN.md` § Scope decisions): per-step duration on the SSE frame, non-admin access to built-in
tool-call history, the redaction canonicalisation, and the `bio_mcp` live sidecar probe. All four
shipped; the probe genuinely ran against the real binary and returned one tool (`biomcp`).

**Design of record** — Direction C was chosen over A and B in a three-direction comparison and is
binding; `DESIGN.md`'s nine non-negotiables are lifted verbatim into `PLAN.md` and each is pinned by
an `[acceptance]` test (TEST-1 … TEST-9), all PASS.

**Mid-flight coordinator correction** — after a session limit, I was told to commit the then-113
uncommitted files immediately and to re-establish two dead sub-agents' work by inspecting the tree
rather than trusting their last reported state. Done: the work was committed before anything else,
and both agents' output was verified directly (the Rust agent's self-reported broken assertion had in
fact landed correctly and passes; the e2e agent's nine specs existed and were subsequently run).

## No further human feedback received

**FB-5 — DEC-13, owner, 2026-07-29** — first human view of the rail in a browser. Owner: *"looks
like rail didn't follow the design, isn't it? thinking is not in rail?"* The premise was checked
before answering: the implementation was FAITHFUL — `thinking` was on `DESIGN.md`'s "Explicitly out
of the rail" list and `DESIGN_FIDELITY.md` INV-6 confirms the list was carried into the plan
verbatim. The DESIGN was wrong, not the build. → **Reasoning becomes a rail step.**
**Resolved:** `textRailContributions` in the `text` extension; `thinking` removed from
`RAIL_EXCLUDED_TYPES`; `DESIGN.md` amended in place; DEC-13 records the reversal. Pinned by the
`DEC-13` case in `railSegmentation.test.ts` (with a `text`-still-excluded negative control) and 11
contribution tests in `railContribution.test.ts`.
**[generalizable: yes** — *an exclusion list entry needs a recorded REASON, exactly like an
inclusion decision. `observation` had DEC-11 and survived scrutiny; `thinking` had only a list entry
and did not. A design-phase gate should require every "explicitly out of scope" item to name its
basis, so unargued exclusions cannot silently narrow a feature to half its stated problem.*]

**Superseded note:** until 2026-07-29 this file read "No human feedback received on the rendered UI
— no human has looked at the rail in a browser." That was accurate for 20 audit rounds, and is the
reason a design defect of this size survived all of them: every round audited the code against the
design, and none could question the design itself.

No human has reviewed the rendered rail. Two consequences are stated rather than glossed:

1. **The design-critic pass has not happened.** It is criterion 1 of the UI DONE definition and is
   explicitly out-of-band — a vision model cannot be wired into a headless gate. The four
   machine-enforced criteria are all green (`gate:ui` PASS, 187/187 surfaces runtime-clean, zero
   gating HIGH findings, tsc + lint clean, 42/42 tests PASS), and the seeded turns the review needs
   now exist and render correctly. But "no HIGH visual findings" is unverified.
2. **Three audit findings are deliberately open and would benefit from an owner's view** before this
   lands (all detailed in `FIX_ROUND-1.md`): the INV-3 acceptance spec drives a mocked SSE stream
   rather than the real approval path; the AP-4 move turned `mcp → js-tool` coupling into
   `js-tool → mcp` store coupling rather than removing it; and the new partial indexes omit
   `user_id`, so they may not be used by the queries whose cost the migration exists to remove.
