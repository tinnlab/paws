# TESTS — github-token-fallback

Every ITEM is covered; every `INV-N` is pinned by an `[acceptance]` test that
would FAIL if the invariant were violated.

## Tier-1 unit (in-source `#[cfg(test)]`, no network)

- **TEST-1** (tier: unit) [acceptance] [invariant: INV-1] [covers: ITEM-2] file: `src-app/server/src/modules/llm_local_runtime/engine/download.rs` — asserts: `is_auth_rejection` is true for 401 and for `403` + `X-GitHub-SSO`, and FALSE for every other 403 (bare, rate-limited, budget-remaining, retry-after) and for 200/404/429/500/503 — i.e. a credential rejection and a refusal of an ACCEPTED credential are two outcomes, not one. Widening the predicate to all of `401 | 403` (the intuitive implementation) turns this red, and so does narrowing it back to `401` alone (which would leave a SAML-SSO operator with the original defect).
- **TEST-2** (tier: unit) [acceptance] [invariant: INV-3] [covers: ITEM-2] file: `src-app/server/src/modules/llm_local_runtime/engine/download.rs` — asserts: with the process credential VARIED across five real GitHub token formats (`ghp_`/`github_pat_`/`ghs_`/`gho_`/opaque), the classifier's verdict is observed not to move (a runtime observation that fails against any implementation reaching for the ambient token — the shape check INV-3 forbids), AND `github_token()` forwards every one of those shapes. A shape-validating implementation cannot satisfy both halves. Takes `ENV_LOCK`, since `GITHUB_TOKEN` is process-global.
- **TEST-8** (tier: unit) [covers: ITEM-1] file: `src-app/server/src/modules/llm_local_runtime/engine/download.rs` — asserts: `CredentialStatus::as_str()` maps to exactly `absent|used|unverified|rejected` (the wire vocabulary, duplicated in three places that cannot import each other: this enum, the OpenAPI doc-comment, and the TS union), and that only a rejection annotates a failing read's reason, naming the VARIABLE.
- **TEST-7** (tier: unit) [covers: ITEM-5] file: `src-app/server/src/modules/llm_local_runtime/engine/release_cache.rs` — asserts: a fetch that reports `Rejected` stores that on the entry, and BOTH cache-serving paths (fresh-hit within TTL, and retain-on-failure after a failed refresh) report `rejected` rather than reverting to `absent`; and the pre-existing retain-on-failure + genuinely-empty-vs-unavailable behaviour is unchanged.

## Tier-2 integration (loopback mock GitHub API via the existing `LLM_RUNTIME_API_MIRROR` debug seam)

- **TEST-3** (tier: integration) [acceptance] [invariant: INV-4] [covers: ITEM-3] file: `src-app/server/tests/llm_local_runtime/github_credential_test.rs` — asserts: against a mock that ACCEPTS the token, the catalogue is fetched with **exactly one** request, that request carried `Authorization: Bearer <token>`, and the reported status is `used`. A silent downgrade to anonymous (0 authenticated requests) or a gratuitous second request fails this — this is the happy-path counterpart that stops the fix from halving an operator's rate limit.
- **TEST-4** (tier: integration) [acceptance] [invariant: INV-1] [covers: ITEM-3, ITEM-4] file: `src-app/server/tests/llm_local_runtime/github_credential_test.rs` — asserts: against a mock that answers **401** to an authenticated request and **200** to an anonymous one (the measured live behaviour), the catalogue is returned successfully with the real releases, via exactly TWO requests — first authenticated, then with NO `Authorization` header — and the status is `rejected`. Pre-fix this errors out; removing the fallback turns it red.
- **TEST-5** (tier: integration) [covers: ITEM-2, ITEM-3] file: `src-app/server/tests/llm_local_runtime/github_credential_test.rs` — asserts: against a mock answering **403 with `x-ratelimit-remaining: 0`**, NO anonymous retry is issued (exactly one request, authenticated) and the call fails — a rate limit is not a credential problem and must not spend the anonymous budget. This is the negative control for TEST-4.
- **TEST-6** (tier: integration) [acceptance] [invariant: INV-2] [covers: ITEM-4, ITEM-5, ITEM-6] file: `src-app/server/tests/llm_local_runtime/github_credential_test.rs` — asserts: over the REAL HTTP surface (`GET /api/local-runtime/versions/{engine}/check-updates` and `/versions/available`), a rejected credential is reported AS a rejected credential — `credential_status == "rejected"` — and is distinguishable from a plain unreachable feed, which reports `credential_status == "absent"` with `source == "unavailable"`. Both are asserted in the same test so "distinguishable" is proven, not assumed. Also asserts the rejection reason text names `GITHUB_TOKEN` and contains **no** token value.

