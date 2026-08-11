# TESTS — github-token-fallback

Every ITEM is covered; every `INV-N` is pinned by an `[acceptance]` test that
would FAIL if the invariant were violated.

## Tier-1 unit (in-source `#[cfg(test)]`, no network)

- **TEST-1** (tier: unit) [acceptance] [invariant: INV-1] [covers: ITEM-2] file: `src-app/server/src/modules/llm_local_runtime/engine/download.rs` — asserts: `is_auth_rejection` returns true for 401 and for a bare 403, and FALSE for a 403 carrying `x-ratelimit-remaining: 0` and for a 403 carrying `retry-after` — i.e. the bad-credentials/rate-limit distinction exists as two outcomes, not one. Flipping the rate-limit arm to `true` (collapsing the distinction) turns this red.
- **TEST-2** (tier: unit) [acceptance] [invariant: INV-3] [covers: ITEM-2] file: `src-app/server/src/modules/llm_local_runtime/engine/download.rs` — asserts: the classifier's decision is identical for a `ghp_`-shaped, a `github_pat_`-shaped, an opaque and a whitespace-padded token because the token is not one of its inputs; and `github_token()` still returns `Some(_)` for every non-empty shape (a shape check would have to reject one). A shape-validating implementation cannot satisfy both halves.
- **TEST-8** (tier: unit) [covers: ITEM-1] file: `src-app/server/src/modules/llm_local_runtime/engine/download.rs` — asserts: `CredentialStatus::as_str()` maps to exactly `absent|used|rejected` (the wire vocabulary the UI and the OpenAPI doc-comment name).
- **TEST-7** (tier: unit) [covers: ITEM-5] file: `src-app/server/src/modules/llm_local_runtime/engine/release_cache.rs` — asserts: a fetch that reports `Rejected` stores that on the entry, and BOTH cache-serving paths (fresh-hit within TTL, and retain-on-failure after a failed refresh) report `rejected` rather than reverting to `absent`; and the pre-existing retain-on-failure + genuinely-empty-vs-unavailable behaviour is unchanged.

## Tier-2 integration (loopback mock GitHub API via the existing `LLM_RUNTIME_API_MIRROR` debug seam)

- **TEST-3** (tier: integration) [acceptance] [invariant: INV-4] [covers: ITEM-3] file: `src-app/server/tests/llm_local_runtime/github_credential_test.rs` — asserts: against a mock that ACCEPTS the token, the catalogue is fetched with **exactly one** request, that request carried `Authorization: Bearer <token>`, and the reported status is `used`. A silent downgrade to anonymous (0 authenticated requests) or a gratuitous second request fails this — this is the happy-path counterpart that stops the fix from halving an operator's rate limit.
- **TEST-4** (tier: integration) [acceptance] [invariant: INV-1] [covers: ITEM-3, ITEM-4] file: `src-app/server/tests/llm_local_runtime/github_credential_test.rs` — asserts: against a mock that answers **401** to an authenticated request and **200** to an anonymous one (the measured live behaviour), the catalogue is returned successfully with the real releases, via exactly TWO requests — first authenticated, then with NO `Authorization` header — and the status is `rejected`. Pre-fix this errors out; removing the fallback turns it red.
- **TEST-5** (tier: integration) [covers: ITEM-2, ITEM-3] file: `src-app/server/tests/llm_local_runtime/github_credential_test.rs` — asserts: against a mock answering **403 with `x-ratelimit-remaining: 0`**, NO anonymous retry is issued (exactly one request, authenticated) and the call fails — a rate limit is not a credential problem and must not spend the anonymous budget. This is the negative control for TEST-4.
- **TEST-6** (tier: integration) [acceptance] [invariant: INV-2] [covers: ITEM-4, ITEM-5, ITEM-6] file: `src-app/server/tests/llm_local_runtime/github_credential_test.rs` — asserts: over the REAL HTTP surface (`GET /api/local-runtime/versions/{engine}/check-updates` and `/versions/available`), a rejected credential is reported AS a rejected credential — `credential_status == "rejected"` — and is distinguishable from a plain unreachable feed, which reports `credential_status == "absent"` with `source == "unavailable"`. Both are asserted in the same test so "distinguishable" is proven, not assumed. Also asserts the rejection reason text names `GITHUB_TOKEN` and contains **no** token value.

