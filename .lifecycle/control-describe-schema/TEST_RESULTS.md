# TEST_RESULTS — control-describe-schema

Every number below is transcribed from a real run in this worktree against the
configured test LLM (`provider=OpenAI model=qwen3.6-35b-a3b
base_url=http://localhost:4000/v1` — the local Qwen bridge). Logs under
`/data/pbya/ziee/tmp/lifecycle-logs/`.

## Commands + observed output

```
cargo test -p ziee --lib -- control_mcp::
  → test result: ok. 41 passed; 0 failed; 0 ignored

cargo test -p ziee-control-mcp
  → test result: ok. 18 passed; 0 failed; 0 ignored

cd sdk && cargo test -p ziee-framework permissions::
  → test result: ok. 3 passed; 0 failed; 0 ignored

cargo test -p ziee --lib -- types_ts_parity
  → test result: ok. 2 passed; 0 failed; 0 ignored     (BOTH binaries' goldens)

source tests/.env.test
cargo test --test integration_tests control_mcp:: -- --test-threads=4
  → test result: ok. 31 passed; 0 failed; 0 ignored     (cds-int2.log)
```

The integration run includes the two real-LLM control tests
(`real_llm_discovers_capabilities`, `real_llm_write_requires_approval`) — they
executed, they did not self-skip.

## Per-TEST results

Unit — the `$ref` inliner (`schema_inline.rs`)

- **TEST-1**: PASS
- **TEST-2**: PASS
- **TEST-3**: PASS
- **TEST-4**: PASS
- **TEST-5**: PASS  *(acceptance, INV-1)*
- **TEST-6**: PASS
- **TEST-7**: PASS  *(acceptance, INV-3)*
- **TEST-8**: PASS  *(acceptance, INV-3)*
- **TEST-9**: PASS
- **TEST-10**: PASS *(acceptance, INV-2)*
- **TEST-11**: PASS
- **TEST-12**: PASS

Unit — catalog permission extraction

- **TEST-13**: PASS
- **TEST-14**: PASS — rewritten in fix-round 1 to pin the new precedence
  (extension → 403 example → description marker) and the full ALL-of set.

Unit — the digest and the model-facing text

- **TEST-15**: PASS
- **TEST-16**: PASS *(acceptance, INV-6)*
- **TEST-17**: PASS *(acceptance, INV-5)*
- **TEST-18**: PASS
- **TEST-19**: PASS *(acceptance, INV-6)*

Integration — the real JSON-RPC endpoint

- **TEST-20**: PASS
- **TEST-21**: PASS *(acceptance, INV-1)* — swept 250+ live operations, ≥40 with
  a body; this is the test that caught the un-inlined `parameters` schemas.
- **TEST-22**: PASS
- **TEST-23**: PASS *(acceptance, INV-4)*
- **TEST-24**: PASS
- **TEST-26**: PASS — catalog-wide: no permission-gated operation reports null
  (added in fix-round 1; this is the test that would have caught the residual
  18-operation class the first fix left behind).
- **TEST-27**: PASS — an ALL-of operation reports every permission, and holding
  one of a pair does not unlock it.

E2E

- **TEST-25**: PASS — `control-ask-user-for-input.spec.ts`, real Qwen, 25.9s.
  Asked "I want to create a new project" with no details, the model renders the
  `ask_user` form; the backend log shows
  `Parsed as MCP content: "ToolUse(ask_user)"`. This is the executable proof of
  INV-5 / defect 2.
  First run FAILED twice on an over-narrow field selector (`input, textarea,
  [role=radio], [role=checkbox]` — the wizard also renders Switch/Select/
  DatePicker) while the card itself rendered correctly; fixed to the per-field
  testid. Recorded rather than quietly re-run.

Regression on the pre-existing control e2e (not enumerated in phase 3; run
because this feature changes what those specs assert):

- `control-negative-perm.spec.ts` "NOT OFFERED": PASS
- `control-negative-perm.spec.ts` chat-UI leg: PASS
- `control-negative-perm.spec.ts` "unpermitted write is REFUSED": PASS after the
  assertion was re-anchored. The first re-run FAILED with
  `Received: "operation 'Project.create' is not available to you"` against a
  `/403|forbidden|permission/i` pattern — because the refusal now comes from the
  catalog filter BEFORE the loopback dispatch, which is strictly earlier and
  tighter than the 403 the test was written against. Recorded rather than
  quietly widened: the spec now states which layer refuses and why that changed.

Final: `control-negative-perm.spec.ts` → **3 passed (1.7m)** (cds-e2e3.log).

## Frontend gates

```
cd src-app/ui         && npm run check   → PASS (exit 0)
cd src-app/desktop/ui && npm run check   → PASS (exit 0)
```

`npm run check (ui): PASS`
`npm run check (desktop/ui): PASS`

## Not yet green — stated plainly

- **`gate:ui (ui)`: FAIL — harness-originated, NOT attributable to this branch.**
  Two full runs, both FAIL on `runtime-health`, and the evidence is consistent:

  | run | verdict | failing surfaces |
  |---|---|---|
  | 1 | 202/204 | `chat` (HIGH 772), `auth` (HIGH 536) |
  | 2 | 195/205 | seven `overlay-*` surfaces (HIGH 37–360) |

  **The failing surfaces are disjoint between runs** — the signature of flake,
  not a defect. And in run 2, **100 % of the HIGH findings are the same thing**:
  3,405 `console-error — Failed to load resource: net::ERR_NETWORK_CHANGED`
  plus ~1,200 `request-failed` on Vite module loads
  (`GET http://localhost/@fs/…/node_modules/.vite/…`,
  `…/sdk/packages/kit/src/shadcn/…`) — against a **portless**
  `http://localhost/`, i.e. the gallery dev server dropping mid-run. Run 1's
  findings additionally carried `harness: true`.

  Causal check: this branch changes **zero** files under `src-app/ui/src`,
  `src-app/desktop/ui/src` or `sdk/packages/**`
  (`git diff origin/feat/agent-core...HEAD --name-only` over those paths is
  empty), and `types.ts` / `api-client/*` are byte-unchanged — the gallery build
  is identical to the base's. The modules failing to load
  (`sdk/packages/kit/src/shadcn/*`) are ones the diff never touches.

  Both runs logged `reusing THIS worktree's gallery dev server already on
  :20004` — the stale-Vite failure mode CLAUDE.md documents. A third run was
  started after `pkill -f "vite --config"` (port verified free) and had not
  produced a verdict when this record was written.

  **This is an open item, not a pass.** The line below must read PASS before
  merge; it does not yet. What is NOT in doubt is that the cause lies in the
  harness/box rather than this diff — but that argument is evidence, not a
  green gate, and it is recorded as such.

  `gate:ui (ui): FAIL (harness — see above; re-run required before merge)`

- **Phase 0 / A1 fails with 17 `.lifecycle` feature dirs.** Inherited from
  `origin/feat/agent-core`, which carries 16 before this branch adds its own; the
  sibling in-flight branch fails it identically at 16. Not caused here and
  deliberately not "fixed" — see DEC-13. Every per-phase gate 1–8 is green.

## Full-suite scope

Only `control_mcp::` was run, per the scope-tests-to-the-change rule. The diff
touches `modules/control_mcp/**`, two SDK crates and two e2e specs; no other
module's code path changes. `types_ts_parity` covers the openapi/types regen the
SDK change forced, for both binaries.
