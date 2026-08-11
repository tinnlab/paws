# SURVEY — every GitHub-credential call site in the tree (ITEM-10)

Reported, not changed (DESIGN §6). Search basis:
`rg -n 'GITHUB_TOKEN|GH_TOKEN|Authorization' --type rust --type ts` over
`src-app/server/src/modules/**`, `src-app/server/build_helper/**`,
`src-app/server/build.rs`, `src-app/desktop/**`, `scripts/**`.

## Headline

**`GITHUB_TOKEN` is read in exactly ONE place in the entire runtime** — the file
this branch fixes. `GH_TOKEN` is never read in server or desktop source (only in
`.github/workflows/*.yml`, for the `gh` CLI). So the defect is not a widespread
pattern to sweep; it is a single site, and the interesting finding is the
*inconsistency around it*.

| # | site | build/runtime | token? | filter | on 401/403 | anon fallback | user-visible? |
|---|---|---|---|---|---|---|---|
| 1 | `llm_local_runtime/engine/download.rs:60,498` | runtime | `GITHUB_TOKEN` | `trim` + non-empty; **no shape check** | `Err("Failed to list releases: HTTP 401")` | **No** ← the defect | yes — 200 + `unavailable_reason` + UI banner + retain-on-failure cache |
| 1b | same file `:616,:650` (asset download) | runtime | **none** | — | `RuntimeError::network` | n/a | yes (error string) |
| 2 | `code_sandbox/version_manager.rs:278` | runtime | **none** | — | `VersionError::GitHubUnreachable` | n/a | **no** — see below |
| 2b | `version_manager.rs:525` (`set_pin`) | runtime | none | — | propagates | n/a | yes — HTTP 502 `SANDBOX_ROOTFS_GITHUB_UNREACHABLE` |
| 2c | `version_manager.rs:489` (pin probe) | runtime | none | — | `Ok(None)` | n/a | `tracing::warn!` only |
| 3 | `server_update/checker.rs:110` | runtime | **none** | — | `Err(String)` | n/a | `tracing::warn!("…(soft)")` only; cache untouched, no reason on the wire |
| 4 | `voice/engine/download.rs:394` | runtime | **none** | — | `RuntimeError::network` | **No** | error string; no retain-on-failure cache |
| 5 | 8× `build_helper/{bun,llm_runtime,uv,typst,pgvector,pdfium,pandoc,biomcp}.rs` | **build** | **none** (bare `ureq::get`) | — | `Err("Download failed with status: …")` | **No** | yes — the build fails loudly |
| 6 | `build_helper/hub_seed.rs` | build | **none** (removed in the Pages migration) | — | no network at all | n/a | — |
| 7 | `hub/hub_manager.rs:437` | runtime | none (GitHub **Pages**, no auth concept) | — | `.error_for_status()` → 500 | n/a | yes (500 with URL) |
| 8a | `llm_model/handlers/repo_files.rs:510,531` | runtime | **DB** credential (not env) | `!t.trim().is_empty()` | 401\|403\|429 → one `UPSTREAM_REJECTED` | **No** | yes — but the three are made indistinguishable |
| 8b | `llm_repository/utils.rs:602,617` | runtime | **DB** credential | presence only | 403→`Unverified`, 401→`Unhealthy` (auto-disables the row) | **No** | yes |
| 8c | `mcp/client/http.rs:98` | runtime | DB env-map template | undefined ⇒ literal `${GITHUB_TOKEN}` + warn | server-specific | n/a | log |

## Findings worth acting on later (NOT changed here)

