# PLAN — chat-send-resilience

A production defect fix, not a feature: the chat send path swallows a
request-field composition failure and POSTs a structurally invalid body, and the
lazy-action dispatcher permanently memoizes a transient dynamic-import failure so
one blip bricks that action for the whole session.

Branch base is **`origin/feat/agent-core`** (the integration line). This work never
merges to `main`; every gate is run with `--base origin/feat/agent-core`.

## Design source

Realizes `.lifecycle/chat-send-resilience/DESIGN-SOURCE.md` — the verbatim §4
"STILL-PRESENT items" **Rank 1** and **Rank 2** sections of
`/data/pbya/ziee/tmp/live-ui-247/TRIAGE-vs-9363976a2.md` (24/7 live-UI audit rig
triage against `origin/feat/agent-core` @ `9363976a2`), plus the orchestrator
brief's `## Scope` quoted at the foot of that file.

## Invariants

Lifted verbatim from the design source (brief `## Scope` + triage §4 Rank 1).

- **INV-1**: "a failing required contributor must not produce a silent invalid send. Surface a user-visible, actionable error instead of a raw 422"
- **INV-2**: "add dynamic-import failure recovery (`vite:preloadError` handling and/or a retry in `lazy-dispatch.ts`) so a transient blip doesn't permanently brick a lazy action for the session."
- **INV-3**: "`sendMessage.ts:180-184` spreads the result into the POST behind `as any`, erasing the TS requirement; there is no `model_id` presence check anywhere between `:85` and `:184`." — i.e. the send path must verify the composed body carries the server-required fields BEFORE the POST, with the `as any` gone.

## Items

- **ITEM-1**: `ChatExtensionRegistry.composeRequestFields` becomes **fail-closed**: it runs every contributor (so one failure does not hide another), collects each failure with its extension name, and — if any contributor failed — throws a `RequestFieldCompositionError` instead of returning silently-incomplete fields. No contributor's keys are ever dropped without the caller knowing.
- **ITEM-2**: The thrown error carries a **user-visible, actionable message** (which extension failed, the underlying cause, and "Reload the page and try again"), built by a pure, unit-testable helper. When the framework has recorded a chunk-load/stale-deploy condition, the message additionally says the app may have been updated.
- **ITEM-3**: `sendMessage` records a composition failure on `store.error` before re-throwing, so the failure is visible on EVERY caller path — including the programmatic ones (`startRegenerateMessage`, tool-approval transmit) that do not toast — not only the two composers that `message.error(...)`.
- **ITEM-4**: `sendMessage` gains a **required-field guard** on the composed body: it must carry `content` and a `model_id`; the `as any` cast at the POST is replaced by a typed, validated payload. A missing field aborts with the same actionable error class instead of POSTing an invalid body. (Amended per DRIFT-1.4: the CHECK runs right after composition — before `createConversation` and before the optimistic bubble, so a rejected turn leaves no debris — while the typed payload stays at the POST site.)
- **ITEM-5**: `createLazyDispatcher` becomes **stage-aware**. It takes the module import and the impl-build as two separate stages so it can tell a transient CHUNK-LOAD failure from a deterministic action-FACTORY throw. A chunk-load failure is retried (bounded, with a short backoff) and its rejection is **never permanently memoized** — a later dispatch retries from scratch. A factory throw keeps today's semantics (memoized after one retry — the constant is renamed `MAX_BUILD_RETRIES` now that it applies to the build stage only), preserving the documented "a deterministic authoring bug must fail fast, not loop forever" rationale.
- **ITEM-6**: `store-kit`'s lazy-action wiring passes the two stages (`loader()` and `m.default(set, get)`) to the stage-aware dispatcher, so every lazy action in both workspaces inherits the recovery.
- **ITEM-7**: A framework-level `installChunkLoadRecovery()` installs a `vite:preloadError` listener: it logs and records a module-level "stale build" mark that ITEM-2's message consults. (Amended per DRIFT-1.7: it deliberately does NOT `preventDefault()` — Vite rethrows only when the event is not defaultPrevented, so preventing it makes the import promise resolve with `undefined` and re-creates the silent failure. The listener observes; `lazy-dispatch.ts` recovers.)
- **ITEM-9**: `store-kit`'s baked-in lazy-action PREFETCH (`autoWarmLazyActions`) must not turn a warm-up chunk failure into an uncaught page error. Its `try/catch` only ever caught a SYNCHRONOUS throw, while `preload()` returns a promise — so a failed chunk produced an unhandled rejection for a warm-up nobody awaited. Add the `.catch` (debug-level; the load failure is already logged once by ITEM-7's listener). Found by the e2e, not by inspection. (Added during phase 5 — see DRIFT-1.8.)
- **ITEM-8**: Both app entries (`src-app/ui/src/main.tsx` and `src-app/desktop/ui/src/main.tsx`) call `installChunkLoadRecovery()` — desktop ships its own hand-written entry, so it must be wired explicitly (R2-3).

