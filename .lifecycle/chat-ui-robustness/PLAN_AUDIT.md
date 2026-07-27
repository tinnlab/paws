# chat-ui-robustness — PLAN_AUDIT

The plan audited against the codebase BEFORE writing code. Every claim below was
checked by opening the file, not inferred.

## Breakage risk

**ITEM-1 (`silent` cancel) — the widest blast radius; audited callers exhaustively.**
`BeforeSendResult` (`chat/core/extensions/types.ts:198-205`) is consumed in
exactly three places: `mergeBeforeSendResults`
(`core/extensions/utils.tsx:129-139`), the registry's `beforeSendMessage`
aggregation (`core/extensions/registry.tsx:770-804`), and the throw site
(`core/stores/chat/actions/sendMessage.ts:15-22`). Adding an OPTIONAL `silent?:
boolean` is additive — every existing extension that returns `{cancel:true}`
without it keeps today's throwing behavior byte-for-byte. Producers of `cancel`
today: the text extension's empty check (`extensions/text/extension.tsx:169-179`
— the ONE we make silent) and any extension using the documented click-time
defensive-cancel pattern (`types.ts:206-215`). Risk: LOW, but the merge semantics
matter — a merge that made a non-silent cancel silent would SWALLOW a real error
(INV-4 violation). Mitigated by an explicit "fail-loud wins" rule (a silent cancel
merged with a non-silent cancel is NON-silent) implemented in a pure, unit-tested
helper rather than inline in the reducer.

**ITEM-2 (Enter guard) — a behavior change users can feel.** Adding
`if (sending || isStreaming) return` to `TextInput.handleKeyDown` means Enter no
longer starts a second send mid-stream. Checked: this is exactly what the Send
BUTTON already does (`ChatInput.tsx:76` guard + `:165` `disabled=`), so the guard
makes the two paths CONSISTENT rather than introducing a new restriction — and it
is the direct fix for the audit's `rapid-double-submit` cell. The textarea is
already `disabled={sending}` (`TextInput.tsx:119`) but NOT on `isStreaming`, which
is precisely the hole. No spec asserts "Enter sends during streaming"; the steer-
mid-stream feature has its own path (`steer-running-agent.spec.ts`) — checked, it
does not submit via this handler. Risk: LOW.

**ITEM-3 (try-scope + reset) — the highest-value, most delicate edit.** Today the
flags go true at `sendMessage.ts:64-70` while the `try` opens at `:106`. Between
them: `loadMessages` (`:79`) and `provideUserContent` (`:82`). Widening the `try`
means those two now route into the existing catch — which calls
`chatExtensionRegistry.onStreamError(...)` (`:154`). Audited the consequence: the
text extension's `onStreamError` (`extensions/text/extension.tsx:238-247`) calls
`textStore.restoreFromBackup()`, and the backup is only WRITTEN in `onMessageSent`
(`:207-212`), which has not run at that point — so restoring from an unset backup
must be a no-op, not a clobber. **Verified**: `restoreFromBackup` is guarded and
`backupMessage` starts empty, so an early failure cannot wipe the user's composer
text. Second consequence: the catch deletes the optimistic temp user bubble
(`:176-188`) — correct for an early failure too (no bubble exists yet;
`tempUserMessageId` is null, so it takes the `else` branch). Risk: MEDIUM →
mitigated by an explicit unit-level assertion on the reset shape plus the e2e.

**ITEM-3b (guarding `onStreamError`)** — wrapping an extension hook in try/catch is
a deliberate, LOGGED swallow whose only purpose is to guarantee the state reset
that follows it runs. Audited against INV-4: the guideline forbids swallowing a
real failure *instead of* surfacing it; here the failure IS surfaced (the store
`error` is set by the very reset the guard protects) and the swallowed secondary
error is `console.error`-logged. Conforms.

**ITEM-4 (spinner attrs)** — three attributes on one JSX node. The only risk is a
`check:testid-registry` failure if a new testid is not registered; handled below.
Risk: LOW.