## Tier-3 e2e (real backend, no `page.route` mocking — repo rule)

- **TEST-9** (tier: e2e) [covers: ITEM-7, ITEM-9] file: `src-app/ui/tests/e2e/local-runtime/version-discovery.spec.ts` — asserts: with the invalid `GITHUB_TOKEN` from `tests/.env.test` present in the backend environment, an admin opening Settings → Local Runtimes sees installable version rows with an Install control and a size, and the unreachable state is absent. This is the reported failing spec, unmodified in its assertions; it fails RED on current main and passes only because the anonymous fallback works end-to-end. ITEM-9 adds a pre-assertion probe so a genuine GitHub outage reports the server's own `source`/`unavailable_reason`/`credential_status` instead of "element not found".
- **TEST-10** (tier: e2e) [covers: ITEM-9] file: `src-app/ui/tests/e2e/local-runtime/version-discovery.spec.ts` — asserts: the release-catalogue TTL admin setting persists across a reload and an out-of-bounds value is refused (the second declared test in the reported-failing spec). Included because the report says BOTH tests in the file fail on main; its status must be established rather than assumed.

## Component / gallery

- **TEST-11** (tier: unit) [covers: ITEM-7] file: `src-app/ui/src/modules/llm-local-runtime/components/AvailableVersionsCard.test.tsx` — asserts: mounted with `credential_status: 'rejected'` AND version rows present, the card renders BOTH the rows and a distinct credential notice naming `GITHUB_TOKEN`; mounted with `credential_status: 'used'` it renders no such notice; and the credential notice is NOT the `feedUnreachable` notice (the two are independent, so a rejected-but-live catalogue never claims GitHub is unreachable).
- **TEST-12** (tier: unit) [covers: ITEM-8] file: `src-app/ui/src/dev/gallery` (`check:state-matrix` via `npm run check`) — asserts: the new `credential_status === 'rejected'` conditional render state has gallery coverage, at desktop and narrow (390px) viewport.

## Reporting

- **TEST-13** (tier: unit) [covers: ITEM-10] file: `.lifecycle/github-token-fallback/SURVEY.md` — asserts: the survey enumerates every GitHub-credential call site with file:line, build-time-vs-runtime, its filter, and its 401/403 behaviour. Verified mechanically by re-running the search that produced it (`rg -n 'GITHUB_TOKEN|GH_TOKEN'`) and confirming every hit appears in the document; recorded in TEST_RESULTS.md with the command + counts.
- **TEST-14** (tier: unit) [covers: ITEM-11] file: `src-app/server/src/modules/llm_local_runtime/engine/download.rs` — asserts: the false "`hub_seed.rs` already honours GITHUB_TOKEN at build time" claim is gone from the file. Verified mechanically (`rg -n 'hub_seed' download.rs` returns nothing, and `rg -n 'GITHUB_TOKEN' build_helper/hub_seed.rs` confirms the helper still has no token code — i.e. the claim was and remains false); recorded in TEST_RESULTS.md with both commands and their output.

## Coverage map

| ITEM | covered by |
|---|---|
| ITEM-1 | TEST-8 |
| ITEM-2 | TEST-1, TEST-2, TEST-5 |
| ITEM-3 | TEST-3, TEST-4, TEST-5 |
| ITEM-4 | TEST-4, TEST-6 |
| ITEM-5 | TEST-7, TEST-6 |
| ITEM-6 | TEST-6 |
| ITEM-7 | TEST-9, TEST-11 |
| ITEM-8 | TEST-12 |
| ITEM-9 | TEST-9, TEST-10 |
| ITEM-10 | TEST-13 |
| ITEM-11 | TEST-14 |

| INV | acceptance test |
|---|---|
| INV-1 | TEST-1, TEST-4 |
| INV-2 | TEST-6 |
| INV-3 | TEST-2 |
| INV-4 | TEST-3 |

No permission is introduced by this diff, so A9/A10 (`[negative-perm]`) do not
apply. The surfaces touched are already gated by the pre-existing
`RuntimeVersionRead` permission, unchanged.
