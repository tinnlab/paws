# TESTS — local-model / local-runtime install path

Every ITEM is covered by ≥1 TEST; every `INV-N` is pinned by ≥1 `[acceptance]`
test that would go RED if the invariant were violated. No new permission is
introduced by this branch (discovery reuses `RuntimeVersionRead`, the probe
reuses `LlmRepositoriesEdit`), so no `[negative-perm]` spec is required — but
both endpoints keep their existing 401/403 coverage, re-asserted below.

**Rejection tests always ship with their happy-path counterpart in the same
test**, so a rejection that passes because the endpoint is broken some other way
cannot go unnoticed.

## §1 Discovery

- **TEST-1** (tier: integration) [acceptance] [invariant: INV-1] [covers: ITEM-3, ITEM-7] file: `src-app/server/tests/llm_local_runtime/available_versions_test.rs` — asserts: starting from a server with ZERO installed versions, `GET /local-runtime/versions` returns an empty list, and `GET /local-runtime/versions/available` then yields a five-tuple `(engine, version, platform, arch, backend)` which is fed VERBATIM into `POST /local-runtime/versions/download` and succeeds — i.e. discovery alone is sufficient to install, with no hardcoded tag anywhere in the test. Negative control in the same test: a tag NOT in the discovery output is rejected by download with an error naming the discovery endpoint.
- **TEST-2** (tier: integration) [covers: ITEM-3] file: `src-app/server/tests/llm_local_runtime/available_versions_test.rs` — asserts: `GET /local-runtime/versions/available` resolves to the discovery handler and is NOT shadowed by `/versions/{version_id}` (no UUID-parse 400), while `GET /local-runtime/versions/{a-real-uuid}` still resolves to the by-id handler in the same test — the literal-vs-parameter precedence proven both ways, not assumed.
- **TEST-3** (tier: integration) [covers: ITEM-3] file: `src-app/server/tests/llm_local_runtime/available_versions_test.rs` — asserts: each release reports EVERY published variant as `(platform, arch, backend, size_bytes)`, including variants for a platform/arch that is NOT the test host, and the `?engine=` filter narrows to one engine while its absence returns all engines.
- **TEST-4** (tier: integration) [acceptance] [invariant: INV-2] [covers: ITEM-1, ITEM-4] file: `src-app/server/tests/llm_local_runtime/release_cache_test.rs` — asserts: with the mock release server COUNTING requests, N successive discovery calls within the TTL produce exactly ONE upstream request (`source: "cache"` on calls 2..N, `source: "live"` on the first); then the mock is taken down and a further call still returns the previously-listed versions with `source: "cache"`, a `checked_at`, and a non-null `unavailable_reason` — never an empty list, and never a 5xx. Happy-path counterpart in the same test: while the mock is up the response is `source: "live"` with `unavailable_reason` null.
- **TEST-5** (tier: integration) [covers: ITEM-1, ITEM-6] file: `src-app/server/tests/llm_local_runtime/release_cache_test.rs` — asserts: `PUT /local-runtime/settings` with `engine_release_cache_ttl_secs` out of bounds (59 and 86401) is rejected 400 AND an in-bounds value (120) is accepted and read back — rejection plus happy path in one test; a TTL of 60s honoured such that a call after simulated expiry re-fetches (`source: "live"`).
- **TEST-6** (tier: unit) [covers: ITEM-1] file: `src-app/server/src/modules/llm_local_runtime/engine/release_cache.rs` — asserts: the cache's pure logic — a fresh entry within TTL is served as `cache`, an entry past TTL is stale, and a failed refresh RETAINS the prior entry rather than evicting it (the specific behaviour that stops a rate-limited box from collapsing to an empty list).
- **TEST-7** (tier: unit) [covers: ITEM-2] file: `src-app/server/src/modules/llm_local_runtime/engine/download.rs` — asserts: the GitHub request builder attaches an `Authorization` header when `GITHUB_TOKEN` is set and attaches none when it is unset, and the token never appears in the struct's `Debug` output or in any produced error string.
- **TEST-8** (tier: integration) [covers: ITEM-5] file: `src-app/server/tests/llm_local_runtime/release_cache_test.rs` — asserts: the pre-existing `GET /versions/{engine}/check-updates` keeps every field it had (`versions[]`, `binary_ready`, `installed`, `available_backends`, `size_bytes`, `platform`, `arch`) AND gains `source`/`checked_at`, and that a second call within TTL issues no additional upstream request.
- **TEST-9** (tier: integration) [covers: ITEM-3] file: `src-app/server/tests/llm_local_runtime/available_versions_test.rs` — asserts: the discovery endpoint requires auth (401 unauthenticated) and requires `RuntimeVersionRead` (403 for a user without it), with the permitted user succeeding in the same test as the positive control.
- **TEST-10** (tier: e2e) [acceptance] [invariant: INV-1] [covers: ITEM-8] file: `src-app/ui/tests/e2e/local-runtime/version-discovery.spec.ts` — asserts: on the runtime settings page an admin who has typed nothing SEES a list of installable versions with their sizes and CHOOSES one via an Install control — the version string is READ OFF the rendered row, never hardcoded or typed into a field.
- **TEST-11** (tier: unit) [acceptance] [invariant: INV-2] [covers: ITEM-4, ITEM-8] file: `src-app/ui/src/modules/llm-local-runtime/components/AvailableVersionsCard.test.tsx` — asserts: in a mounted component harness (the real card, jsdom), with the feed unreachable and nothing cached the card SAYS so and specifically does NOT render "No published binaries" (the pre-fix sentence, which claims upstream published nothing); and with a stale cache it STILL lists the installable rows, labelled with when they were last refreshed. Positive control in the same file: a live catalogue renders rows + Install actions and shows neither degradation affordance.
- **TEST-12** (tier: unit) [covers: ITEM-8] file: `src-app/ui/src/modules/llm-local-runtime/components/AvailableVersionsCard.test.tsx` — asserts: a SUCCESSFUL check that returned no host-ready builds still reports upstream as empty ("No published binaries"), so the genuinely-empty case stays distinguishable from the unreachable one — the distinction INV-2 turns on. Separate assertion from TEST-11's, in the same file.

