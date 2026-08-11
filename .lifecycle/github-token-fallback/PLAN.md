# PLAN — GitHub credential rejection must degrade to anonymous, visibly

Feature slug: `github-token-fallback`
Branch: `fix/github-token-fallback` (worktree `/data/pbya/ziee/wt-token-fallback`, base `origin/main` = `256a23930`)

## Design source

Realizes `.lifecycle/github-token-fallback/DESIGN.md` §3 (the four
non-negotiables), §4 (header-based response classification), §5 (the
`credential_status` vocabulary extension) and §6 (scope: runtime engine
discovery only; other GitHub callers surveyed, not changed).

## Invariants

Lifted VERBATIM from DESIGN.md §3.

- **INV-1**: An auth rejection (401, and `403`-bad-credentials as distinct from `403`-rate-limit — they are different and the distinction matters) must **fall back to an anonymous request** rather than failing the discovery.
- **INV-2**: The user must be able to tell the two cases apart. The existing degradation surface already carries `source` (`live|cache|unavailable`) and `unavailable_reason` — **extend that vocabulary** rather than inventing a parallel mechanism, so an invalid credential reports as an invalid credential.
- **INV-3**: **Do not simply validate the token's shape** (e.g. rejecting anything not matching `ghp_…`). GitHub has several valid token formats and adds more; a shape check would reject valid credentials and would not catch an expired one. Fall back on the **response**, not on the string.
- **INV-4**: A valid-token request must still be **authenticated** — never silently downgraded to anonymous, which would quietly cut an operator's rate limit from 5000/hr to 60/hr.

## Items

