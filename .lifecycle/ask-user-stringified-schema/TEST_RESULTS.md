# TEST_RESULTS — phase 8

Every line below is an OBSERVED result from a run whose log is named. Logs live
under `/data/pbya/ziee/tmp/lifecycle-logs/`.

## Observed totals

| Scope | Command | Log | Result |
|---|---|---|---|
| Backend unit | `cargo test -p ziee --lib -- <9 module filters>` | `askuser-unit4.log` | **136 passed / 0 failed / 0 ignored** |
| Backend integration (elicitation) | `cargo test --test integration_tests -- mcp::elicitation_mcp_test` | `askuser-int2.log` | **16 passed / 0 failed** |
| Backend integration (citations) | `cargo test --test integration_tests -- citations::…stringified…` | `askuser-cit.log` | **2 passed / 0 failed** |
| Frontend unit | `node --import ./scripts/node-test-loader.mjs --test …elicitationOptions.test.ts` | — | **21 passed / 0 failed** |
| E2E (degraded card) | `npx playwright test tests/e2e/chat/ask-user-degraded-schema.spec.ts --workers=1` | `askuser-e2e.log` | **3 passed / 0 failed** |
| E2E (acceptance proof) | `npx playwright test tests/e2e/chat/ask-user-stringified-schema.spec.ts --workers=1` | `askuser-e2e3.log` | **1 passed / 0 failed** |

npm run check (ui): PASS

## Per-test results

- **TEST-1**: PASS
- **TEST-2**: PASS
- **TEST-3**: PASS
- **TEST-4**: PASS
- **TEST-5**: PASS
- **TEST-6**: PASS
- **TEST-7**: PASS
- **TEST-8**: PASS
- **TEST-9**: PASS
- **TEST-10**: PASS
- **TEST-11**: PASS
- **TEST-12**: PASS
- **TEST-13**: PASS
- **TEST-14**: PASS
- **TEST-15**: PASS
- **TEST-16**: PASS
- **TEST-17**: PASS
- **TEST-18**: PASS
- **TEST-19**: PASS
- **TEST-20**: PASS
- **TEST-21**: PASS
- **TEST-22**: PASS
- **TEST-23**: PASS
- **TEST-25**: PASS
- **TEST-26**: PASS
- **TEST-27**: PASS
- **TEST-28**: PASS
- **TEST-29**: PASS
- **TEST-30**: PASS
- **TEST-31**: PASS
- **TEST-32**: PASS
- **TEST-33**: PASS
- **TEST-34**: PASS
- **TEST-35**: PASS
- **TEST-36**: PASS
- **TEST-37**: PASS
- **TEST-39**: PASS
- **TEST-40**: PASS
- **TEST-41**: PASS
- **TEST-42**: PASS
- **TEST-43**: PASS

## NOT PASS — stated plainly

- **TEST-24** (integration: `invoke_capability` with a stringified body reaching
  the real loopback route): **NOT WRITTEN**. The `control_mcp` integration
  harness needs the full catalog + loopback plumbing, which did not fit this
  session. The unit-level proof exists and passes (TEST-22/23/25, incl. the
  conformance battery over `invoke_capability.body`), so the DECODE is covered;
  what is missing is the end-to-end proof that the decoded body reaches the real
  route and succeeds. Recorded as an honest gap, not marked PASS.
- **TEST-38** (real-LLM e2e no-regression leg): **NOT WRITTEN**. Its value is a
  no-regression check with a real model in the loop; the existing
  `chat/ask-user-real-llm.spec.ts` and `control/…for-input.spec.ts` already
  cover that surface and are unchanged by this diff. Not marked PASS.

Phase 8 therefore does NOT pass cleanly (the gate reports FAIL on the two
missing IDs), and this file says so rather than padding them into PASS lines.

## ACCEPTANCE — the design invariants, each proved by a test that RAN

Every `[acceptance]` test is green:

| Invariant | Proof | Result |
|---|---|---|
| INV-1 decode what the model meant | TEST-1, 17, 22, 26, 37, 40, 41 | PASS (incl. the e2e through the real backend) |
| INV-2 never invent a value | TEST-4 | PASS |
| INV-3 bounded unwrapping | TEST-3 | PASS |
| INV-4 size guard in both forms | TEST-12 | PASS |
| INV-5 every rejection is actionable | TEST-8, 14, 23 | PASS |
| INV-6 the rich-UX marker cannot be forged | TEST-10, 19 | PASS |
| INV-7 no card that lies | TEST-33, 36 | PASS |
| INV-8 no regression on working shapes | TEST-6, 11 | PASS |

The headline: **TEST-37** drove the exact reported payload through the real chat
loop, the real built-in, real SSE and the real renderer, and the card rendered
`step 1 of 3` — one wizard step per decoded property. On the pre-fix backend
`properties` is `{}`, so there are no steps at all.

## Known baseline breakage (NOT this branch)

`cargo check --workspace --tests` fails on the untouched base at
`agent-core/tests/real_llm_loop.rs:143/221` (`missing fields isolate_children
and schedule`). Reproduced at `d53db2d11` before any edit; `src-app/agent-core`
is not touched here. Backend scope is `-p ziee`, which is clean. See BASE.md.
