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
- **TEST-24**: PASS
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
- **TEST-38**: PASS
- **TEST-39**: PASS
- **TEST-40**: PASS
- **TEST-41**: PASS
- **TEST-42**: PASS
- **TEST-43**: PASS

## TEST-24 and TEST-38 — written and RUN in this round

Both were recorded as NOT WRITTEN in the previous round. They now exist, and the
numbers below are transcribed from runs whose logs are named.

### TEST-24 — integration, `control_mcp/stringified_args_test.rs`

```
cargo test --test integration_tests -- control_mcp::stringified_args_test --test-threads=1
→ test result: ok. 6 passed; 0 failed; 0 ignored     (test24-round2.log)
```

Six legs: `body` (single + double encoded, both reaching the real loopback route
and creating the row), the exclusive side of `MAX_STRING_UNWRAPS`, `query` (the
SILENT failure — a dropped query returned a plausible 200 for the wrong
question), `path_params`, and the actionable-refusal negative control.

**Verified DISCRIMINATING, not assumed.** With `decode_invoke_args` neutered to
`args.clone()` (the pre-fix behaviour), **all 6 legs go RED**
(`test24-tautology-guard3.log`: `0 passed; 6 failed`), and all 6 pass again once
it is restored.

An earlier revision of this file said "5 of the 6 — the sixth stays green by
design". That was measured before
`triple_stringified_body_is_refused_at_the_bound` gained its bound-exhausted
message assertion, and was left stale when the assertion landed. Re-measured
against the current file: pinning the text that only `coerce_value`'s bound arm
emits makes that leg discriminating too, because `validate_body`'s generic
scalar-reject — the refusal a neutered build produces — does not carry it.

The measurement also **corrected a false claim** written into the first draft of
this file: the pre-fix behaviour for these fixtures is NOT a 422 from the target
route (that path belongs to operations with no object `request_schema`) but a
pre-dispatch refusal. The assertion resting on it was removed rather than
reworded, because it compared against an absent `structuredContent` and passed
vacuously.

### TEST-38 — e2e, real model in the loop

```
npx playwright test tests/e2e/chat/ask-user-stringified-schema.spec.ts --workers=1
→ 2 passed (1.1m)     (test38-round2.log)
   ✓ TEST-37 the reported stringified schema renders its fields …
   ✓ TEST-38 an under-specified request renders an ask_user form with real fields (24.5s)
```

RUN, not skipped. It drove the **local Qwen bridge**
(`ZIEE_TEST_LLM_BASE_URL=http://localhost:4000/v1`,
`ZIEE_TEST_LLM_MODEL=qwen3.6-35b-a3b`, resolved through the shared `TEST_LLM`
seam), which was wired up for this run rather than left unconfigured.

**It contains no skip** — see DEC-21. TESTS.md enumerated it with a conditional
skip-on-`!TEST_LLM` guard; it is implemented as an unconditional `beforeAll`
precondition instead, because a missing LLM is a missing DEPENDENCY and not the
platform-incompatibility that is the only legitimate skip. **Verified the
precondition is not vacuous**: with every LLM env var unset it FAILS in 10s with
`no LLM configured at all (set OPENAI_API_KEY [+OPENAI_BASE_URL
+ZIEE_TEST_LLM_MODEL], or the Anthropic seam)`
(`test38-precondition-negative.log`) — before the per-test stack boots.

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

## A7 boot/runtime canary — RAN FOUR TIMES, FAILS, and FAILS ON THE BASE TOO

**gate:ui (ui): FAIL** — recorded as what it is.

> **Integrity note.** The previous revision of this file explained, in prose, that
> the canary was *not* being recorded as passing — and in doing so quoted the
> canary line verbatim. The gate's regex does not know prose from a verdict, so
> that quotation **accidentally satisfied the A7 check** and phase 8 reported the
> canary green. The branch's prior "8/9" therefore rested on an unintended false
> pass. The quotation is gone; the verdict line above is the only canary-shaped
> text in this file, and it says FAIL.

`tsc` **PASS**, `lint` **PASS**, `visual` skipped, `runtime-health` **FAIL**.

### Why this is not attributable to this branch — four measurements