- **ITEM-1**: Add a `CredentialStatus { Absent, Used, Unverified, Rejected }` enum to `engine/download.rs`, with an `as_str()` mapping to the wire vocabulary `absent|used|unverified|rejected` (`Unverified` added at FIX_ROUND-1 — see DEC-11). Documented as the credential-health axis, orthogonal to `CatalogSource`'s catalogue-provenance axis.
- **ITEM-2**: Add a pure classifier `is_auth_rejection(status) -> bool` in `engine/download.rs` implementing DESIGN §4's table: **401 ⇒ true; `403` + `X-GitHub-SSO` ⇒ true; every other status ⇒ false**. Status + the ONE documented header — never the body, never the token string (INV-3). (Amended twice: FIX_ROUND-1 removed an unsound header-based 403 split, FIX_ROUND-2 restored the single 403 class GitHub does identify — see DEC-1.)
- **ITEM-3**: Rework `BinaryDownloader::github_get_with_retry` to return `(Result<reqwest::Response>, CredentialStatus)` — the status rides ALONGSIDE the result, not inside the `Ok`, so it survives a transport error on the anonymous retry (see DRIFT-1.1). Send the token when present; on an auth-rejection response **while authenticated**, re-issue the SAME request once with no `Authorization` header and record `CredentialStatus::Rejected`. A token accepted on the first try records `Used` (INV-4 — exactly one request, still authenticated); no token records `Absent`. The anonymous retry is exempt from — and does not consume — the existing transient-failure attempt budget.
- **ITEM-4**: Thread the status out of the two GitHub-reading call sites: `list_releases` returns `(Result<Vec<ReleaseInfo>>, CredentialStatus)`; `get_latest_version` consumes the tuple and is otherwise unchanged. When a rejection is observed on a FAILING request, the error text names the credential (`GitHub rejected the configured GITHUB_TOKEN (HTTP 401)`) — never the token value.
- **ITEM-5**: Carry `credential_status` through `engine/release_cache.rs`: add it to `Catalog`, store it on the cached `Entry`, and have `get_or_refresh`'s injected `fetch` return `(Result<Vec<ReleaseInfo>, String>, CredentialStatus)`. A FRESH cache hit reports the status of the fetch that produced the entry; the RETAIN-ON-FAILURE path reports the FAILED refresh's status, so a token revoked since caching surfaces immediately instead of being masked by a stale `used` (see DRIFT-1.2). Neither path may report `Absent` by default.
- **ITEM-6**: Surface the field on the wire: `AvailableUpdatesResponse.credential_status` and `InstallableEngine.credential_status` (`String`, always present — an absent field would be indistinguishable from `absent`), populated in `runtime_version/handlers.rs::check_for_updates` and `binary_manager.rs::list_installable`. Regenerate OpenAPI + `api-client/types.ts` for BOTH workspaces.
- **ITEM-7**: Frontend: extend `llm-local-runtime/types.ts`'s catalogue type with `credential_status`, thread it through `stores/runtimeUpdate/actions/checkForUpdates.ts`, and render a distinct, non-alarming notice on `AvailableVersionsCard` when `credential_status === 'rejected'` — separate from the existing `feedUnreachable` notice, since the two can co-occur or occur independently. Wording names the credential, never a value.
- **ITEM-8**: Gallery coverage for the new conditional state (`credential_status: 'rejected'` with rows present) so `check:state-matrix` passes, at desktop AND narrow (390px) viewport.
- **ITEM-9**: Harden `ui/tests/e2e/local-runtime/version-discovery.spec.ts` so a genuine GitHub outage is distinguishable from a regression: before asserting rows, read `GET /api/local-runtime/versions/llamacpp/check-updates` and, if it reports no versions, fail with the server's own `source` / `unavailable_reason` / `credential_status` rather than a bare "element not found". The row assertions themselves are NOT weakened (see DECISIONS DEC-4).
- **ITEM-10**: Write `SURVEY.md` reporting every other GitHub-credential call site in the tree (build-time and runtime), each with its filter, its 401/403 behaviour, and whether it has an anonymous fallback — reported, not changed (DESIGN §6).
- **ITEM-12**: (added at FIX_ROUND-1, revised at FIX_ROUND-2) Bound the fallback with ONE exact mechanism. The round-1 shape derived `authenticated` from a counter-vs-limit, which reads as "the budget is not exhausted" rather than "the credential has not been refused" — identical only at limit 1, and at 2 it would re-present an already-rejected token. Replaced by a `credential_refused` boolean; deleting it produces an infinite loop that TEST-14 catches.
- **ITEM-13**: (added at FIX_ROUND-2) `Used` requires a SUCCESS status, not merely a response. A 403/404/persistent-5xx leaves the verdict `Unverified` — a revoked or SAML-blocked token must never be reported as accepted.
- **ITEM-14**: (added at FIX_ROUND-2) Withhold the credential from any host that is not real GitHub (or, in a debug build, a loopback mirror), so a misconfigured `LLM_RUNTIME_API_MIRROR` can never receive an operator's real token.
- **ITEM-15**: (added at FIX_ROUND-2, found by RUNNING the e2e) Fix the reactive store-proxy read inside the async `checkForUpdates` action. `RuntimeVersion.versions` is a hook; after the `await` it throws React #321, the action's catch swallows it into `state.error`, and the card claims the release feed is unreachable over a catalogue the server returned fine. Use `.$`, the sole hook-free snapshot escape. A second, independent cause of the reported failing spec.
- **ITEM-16**: (added at FIX_ROUND-2) Fix the pre-existing race in the TTL spec: it clicked Save without awaiting and reloaded, aborting the PUT, so its "the stored value is NOT replaced" assertion passed only because the save never landed. Await the save, assert what was sent, and assert the real behaviour (a below-floor value is CLAMPED to the 60s floor and 60 persists).
- **ITEM-11**: Correct the FALSE justification comment at `engine/download.rs:495-497` — it claims "`hub_seed.rs` already honours GITHUB_TOKEN at build time", which the Pages migration deleted (the helper now does zero network I/O; its own header lists `GITHUB_TOKEN handling` among what was removed). It sits directly above the only token-attach site in the codebase, i.e. inside the hunk this branch rewrites. The two other stale claims found (`server-release.yml:10`, `e2e/sync/hub-settings-sync.spec.ts:40-41`) are outside this diff and are REPORTED in SURVEY.md, not changed.

