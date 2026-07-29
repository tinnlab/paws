# PLAN_AUDIT — chat-send-resilience

Audited against the tree at `origin/feat/agent-core` @ `9363976a2`, before any
code was written.

## Breakage risk

**ITEM-1 (fail-closed registry) is the only behavior-changing item with a blast
radius beyond the failure path, so it was audited by enumerating EVERY
contributor.** `grep -rn "composeRequestFields" src-app/ui/src` finds exactly
five production contributors:

| extension | file:line | can it throw in NORMAL operation? |
|---|---|---|
| `model` | `user-llm-providers/chat-extension/extension.tsx:76` | **yes, deliberately** — `throw new Error('No model selected')` when no model resolves. Today that throw is swallowed and becomes a 422; fail-closed turns it into the intended user-facing message. This is the defect, not a regression. |
| `text` | `chat/extensions/text/extension.tsx:166` | no — reads `TextStore.getText()` and returns a trimmed string. |
| `assistant` | `assistant/chat-extension/extension.tsx:102` | no — a dynamic import + a picker read, returns `{}` when unset. |
| `file` | `file/chat-extension/extension.tsx:349` | no — reads ids from the store, returns `{}` when empty. |
| `mcp` | `mcp/chat-extension/extension.tsx:992` | no — a dynamic import + two store reads, returns `{}` when nothing is selected. |

None of the four non-model contributors throws as a routine outcome, so
fail-closed does not convert any normal state into a blocked send. The residual
risk — "an optional contributor's transient failure now blocks the send" — is
deliberate and is the point of the fix: today that same failure *silently drops
the user's attached files / MCP selection / assistant* and sends anyway, which is
a worse outcome than an actionable abort. A contributor that genuinely wants to
degrade must catch its own error locally, where the choice is explicit and
reviewable (DEC-1).

**Callers of `composeRequestFields`:** exactly one production call site,
`actions/sendMessage.ts:85`, plus `sendMessage.store.test.ts`. So the throw has a
single, already-audited propagation path.

**Where a throw from `sendMessage`'s pre-flight region lands** was verified per
caller:
- `chat/components/ChatInput.tsx:82` — try/catch → `message.error(...)`. ✅
- `chat/extensions/text/components/TextInput.tsx:139` — try/catch → `message.error(...)`. ✅
- `mcp/.../ToolCallPendingApprovalContent.tsx:159/218/250` — try/catch, reverts the
  optimistic card. ✅
- `chat/core/stores/chat/actions/startRegenerateMessage.ts:70` — **no local catch**;
  this is precisely why ITEM-3 also writes `store.error`, so the regenerate path
  surfaces the failure in the conversation error Alert rather than only as an
  unhandled rejection.

**ITEM-5 (stage-aware dispatcher) risk:** relaxing the memoization for chunk-load
failures could reintroduce the unbounded-retry loop the existing comment warns
about ("a component that dispatches from a render or an effect"). Mitigated by
keeping a bounded per-dispatch retry with backoff AND keeping the factory-throw
path memoized exactly as today. `createLazyDispatcher` has ONE call site
(`store-kit.ts:361`) and is not re-exported from `@ziee/framework`'s barrel
(`src/index.ts` exports `module-system`, `module`, `stores`, `events`,
`overrides`, `app-seam` — not `lazy-dispatch`), so the signature change cannot
break an out-of-tree consumer.

**ITEM-7 risk:** `event.preventDefault()` on `vite:preloadError` suppresses Vite's
default rethrow. The import promise still rejects, so the dispatcher (ITEM-5) is
what handles it — the two items must ship together or preventDefault would
swallow a failure nothing else reports. They do.

## Pattern conformance

- `requestFieldFailure.ts` mirrors `sendFailureState.ts` — same directory-adjacent
  pure-module shape, same "the ONE failure shape lives here" doc-comment style,
  same `export const <NAME>_FALLBACK_MESSAGE` convention.
- New sendMessage assertions are appended to the existing
  `sendMessage.store.test.ts`, reusing its `makeStore` / `stubRegistry` /
  `stubSend` harness rather than introducing a second store double.
- SDK unit tests mirror `sdk/packages/framework/src/store-kit.test.ts`
  (Vitest, direct module import, no DOM assumptions beyond an injected target).
- The e2e mirrors `tests/e2e/chat/empty-submit-no-throw.spec.ts` beat for beat:
  `test-context` fixture → `loginAsAdmin` → seed via API → a `page.on('request')`
  counter over `/api/conversations/{id}/messages` → fail exactly ONE boundary.
- Provider/model seeding uses `tests/common/provider-helpers.ts` exactly as
  `chat-basic.spec.ts` does.

## Migration collisions

None — this branch adds no migration. See `BASE.md`.

## OpenAPI regen

Not required — no Rust type, handler, permission or sync entity changes; no
`openapi.json` / `api-client/types.ts` bytes in the diff, in either workspace.

## Per-item verdicts

- **ITEM-1** — verdict: PASS — one production call site; all five contributors enumerated above; fail-closed converts a silent invalid send into an actionable abort and regresses no routine path.
- **ITEM-2** — verdict: PASS — pure helper mirroring `sendFailureState.ts`; the message is consumed by error surfaces that already exist (the conversation error Alert + the composers' `message.error`), so no new UI.
- **ITEM-3** — verdict: PASS — closes the one caller (`startRegenerateMessage`) that has no local catch. Writes only `error` (NOT the full `buildSendFailureState` patch, whose `lastTurnInterrupted: true` would be wrong for a turn that never started).
- **ITEM-4** — verdict: PASS — `SendMessageRequest` (`server/src/modules/chat/core/extension/request.rs`) requires `content: String` and `model_id: Uuid`; guarding both before the POST is exactly the contract. `branch_id` is supplied by `sendMessage` itself from `conversation.active_branch_id`, so it is out of the contributor-failure blast radius and deliberately left alone.
- **ITEM-5** — verdict: CONCERN — the retry relaxation must not reopen the unbounded-loop hazard the existing comment documents. Resolved by DEC-4 (bounded retries + backoff for chunk-load only; factory throws keep today's memoization) and pinned by a unit test asserting the factory path is STILL memoized.
- **ITEM-6** — verdict: PASS — a single call site in `store-kit.ts:361` that already has the two stages separated (`loader().then(m => m.default(set, get))`); passing them separately is a mechanical rewrite.
- **ITEM-7** — verdict: PASS — new file, no existing behavior touched; `@ziee/framework/*` already maps to `./src/*` so no packaging change.
- **ITEM-8** — verdict: PASS — desktop carries a hand-written `main.tsx` and no `modules/chat` override (R2-3 check performed: `ls src-app/desktop/ui/src/modules` → no `chat/core`), so this one line is the entire desktop-parity surface.