| run | UI under test | port | verdict | failing surfaces |
|---|---|---|---|---|
| 1 | branch | :20181 (collided) | 69/209 | 17 |
| 2 | branch | :21500 isolated | 145/151 | 6 |
| 3 | branch | :21601 isolated | 145/151 | the same 6 |
| 4 | **base UI** (`origin/feat/agent-core`) | :21800 isolated | **177/182** | 5 — **disjoint** from runs 2/3 |
| 5 | branch | :22000 isolated | 161/171 | 3 — **disjoint from both** |
| 6 | branch | :22200 isolated | 193/194 | 1 — `settings-user-groups`, **disjoint again** |
| 7 | branch | :22402 isolated | 184/188 | 4 — hardware/download surfaces, **disjoint again** |

Three independent facts, each measured:

1. **The untouched BASE fails the same gate** (run 4 — the branch's own UI files
   were replaced with `origin/feat/agent-core`'s and the gate re-run in this same
   worktree). A7 is therefore a pre-existing base condition, not a regression
   introduced here.
2. **The failing set is non-deterministic across runs of the same commit** —
   runs 2/3, run 5, run 6 and run 7 produce FOUR mutually disjoint failing sets,
   and the count wanders 6 → 3 → 1 → 4 with no code change between them. A code
   defect does not migrate between disjoint surface sets, nor does the enumerated
   surface COUNT move (151 → 171 → 194 → 188) when the gallery is identical —
   that drift is the runtime-health pass losing surfaces as the dev server
   struggles, which is the same underlying instability.
3. **Every finding is a network-class dev-server failure** —
   `net::ERR_NETWORK_CHANGED` / `ERR_CONNECTION_REFUSED` and the
   `Failed to fetch dynamically imported module` errors downstream of them. Zero
   contrast failures, zero a11y-name findings, zero React warnings promoted to
   HIGH, zero crashes in run 5.

### The surfaces this branch actually owns are clean in EVERY run

`deep-chat-elicitation`, `deep-chat-ask-user-wizard`, `seeded-s1-elicit-error`
and the surface this branch ADDS — `deep-chat-elicitation-no-fields` — report
**0 HIGH findings** in every isolated run.

### Root cause of run 1, reproduced independently

The gate detects a foreign worktree on the base port, announces it will avoid it,
and then boots on the same port anyway:

```
• port :20181 holds a FOREIGN worktree's server (…/scheduler-layout-wt); NOT reusing — booting our own on a fresh port
• booting gallery dev server on :20181 …          ← the SAME port
```

`pickBindablePort(PORT_BASE)` returns the base port even when a foreign server is
already serving on it, so with `--strictPort` our Vite never binds, `waitForPort`
is satisfied by the FOREIGN server, and the whole runtime-health pass runs against
a sibling worktree's tree (`/@fs/data/pbya/ziee/tmp/scheduler-layout-wt/…`
appeared in 1248 findings). This is the exact "fixed-port false-pass" the
surrounding comment says the sentinel check exists to prevent — the detection
works, the mitigation does not.

**Deliberately NOT fixed here**: it is shared infrastructure
(`sdk/packages/gallery/scripts/gate-ui.mjs`), and editing the harness to make my
own gate green is what the rules forbid. Runs 2-5 avoided it with the **supported
`GALLERY_PORT` env knob** rather than a code change. Filed for the owner — it
explains a recurring, previously-unexplained `gate:ui` symptom across worktrees
and deserves its own change.

**A7 therefore remains RED, and phase 8 reports it.** It is not padded into a
pass, and the evidence shows the branch is not its cause.

## A1 `.lifecycle/` single-feature rule — BASE-CARRIED, not a stray of this branch

Phase 0 reports `.lifecycle/ has 18 feature dirs … a branch may carry exactly ONE`.
Seventeen of the eighteen come from the base branch, not from this one:

```
$ git ls-tree origin/feat/agent-core .lifecycle/
  agent-orchestration  background-in-conversation  chat-ui-robustness
  control-describe-schema  control-mcp-e2e-coverage  e2e-render-serving
  frontend-perf  hook-lint-guardrails  live-ui-audit-fixes
  live-ui-audit-round2  net-hygiene  perf-ux-round2  smart-module-loading
  sse-slot-leak  streamdown-html-renderer  workflow-kind-agent
  worktree-isolation                                        → 17 directories
```

This branch adds exactly one — `ask-user-stringified-schema` — bringing the total
to 18. It DELETES none, and deleting sixteen other features' lifecycle records to
turn a gate green would destroy other work to flatter this branch's scorecard.
Recorded as a base-carried exception and reported to the orchestrator rather than
"resolved". Sibling branches cut from the same base carry the identical failure.