## Files to touch

- `src-app/server/src/modules/llm_local_runtime/engine/download.rs` (ITEM-1..4 + unit tests)
- `src-app/server/src/modules/llm_local_runtime/engine/release_cache.rs` (ITEM-5 + unit tests)
- `src-app/server/src/modules/llm_local_runtime/binary_manager.rs` (ITEM-5/6)
- `src-app/server/src/modules/llm_local_runtime/runtime_version/models.rs` (ITEM-6)
- `src-app/server/src/modules/llm_local_runtime/runtime_version/handlers.rs` (ITEM-6)
- `src-app/server/tests/llm_local_runtime/` — new `github_credential_test.rs` (+ `mod.rs`) (ITEM-3/4 integration, loopback mock)
- `src-app/ui/src/modules/llm-local-runtime/types.ts`, `stores/runtimeUpdate/actions/checkForUpdates.ts`, `components/AvailableVersionsCard.tsx`, `components/AvailableVersionsCard.test.tsx`, `gallery.tsx` (ITEM-7/8)
- `src-app/ui/tests/e2e/local-runtime/version-discovery.spec.ts` (ITEM-9)
- Generated (regen, not hand-edited): `src-app/ui/openapi/openapi.json`, `src-app/ui/src/api-client/types.ts`, and the `src-app/desktop/ui/` counterparts.

## Patterns to follow

- **Credential-status enum + `as_str()`** — mirror `engine/release_cache.rs`'s `CatalogSource` exactly (same file, same shape, same wire-string convention). This is deliberately the closest sibling: the new field is the second axis of the same provenance vocabulary.
- **Loopback mock GitHub API** — mirror `src-app/server/tests/llm_local_runtime/mock_release.rs` (`MockReleaseServer`), driven through the EXISTING debug-only `LLM_RUNTIME_API_MIRROR` seam in `download.rs::api_base_url()`. No new env seam, no shared-harness edit (B3).
- **Degraded-state UI notice** — mirror the existing `feedUnreachable` branch in `components/AvailableVersionsCard.tsx` (same `details=` notice shape, same tokens).
- **Gallery cell** — mirror `modules/llm-local-runtime/gallery.tsx`'s existing `seeded-s3-available-versions-{unreachable,stale-cache}` cells.
- **Response-field docs** — mirror the prose style of `AvailableUpdatesResponse::unavailable_reason`'s doc comment (states what the field rules OUT, not just what it is), so the JSDoc that lands in `types.ts` is useful.

## Plan audit (phase 2)

Dimension sections + a per-ITEM verdict.

### Breakage risk

`github_get_with_retry`, `list_releases` and `get_or_refresh`'s `fetch` closure
all change signature. All three are crate-internal (`list_releases` is `pub` but
only within the `ziee` lib; `rg` shows callers only in `binary_manager.rs` and
the in-crate tests), so the blast radius is the `ziee` crate plus its own tests —
`cargo check -p ziee --tests` is a complete oracle for it. Adding a REQUIRED
(non-`skip_serializing_if`) response field is additive for every existing TS
consumer; no consumer destructures exhaustively.

The one genuine behaviour change for an existing deployment: a box with a VALID
token sees no change at all (INV-4, one authenticated request); a box with a
REJECTED token now issues **two** requests instead of one on a cache miss. That
is bounded by the release-cache TTL (default ≥60s, admin-configurable) — it is
not per-page-mount — and it only happens in a state that is currently a hard
failure.

### Pattern conformance

`CredentialStatus` is deliberately a carbon copy of `CatalogSource` (adjacent
module, same `as_str()` wire convention). The mock-server test mirrors
`mock_release.rs` and reuses the already-committed `LLM_RUNTIME_API_MIRROR`
debug seam rather than adding one — this is what keeps B3 (never edit the shared
harness for your feature) satisfiable. UI notice + gallery cell mirror their
in-file siblings.

### Migration collisions

**None — this change adds no migration.** Highest server migration prefix in the
tree at branch time: `202607200600` (`find src-app/server -path '*/migrations/*.sql'`).
Recorded in BASE.md.

