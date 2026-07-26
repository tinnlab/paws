# chat-ui-robustness — DECISIONS

Every human/product input the implementation needs, resolved up front. Zero
markers remain.

### DEC-1: On an empty composer submit — silent no-op, or inline validation?
**Resolution:** Silent no-op. Nothing is shown: no toast, no inline error, no
alert. The composer keeps focus and its (empty) content; no message is created.
**Basis:** convention — the Send BUTTON already behaves exactly this way today
(`ChatInput.tsx:165` disables the button when there is nothing to send, so
clicking produces no message AND no error). Making Enter throw a visible error
for the same user intent would be an inconsistency between two paths to the same
action. It also matches every mainstream chat composer. The audit classifies the
current behavior as a `🔴 HIGH page-error`, not as "missing validation" — the
defect is the exception, and the correct terminal state for "the user submitted
nothing" is "nothing happened".

### DEC-2: Prevent the throw at the source, or just catch it at the call site?
**Resolution:** Both, and they are not redundant. (a) At the source: the empty
case becomes a `silent` cancel that `sendMessage` returns from without throwing
(ITEM-1) — so the ordinary empty-Enter produces no exception at all, rather than
an exception that happens to be caught. (b) At the call site: `TextInput`'s
keydown gets the same guard + try/catch the Send button has (ITEM-2) — so ANY
other cancel reason or send failure on the Enter path is surfaced as a toast
instead of escaping as an unhandled rejection.
**Basis:** codebase — the asymmetry between `ChatInput.handleSend` (guarded +
caught) and `TextInput.handleKeyDown` (neither) IS the bug; fixing only (a) leaves
the second path permanently un-defended for every future cancel-producing
extension, and fixing only (b) leaves a spurious exception being raised and
swallowed on a routine keypress (which still shows in DevTools noise and in any
error-reporting hook).

### DEC-3: Should the `silent` flag be per-cancel-reason, or a global "don't throw on cancel" mode?
**Resolution:** Per-cancel-reason. `silent?: boolean` is opt-in on
`BeforeSendResult`; ONLY the text extension's empty-content branch sets it. Every
other cancel keeps throwing. When results merge, a silent cancel combined with a
non-silent cancel resolves to NON-silent.
**Basis:** convention + CODING_GUIDELINES §6 ("never silently swallow"). A global
mode would silence genuine blockers (e.g. the file extension's
uploads-in-flight cancel, whose whole purpose is to tell the user why the send did
not go), converting a real error into a mysterious dead Enter key. Fail-loud-wins
keeps the silent path narrow by construction, and it is pinned by TEST-1 so it
cannot widen later.

### DEC-4: Where does the `sending`/`isStreaming` recovery live — a `finally`, or a widened `try`?
**Resolution:** A widened `try` that reuses the EXISTING catch, plus a pure
`buildSendFailureState()` helper shared by the reset sites. Not a bare `finally`.
**Basis:** codebase — the existing catch does more than reset flags: it decides
`isAborted`, notifies extensions via `onStreamError`, removes the optimistic temp
user bubble, and on abort reloads messages. A `finally` would either duplicate
that logic or run it on the SUCCESS path too (clearing `isStreaming` while the
stream is still live — a worse bug than the one being fixed, since the stream
legitimately continues after `sendMessage` resolves). Widening the try routes the
newly-covered failures into the one reset vocabulary that already exists.

### DEC-5: Is a stream that dies with no terminal frame (silent SSE death) in scope?
**Resolution:** OUT of scope for this change; the `type === 'error'` frame path
(`applyStreamFrame.ts:391-438`) and the send-time failure path are in scope. No
client-side stream watchdog/timeout is added.
**Basis:** user/product boundary — a wall-clock "we haven't heard anything in N
seconds, declare failure" heuristic is a new operational tunable (see DEC-6) with
a real false-positive cost: a legitimately slow first token (the audit's own runs
show `first_token=3015ms` and total `19116ms` for a sandbox turn) or a long
tool-execution gap would be misreported as an error, which is a WORSE user
experience than the spinner. The two mechanisms actually evidenced by the audit —
an unprotected throw wedging the flags, and a failed send — are both fixed
deterministically. Recorded explicitly so its absence is a decision, not an
oversight; ITEM-3 also removes the secondary consequence (a wedged `isStreaming`
suppressing the reconnect resync at `chat/index.ts:563,578`), which restores the
existing self-heal-on-reconnect path for the transport-drop case.