## Files to touch

New:
- `src-app/ui/src/modules/chat/core/extensions/composeRequestFields.ts` — the pure, JSX-free fail-closed composition algebra that `registry.tsx` delegates to (added per DRIFT-1.5, mirroring `beforeSendCancel.ts`).
- `src-app/ui/src/modules/chat/core/extensions/composeRequestFields.test.ts` — unit.
- `src-app/ui/src/modules/chat/core/extensions/requestFieldFailure.ts` — the `RequestFieldCompositionError` class + the pure message builder.
- `src-app/ui/src/modules/chat/core/extensions/requestFieldFailure.test.ts` — unit.
- `src-app/ui/src/main.entry-wiring.test.ts` — unit (both entries wired).
- `sdk/packages/framework/src/chunk-recovery.ts` — `installChunkLoadRecovery` + `isStaleBuild`.
- `sdk/packages/framework/src/chunk-recovery.test.ts` — unit.
- `sdk/packages/framework/src/lazy-dispatch.test.ts` — unit.
- `src-app/ui/tests/e2e/chat/send-field-composition-failure.spec.ts` — e2e.

Edited:
- `src-app/ui/src/modules/chat/core/extensions/registry.tsx`
- `src-app/ui/src/modules/chat/core/stores/chat/actions/sendMessage.ts`
- `src-app/ui/src/modules/chat/core/stores/chat/sendMessage.store.test.ts`
- `src-app/ui/src/main.tsx`
- `src-app/desktop/ui/src/main.tsx`
- `sdk/packages/framework/src/lazy-dispatch.ts`
- `sdk/packages/framework/src/store-kit.ts`
- `src-app/ui/src/api-client/lazy-dispatch.test.ts` — migrated to the two-stage signature; its transient-failure spec widened (DRIFT-1.1 / DRIFT-1.2).
- `src-app/ui/src/api-client/shared-infra.test.ts` — migrated to the two-stage signature (DRIFT-1.1).

## Patterns to follow

- **Pure-helper-beside-the-action**: `sendFailureState.ts` (same directory as the
  action it serves) is the model for `requestFieldFailure.ts` — a documented pure
  module holding the ONE failure shape, unit-tested on its own.
- **Store-action unit test**: `sendMessage.store.test.ts` — the real action driven
  through a fake `set`/`get` with the registry singleton monkey-patched and
  restored. New sendMessage tests extend that file in place.
- **SDK unit test**: `sdk/packages/framework/src/store-kit.test.ts` /
  `stores.test.ts` — `node:test` + `node:assert/strict`, direct `./x.ts` import
  of the module under test. `lazy-dispatch.test.ts` and `chunk-recovery.test.ts`
  mirror them, and (unlike those two, which need `import.meta.env`) run under a
  bare `node --test` with no loader because both modules are dependency-free.
- **E2E fault-injection spec**: `tests/e2e/chat/empty-submit-no-throw.spec.ts` —
  real backend via `test-context`, `loginAsAdmin`, a seeded conversation, a
  `page.on('request')` counter over the send route, and `page.route` used to fail
  exactly ONE boundary. The new spec follows it exactly, except the failed
  boundary is a **static ES-module URL** (never an `/api/` route), so R2-5 does
  not apply and no API response is mocked.
- **Provider/model seeding**: `tests/common/provider-helpers.ts`
  (`createProviderViaAPI` / `assignProviderToAdministratorsGroup` /
  `createModelViaAPI`) as used by `tests/e2e/chat/chat-basic.spec.ts`.
- **Framework subpath export**: `@ziee/framework/*` maps to `./src/*`
  (`sdk/packages/framework/package.json` `exports`), so
  `@ziee/framework/chunk-recovery` needs no packaging change.

### UI-surface checklist

This change adds **no new UI surface**: no page, drawer, card, panel, list,
or conditional render state. It changes the *content* and the *reachability* of
two error surfaces that already exist and are already gallery-covered — the
conversation error `Alert` (`chat-conversation-error-alert`) and the composer's
`message.error(...)` toast. Precedent, scale/cardinality, responsive behavior,
populated-render review, progress affordances and input economy are therefore
unchanged and inherited from those surfaces. `check:state-matrix` has nothing new
to cover.

**JTBD.** The user's job is "send my message." Today, when a request-field
contributor fails, the app *appears* to send, then shows a raw server validation
string (`missing field \`model_id\``) that names nothing the user can act on —
and, because the failed chunk is memoized, EVERY subsequent send fails the same
way until the tab is reloaded, with no hint that reloading is the cure. After
this change the user gets: (1) no phantom send, (2) a message naming what failed
and telling them to reload, and (3) in the transient case, a send that simply
works on the next attempt because the dispatcher re-fetches the chunk.
