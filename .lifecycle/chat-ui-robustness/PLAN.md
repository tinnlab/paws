# chat-ui-robustness — PLAN

Fix four chat-UI robustness defects surfaced by a live-app audit of a running
instance, plus re-verify one finding that the audit attributed to an old build.

## Design source

- Realizes `/data/pbya/ziee/tmp/live-ui-audit-2026-07-26/findings.md` — the
  evidence-based live-app audit (2026-07-26, `http://127.0.0.1:1520`, driven as
  `admin`), specifically:
  - `## bug · adversarial-compose (flow-level)` → `🔴 HIGH · page-error` /
    "Message cannot be empty" (6/6 cells: mobile|tablet|desktop × light|dark).
  - `## bug · sent` + `## bug · rapid-double-submit` → `🟡 MEDIUM ·
    stuck-loading` "3 loading indicator(s) still present after settle window"
    (6/6 cells each).
  - `## responsive · sandbox-exec-approval` + `## real-infra ·
    sandbox-exec-approval` → the approval card as the surface that renders in
    place of the tool card (`toolCard=0 approval=1`).
  - `## real-infra · llm-mermaid` / `llm-html` → `🟡 MEDIUM ·
    llm-render-missing` (attributed to the OLD `fp-ac-merge` @ `51164e4cd`
    build — re-verification item, see ITEM-8).
- Realizes `agent-kit/docs/CODING_GUIDELINES.md` §6 (Error handling) and §13
  (UI/UX & accessibility) — the binding house rules the audit findings violate.
- Realizes root `CLAUDE.md` → `## UI Build Gate — the visual-testing exit
  condition` → "Definition of DONE for a UI surface", criterion 2.
- The approval card's disclosure contract is defined in-code at
  `src-app/ui/src/modules/mcp/stores/mcpComposer/state.ts:62-66` and
  `src-app/ui/src/modules/mcp/chat-extension/components/ToolCallPendingApprovalContent.tsx:299-301`
  (ITEM-50 of the external-approval-full-disclosure feature) — that contract
  constrains the ITEM-6 fix.

## Invariants

- **INV-1**: "**Always render `store.error`** (antd `Alert`/inline) — never
  `return null` on error. **Always show loading** (`Spin`/`Skeleton`) on initial
  fetch. **Always show success/error feedback** after a mutation (`message.*`)."
  (CODING_GUIDELINES §13, verbatim)
- **INV-2**: "**Zero runtime HIGH findings** — the runtime-health pass reports no
  console error, no uncaught exception / ErrorBoundary crash, no failed network
  request, and no WCAG-AA contrast failure for that surface, in ANY state ×
  theme." (CLAUDE.md, UI Build Gate DoD criterion 2, verbatim)
- **INV-3**: "FULL, EXACT advertised description (never truncated/summarized —
  poisoning hides in truncation)" (`mcpComposer/state.ts:62-66`, verbatim) — and
  its sibling in-code comment "Full, EXACT tool description (never truncated):
  the description the model was actually given, so a poisoned/misleading one is
  visible." (`ToolCallPendingApprovalContent.tsx:299-301`, verbatim).
- **INV-4**: "**Never silently swallow** (`let _ =`, `.ok()`,
  `unwrap_or_default()` on a real failure, empty-string-on-serialize-fail).
  Propagate with `?` or surface a user-visible error." (CODING_GUIDELINES §6,
  verbatim)

## JTBD / user-experience design

Three jobs, one per defect class. Each is stated as what a real human wants to
DO, then reconciled per surface.

**JTBD-A — "I hit Enter and nothing was in the box."** The user taps Enter on an
empty composer (a stray keypress, a double-Enter after a send, a mobile keyboard
autocorrect). What they WANT: nothing to happen. The composer stays focused,
their conversation is untouched, and no scary error appears. What they must NEVER
get: an uncaught exception (which in a production build surfaces as a red
console/ErrorBoundary event and, in the audit harness, as a `pageerror`). Today
the Enter path throws. Surfaces: composer textarea (`TextInput`), Send button
(`ChatInput` — already correct, the asymmetry is the bug).