## §2 Progress

- **TEST-13** (tier: integration) [acceptance] [invariant: INV-3] [covers: ITEM-9] file: `src-app/server/tests/llm_model/download_progress_test.rs` — asserts: for a download driven to genuine success, `GET /llm-models/downloads/{id}` reports `status == "completed"` AND `progress_data.current == progress_data.total` with `total > 0` and `phase == "complete"` — i.e. the exact contradiction reported (`completed` + `committing` 90/100) is impossible. This assertion fails against the pre-fix code.
- **TEST-14** (tier: integration) [covers: ITEM-10] file: `src-app/server/tests/llm_model/download_progress_test.rs` — asserts: a download that FAILS keeps its progress frozen at the point it stopped (not fabricated to 100%), while a completed one in the same test reads 100% — the pair pins that "make status and progress consistent" was not implemented as "always report 100%".
- **TEST-15** (tier: unit) [covers: ITEM-9] file: `src-app/server/src/modules/llm_model/models.rs` — asserts: the terminal-complete progress snapshot preserves a pre-existing non-zero `total` and falls back to a sane 100 when `total` was 0, so a download whose total was never known still reads 100% rather than 0/0.
- **TEST-16** (tier: e2e) [covers: ITEM-9] file: `src-app/ui/tests/e2e/llm/llm-models-local-download.spec.ts` — asserts: the rendered download bar reads 100% (not 90%) once the download reports completed, on the surface that binds to `current/total`.

## §3 Validation