- **TEST-14** (tier: integration) [covers: ITEM-3, ITEM-4, ITEM-12] file: `src-app/server/tests/llm_local_runtime/github_credential_test.rs` — asserts: against a mock that answers 401 to BOTH the authenticated request and the anonymous re-issue, the loop stops at exactly two requests, the second carries NO `Authorization` header, and the reason names `GITHUB_TOKEN` + the status but never the value. The only path where `ANONYMOUS_RETRY_LIMIT` is observable (in the rescued case the loop exits anyway) and the only path that reaches `failure_note()`'s interpolation with a `Rejected` credential — blanking both call sites survived the whole suite without it.
- **TEST-15** (tier: integration) [covers: ITEM-3] file: `src-app/server/tests/llm_local_runtime/github_credential_test.rs` — asserts: a 500 followed by a 200 costs two requests, BOTH authenticated (a 5xx must not drop the credential), and reports `used`. Pins the restructured transient-retry counter: reverting `attempt` to 0 makes `2u64.pow(attempt - 1)` underflow and PANIC in debug, which nothing else in the suite would catch.
- **TEST-19** (tier: integration) [acceptance] [invariant: INV-2] [covers: ITEM-13] file: `src-app/server/tests/llm_local_runtime/github_credential_test.rs` — asserts: a token that meets a PERSISTENT non-success answer (403 without an SSO header) is reported `unverified`, never `used`. GitHub answered but did not serve the request, so it is evidence of nothing; reporting `used` there told an operator with a revoked or SAML-blocked token that their credential was fine — the original defect with the blame inverted. Mutating the guard back to `result.is_ok()` turns this red.
- **TEST-20** (tier: unit) [covers: ITEM-14] file: `src-app/server/src/modules/llm_local_runtime/engine/download.rs` — asserts: `credential_target_is_trusted` accepts real GitHub and (debug only) loopback, and REFUSES `api.github.com.evil.example`, a plain external host, an RFC1918 address and an IPv6 host — so a misconfigured `LLM_RUNTIME_API_MIRROR` can never receive an operator's real token.
- **TEST-16** (tier: integration) [acceptance] [invariant: INV-2] [covers: ITEM-1, ITEM-4] file: `src-app/server/tests/llm_local_runtime/github_credential_test.rs` — asserts: a token present through a TOTAL outage reports `unverified`, not `used` — GitHub never answered, so claiming acceptance would be unfounded — and the reason does not blame a credential that was never judged. With TEST-3 (`used`), TEST-6 (`absent`) and TEST-4/14 (`rejected`), all four vocabulary values are reachable and mutually distinguishable.

## Tier-3 e2e (real backend, no `page.route` mocking — repo rule)

- **TEST-9** (tier: e2e) [covers: ITEM-7, ITEM-9] file: `src-app/ui/tests/e2e/local-runtime/version-discovery.spec.ts` — asserts: with the invalid `GITHUB_TOKEN` from `tests/.env.test` present in the backend environment, an admin opening Settings → Local Runtimes sees installable version rows with an Install control and a size, and the unreachable state is absent. This is the reported failing spec, unweakened; it fails RED on current main and passes only because the anonymous fallback works end-to-end. ITEM-9 additionally asserts, on the REAL production path (which no mock can stand in for), that `credential_status` is one of the four known values and that when it is `rejected` the list is non-empty, `source` is `live`, and `unavailable_reason` is null — INV-1 end-to-end. The probe is authenticated with `getCurrentUserToken` (the endpoint is permission-gated; an unauthenticated in-page fetch 401s and would throw unconditionally — the round-1 corroborated defect).
- **TEST-10** (tier: e2e) [covers: ITEM-9] file: `src-app/ui/tests/e2e/local-runtime/version-discovery.spec.ts` — asserts: the release-catalogue TTL admin setting persists across a reload and an out-of-bounds value is refused (the second declared test in the reported-failing spec). Included because the report says BOTH tests in the file fail on main; its status must be established rather than assumed.

## Frontend defect found by RUNNING the stack

- **TEST-21** (tier: e2e) [covers: ITEM-15] file: `src-app/ui/tests/e2e/local-runtime/version-discovery.spec.ts` — asserts: (as part of TEST-9) the card actually RENDERS the version rows when the server has them. This is what caught React #321 — a reactive store-proxy read inside the async `checkForUpdates` action, whose throw the action's own catch swallowed into `state.error`, making the card claim the release feed was unreachable over a catalogue the server returned fine. No static angle saw it; only driving the real stack did. The spec's failure path now expands `ErrorState`'s collapsed "Details" disclosure and reports the card's own text, which is the only reason the cause was identifiable.
- **TEST-22** (tier: e2e) [covers: ITEM-16] file: `src-app/ui/tests/e2e/local-runtime/version-discovery.spec.ts` — asserts: the runtime-config save is AWAITED (its PUT status and body are read), an in-bounds TTL persists across a reload, and a below-floor value is clamped to the 60s minimum and stored as 60 — never as the typed 10. Replaces an assertion that passed only because `page.reload()` aborted the PUT in flight.