### DEC-6: Configurable settings — does this change introduce any operational tunable?
**Resolution:** No admin-configurable settings row is added, because this change
introduces no operational tunable. The two constants it does add are UI layout
values, not operational limits: `APPROVAL_DESCRIPTION_COLLAPSED_MAX_PX` (the
approval description's collapsed height) and the overflow tolerance used to decide
whether to offer "Show more". Both are exported named constants in the module that
uses them (never inline magic numbers), so either can be promoted later without a
rewrite.
**Basis:** convention — the mandatory configurable-settings rule targets resource
limits, retention, rate/quota, concurrency, toggles, model selection and
thresholds. A collapsed-height in pixels is presentation, in the same class as the
chat module's existing `COLLAPSE_MAX_HEIGHT_PX = 384`
(`chat/components/collapsible.ts:13`) and the approval card's own `max-h-40` args
clamp — none of which are admin-configurable. Had DEC-5 gone the other way, a
stream-timeout WOULD have required a settings row; that is part of why DEC-5
resolved as it did.

### DEC-7: How is the approval description bounded — string truncation, fixed scroll box, or collapse-with-expand?
**Resolution:** Collapse-with-expand, implemented as a **CSS-only** clamp
(`max-height` + `overflow`) plus a "Show more"/"Show less" toggle that is rendered
only when the content genuinely overflows. Never a string operation.
**Basis:** codebase + the surface's own security contract (INV-3, "FULL, EXACT
advertised description … poisoning hides in truncation"). String truncation is
forbidden outright by that contract. A plain always-scrolling box would bound the
height but hides that there is more to read behind a scrollbar that is easy to
miss inside an already-scrolling message list; an explicit "Show more" makes the
remainder discoverable. The idiom also already exists twice on this surface (the
args `overflow-auto max-h-40` clamp in the same file, and the chevron
expand/collapse in `mcp/chat-extension/extension.tsx:206-215`).

### DEC-8: Should the approval action row also be pinned/sticky?
**Resolution:** No. Bounding the description (DEC-7) bounds the card, which is
sufficient; no `position: sticky` is added to the footer.
**Basis:** convention — the card renders inside a virtualized, scrolling message
list, where a sticky footer would compete with the list's own scroll container and
with `MessageList`'s row-height measurement (`estimateMessageHeight` /
`measuredHeightCache`), risking a measurement-thrash regression far worse than the
defect. With the description clamped and the args already at `max-h-40`, the whole
card is bounded to roughly one screen-third, so the actions sit within the
viewport — which is what TEST-10 asserts directly, rather than assuming.

### DEC-9: Bug 4 (tool cards absent pre-approval) — change the behavior, or confirm it is deliberate?
**Resolution:** Confirm it is deliberate; change no behavior. Add only the
regression test that pins it (ITEM-7).
**Basis:** codebase — `mcp/chat-extension/extension.tsx:41-44` early-returns
`ToolCallPendingApprovalContent` for `status === 'pending_approval'`, so the
approval card renders IN PLACE OF the running tool card, in the same in-thread
slot. That card is not a bare prompt: it already discloses the tool name, the
server, the concrete arguments (`approval-tool-args`, the full JSON the model
chose), the destination host for an external server, and the full advertised
description. The SSE `mcpApprovalRequired` handler
(`extension.tsx:589-638`) even SYNTHESIZES the `tool_use` content block
specifically so this card can mount in the transcript. Inside a group, a pending
approval force-opens the wrapper (`toolRun.ts:76-81`) so it is never hidden behind
a collapsed group. So the user CAN see what is being requested, in context,
pre-approval — the audit's `toolCard=0 approval=1` is a correct measurement of
that intended design, not a missing card. Rendering BOTH would duplicate the same
information twice in the same slot.

