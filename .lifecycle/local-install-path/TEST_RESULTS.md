# TEST_RESULTS — local-model / local-runtime install path

Full integration log: `/data/pbya/ziee/tmp/lifecycle-logs/local-install-path-int.log`

Commands (env sourced with `set -a; . server/tests/.env.test; set +a` — plain
`source` does not export to the spawned server subprocesses):

```
cargo test -p ziee --lib -- llm_local_runtime::engine llm_model::models llm_repository
  → test result: ok. 74 passed; 0 failed; 0 ignored

cargo test -p ziee --test integration_tests -- --test-threads=4 \
    llm_local_runtime:: llm_model:: llm_repository::
  → test result: FAILED. 239 passed; 2 failed; 0 ignored   (see "Environmental" below)

cd src-app/ui && npx vitest run \
    src/modules/llm-local-runtime/components/AvailableVersionsCard.test.tsx \
    src/modules/llm-repository/components/LlmRepositoryHealth.test.tsx
  → Test Files 2 passed (2) · Tests 9 passed (9)
```

## Per enumerated TEST-ID

### §1 Discovery
- **TEST-1**: PASS — `discovery_alone_yields_an_installable_five_tuple` + `undiscovered_version_is_refused_with_an_actionable_error`
- **TEST-2**: PASS — `available_literal_and_uuid_routes_coexist`
- **TEST-3**: PASS — `reports_all_published_variants_and_filters_by_engine`
- **TEST-4**: PASS — `discovery_is_cached_and_degrades_honestly_when_upstream_is_gone` + `unreachable_upstream_with_empty_cache_reports_a_reason_not_an_empty_list`
- **TEST-5**: PASS — `release_cache_ttl_is_bounded_and_persisted`
- **TEST-6**: PASS — `freshness_follows_ttl`, `second_read_within_ttl_does_not_refetch`, `failed_refresh_retains_previous_catalog`, `failure_with_empty_cache_is_unavailable_with_reason`
- **TEST-7**: PASS — `github_token_is_read_and_blank_is_treated_as_absent`
- **TEST-8**: PASS — `check_updates_keeps_its_contract_and_is_cached`
- **TEST-9**: PASS — `discovery_requires_versions_read_permission`
- **TEST-10**: NOT RUN — see "Not run" below
- **TEST-11**: PASS — `AvailableVersionsCard.test.tsx` (unreachable + stale-cache states)
- **TEST-12**: PASS — `AvailableVersionsCard.test.tsx` (genuinely-empty stays distinguishable)

### §2 Progress
- **TEST-13**: PASS — `completed_download_reports_full_progress`
- **TEST-14**: PASS — `failed_download_freezes_progress_while_completed_reports_full`
- **TEST-15**: PASS — `terminal_progress_tests::*` (4 cases)
- **TEST-16**: NOT RUN — see "Not run" below

### §3 Validation
- **TEST-17**: PASS — `reachable_web_server_is_not_healthy_while_a_model_listing_is`
- **TEST-18**: PASS — `unverified_keeps_the_row_enabled_while_a_real_failure_auto_disables`
- **TEST-19**: PASS — `valid_json_that_is_not_a_model_listing_is_rejected`
- **TEST-20**: PASS — `repository_kind_matches_host_suffix_not_substring`, `hugging_face_bearer_branch_follows_host_not_substring`
- **TEST-21**: PASS — `model_listing_predicate_accepts_real_payload_and_rejects_lookalikes`, `github_catalog_predicate_accepts_rest_root_and_rejects_lookalikes`
- **TEST-22**: PASS — `llm_repository::connection_health_test::*` (53 repository integration tests green)
- **TEST-23**: NOT RUN — see "Not run" below
- **TEST-24**: PASS — `LlmRepositoryHealth.test.tsx`
- **TEST-25**: NOT RUN — see "Not run" below

Added during implementation (not in the phase-3 enumeration; the residual gap it
closes was found by re-checking the fix against the ORIGINAL reproduction):
- **`only_a_clonable_github_origin_can_be_verified`**: PASS — `https://api.github.com`
  (one of the three reported rows) shares the `.github.com` suffix that selects
  the GitHub kind, and the REST catalogue genuinely answers for it, so the
  capability probe ALONE still reported it `healthy`. It is now `unverified`.

## Red → green (verbatim)

