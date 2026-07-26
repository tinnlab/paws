# chat-ui-robustness — TEST_RESULTS

Real exit codes and counts, transcribed from the saved logs. No test is skipped
to go green; the one environmental failure is classified, named, and shown to be
structurally unattributable to this change.

## Frontend gates

```
npm run check (ui): PASS
gate:ui (ui): PASS
```

- `npm run check` → **exit 0** (`/data/pbya/ziee/tmp/chat-ui-check3.log`). Full
  chain: tsc + guardrails + colors + settings-field + adjacent-inline +
  icon-action + logical-direction + tooltip-placement + kit-manifest +
  testid-registry + design-spec + gallery-coverage + gallery-crawl +
  gallery-fixtures + state-matrix + overlay-registry + override-registry +
  gallery-seed-registry + store-actions.
- `npm run gate:ui` → **exit 0** — `✅ GATE PASSED — every UI DONE criterion met`,
  **190/190 surfaces PASS**, runtime-health `HIGH 0 gating`, visual 10 passed
  (`/data/pbya/ziee/tmp/chat-ui-gateui4.log`).
  - An earlier run of the same gate reported 2 failing surfaces —
    `seeded-wf-builder-validation-error` and `seeded-wf-builder-populated` — whose
    findings were all `request-failed … net::ERR_ABORTED` on Vite dev-server
    module fetches (`kit/tooltip.tsx`, `modules/workflow/gallery.tsx`), i.e.
    load-races under the 638-cell sweep, on WORKFLOW surfaces. This diff contains
    zero workflow files, and the clean re-run reproduced neither. **No chat or
    approval surface carried a HIGH finding in either run** — verified by
    querying `RUNTIME_FINDINGS.jsonl` directly. Both runs are recorded rather
    than only the green one.
- `src-app/desktop/ui`: **no gate line — the workspace is not touched.** Verified
  per-file: none of the changed files has a hand-written desktop override
  (`desktop/ui/src/modules/chat/` holds only three popout `*.test.ts`; there is no
  `desktop/ui/src/modules/mcp`), and `desktop/ui` resolves `@/` through to
  `../../ui/src`, so it picks up the shared implementation automatically.

## Unit tests

`node --import ./scripts/node-test-loader.mjs --test` → **20 tests, 20 pass, 0 fail**
`npx vitest run …/sendMessage.store.test.ts` → **7 tests, 7 pass, 0 fail**

- **TEST-1**: PASS — 9 cases (`beforeSendCancel.test.ts`), incl. fail-loud-wins in
  both orders and the discard interaction.
- **TEST-2**: PASS — `[acceptance] [invariant: INV-4]`.
- **TEST-3**: PASS — `provideUserContent` and `loadMessages` failures both leave
  `sending`/`isStreaming` false.
- **TEST-4**: PASS — 6 cases (`sendFailureState.test.ts`).
- **TEST-9**: PASS — 5 cases (`approvalDescriptionClamp.test.ts`).

## E2E

| Spec | Result |
|---|---|
| `chat/empty-submit-no-throw.spec.ts` | **4 passed** (exit 0) |
| `chat/failed-stream-error-state.spec.ts` | **2 passed** (exit 0) |
| `visual/approval-actions-reachable.spec.ts` | **5 passed** (exit 0) |
| `chat/markdown-rendering.spec.ts` + `chat/html-iframe-render.spec.ts` | **16 passed** (exit 0) |

- **TEST-5**: PASS — `[acceptance] [invariant: INV-2]`.
- **TEST-6**: PASS.
- **TEST-7**: PASS — `[acceptance] [invariant: INV-1]`.
- **TEST-8**: PASS.
- **TEST-10**: PASS — `[acceptance] [invariant: INV-3]` (10a/10b/10c).
- **TEST-11**: PASS.
- **TEST-12**: PASS — the ` ```mermaid ` fence renders
  `[data-streamdown="mermaid-block"]` with a real diagram `svg`.
- **TEST-13**: PASS — the ` ```html ` fence renders `html-block` with its source
  view + Preview toggle (all 7 cases).
- **TEST-14**: PASS — the long-description gallery cell renders (every case in the
  approval spec drives that surface).
- **TEST-15**: PASS.
- **TEST-16**: PASS — `[acceptance] [invariant: INV-3]`.

## Red-green evidence (each fix was shown to be load-bearing)

Not asserted — RUN, by reverting the fix and re-running:

| Fix reverted | Result |
|---|---|
| `sendMessage.ts` restored from `origin/feat/agent-core` | **5 failed / 1 passed** (the 1 pass is the unchanged "a loud cancel still throws" regression guard) |
| `descriptionClampClass` stubbed to return `''` | **3 failed / 1 passed** (10a, 10b, 10c fail) |
| both fixes in place | **6 passed** / **5 passed** respectively |

The clamp geometry was also measured directly on the real surface rather than
assumed: unclamped the approval card is **837px** tall with its top at **y=-235**;
clamped, **457px** at **y=145**.

## Regression batch (existing specs over the touched surfaces)

`error-recovery` + `collapse-long-message` + `chat-basic` +
`mcp-tool-approval-optimistic` + `composer-draft-persist` → **15 passed, 1 failed**
(`/data/pbya/ziee/tmp/chat-ui-e2e-regress2.log`).

The single failure — `chat-basic.spec.ts:132 "should send multiple messages in
existing conversation"` — is **Category A of the known test-environment floor**
(genuinely blocked dependency), established by evidence, not assumed:

1. The failure is `waitForAssistantResponse` timing out on
   `[data-role="assistant"]` — i.e. **no assistant reply ever arrived**, a
   provider outcome.
2. `OPENAI_API_KEY` is **UNSET** in this environment, and
   `tests/common/provider-helpers.ts:63-65` therefore falls back to
   `'sk-test-placeholder'` — the upstream call cannot succeed.
3. The failing helper sends via the **Send BUTTON**
   (`chat-helpers.ts:211,229`), and `ChatInput.tsx` — the button's handler — is
   **not in this diff at all** (`git diff --name-only … -- ChatInput.tsx` → 0
   files). The Enter-path guard cannot reach it.
4. Its sibling `chat-basic.spec.ts:97` passes only because it never awaits an
   assistant reply, so it is not counter-evidence that the LLM works.

No code change can make this pass here; it needs a real provider key.