### DEC-10: Bug 5 (mermaid/html) — re-fix, or re-verify only?
**Resolution:** Re-verify only; write no renderer code. Discharge by RUNNING the
existing render specs on this branch (TEST-12, TEST-13).
**Basis:** codebase — the audit's build `fp-ac-merge` @ `51164e4cd` carried
`pre: MarkdownCodeBlock` at `useStreamdownComponents.tsx:57`, which replaced
Streamdown's own code component and thereby bypassed BOTH `plugins.renderers`
(```html/```mermaid) and the parse-time Shiki rehype pass. Commit `3f6319d9a`
("fix(chat): restore streamdown code renderers + shiki (drop broken pre
override)") removed it, and HEAD carries the explanatory NOTE at
`useStreamdownComponents.tsx:56-67`. `git merge-base --is-ancestor 51164e4cd
60b0db310` returns false, so the audit's base is not an ancestor of this branch
and its finding cannot be assumed live. Per B7 the verdict is established by
running the specs, not by reading the diff.

### DEC-11: Which workspaces get the change — `ui` only, or `ui` + `desktop/ui`?
**Resolution:** `src-app/ui` only. No file is added or edited under
`src-app/desktop/ui/**`.
**Basis:** codebase — `desktop/ui/vite.config.ts:35-38` installs a
`localOverridePlugin` that resolves `@/` against `desktop/ui/src` first and falls
back to `../../ui/src`. `desktop/ui/src/modules/chat/` contains only three popout
`*.test.ts` files and there is no `desktop/ui/src/modules/mcp` at all, so none of
the nine changed files has a hand-written desktop override — the desktop app picks
up the shared implementation automatically. R2-3 (diff-review the desktop
overrides for dropped security logic) therefore has an empty surface here, which
was verified per-file rather than assumed.

### DEC-12: The sibling `.lifecycle/` feature dirs inherited from `feat/agent-core`
**Resolution:** Strip the seven sibling dirs on this branch for the duration of
the lifecycle (so gate A1 — "a branch may carry exactly ONE feature dir" — can
run against this feature), and RESTORE them in a final commit before the branch is
merged, so `feat/agent-core` does not lose its audit trail.
**Basis:** codebase — this is the established practice on this exact branch
family: commit `30f12a43e` ("chore(lifecycle): restore sibling feature audit
trails (agent-orchestration/frontend-perf/smart-module-loading/workflow-kind-agent)
**stripped for A1**; they belong on agent-core") did precisely this. The strip is
recorded as its own commit so the restore is a clean revert.

### DEC-13: What is the lifecycle base ref for the gates?
**Resolution:** `origin/feat/agent-core` (= `60b0db310`) — passed explicitly as
`--base origin/feat/agent-core` to `lifecycle-check.mjs` on every phase.
**Basis:** codebase — `.claude/app.config` already declares
`LIFECYCLE_BASE=feat/agent-core` for stacked branches, and the default
`origin/main` would drag in all of agent-core's own hunks (covered by agent-core's
own lifecycle) into this feature's diff-coverage law. Note the LOCAL `feat/agent-core`
ref in this worktree is stale (`ec00a14de`), so the remote-tracking ref must be
used, not the bare branch name.

## Descopes

None. Every PLAN ITEM (ITEM-1 … ITEM-9) is implemented and covered by an
enumerated test; no item is `[DESCOPED]`. DEC-5 records the ONE adjacent behavior
deliberately not built (a client-side stream watchdog) — it is out of scope of the
audit's evidence rather than a cut from this plan, so it is a decision, not a
descope.