**JTBD-B — "My message failed; tell me, and let me try again."** The user sends,
generation fails (provider 429/500, dropped SSE, an extension throwing mid-send).
What they WANT: the spinner to STOP, a visible error naming what went wrong, and
a re-enabled composer so they can retry. What they must NEVER get: an eternal
spinner with no text — indistinguishable from "the model is thinking", so they
wait indefinitely. Surfaces: the streaming indicator in `MessageList`, the error
`Alert` in `ConversationPage`, the Send button's disabled state, the composer
textarea's disabled state. Secondary consequence today: a wedged `isStreaming`
also SUPPRESSES the reconnect resync (`chat/index.ts:563,578` bail on
`state.isStreaming`), so the stuck state cannot self-heal even when the stream
comes back.

**JTBD-C — "Should I let this tool run?"** The model requests a tool; the user
must decide. What they WANT: to see WHAT is being asked (tool name, the concrete
arguments, where data goes, the tool's advertised description) and then reach
Approve/Deny without hunting. What they must NEVER get: the decision controls
pushed off-screen by an unbounded description — which is also an attack surface
(a hostile MCP server can newline-stuff its description to push Deny below the
fold and make Approve the only visible action after a scroll). Surfaces: the
approval card inside the message bubble, and the group wrapper it can sit inside.

## UI-surface checklist

Only ONE surface changes visually (the approval card); the rest are behavioral.

- **Precedent** — the approval card's clamp mirrors its own sibling clamp idiom
  already in the SAME file: the arguments `<pre className="… overflow-auto
  max-h-40 …">` (`ToolCallPendingApprovalContent.tsx:315-326`). The expand/
  collapse control mirrors the chevron "Show details" idiom used by
  `McpToolCallUI` / `McpToolUseRenderer` / `McpToolGroupCard`
  (`mcp/chat-extension/extension.tsx:74-81, 206-215, 353-360`) and
  `ThinkingContent.tsx:40-54`. No new visual vocabulary is introduced.
- **Scale / cardinality** — the bounded quantity here is the tool DESCRIPTION
  string, which is attacker-controlled and unbounded (the audit's live instance
  produced ~2,000 chars). Bound it visually at a fixed collapsed height; the full
  string stays in the DOM (INV-3). The args block is already bounded (`max-h-40`).
- **Device size / responsive** — the clamp makes the card SHORTER at every
  viewport, so mobile (390px) / tablet (768px) / desktop (1280px) all improve;
  no breakpoint-specific behavior is added, matching the sibling args block which
  is also viewport-independent. The pre-existing mobile `overflow-x` on this flow
  is OWNED BY ANOTHER AGENT (responsive/shell scope) and is explicitly NOT
  touched here.
- **Populated-render review** — the gallery already seeds this state
  (`src/dev/gallery/fixtures/chat-deep.ts`, slug `deep-chat-tool-approval`). It
  is seeded with a short 2-sentence description, which is exactly the case that
  HIDES this bug. Add a long-description gallery cell so the populated render of
  the defect state is reviewable.
- **User-visible progress** — JTBD-B is precisely this rule: a silent boolean
  spinner that never terminates is a defect. The fix makes the terminal state
  (error) visible and the spinner stop.
- **Input economy** — n/a (no new inputs).
- **Multi-instance / workspace surfaces** — the chat store is already per-pane
  (`paneId`); every state write in ITEM-3 goes through the SAME per-instance
  `set` the existing catch uses, so a wedge-recovery in pane A cannot clear pane
  B. Split-pane behavior is unchanged.
- **URL-as-view-into-focus** — n/a (no focus/URL change).
- **Platform-provided affordances** — n/a.

## Items

- **ITEM-1**: An empty composer submit is a graceful NO-OP, not a throw. Add an
  optional `silent?: boolean` to `BeforeSendResult`; the text extension's
  empty-content branch sets it; `chat/core/stores/chat/actions/sendMessage.ts`
  returns early (no throw, no state mutation) on a silent cancel, and keeps
  throwing for every non-silent cancel (so a real blocker — e.g. file upload in
  flight — still surfaces a toast). `mergeBeforeSendResults` and the registry's
  cancel aggregation must carry `silent` through, and a merge of a silent cancel
  with a non-silent cancel must be NON-silent (fail loud wins).
- **ITEM-2**: The Enter path is as defensive as the Send-button path.
  `extensions/text/components/TextInput.tsx::handleKeyDown` gains the same
  pre-guard (`sending || isStreaming` → return) and the same `try/catch` →
  `message.error(...)` that `ChatInput.tsx::handleSend` already has, so NO cancel
  reason and no send failure can ever escape as an unhandled rejection.
- **ITEM-3**: `sendMessage` can never wedge `sending`/`isStreaming`. Move the
  flag-set inside the protected region (today the flags are set at
  `sendMessage.ts:64` but the `try` only opens at `:106`, leaving
  `loadMessages` + `provideUserContent` unprotected), and make the recovery run
  unconditionally: wrap the `chatExtensionRegistry.onStreamError(...)` call so a
  throwing extension hook can no longer skip the state reset that follows it
  (INV-4 — the swallow is deliberate, logged, and only guards the RESET path).
- **ITEM-4**: The streaming indicator is identifiable + accessible.
  `MessageList.tsx:596-600` gains `data-testid="chat-streaming-indicator"`,
  `role="status"` and `aria-label` (mirroring the sibling older-messages spinner
  at `MessageList.tsx:509-513`, which already has both). This is required to
  ASSERT the spinner's absence in a test, and closes an a11y-name gap of the
  same class the audit reports elsewhere.
- **ITEM-5**: A failed send/stream surfaces a visible, actionable error.
  `ConversationPage` already renders `chat-conversation-error-alert` from
  `store.error`; ITEM-3 guarantees `error` is actually SET on every failure path,
  so the pair (spinner gone + alert shown + composer re-enabled) holds. Verified
  end-to-end rather than assumed.
- **ITEM-6**: The approval card bounds its description so Approve/Deny stay
  reachable. Clamp the description block to a fixed collapsed height with a
  "Show more"/"Show less" toggle; the FULL string remains in the DOM at all times
  (CSS clamp, never string truncation — INV-3), and `approval-tool-description`
  keeps returning the full text to `toHaveText`. Extract the overflow decision as
  a pure, unit-tested helper.
- **ITEM-7**: Lock the pre-approval disclosure contract. Establish, by test, what
  the user can see BEFORE approving — the audit's `toolCard=0 approval=1` signal
  is the approval card rendering IN PLACE OF the tool card
  (`mcp/chat-extension/extension.tsx:41-44` early-returns on
  `status === 'pending_approval'`), and that card already discloses tool name,
  concrete args, dest host and description in the message thread. Add the
  regression test that pins this intended behavior so a future refactor cannot
  silently make the pending request invisible.
- **ITEM-8**: Re-verify — NOT re-fix — the ```mermaid / ```html finding on
  current code. The audit ran against `fp-ac-merge` @ `51164e4cd`, whose
  `useStreamdownComponents.tsx:57` set `pre: MarkdownCodeBlock`, which bypassed
  Streamdown's `plugins.renderers` (so ```html/```mermaid fell back to plain code
  blocks). `feat/agent-core` commit `3f6319d9a` dropped that override; the audit
  base is NOT an ancestor of this branch. Prove the current behavior by RUNNING
  the existing render specs rather than reasoning about the diff.
