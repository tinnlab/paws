# TEST_RESULTS

Full logs under `/data/pbya/ziee/tmp/lifecycle-logs/tokfb-*.log`.

## Red → green (the reported defect)

**RED, on unmodified `origin/main` (`256a23930`)**, with `tests/.env.test`
sourced (`set -a`), `tokfb-e2e-RED.log`:

```
✘  1 … › lists installable versions and offers an Install action for each (44.4s)
✓  2 … › release-catalogue cache TTL persists, and an out-of-bounds value is refused (14.9s)
  1 failed
  1 passed (7.8m)
EXIT=1
```

Backend cause, verbatim from that run:

```
WARN ziee::modules::llm_local_runtime::engine::release_cache: engine release
catalogue unavailable and nothing cached engine=llamacpp
reason=Network error: Failed to list releases: HTTP 401 Unauthorized
```

**Note the report is half-disproved**: only ONE of the two tests fails on main.
`release-catalogue cache TTL persists…` PASSED. (Round 2 then found it was
passing for a bad reason — see below.)

Network-level reproduction, same box, same fork the downloader targets:

```
1. anonymous  GET api.github.com/repos/ziee-ai/llama.cpp/releases -> http=200
2. + Authorization: Bearer <tests/.env.test GITHUB_TOKEN>         -> http=401
   message: Bad credentials
3. HUGGINGFACE_API_KEY whoami                                     -> http=200
   type: user auth-ok: True     (so .env.test's HF key IS valid; its GH one is not)
anonymous rate budget at time of measurement: limit=60 remaining=41
```

**GREEN, on the branch**, `tokfb-e2e-R2FINAL.log`:

```
✓  1 … › lists installable versions and offers an Install action for each (15.6s)
✓  2 … › release-catalogue cache TTL persists, and a below-floor value is clamped, never stored (18.4s)
  2 passed (3.5m)
EXIT=0
```

Stability: the discovery spec passed **5 consecutive runs**; the pair passed 2
consecutive full-spec runs after the TTL race fix (`tokfb-e2e-FINAL2.log`).

## Backend

`cargo test --lib -p ziee llm_local_runtime::engine::` — `tokfb-unit5.log`:

```
test result: ok. 39 passed; 0 failed; 0 ignored; 0 measured; 1520 filtered out
UNIT=0
```

`cargo test --test integration_tests llm_local_runtime::github_credential -- --test-threads=1`
— `tokfb-int5.log`:

```
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 2563 filtered out
INT=0
```

`cargo check -p ziee --tests` → exit **0** (`tokfb-check2.log`, re-verified after
the round-2 re-splice).

## Frontend

`npx vitest run src/modules/llm-local-runtime/` → **13 passed** (component) +
**3 passed** (store wiring), and each was **mutation-verified**:

- removing the credential notice → `2 failed | 5 passed`, restored → `7 passed`
- deleting the `credential_status` store mapping → `3 failed | 6 passed`,
  restored → `9 passed`

```
npm run check (ui): PASS                 (tokfb-check-ui-r2.log, EXIT=0)
npm run check (desktop/ui): PASS         (tokfb-check-desktop-r2.log, EXIT=0)
gate:ui (ui): PASS                       (tokfb-gateui.log, GATEUI_EXIT=0)
```

`gate:ui` detail (exit code captured with `set -o pipefail`, not from a tail):

```
=== runtime-health: 448 findings (HIGH 0 gating + 2 harness-noise + 2 baselined
    / MEDIUM 115 / LOW 329) ===
  validity: 688/688 cells · origin alive (99 checks) · transport artifacts 0
  0 surface(s) with gating HIGH findings
  PASS  tsc | PASS  lint | PASS  runtime-health | PASS  visual
✅ GATE PASSED — every UI DONE criterion met
```

## Per-test