**ITEM-6 (description clamp)** — the live blast radius is
`tests/e2e/07-mcp/external-approval-full-disclosure.spec.ts:114-117`, which does
`expect(desc).toBeVisible()` and `expect(desc).toHaveText(TOOL_DESCRIPTION)`.
Audited Playwright semantics: `toHaveText` compares the element's **textContent**
(not `innerText`) unless `useInnerText` is passed — it is not — so a CSS
`max-height`/`overflow-hidden` clamp leaves the assertion green, whereas a STRING
truncation would break it (and violate INV-3). `toBeVisible()` requires a non-empty
bounding box, which a clamped-but-present block still has. Therefore the clamp
MUST be CSS-only. Risk: LOW **given** the CSS-only constraint; HIGH if implemented
as string truncation — recorded as the binding constraint.

**ITEM-9 (gallery cell)** — additive cell. Risk: it perturbs
`gen-gallery-coverage`, `gen-state-matrix`, `gen-gallery-seed-registry` and
`gen-testid-registry`, all of which run in `--check` mode inside `npm run check`.
Each has a generator mode; they must be re-run and the outputs committed, or the
phase-8 frontend gate fails. Also `GEOMETRY_FINDINGS.jsonl` records pre-existing
findings for `deep-chat-tool-approval`; the new sibling slug will produce its own.
`gallery:geometry:gate` is NOT part of `npm run check` (verified against
`package.json`), so this does not gate — but it is noted so a new-cell finding is
not mistaken for a regression.

**Not touched, by scope contract:** app shell/layout, responsive/`overflow-x`
fixes, `conversations`|`llm-models` fetch/store files, all backend. Verified the
plan's file list contains none of them.

## Pattern conformance

- **ITEM-2 mirrors `ChatInput.tsx::handleSend` (`:75-87`)** — same guard, same
  `console.error` + `message.error(error.message || …)`. Conforms.
- **ITEM-3 mirrors the existing catch in the same file (`sendMessage.ts:150-196`)**
  — reuses the `baseUpdate` shape rather than inventing a second reset vocabulary.
  Conforms.
- **ITEM-4 mirrors the sibling spinner in the same component
  (`MessageList.tsx:509-513`)**, which already carries `aria-label` +
  `data-testid`. Conforms; also closes the a11y-name gap flagged by the audit.
- **ITEM-6 mirrors two idioms already in the MCP chat-extension**: the args clamp
  (`ToolCallPendingApprovalContent.tsx:315-326`, `overflow-auto max-h-40`) and the
  chevron expand/collapse (`mcp/chat-extension/extension.tsx:206-215`). Conforms.
  Deliberately does NOT reuse `chat/components/CollapsibleBlock.tsx` — audited: it
  persists collapsed state in `MessageViewState` keyed by `messageId`, which the
  approval card has no analogue for, and it is chat-module-internal (importing it
  from the mcp module would be the cross-module-internals coupling CODING_GUIDELINES
  §9 forbids). Divergence is justified, not accidental.
- **e2e specs mirror `tests/e2e/chat/error-recovery.spec.ts`** — same fixture,
  same `loginAsAdmin`/`getAdminToken`/`byTestId`, same "route-intercept only the
  send POST" line that spec already draws. Conforms to the repo's no-app-API-mocking
  rule: the app's own READ paths are never mocked; only the boundary being made to
  fail is intercepted.
- **Unit tests colocated `*.test.ts`** — matches `components/collapsible.test.ts`,
  `components/emptyCompletion.test.ts`. Conforms.
- **Desktop workspace** — audited: `src-app/desktop/ui` resolves `@/` to its own
  `src` first and falls back to `../../ui/src`
  (`desktop/ui/vite.config.ts:35-38`, `localOverridePlugin`). Its
  `src/modules/chat/` contains ONLY three popout tests
  (`core/popout/{openConversationWindow,focusPopoutWindow,popoutSnapBack}.test.ts`)
  and there is NO desktop `modules/mcp`. So none of the nine changed files has a
  hand-written desktop override — the desktop app picks the shared file up
  automatically, and R2-3 has nothing to reconcile. The diff will not touch
  `src-app/desktop/ui/**`, so only the `ui` workspace's `npm run check` is required
  at phase 8.

## Migration collisions

**None — structurally impossible.** This change is frontend-only: zero files under
`src-app/server/**` or `sdk/crates/**`. There is no `src-app/server/migrations`
directory on this branch at all (migrations moved into the per-crate SDK layout),
so there is no migration number to collide. `MERGE_MIGRATIONS_DIR` in
`.claude/app.config` points at that now-absent path, so the merge-gate's C2 check
will find nothing to compare — expected, not a failure of this change.