- **ITEM-9**: Add the long-description approval gallery cell so the populated
  defect state is reviewable and covered by `check:state-matrix` / `gate:ui`.

## Files to touch

- `src-app/ui/src/modules/chat/core/extensions/types.ts` (ITEM-1 — `silent` on
  `BeforeSendResult`)
- `src-app/ui/src/modules/chat/core/extensions/utils.tsx` (ITEM-1 —
  `mergeBeforeSendResults` carries `silent`)
- `src-app/ui/src/modules/chat/core/extensions/registry.tsx` (ITEM-1 — cancel
  aggregation carries `silent`)
- `src-app/ui/src/modules/chat/extensions/text/extension.tsx` (ITEM-1 — empty
  branch is silent)
- `src-app/ui/src/modules/chat/core/stores/chat/actions/sendMessage.ts` (ITEM-1,
  ITEM-3)
- `src-app/ui/src/modules/chat/extensions/text/components/TextInput.tsx` (ITEM-2)
- `src-app/ui/src/modules/chat/components/MessageList.tsx` (ITEM-4)
- `src-app/ui/src/modules/mcp/chat-extension/components/ToolCallPendingApprovalContent.tsx`
  (ITEM-6)
- `src-app/ui/src/modules/mcp/chat-extension/components/approvalDescriptionClamp.ts`
  (NEW — ITEM-6 pure helper) + its `.test.ts`
