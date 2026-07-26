# chat-ui-robustness — DRIFT round 1

Implementation reconciled against `PLAN.md` + the named design's invariants,
written DURING phase 5 as each item landed. Every divergence below is a
mechanical/environmental constraint discovered by running the gates, not a
change of intent — the four INVs are unchanged and each is still pinned by its
`[acceptance]` test.

- **DRIFT-1.1** — verdict: impl-wins — TEST-2/TEST-3's file moved from
  `actions/sendMessage.failure.test.ts` to
  `actions/sendMessage.store.test.ts`, and from `node:test` to **Vitest**.
  `sendMessage.ts` imports `@ziee/framework/stores`, a workspace package whose
  export map only resolves through Vite's resolver — under `node:test` it dies
  with `ERR_MODULE_NOT_FOUND` on `@ziee/framework/src/stores`. Fixing that would
  have meant editing the SHARED `scripts/node-test-hooks.mjs` resolver to route
  around this one feature's import — forbidden by B3. Vitest already exists in
  this workspace for exactly this class of test (`vitest.config.ts`: "stores …
  need module mocking and a DOM … so they run under Vitest"), and its
  `include: ['src/**/*.store.test.ts']` dictates the filename. TESTS.md amended;
  phases 1–3 re-gated.
- **DRIFT-1.2** — verdict: impl-wins — `sendFailureState.ts` moved OUT of
  `chat/actions/` to `chat/sendFailureState.ts`. `check:store-actions` (part of
  `npm run check`) treats every file under a store's `actions/` dir as an action
  and regenerates `actions.gen.ts` from it; a pure helper there made the
  generated file stale and failed the gate. It is not an action, so the plan's
  placement was simply wrong. PLAN.md file list amended.
- **DRIFT-1.3** — verdict: impl-wins — TEST-10/TEST-11 moved from
  `tests/e2e/07-mcp/approval-actions-reachable.spec.ts` to
  `tests/e2e/visual/approval-actions-reachable.spec.ts`, driven against the
  backend-free gallery deep-state. The 07-mcp sibling the plan pointed at
  (`external-approval-full-disclosure.spec.ts`) opens with
  `test.skip(!HAS_BRIDGE, BRIDGE_SKIP)` — it needs a real LLM bridge to make a
  model choose to call a tool, and self-skips without one. A skip is not a PASS,
  so an acceptance test for INV-3 could not live there and be honestly recorded.
  The gallery deep-state renders the REAL `ConversationPage` through the
  production chat path (the established pattern in
  `tests/e2e/visual/mermaid-toggle.spec.ts`: "behavioral e2e against the
  backend-free gallery"), so the card under test is the real component in its
  real scrolling container — which is what makes card height a layout problem at
  all. It also runs deterministically, which a bridge-dependent spec never does.
  TESTS.md amended.
- **DRIFT-1.4** — verdict: impl-wins — the ~2,000-char seed was extracted from
  `chat/gallery.tsx` into `dev/gallery/fixtures/longToolDescription.ts`. Two
  consumers need it without pulling the chat module's React graph: TEST-14
  (`node:test`) and TEST-10 (Playwright, asserting the rendered text equals the
  seed character-for-character). Sharing the constant is what makes TEST-10's
  "nothing was truncated" assertion exact rather than approximate.
- **DRIFT-1.5** — verdict: impl-wins — the clamp is applied as a Tailwind
  utility (`max-h-30 overflow-hidden`) rather than an inline `style={{maxHeight}}`.
  The kit's `Text` requires an explicit `allowStyle` opt-out to accept a raw
  style prop, and a utility keeps the value on the 4px spacing grid. **INV-3 is
  unaffected** — this is still a CSS-only clamp, not a string operation. The
  helper now exports both the px constant and the class, and TEST-9 asserts they
  cannot drift (`max-h-30` × 4px === 120px).
- **DRIFT-1.6** — verdict: impl-wins — three mechanically-generated artifacts had
  to be regenerated and committed, none of which the plan listed:
  `sdk/packages/kit/src/testIds.generated.ts` (the two new testids — committed IN
  the `sdk` submodule, with the superproject pointer bumped),
  `src/dev/gallery/stateMatrix.generated.ts` and `STATE_MATRIX.md` (the new
  conditional "Show more" render). All three are `--check`-gated inside
  `npm run check`, which now exits 0. Anticipated in `PLAN_AUDIT.md`'s ITEM-4 and
  ITEM-9 CONCERN verdicts; recorded here as the concrete outcome.
- **DRIFT-1.7** — verdict: none — ITEM-7 confirmed exactly as planned: no
  behavior changed. `mcp/chat-extension/extension.tsx:41-44` early-returns the
  approval card for `pending_approval`, so the running tool card and the approval
  card are mutually exclusive in the same in-thread slot, and the approval card
  already discloses tool name / args / dest host / description. TEST-11 pins it.
- **DRIFT-1.8** — verdict: none — ITEM-8 confirmed as planned: no renderer code
  written. `useStreamdownComponents.tsx` on this branch carries no `pre`
  override (the audit's base `51164e4cd` did, at line 57), and the audit base is
  not an ancestor of this branch. The verdict is discharged by RUNNING the
  existing specs at phase 8, per B7 — not by this reasoning.

## Red-green evidence (recorded live, not reconstructed)

`sendMessage.store.test.ts` was run against the PRE-FIX `sendMessage.ts`
(restored from `origin/feat/agent-core`) before being run against the fixed one:

- pre-fix: **5 failed | 1 passed** — the silent-cancel no-op, both wedged-flag
  cases, the non-empty-error case, and the throwing-hook case all FAIL.
- post-fix: **6 passed**.

The single test that passes in both is "a non-silent cancel still THROWS" — by
design: that behavior is unchanged and the test is its regression guard.

**Unresolved drifts:** 0