## OpenAPI regen

**Not required.** No Rust handler, request/response type, permission, or
`SyncEntity` is touched, so neither `src-app/ui/openapi/openapi.json` nor
`src-app/ui/src/api-client/types.ts` (nor their desktop twins) changes. `just
openapi-regen` is deliberately NOT run: running it would produce an unrelated
positional diff and violate the "diff only what the feature changes" discipline.
The C3 regen-parity gate has nothing to reconcile. Confirmed against the plan's
file list — no generated file appears in it.

Note on the phase-3/8 frontend gates: because no generated file is touched, the
diff is unambiguously a UI diff, so the `tier: e2e` requirement and the
`npm run check (ui)` + `gate:ui (ui)` lines are all in force. That is intended.

## Per-item verdicts

- **ITEM-1** — verdict: PASS — additive optional field; all three consumers
  located and enumerated; "fail-loud wins" merge rule pinned as a unit test so the
  silent path can never widen to a real error.
- **ITEM-2** — verdict: PASS — mirrors `ChatInput::handleSend` exactly; the guard
  it adds is one the Send button already enforces, so it removes an asymmetry
  rather than adding a restriction.
- **ITEM-3** — verdict: CONCERN — widening the `try` newly routes `loadMessages`
  and `provideUserContent` failures into the extension `onStreamError` hook. The
  one hook that reacts (text's `restoreFromBackup`) was checked to be a no-op with
  an unset backup, so composer text cannot be clobbered — but this is the item to
  re-check in the phase-6 audit and to cover explicitly with a test rather than
  assume. Not BLOCKED: the alternative (leaving the flags outside the try) is the
  defect itself.
- **ITEM-4** — verdict: CONCERN — introduces a new `data-testid`, which
  `check:testid-registry --check` will fail until the registry is regenerated.
  Mechanical, but it MUST be regenerated and committed in the same change or
  phase 8 fails.
- **ITEM-5** — verdict: PASS — no new rendering code; `ConversationPage`'s
  `chat-conversation-error-alert` (`:1003-1005`) already renders `store.error`.
  The item is an end-to-end verification obligation, discharged by an e2e that
  asserts the triple (spinner gone + alert visible + composer usable) rather than
  by reading the code (B7).
- **ITEM-6** — verdict: CONCERN — the fix is only safe as a **CSS-only** clamp.
  A string truncation would both violate INV-3 and break the existing
  `external-approval-full-disclosure` spec's `toHaveText`. Recorded as a hard
  implementation constraint; the acceptance test for INV-3 asserts the full string
  is still present in the DOM while collapsed.
- **ITEM-7** — verdict: PASS — the behavior is already implemented and
  deliberate (`mcp/chat-extension/extension.tsx:41-44` early-returns the approval
  card for `status === 'pending_approval'`; the SSE `mcpApprovalRequired` handler
  at `:589-638` synthesizes the `tool_use` block so the card mounts in-thread at
  all). The item adds only a pinning regression test, so there is no breakage
  surface. The audit's `toolCard=0 approval=1` is that design, correctly measured.
- **ITEM-8** — verdict: PASS — verification-only, no code. The premise was
  confirmed: `51164e4cd:…/useStreamdownComponents.tsx:57` has
  `pre: MarkdownCodeBlock`; HEAD does not, and carries the explanatory NOTE at
  `useStreamdownComponents.tsx:56-67`; `git merge-base --is-ancestor 51164e4cd
  60b0db310` is FALSE. Existing specs (`chat/html-iframe-render.spec.ts`,
  `chat/markdown-rendering.spec.ts`, `visual/mermaid-toggle.spec.ts`) already
  cover the behavior — the obligation is to RUN them, not to re-derive from the
  diff.
- **ITEM-9** — verdict: CONCERN — additive gallery cell, but it perturbs four
  `--check` generators inside `npm run check`. Must regenerate + commit
  `gallery-coverage`, `state-matrix`, `gallery-seed-registry`, `testid-registry`.
  Mechanical and known, not a design problem.

No `BLOCKED` verdicts. The two hard constraints extracted from this audit and
carried into implementation: **(a) ITEM-6 must be CSS-only**, **(b) ITEM-1's merge
must fail loud on a mixed silent/non-silent cancel.**