## Component / gallery

- **TEST-17** (tier: unit) [covers: ITEM-7] file: `src-app/ui/src/modules/llm-local-runtime/stores/runtimeUpdate/checkForUpdates.credential.store.test.ts` — asserts: driving the REAL `checkForUpdates` action against a stubbed api-client (the external boundary, and the only thing mocked), a `rejected` verdict reaches the store entry the card reads; `used` is passed through unchanged (the control that rejects a hardcoded value); and a missing field defaults to `absent`. This is the ONLY wire between the new backend field and the new UI branch — the component harness seeds the store directly and never runs it, so deleting the mapping otherwise left every UI gate green while the notice could never appear in the real app. **Must be named `*.store.test.ts`**: `vitest.config.ts` includes only `src/**/*.store.test.ts` and `src/**/*.test.tsx`, and the first draft (`*.credential.test.ts`) was silently never collected.
- **TEST-11** (tier: unit) [covers: ITEM-7] file: `src-app/ui/src/modules/llm-local-runtime/components/AvailableVersionsCard.test.tsx` — asserts: mounted with `credential_status: 'rejected'` AND version rows present, the card renders BOTH the rows and a distinct credential notice naming `GITHUB_TOKEN`; mounted with `credential_status: 'used'` it renders no such notice; and the credential notice is NOT the `feedUnreachable` notice (the two are independent, so a rejected-but-live catalogue never claims GitHub is unreachable).
- **TEST-12** (tier: unit) [covers: ITEM-8] file: `src-app/ui/src/dev/gallery` (`check:state-matrix` via `npm run check`) — asserts: the new `credential_status === 'rejected'` conditional render state has gallery coverage, at desktop and narrow (390px) viewport.

## Reporting

- **TEST-13** (tier: unit) [covers: ITEM-10] file: `.lifecycle/github-token-fallback/SURVEY.md` — asserts: the survey enumerates every GitHub-credential call site with file:line, build-time-vs-runtime, its filter, and its 401/403 behaviour. Verified mechanically by re-running the search that produced it (`rg -n 'GITHUB_TOKEN|GH_TOKEN'`) and confirming every hit appears in the document; recorded in TEST_RESULTS.md with the command + counts.
- **TEST-18** (tier: unit) [covers: ITEM-11] file: `src-app/server/src/modules/llm_local_runtime/engine/download.rs` — asserts: the false "`hub_seed.rs` already honours GITHUB_TOKEN at build time" claim is gone from the file. Verified mechanically (`rg -n 'hub_seed' download.rs` returns nothing, and `rg -n 'GITHUB_TOKEN' build_helper/hub_seed.rs` confirms the helper still has no token code — i.e. the claim was and remains false); recorded in TEST_RESULTS.md with both commands and their output.

## Coverage map

| ITEM | covered by |
|---|---|
| ITEM-1 | TEST-8, TEST-16 |
| ITEM-2 | TEST-1, TEST-2, TEST-5 |
| ITEM-3 | TEST-3, TEST-4, TEST-5, TEST-14, TEST-15 |
| ITEM-4 | TEST-4, TEST-6, TEST-14, TEST-16 |
| ITEM-5 | TEST-7, TEST-6 |
| ITEM-6 | TEST-6 |
| ITEM-7 | TEST-9, TEST-11, TEST-17 |
| ITEM-8 | TEST-12 |
| ITEM-9 | TEST-9, TEST-10 |
| ITEM-10 | TEST-13 |
| ITEM-11 | TEST-18 |
| ITEM-12 | TEST-14 |
| ITEM-13 | TEST-19 |
| ITEM-14 | TEST-20 |
| ITEM-15 | TEST-21 |
| ITEM-16 | TEST-22 |

| INV | acceptance test |
|---|---|
| INV-1 | TEST-1, TEST-4 |
| INV-2 | TEST-6, TEST-16, TEST-19 |
| INV-3 | TEST-2 |
| INV-4 | TEST-3 |

No permission is introduced by this diff, so A9/A10 (`[negative-perm]`) do not
apply. The surfaces touched are already gated by the pre-existing
`RuntimeVersionRead` permission, unchanged.