**S-1 — `code_sandbox::version_manager` collapses a GitHub failure to an empty
`Vec`, at `debug!` level.** `status()` (`:1128-1137`) and `available_only()`
(`:1218-1223`) both `unwrap_or_else(|e| { tracing::debug!(…); Vec::new() })`, and
`VersionStatus` has **no** `source`/`unavailable_reason`/`checked_at` field, so
the reason never reaches the wire. The UI guesses in static copy
(`AvailableRootfsCard.tsx:27`: *"GitHub Releases may be unreachable, or no
compatible releases were found"* — it genuinely cannot tell). This is the same
class of defect as the one being fixed here, one notch worse: the degradation
vocabulary this branch extends does not exist there at all.
`engine/release_cache.rs:25-28` already names it as the anti-pattern it
deliberately does not mirror. **The right shape is to give it the same
`Catalog`/`source`/`unavailable_reason` treatment — a separate change.**

**S-2 — `voice/engine/download.rs` is a near-copy of the fixed downloader that
never reads the token.** Same `github_get_with_retry` shape, same
`api.github.com` target, same 5xx/429-only transient rule — minus the token
block and minus any retain-on-failure cache. So voice-engine discovery is
permanently on the 60/hr anonymous budget, and a rate limit there yields a bare
error with no cached fallback. It is the strongest argument that **a shared
helper is the right eventual shape** (one `github_get` that owns the token, the
classification, the anonymous fallback and the retry policy, consumed by
llm_local_runtime + voice + code_sandbox + server_update). Doing that now would
be exactly the broad refactor DESIGN §6 says not to do unsolicited — it touches
four modules and three of them have no degradation vocabulary to report into
yet, so the sequencing is: give code_sandbox/voice the vocabulary first, then
extract.

**S-3 — `server_update/checker.rs` fails silently-ish.** On error the process
cache is left entirely untouched (`checked_at` is not even updated), and
`UpdateStatusResponse` has no `last_error`, so "never checked" and "failing
every day" are indistinguishable from the UI. Less harmful than S-1 (nothing is
*claimed* absent), still a silent degradation.

**S-4 — `llm_repository/utils.rs` 403-tolerance is incompletely applied.** The
probe deliberately splits 403 (`Unverified`, does not auto-disable — because a
403 is what GitHub returns on an exhausted anonymous budget) from 401
(`Unhealthy`, auto-disables). But the credential-endpoint step that runs FIRST
(`:712-725`) treats anything other than 200 as `Unhealthy`, so a **403 on the
auth-test endpoint still auto-disables the row**, bypassing the tolerance added
below it. Looks like an incomplete application of the fix in `e8ebf7e9c`.

**S-5 — `repo_files.rs` merges 401/403/429 into one `UPSTREAM_REJECTED`
message**, so an operator cannot tell a bad token from a rate limit — the same
confusion this branch removes from engine discovery.

## Stale documentation discovered (one is in this branch's own hunk)

`build_helper/hub_seed.rs` is now fully offline (its own header lists
`GITHUB_TOKEN handling` among what the Pages migration **deleted**). Three
comments still claim otherwise:

1. **`llm_local_runtime/engine/download.rs:495-497`** — *"`hub_seed.rs` already
   honours GITHUB_TOKEN at build time for exactly this reason — the runtime path
   simply never adopted it."* This is the **justification comment sitting
   directly above the only token-attach site in the codebase**, i.e. inside the
   hunk this branch rewrites. Corrected here (ITEM-11); leaving a false
   rationale in code I am editing would be shipping a known defect.
2. `.github/workflows/server-release.yml:10` — *"`GITHUB_TOKEN` for the hub-seed
   build helper (panics without it)"*. The helper has no token code and cannot
   panic on its absence. **Not changed** (outside scope; reported).
3. `src-app/ui/tests/e2e/sync/hub-settings-sync.spec.ts:40-41` — asserts in prose
   that the build helper honours `GITHUB_TOKEN`. Second clause (runtime
   `fetch_releases` uses no auth) is correct; the first is stale. **Not changed**
   (outside scope; reported).

## Non-findings (checked, clean)

- The token is **never logged, never placed in an error string, never
  serialized** on the existing path — that part was already correct, and this
  branch preserves it.
- `desktop/tauri/src/modules/backend/mod.rs:132` `"Authorization"` is a CORS
  `allow_headers` entry, not an outbound credential.
- `scripts/install.sh` uses plain `curl` with no auth header;
  `scripts/hub-smoke.sh`'s bearer is a ziee session token, not a GitHub one.
- `utils/git/service.rs:728` host matching is exact (`== "github.com" ||
  ends_with(".github.com")`), so it is not spoofable by `github.com.evil.example`.
- `repo_files.rs:355-360` pins the host across HF pagination so the bearer cannot
  be replayed to a host smuggled in via a poisoned `Link` cursor.