**TEST-13 / INV-3.** With `llm_model/repository.rs` reverted to its pre-fix state
(`git stash push` of that one file), the acceptance test fails on the exact
reported contradiction:

```
thread '...completed_download_reports_full_progress' panicked at
  server/tests/llm_model/download_progress_test.rs:784:5:
assertion `left == right` failed: INV-3: a download reported `completed` must
  report 100%, not 90/100 (phase=committing) — this is the reported defect
  left: 90
 right: 100
test result: FAILED. 0 passed; 1 failed
```

With the fix restored (verified byte-identical via `diff -q`):

```
test result: ok. 1 passed; 0 failed
```

**TEST-11 / INV-2.** With the card's two degradation branches disabled to
reproduce the pre-fix render, the degradation tests fail while the two positive
controls stay green — i.e. the tests discriminate rather than merely being
strict:

```
 × an unreachable feed with no cache says so, and never claims upstream is empty
 × a stale cached catalogue still lists installable versions, labelled
AssertionError: expected null not to be null
      Tests  2 failed | 2 passed (4)
```

Restored: `Tests 4 passed (4)`.

## Frontend gate

- `npm run check (ui): PASS` — exit 0. The full chain: tsc + biome guardrails +
  lint:colors/settings-field/adjacent-inline/icon-action/hooks/logical-direction/
  tooltip-placement + check:kit-manifest/testid-registry/design-spec/
  gallery-coverage/gallery-crawl/state-matrix/overlay-registry/override-registry/
  gallery-seed-registry/store-actions/harness-parity + the hook-gate,
  gallery-script and gate-ui-stale test suites.
  (`check:state-matrix` failed on the first run — the two new conditional
  renders in `AvailableVersionsCard` needed a regenerated matrix; regenerated
  and committed, then green.)
- `npm run check (desktop/ui): PASS` — exit 0 (114 tests pass).
- `tsc --noEmit (ui)`: PASS (exit 0); `tsc --noEmit (desktop/ui)`: PASS (exit 0)
- `check:testid-registry (ui)`: PASS — `testIds.generated.ts up to date (1790 ids)`
- `cargo check -p ziee --tests`: PASS — 0 errors

`npm run gate:ui` (runtime-health boot canary + Layer A/axe + visual regression)
has **not** been run — see "Not run".

## Environmental failures (Category A — NOT regressions)

2 of the 241 integration tests fail, both pre-existing:

```
llm_model::repo_files_real_test::test_detect_github_tree
llm_model::repo_files_real_test::test_detect_not_found_returns_404

assertion `left == right` failed: body:
  {"error":"GitHub rejected the request (auth required or rate-limited)",
   "error_code":"UPSTREAM_REJECTED"}
  left: 403
 right: 200
```

Classified, not assumed:

1. The tests **require** a real token by construction —
   `repo_files_real_test.rs:183` does `std::env::var("GITHUB_TOKEN").expect(...)`
   and configures the repository row with it.
2. `tests/.env.test` ships the documented **placeholder** `GITHUB_TOKEN=ghp_xxx…`,
   which GitHub rejects with 403. Verified by printing `${GITHUB_TOKEN:0:7}` → `ghp_xxx`.
3. **Not** rate-limit exhaustion: re-run in isolation with the budget at
   `core limit 60 remaining 60 used 0` and they still 403.
4. With `GITHUB_TOKEN` unset they fail earlier still, at the `expect` on line 183.
5. This branch does not touch either file:
   `git diff --stat c7456cec6...HEAD -- .../repo_files_real_test.rs .../llm_model/handlers/`
   is **empty**.

This matches the documented test-environment floor in CLAUDE.md
("needs real GitHub … ships a placeholder `GITHUB_TOKEN=ghp_xxx…`; export a real
read-only token or expect-skip").

## Not run (stated, not silently omitted)

- **TEST-10, TEST-16, TEST-23, TEST-25** (Playwright e2e) — not executed. The
  specs are written and committed; they have never been observed green, so they
  are recorded NOT RUN rather than PASS.
- **`npm run gate:ui`** (the A7 boot/runtime canary + Layer A/axe + visual
  regression) — not run. `npm run check` covers the static contract and passes
  in both workspaces, but the runtime canary is a separate, unrun step.

Phase 8 is therefore **not** satisfiable on this evidence, and is not claimed to
be. What is claimed is exactly what was observed.
