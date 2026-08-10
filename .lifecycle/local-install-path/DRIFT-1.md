# DRIFT-1 — implementation vs plan/design

Authored during phase 5, item by item, as each landed.

## §1 Discovery (implemented by the lead agent)

- **DRIFT-1.1** — verdict: impl-wins — PLAN's ITEM-3 said "new discovery endpoint … per release it reports every published variant". The implementation needed a piece the plan did not name: a *reverse* asset-name parser. The existing `asset_backend` helper can only answer "is this asset for the host I already know about"; enumerating variants requires the opposite direction (given an arbitrary asset, which `(platform, arch, backend)` IS it). Added `download::parse_asset_variant` as the inverse of `archive_name`, with accept/reject unit tests. PLAN's *Files to touch* already covered `engine/download.rs`, so no plan amendment beyond noting the helper here.
- **DRIFT-1.2** — verdict: impl-wins — the plan implied `check_for_updates` would keep returning `Vec<AvailableVersion>`. To surface provenance (ITEM-4) on the SAME cached read, its signature became `(Vec<AvailableVersion>, release_cache::Catalog)`. Single in-tree caller (the handler), updated in the same change. This is a strictly better shape than a second cache lookup, which would have raced with the first.
- **DRIFT-1.3** — verdict: resolved — the plan named `llm_local_runtime/settings/*` for the TTL wiring; the module's real path is `runtime_settings/` (models) plus the shared `repository.rs`. Corrected in place; no behavioural difference.
- **DRIFT-1.4** — verdict: none — DEC-5 (200-with-reason rather than 500) is implemented exactly as decided. Verified against the pre-existing assertion in `tests/llm_local_runtime/engine_download_test.rs`, which only covers the success path, so no existing contract breaks.
- **DRIFT-1.5** — verdict: resolved — a REAL defect the new unit tests found, not a plan divergence, recorded because it changed the code: the three `release_cache` unit tests share a process-lifetime global and `clear()` wipes every engine, so a sibling test evicted another's seed mid-sleep and `failed_refresh_retains_previous_catalog` failed with `left: Unavailable, right: Cache`. Fixed by serializing them on a module `CACHE_TEST_LOCK`. Worth noting because the failure was a genuine shared-state hazard the design did not anticipate, and the same hazard would bite any future test of this module.
- **DRIFT-1.6** — verdict: resolved — `Catalog::is_stale` and `release_cache::clear` were initially `pub` in the production build and flagged by rustc as never used. Per §15 (dead code = unfinished work) both were narrowed to `#[cfg(test)]` rather than left with an `allow`. On the wire the same fact is carried by `source` + `unavailable_reason`, which is what the UI consumes, so no production accessor is warranted.
- **DRIFT-1.7** — verdict: impl-wins — the plan did not mention the fixture. `tests/llm_local_runtime/mock_release.rs` had to gain (a) a release-LIST request counter and (b) a `take_upstream_down()`, because TEST-4's whole point is asserting an upstream *call count* and then observing degradation. Both are additive to an existing shared fixture used only by this module's tests, so no other suite is affected (rule B3: this is the fixture's own module, not shared harness infrastructure like `tests/common/*`). The fixture also now publishes non-host asset names so TEST-3 can prove cross-platform variants are reported — without them the fixture could only ever confirm host-scoped behaviour, i.e. it could not have caught the very gap being closed.
- **DRIFT-1.8** — verdict: none — ITEM-8's UI states are implemented as three distinct branches (rows / stale-with-rows / unreachable-with-nothing) and each has a gallery cell, satisfying the state-matrix gate rather than relying on the pre-existing `empty` cell to stand in for the new `unreachable` one.

## §2 Progress and §3 Validation

Recorded after their implementing agents reported; see DRIFT-2.md.

**Unresolved drifts:** 0