- **TEST-1**: PASS — `only_self_identifying_credential_refusals_trigger_the_fallback`
- **TEST-2**: PASS — `github_token_forwards_every_shape_and_filters_only_emptiness`
- **TEST-3**: PASS — `valid_token_stays_authenticated_with_exactly_one_request`
- **TEST-4**: PASS — `rejected_token_falls_back_to_anonymous_and_discovery_succeeds`
- **TEST-5**: PASS — `rate_limited_token_does_not_trigger_anonymous_retry`
- **TEST-6**: PASS — `rejected_credential_is_distinguishable_from_an_outage`
- **TEST-7**: PASS — `rejected_credential_survives_cache_hit_and_retain_on_failure`
- **TEST-8**: PASS — `credential_status_wire_vocabulary_and_failure_note`
- **TEST-9**: PASS — e2e `lists installable versions and offers an Install action for each`
- **TEST-10**: PASS — e2e `release-catalogue cache TTL persists, and a below-floor value is clamped, never stored`
- **TEST-11**: PASS — `AvailableVersionsCard.test.tsx` (7 cases, mutation-verified)
- **TEST-12**: PASS — gallery state coverage via `check:state-matrix` inside `npm run check`
- **TEST-13**: PASS — SURVEY.md completeness, verified mechanically: `rg -c 'GITHUB_TOKEN|GH_TOKEN' --type rust --type ts src-app/` → every runtime hit is `llm_local_runtime/engine/download.rs`; `GH_TOKEN` has **0** hits in server/desktop source (workflows only). Both facts are stated in SURVEY.md.
- **TEST-14**: PASS — `rejection_the_fallback_cannot_rescue_terminates_and_is_explained`
- **TEST-15**: PASS — `a_transient_failure_is_retried_and_is_not_a_credential_problem`
- **TEST-16**: PASS — `a_token_present_through_a_total_outage_is_unverified_not_used`
- **TEST-17**: PASS — `checkForUpdates.credential.store.test.ts` (3 cases, mutation-verified)
- **TEST-18**: PASS — stale-comment removal, verified mechanically: `rg -n 'hub_seed' src-app/server/src/modules/llm_local_runtime/engine/download.rs` → **no matches**; `rg -n 'GITHUB_TOKEN' src-app/server/build_helper/hub_seed.rs` → exactly **one** hit, and it is line 26 of the header's "What this REPLACES (deleted with the Pages migration)" list — `//!   - HUB_RELEASE_TAG pinning + GITHUB_TOKEN handling`. So the helper has no token CODE, and the comment removed from `download.rs` was, and remains, false.
- **TEST-19**: PASS — `an_answered_but_unserved_request_leaves_the_credential_unverified`
- **TEST-20**: PASS — `credential_is_withheld_from_untrusted_targets`
- **TEST-21**: PASS — covered by TEST-9's row assertion (the React #321 catch)
- **TEST-22**: PASS — covered by TEST-10 (awaited save + clamp assertions)

## Deterministic checks

- **A2** clean tree — everything committed on the branch.
- **A3** no diff-added `#[ignore]` / `.skip` / `.only`.
- **A4** no cosmetic assertion; every new test was checked against a concrete
  mutation (see FIX_ROUND-1/2).
- **A5** TESTS.md only grew (8 → 22 IDs).
- **A7** `gate:ui (ui): PASS`, exit code captured with `set -o pipefail`.
- **A8** n/a — no new built-in MCP server.
- **A9/A10** n/a — **no permission is introduced**; both endpoints keep the
  pre-existing `RuntimeVersionRead` gate unchanged.
- **R2-5** the diff adds no `page.route()` API mock (the repo forbids them and
  DEC-4 keeps the e2e on the real backend).
- **Migrations**: none added; highest server prefix unchanged at `202607200600`.
- **Diff hygiene**: `download.rs` carries **0** unrelated deleted lines — a
  whole-file `rustfmt` twice reintroduced ~175 lines of churn in pre-existing
  code and was reverted both times by re-splicing only the changed regions onto
  the committed baseline. The repo is not default-rustfmt-clean; the added code
  is (verified by copy-format-diff).

## Acceptance tests (design invariants) — all PASS

| INV | proof | result |
|---|---|---|
| INV-1 | TEST-1, TEST-4 (+ TEST-9 on the real path) | PASS |
| INV-2 | TEST-6, TEST-16, TEST-19 | PASS |
| INV-3 | TEST-2 | PASS |
| INV-4 | TEST-3 | PASS |
