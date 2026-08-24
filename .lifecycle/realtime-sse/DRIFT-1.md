# DRIFT-1 — implementation vs plan

Authored DURING phase 5, item by item, as each landed.

- **DRIFT-1.1** — verdict: impl-wins — PLAN put TEST-3 in a new
  `src-app/desktop/tauri/tests/cors_preflight_test.rs`. It landed as an in-source
  `#[cfg(test)]` in `desktop/tauri/src/modules/backend/mod.rs` instead. That file
  already carries a `create_desktop_config_*` test module — the closest existing
  pattern, which PLAN's own *Patterns to follow* names — and `desktop/tauri/tests/`
  is a DB-backed integration harness that would spin up a server for an assertion
  needing neither. PLAN amended.
- **DRIFT-1.2** — verdict: impl-wins — TEST-6 is
  `ChatStreamClient.subscription.store.test.ts`, not `.test.ts`. This workspace's
  `vitest.config.ts` includes only `src/**/*.store.test.ts` and `src/**/*.test.tsx`;
  a plain `*.test.ts` runs under `node --test`, which has no `vi.mock`. The file
  header records the reason so the name is not mysterious. PLAN + TESTS amended.
- **DRIFT-1.3** — verdict: impl-wins — PLAN listed
  `src-app/server/src/modules/auth/cookie.rs` under *Files to touch* for a
  visibility change. Not needed: that module does not exist in the server crate —
  the constant is `ziee_auth::auth::cookie::REFRESH_COOKIE_OPTIN_HEADER`
  (`sdk/crates/ziee-auth/src/auth/cookie.rs:30`) and is already `pub`. Removed
  from the plan.
- **DRIFT-1.4** — verdict: resolved — the infra walk asked whether ITEM-6 should
  also fire the extension `onStreamError` hook, as the `error` FRAME path does.
  It should not, and does not: no provider stream errored — the server is still
  generating and will persist the reply — so telling extensions the turn failed
  would be false. The user-visible half (banner + cleared flags) is what the
  invariant asks for. Recorded here rather than silently decided.
- **DRIFT-1.5** — verdict: impl-wins — ITEM-7 grew a `narrowStatus` helper the
  plan did not mention. It is forced BY the plan: removing the
  `as DownloadInstance` cast exposed that the wire carries `status` as a bare
  `string` while `DownloadInstance['status']` is a union, which is exactly the
  class of mismatch the cast was hiding. Narrowing (and keeping the row's existing
  status for anything unrecognised) is the honest resolution; re-casting would
  reinstate the defect in miniature.
- **DRIFT-1.6** — verdict: impl-wins — `tower = { workspace = true, features =
  ["util"] }` added to `src-app/desktop/tauri/Cargo.toml`'s `[dev-dependencies]`,
  which PLAN's *Files to touch* did not list. `ServiceExt::oneshot` is needed to
  drive a real preflight, mirroring the sdk's own router tests. Test-only.
- **DRIFT-1.7** — verdict: impl-wins — ITEM-4 also updates
  `config/prod.example.yaml`, which *Files to touch* omitted although DEC-10
  decided it in phase 4. Both examples carry the same explicit list; updating one
  and not the other would be arbitrary. PLAN amended.
- **DRIFT-1.8** — verdict: resolved — running `cargo check` inside the sdk
  workspace dirtied `sdk/Cargo.lock` with an unrelated `webkit2gtk` entry
  (pre-existing staleness in the sdk's committed lock, not a consequence of this
  change). Reverted rather than committed: it does not belong in a focused PR and
  would be a gratuitous conflict for the next sdk branch.
- **DRIFT-1.9** — verdict: none — the design's four invariants are each
  implemented as planned and pinned by the acceptance test named in TESTS.md;
  re-read `docs/design/realtime-sse-delivery.md` § Required behaviour against the
  shipped code with no divergence found. In particular INV-1's "without a config
  file having to remember it" is realised as a union rather than as a longer
  allow-list, which is the stronger reading and the one the design states.

**Unresolved drifts:** 0
