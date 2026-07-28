# DECISIONS — Activity Rail

Every human/product input resolved before implementation. Four were escalated to the owner as
option pickers (2026-07-27); the rest are resolved by codebase convention with the rationale recorded.

### DEC-1: The detail view must pick one argument source. Redacted history, or the raw block the chat card renders today?
**Resolution:** Redact by default in BOTH the rail step and the panel, AND close the denylist gaps
(`cookie`, `credentials`, `x_auth_token`, `openai_api_key`, `Bearer-Token`) — **plus** an
admin-gated "reveal raw" affordance in the panel for the operator debugging a failing call.
**Basis:** user — owner chose "Redact + admin reveal" over redact-everywhere (2026-07-27). This
keeps INV-2 literally satisfiable (no detail becomes permanently unreachable) while removing
plaintext secrets from the default surface. Amends ITEM-17 and adds TEST-41/TEST-42.

### DEC-2: What permission gates the raw reveal — a new one, or an existing?
**Resolution:** Reuse the existing `mcp_servers::manage`. No new permission, no migration.
**Basis:** convention + least privilege — a holder of `mcp_servers::manage` can already read and set
a server's configured secret headers, so revealing arguments grants no capability they lack. Minting
`mcp::secrets::reveal` would add a permission surface (and an A10 obligation) for zero additional
containment. The reveal is a discrete user action, never a default render.

### DEC-3: What does a SINGLE completed tool call render as? (84% of tool-using messages)
**Resolution:** One quiet muted line — no rail spine, no summary row, no collapse control — still
expandable for detail.
**Basis:** user (2026-07-27). A rail of one is ceremony, and this is the majority case, so it sets
the visual tone of most conversations.

### DEC-4: How does the group card's retirement land — cutover, flag, or per-extension?
**Resolution:** Hard cutover in one commit. The rail and the group card never coexist.
**Basis:** user (2026-07-27), and the codebase agrees: both renderers claim the same `tool_use`
blocks, so any window where each believes it owns the span yields double-rendered or dropped blocks
(PLAN_AUDIT § Breakage risk). A flag would double the e2e surface AND keep the hazard alive.

### DEC-5: How does a very long rail render? (worst observed turn = 44 blocks)
**Resolution:** Render every step. No cap, no middle-collapse.
**Basis:** user (2026-07-27). Rows are cheap, the rail is collapsed by default once the answer
arrives, and any cap risks hiding a failed step — which would break INV-5.

### DEC-6: Are the rail's tunables fixed constants or an admin-configurable settings row?
**Resolution:** **Fixed constants**, gathered in one `RAIL_LIMITS` object rather than scattered
magic numbers: artifact chips shown before "+N", label truncation, panel result page size.
**Basis:** convention, with explicit rationale — the mandatory configurable-settings rule defaults to
admin-configurable, and is overridden here because these are **pure client-side presentation
constants with no operator-visible effect and no resource cost**; there is no deployment for which a
different chip count is correct. The one genuine operational tunable this feature touches —
retention of `mcp_tool_calls` — is **already** admin-configurable
(`mcp_user_policy.tool_call_retention_days`, default 90) and is reused, not duplicated. Structuring
them as a single object keeps promotion to a settings row a non-rewrite if that ever changes.

### DEC-7: Where does the step-detail panel open?
**Resolution:** Through the existing right-panel mechanism, inheriting its three layouts (in-pane
slide-over, drawer, resizable column) and its per-conversation persistence. New tab type `tool_call`.
**Basis:** codebase — `registerPanelRenderer` + serializable `RightPanelTab` already back four types
and five open-from-message call sites (`literature`, `kb_source`, `file`, `background`). Inventing a
placement would fork a solved problem.

### DEC-8: What is the rail's step-identity key, for panel tabs and deep links?
**Resolution:** `tool_use_id`.
**Basis:** codebase — it is the join key already persisted on both `message_contents` and
`mcp_tool_calls`, and the existing panels already derive stable ids from tool identity
(`lit:${tool_use_id}`). Reusing it means re-opening focuses the existing tab rather than stacking.

### DEC-9: Does the rail show a duration for a step that is still running?
**Resolution:** Yes — elapsed time, ticking, from the frame's `started_at`; the final `duration_ms`
replaces it on completion.
**Basis:** convention — the workflow run timeline already displays `"{tokens} tokens · {ms/1000}s"`
per step. This is the reason ITEM-14 adds timing to the SSE frame: a DB join alone cannot serve an
in-flight step.

### DEC-10: `bio_mcp` tool names are only knowable at runtime. What ships?
**Resolution:** Probe a live sidecar once, commit the observed `tools/list` output as a test fixture,
and derive the contribution from it. Any name absent from the fixture degrades to name-only.
**Basis:** codebase — `bio_mcp/handlers.rs` is a pure reverse proxy with no tool names in-tree, so a
probe is the only source. Committing the fixture keeps the contribution testable offline (TEST-34),
which a live-probe-at-test-time would not.

### DEC-11: Does `observation` (a finished background sub-agent) join the rail?
**Resolution:** No. It renders as it does today, outside the rail.
**Basis:** design — `DESIGN.md` § Explicitly out of the rail. It arrives asynchronously long after
the turn and is a *message*, not a step; `ChatMessage.tsx:106-111` already forces it full-width.

### DEC-12: Does the rail render for a USER message?
**Resolution:** No. Activity spans are computed only for assistant turns.
**Basis:** codebase — user messages carry only `text` and attachment blocks, and attachments are
already lifted out of the bubble (`ChatMessage.tsx:117-133`).