- `src-app/ui/src/modules/chat/core/extensions/beforeSendCancel.ts` (NEW —
  ITEM-1 pure merge/severity helper) + its `.test.ts`
- `src-app/ui/src/dev/gallery/fixtures/chat-deep.ts` (ITEM-9)
- `src-app/ui/tests/e2e/chat/empty-submit-no-throw.spec.ts` (NEW — ITEM-1/2)
- `src-app/ui/tests/e2e/chat/failed-stream-error-state.spec.ts` (NEW — ITEM-3/4/5)
- `src-app/ui/tests/e2e/07-mcp/approval-actions-reachable.spec.ts` (NEW —
  ITEM-6/7)
- Mirrors of every changed `src/` file under `src-app/desktop/ui/src/…` if and
  only if the desktop workspace carries its own copy of that file (checked per
  file at implement time; codegen'd files are untouched here).

**Explicitly OUT of scope** (owned by other agents — do not edit): the app
shell/layout containers, the responsive/`overflow-x` fixes, the fetch/store files
for `conversations`|`llm-models`, and anything under `src-app/server/`.

## Patterns to follow

- **ITEM-2 (Enter guard + catch)** — mirror `ChatInput.tsx::handleSend`
  (`src-app/ui/src/modules/chat/components/ChatInput.tsx:75-87`) exactly: same
  guard order, same `console.error` + `message.error(error.message || …)` shape.
- **ITEM-3 (state reset)** — mirror the existing catch block in the SAME file
  (`sendMessage.ts:150-196`): reuse its `baseUpdate` object shape verbatim rather
  than inventing a second reset vocabulary.
- **ITEM-4 (spinner a11y)** — mirror the sibling spinner in the same component,
  `MessageList.tsx:509-513` (`aria-label="Loading older messages"` +
  `data-testid="chat-loading-older"`).
- **ITEM-6 (clamp + toggle)** — mirror (a) the args clamp idiom in the SAME file
  (`overflow-auto max-h-40`) and (b) the chevron expand/collapse idiom in
  `mcp/chat-extension/extension.tsx:206-215`. Do NOT re-implement
  `CollapsibleBlock` (it is chat-module-internal and persists per-message view
  state keyed by `messageId`, which the approval card has no analogue for).
- **e2e specs** — mirror `tests/e2e/chat/error-recovery.spec.ts`: the
  `test-context` fixture, `loginAsAdmin` + `getAdminToken`, seeding a
  conversation over the REAL REST API, and `byTestId`. Route-interception is used
  ONLY to fail an external boundary (the send POST), never to mock the app's own
  read path — the same line `error-recovery.spec.ts` already draws.
- **Unit tests** — mirror the in-module colocated `*.test.ts` pattern already in
  the chat module (`components/collapsible.test.ts`,
  `components/emptyCompletion.test.ts`, `core/utils/footnoteScope.test.ts`).