- **TEST-17** (tier: integration) [acceptance] [invariant: INV-4] [covers: ITEM-11, ITEM-12] file: `src-app/server/tests/llm_repository/capability_probe_test.rs` — asserts: a loopback host that answers `200` to ANY GET with a non-model body (the shape a web/dev server has — precisely the `http://127.0.0.1:<vite>/models` case) is NOT reported `healthy`; and, in the same test, a host serving a real model-listing payload IS reported `healthy`. The two halves together prove the probe discriminates rather than merely being stricter.
- **TEST-18** (tier: integration) [acceptance] [invariant: INV-4] [covers: ITEM-12] file: `src-app/server/tests/llm_repository/capability_probe_test.rs` — asserts: a reachable host whose kind cannot be classified is recorded `unverified`, and the repository remains ENABLED (not auto-disabled); while a genuinely failing probe in the same test is recorded `unhealthy` AND auto-disables — the pair proving `unverified` is a distinct outcome and not a rename of either neighbour.
- **TEST-19** (tier: integration) [covers: ITEM-11] file: `src-app/server/tests/llm_repository/capability_probe_test.rs` — asserts: a host that returns 200 with a body that is valid JSON but NOT a model listing is rejected, so the check is a shape assertion and not merely "the body parsed as JSON".
- **TEST-20** (tier: unit) [covers: ITEM-13] file: `src-app/server/src/modules/llm_repository/utils.rs` — asserts: host-kind derivation treats `huggingface.co` and `sub.huggingface.co` as Hugging Face, and does NOT treat `https://evil.example/huggingface.co` or `https://huggingface.co.evil.example` as Hugging Face — the substring bug that leaks the bearer token, with the true-positive counterpart in the same test.
- **TEST-21** (tier: unit) [covers: ITEM-11] file: `src-app/server/src/modules/llm_repository/utils.rs` — asserts: the model-listing shape predicate accepts a real Hugging Face `/api/models` payload and rejects an HTML document, an empty object, and a JSON array of non-model objects.
- **TEST-22** (tier: integration) [covers: ITEM-12] file: `src-app/server/tests/llm_repository/connection_health_test.rs` — asserts: the existing by-id probe endpoint keeps its auth gate (401 unauthenticated, 403 without `LlmRepositoriesEdit`, success with it) and still emits its sync event, with the three outcomes now round-tripping through `last_health_check_status`.
- **TEST-23** (tier: e2e) [acceptance] [invariant: INV-4] [covers: ITEM-14] file: `src-app/ui/tests/e2e/llm/llm-repository-health-8-unverified.spec.ts` — asserts: a repository whose capability could not be confirmed is shown to the user as unverified — visibly distinct from a confirmed-healthy repository rendered in the same spec (the positive control), so "healthy" is never displayed for an unconfirmed repository.
- **TEST-24** (tier: unit) [covers: ITEM-14] file: `src-app/ui/src/modules/llm-repository/components/LlmRepositoryHealth.test.tsx` — asserts: the three health states render distinct, non-empty affordances, and `unverified` renders neither the healthy nor the unhealthy treatment.

## §1 Settings surface

- **TEST-25** (tier: e2e) [covers: ITEM-6] file: `src-app/ui/tests/e2e/local-runtime/version-discovery.spec.ts` — asserts: an admin edits the release-catalogue TTL on the runtime settings card and the value persists across a reload; an out-of-bounds value is refused and does NOT replace the stored value (rejection + happy path in one spec).

## Coverage map

| ITEM | covered by |
|---|---|
| ITEM-1 | TEST-4, TEST-5, TEST-6 |
| ITEM-2 | TEST-7 |
| ITEM-3 | TEST-1, TEST-2, TEST-3, TEST-9 |
| ITEM-4 | TEST-4, TEST-11 |
| ITEM-5 | TEST-8 |
| ITEM-6 | TEST-5, TEST-25 |
| ITEM-7 | TEST-1 |
| ITEM-8 | TEST-10, TEST-11, TEST-12 |
| ITEM-9 | TEST-13, TEST-15, TEST-16 |
| ITEM-10 | TEST-14 |
| ITEM-11 | TEST-17, TEST-19, TEST-21 |
| ITEM-12 | TEST-17, TEST-18, TEST-22 |
| ITEM-13 | TEST-20 |
| ITEM-14 | TEST-23, TEST-24 |

| INV | pinned by |
|---|---|
| INV-1 | TEST-1 (integration), TEST-10 (e2e) |
| INV-2 | TEST-4 (integration), TEST-11 (mounted component harness) |
| INV-3 | TEST-13 (integration) |
| INV-4 | TEST-17, TEST-18 (integration), TEST-23 (e2e) |