### OpenAPI regen

**Required, both workspaces.** ITEM-6 adds a field to two `JsonSchema` response
types, so `just openapi-regen` must run and BOTH `src-app/ui/` and
`src-app/desktop/ui/` `openapi.json` + `api-client/types.ts` must be committed.
The `openapi::emit_ts::tests::types_ts_parity` golden test is the oracle that
catches a missed regen.

### Per-item verdicts

- **ITEM-1** — verdict: PASS — mirrors `release_cache.rs::CatalogSource` (enum + `as_str()`); no new dependency, no public-crate surface.
- **ITEM-2** — verdict: PASS — a pure `(StatusCode, &HeaderMap) -> bool` function, directly unit-testable with no network; satisfies INV-3 by construction (it cannot see the token).
- **ITEM-3** — verdict: CONCERN — the anonymous retry must not be folded into the existing `MAX_ATTEMPTS` transient loop (a credential rejection is not transient; re-sending the same token is waste, and re-sending anonymously twice double-spends the 60/hr budget). Resolved in DEC-2: a separate one-shot boolean, asserted by TEST-4's request count.
- **ITEM-4** — verdict: CONCERN — `get_latest_version` and `list_releases` both call the helper; the tuple change must not leak the token into any error string. Resolved in DEC-5: the error text names only the env var NAME and the status.
- **ITEM-5** — verdict: CONCERN — `Catalog`'s cache hit path currently constructs the struct in three places; all three must set `credential_status` from the stored `Entry`, or a cache hit silently reports `absent` and INV-2 breaks on the second page load. Verified: exactly four construction sites in `release_cache.rs` (lines 144, 166, 185, 197 at branch time). Covered by TEST-7.
- **ITEM-6** — verdict: CONCERN — requires `just openapi-regen` for BOTH workspaces (see above). Non-optional; `types_ts_parity` fails otherwise.
- **ITEM-7** — verdict: PASS — additive branch in `AvailableVersionsCard.tsx` beside the existing `feedUnreachable` branch; no store-shape change beyond one optional field.
- **ITEM-8** — verdict: CONCERN — `check:state-matrix` (inside `npm run check`) fails on a new conditional render state with no gallery cell. Budgeted as its own item rather than discovered at phase 8.
- **ITEM-9** — verdict: PASS — a diagnosability-only change; the row assertions are untouched, so the spec cannot become weaker (re-verified in the phase-6 `tests-quality` angle).
- **ITEM-10** — verdict: PASS — reporting only, per DESIGN §6; changes no code.
- **ITEM-12** — verdict: PASS — one boolean, one proposition; the round-1 counter form was flagged by BOTH round-2 angles as meaning something subtly different from its own comment.
- **ITEM-13** — verdict: PASS — the corroborated round-2 finding; a one-line guard change plus its integration test.
- **ITEM-14** — verdict: PASS — pure hardening, no behaviour change for a correctly-configured deployment; the loopback allowance keeps the existing test seam working.
- **ITEM-15** — verdict: CONCERN — a frontend fix outside the original backend scope, but REQUIRED: the reported spec cannot pass without it, and it is the same defect family (an error misreported as "GitHub is unreachable"). A repo-wide sweep found no other instance; the existing `lint-hooks.mjs` H2 rule does not cover this shape (it fires only on conditionally-evaluated reads) — reported as a guardrail gap.
- **ITEM-16** — verdict: CONCERN — touches a spec whose subject (the TTL setting) is not this feature. Justified because the spec is one of the two the report named, its status had to be established, and leaving a race-certified assertion in place would be shipping a test that proves nothing.
- **ITEM-11** — verdict: PASS — a comment inside the hunk ITEM-3 already rewrites; verified false against `build_helper/hub_seed.rs` (417 lines, zero network I/O, header explicitly lists `GITHUB_TOKEN handling` as deleted). Scoped to this file only; §17 ("docs reference only verified symbols") would otherwise be violated by the very change this branch ships.
