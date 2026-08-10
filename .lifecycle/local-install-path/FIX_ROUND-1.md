# FIX_ROUND-1 — blind multi-angle audit, round 1

Two blind angles over `git diff c7456cec6...HEAD`, diff-only context, generated
files excluded: **correctness** and **design-conformance** (the required angle,
audited against `DESIGN.md` + its `INV-N`, not against PLAN.md).

20 findings in `LEDGER.jsonl`, of which 2 are explicit AFFIRMATIONS (INV-1 and
INV-3 hold and are honestly tested).

## Promoted to work

**Corroborated by BOTH angles (the only ≥2 finding):**

- **403 auto-disable** (`utils.rs`, high; correctness + design-conformance
  independently) — a 401/403 on the capability step mapped to `Unhealthy`, and
  `Unhealthy` is the ONLY verdict that auto-disables. GitHub answers its
  anonymous 60-req/hr rate limit with **403**, on the very shared-IP condition
  this branch's own design documents. A `github.com` row with `auth_type: none`
  is probed at boot, unauthenticated, and would be auto-disabled on a
  rate-limited box — exactly what INV-4 forbids for a repository that was merely
  not confirmable.
  **Fixed**, and deliberately narrowed twice under test pressure:
  1. First attempt: all 401/403 → `Unverified`. Broke 11 tests.
  2. Second: credentialed-vs-anonymous. Still wrong — the pre-existing suite
     uses a 401 mock with `auth_type: none` to mean a genuine failure.
  3. **Shipped**: **403 only** degrades to `Unverified`; 401 keeps its historical
     `Unhealthy`. 403 is the status GitHub actually uses for rate limiting, and
     401 is an explicit authentication challenge against a URL the operator
     configured — actionable, not unknown. All pre-existing semantics preserved.

**Severity-authz / oracle-confirmed (promoted regardless of corroboration):**

- **`api.github.com` still reported healthy** (`utils.rs`, high) — found by the
  author while re-checking the fix against the ORIGINAL reproduction, before the
  audit ran. `api.github.com` shares the `.github.com` suffix that selects the
  GitHub kind, and the REST catalogue genuinely answers for it, so the capability
  probe alone confirmed it — while the download path builds `{url}/{path}.git`,
  which is not a git remote. **Fixed** via `is_clonable_github_origin` +
  `is_usable_repository_base`; pinned by
  `only_a_clonable_github_origin_can_be_verified`.

- **Misleading "you're up to date" toast** (`AvailableVersionsCard.tsx`, medium)
  — the server no longer 500s on an unreachable feed, so the catch branch never
  fires and the user-initiated check reported "No new versions — you're up to
  date" on an empty list caused by an unreachable upstream. That is the precise
  lie INV-2 exists to remove, in the one place the user explicitly asked.
  **Fixed**: the toast now reports the unreachable feed.

- **Unreachable-state copy** (`AvailableVersionsCard.tsx`, low) — the "versions
  are unknown" branch keyed off `readyUpstream` (host-ready rows), so a real but
  stale catalogue containing only other-platform builds rendered the wrong
  sentence. **Fixed**: gated on the catalogue being genuinely empty.

- **Duplicate `#[test]` attribute** (low) — **Fixed**.

## Rejected — an over-correction I made and then reverted

- **HF origin guard** (design-conformance, high: "`https://huggingface.co/custom`
  still reads healthy"). The finding's *diagnosis* is correct — the HF capability
  probe queries the fixed `huggingface.co/api/models`, so it confirms the HUB's
  catalogue and attributes it to any row on that host.

  I first fixed it symmetrically with the GitHub guard (require an origin, no
  path). That **broke two pre-existing tests**, and on inspection those tests
  were right and my guard was wrong: `https://huggingface.co/<org>` is a
  *legitimate* org-scoped base — with a `repository_path` of `<model>` it builds
  `huggingface.co/<org>/<model>`, a real model URL. An origin-only guard would
  report every org-scoped row `unverified`, and (via the boot scan) is one step
  from disabling working deployments — the same class of harm DEC-12 exists to
  avoid.

  **Reverted.** The gap is recorded in code, at
  `is_usable_repository_base`, as a KNOWN GAP with the reason and the shape of a
  real fix (a per-row existence probe such as `…/api/models?author=<org>`), and
  the unit test now asserts what is actually true rather than the claim I briefly
  made. This is a genuine residual: **one of the three reported URLs
  (`https://huggingface.co/custom`) is still reported healthy.** It is reported,
  not hidden — see the final report.

## Not fixed this round (recorded, single-angle, no oracle)

- No single-flight in `release_cache::get_or_refresh` — steady state is fixed
  (1 request/TTL); a TTL boundary with N concurrent readers can still burst.
  Both angles raised it independently at `medium`/`low`. Real, bounded, and a
  behaviour change to concurrent request handling; deferred rather than rushed.
- `release_cache` poisoned-lock arms fail silently (no `warn!`).
- `binary_manager` swallows the settings-row read error before falling back.
- `parse_asset_variant` accepts a backend charset wider than `is_valid_backend`;
  no current asset triggers it.
- `release_cache_test`'s degradation half is partly vacuous — the 60s TTL floor
  means the fast path returns before the downed upstream is contacted, so the
  retain-on-failure branch is proven only by the in-crate unit test, not on the
  wire. Accurate finding; the behaviour IS covered, the integration assertion is
  weaker than it reads.
- `RuntimeVersion.listAvailable` has no in-app consumer (the UI still drives
  `check-updates`). INV-1 is stated at the API level and holds; the endpoint is
  registered, tested, and documented, but no user surface consumes the
  per-variant platform/arch data yet.

## Verification after this round

```
cargo check -p ziee --tests                        → 0 errors
cargo test -p ziee --lib llm_repository            → 34 passed; 0 failed
cargo test -p ziee --test integration_tests --     --test-threads=4 \
    llm_local_runtime:: llm_model:: llm_repository::
                                                   → 239 passed; 2 failed
```

The 2 failures are the pre-existing environmental floor
(`repo_files_real_test`, real `GITHUB_TOKEN` required, `.env.test` ships
`ghp_xxx`) — unchanged from before this round, and untouched by this branch.

**New confirmed findings:** 0
