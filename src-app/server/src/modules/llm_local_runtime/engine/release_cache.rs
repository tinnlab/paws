//! Process-lifetime TTL cache over the engine release catalogue.
//!
//! ## Why this exists
//!
//! `BinaryDownloader::list_releases` issues one `GET /repos/{repo}/releases`
//! per call, and it is the ONLY source of "which engine versions can I
//! install". Every mount of the runtime settings page called it directly, so
//! the surface cost one GitHub API request per page load. GitHub's
//! unauthenticated budget is **60 requests/hour/IP**, which a long-running
//! deployment (or several worktrees sharing an egress IP) exhausts
//! continuously — after which the discovery surface fails, renders no version
//! rows, and offers nothing to install.
//!
//! ## The retain-on-failure rule (the load-bearing part)
//!
//! A refresh failure **never evicts**. The previous catalogue is kept and
//! served, flagged stale, with the failure reason attached. A cache that
//! dropped its entry on failure would fix the request *volume* without fixing
//! the observed *outcome* — a rate-limited box would still show an empty list
//! every time, and an empty list reads as "no versions exist" rather than "we
//! could not refresh". Retention is what makes the surface usable on an
//! air-gapped or rate-limited host.
//!
//! Mirrors `modules::server_update::checker`'s `Lazy<RwLock<…>>` process cache
//! + `checked_at` + soft-fail shape. It deliberately does NOT mirror
//! `code_sandbox::version_manager::status()`, which collapses a GitHub failure
//! to an empty `Vec` — that is the behaviour described above.

use std::collections::HashMap;
use std::sync::RwLock;
use std::time::{Duration, Instant};

use once_cell::sync::Lazy;

use super::download::{CredentialStatus, ReleaseInfo};
use super::types::EngineType;

/// Where the catalogue in a response came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CatalogSource {
    /// Freshly fetched from upstream during this request.
    Live,
    /// Served from the process cache (either still fresh, or stale because a
    /// refresh failed — `unavailable_reason` distinguishes the two).
    Cache,
    /// Nothing to serve: no cached catalogue and the refresh failed.
    Unavailable,
}

impl CatalogSource {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Live => "live",
            Self::Cache => "cache",
            Self::Unavailable => "unavailable",
        }
    }
}

/// A catalogue plus the provenance a caller needs to judge it.
#[derive(Debug, Clone)]
pub struct Catalog {
    pub releases: Vec<ReleaseInfo>,
    pub source: CatalogSource,
    /// RFC3339 timestamp of the fetch that produced `releases`. `None` only
    /// when `source == Unavailable` (nothing was ever fetched).
    pub checked_at: Option<String>,
    /// Why the catalogue could not be refreshed just now. `None` on a clean
    /// live read. `Some` alongside `source == Cache` means "these versions are
    /// real but possibly out of date"; alongside `source == Unavailable` it is
    /// the whole story.
    pub unavailable_reason: Option<String>,
    /// Health of the GitHub credential the catalogue was fetched with — an axis
    /// ORTHOGONAL to `source`. `Rejected` alongside `source == Live` is the
    /// case this exists for: the operator's token was refused, the read was
    /// rescued anonymously, and the catalogue below is genuinely fresh. On a
    /// cache read this is the status of the fetch that PRODUCED the entry (the
    /// same rule `checked_at` follows), not of this read.
    pub credential_status: CredentialStatus,
}

impl Catalog {
    /// True when the caller is looking at data that could not be refreshed.
    ///
    /// Test-only: on the wire the same fact is carried by `source == "cache"`
    /// plus a non-null `unavailable_reason`, and the UI derives it from those
    /// two fields rather than from a server-side boolean. Keeping a production
    /// accessor nothing calls would be dead code (§15), so this exists only for
    /// the assertions below, which read more clearly for it.
    #[cfg(test)]
    pub fn is_stale(&self) -> bool {
        self.unavailable_reason.is_some() && self.source == CatalogSource::Cache
    }
}

/// One cached entry. `fetched_at` is an `Instant` for TTL arithmetic that is
/// immune to wall-clock jumps; `checked_at_rfc3339` is the human-facing
/// timestamp for the same moment.
#[derive(Debug, Clone)]
struct Entry {
    releases: Vec<ReleaseInfo>,
    fetched_at: Instant,
    checked_at_rfc3339: String,
    /// Credential health at the moment this entry was fetched. Echoed on every
    /// cache read rather than recomputed, so the rejection notice does not
    /// flicker off on the second page load within the TTL — an intermittent
    /// warning reads as a glitch, which is worse than never showing it.
    credential_status: CredentialStatus,
}

static CACHE: Lazy<RwLock<HashMap<EngineType, Entry>>> = Lazy::new(|| RwLock::new(HashMap::new()));

/// Read the cached entry for `engine` if it is still within `ttl`.
///
/// Split out (rather than inlined into `get_or_refresh`) so the freshness rule
/// is unit-testable without a network or a downloader.
fn fresh_entry(entry: &Entry, ttl: Duration, now: Instant) -> bool {
    now.duration_since(entry.fetched_at) < ttl
}

/// Drop every cached entry.
///
/// Unit-test-only. The integration suite does NOT need it: each test spawns its
/// own server subprocess, so the process-lifetime cache already starts empty
/// there — which is what makes the upstream-request counts in
/// `tests/llm_local_runtime/release_cache_test.rs` meaningful. Only the
/// in-crate tests below share a process and must reset between cases.
#[cfg(test)]
pub fn clear() {
    if let Ok(mut guard) = CACHE.write() {
        guard.clear();
    }
}

/// Serve `engine`'s release catalogue, refreshing from `fetch` only when the
/// cached entry is missing or older than `ttl`.
///
/// `fetch` is injected rather than called directly so this module never
/// depends on `BinaryDownloader` (and so the tests below can drive every
/// branch deterministically). It returns the same `Result` shape
/// `list_releases` does, reduced to a `String` reason — PAIRED with the
/// credential status, which is known whether the fetch succeeded or failed. A
/// status carried *inside* the `Ok` would be lost on exactly the failure the
/// operator most needs explained.
pub async fn get_or_refresh<F, Fut>(engine: EngineType, ttl: Duration, fetch: F) -> Catalog
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = (Result<Vec<ReleaseInfo>, String>, CredentialStatus)>,
{
    // Fast path: a fresh entry needs no upstream call at all. The read guard
    // is dropped before the await — holding a std RwLock across an await would
    // be a deadlock hazard.
    {
        let now = Instant::now();
        if let Ok(guard) = CACHE.read()
            && let Some(entry) = guard.get(&engine)
            && fresh_entry(entry, ttl, now)
        {
            return Catalog {
                releases: entry.releases.clone(),
                source: CatalogSource::Cache,
                checked_at: Some(entry.checked_at_rfc3339.clone()),
                unavailable_reason: None,
                credential_status: entry.credential_status,
            };
        }
    }

    let (result, credential_status) = fetch().await;
    match result {
        Ok(releases) => {
            let checked_at = chrono::Utc::now().to_rfc3339();
            if let Ok(mut guard) = CACHE.write() {
                guard.insert(
                    engine,
                    Entry {
                        releases: releases.clone(),
                        fetched_at: Instant::now(),
                        checked_at_rfc3339: checked_at.clone(),
                        credential_status,
                    },
                );
            }
            Catalog {
                releases,
                source: CatalogSource::Live,
                checked_at: Some(checked_at),
                unavailable_reason: None,
                credential_status,
            }
        }
        Err(reason) => {
            // RETAIN-ON-FAILURE. Serve the previous catalogue, labelled, so a
            // rate-limited or air-gapped box degrades to stale-but-honest data
            // instead of an empty list that reads as "no versions exist".
            if let Ok(guard) = CACHE.read()
                && let Some(entry) = guard.get(&engine)
            {
                tracing::warn!(
                    engine = %engine,
                    reason = %reason,
                    "engine release catalogue refresh failed; serving cached catalogue"
                );
                return Catalog {
                    releases: entry.releases.clone(),
                    source: CatalogSource::Cache,
                    checked_at: Some(entry.checked_at_rfc3339.clone()),
                    unavailable_reason: Some(reason),
                    // The FAILED refresh's credential verdict, not the stored
                    // entry's: a token revoked since the entry was cached must
                    // be reported NOW, and a refresh that failed for an
                    // unrelated reason must not resurrect a stale `Rejected`.
                    credential_status,
                };
            }
            tracing::warn!(
                engine = %engine,
                reason = %reason,
                "engine release catalogue unavailable and nothing cached"
            );
            Catalog {
                releases: Vec::new(),
                source: CatalogSource::Unavailable,
                checked_at: None,
                unavailable_reason: Some(reason),
                credential_status,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::llm_local_runtime::engine::download::AssetInfo;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// The cache is a process-lifetime global and `clear()` wipes EVERY engine,
    /// so two cache tests running in parallel corrupt each other — one test's
    /// `clear()` evicts the entry another test just seeded. (Observed: the
    /// retain-on-failure case intermittently saw `Unavailable` because a
    /// sibling test cleared its seed during the sleep.) Serialize them.
    static CACHE_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    /// A successful fetch that used no credential — the shape every
    /// pre-existing case implicitly assumed.
    fn ok(releases: Vec<ReleaseInfo>) -> (Result<Vec<ReleaseInfo>, String>, CredentialStatus) {
        (Ok(releases), CredentialStatus::Absent)
    }

    /// A failed fetch that used no credential.
    fn err(reason: &str) -> (Result<Vec<ReleaseInfo>, String>, CredentialStatus) {
        (Err(reason.to_string()), CredentialStatus::Absent)
    }

    fn rel(tag: &str) -> ReleaseInfo {
        ReleaseInfo {
            version: tag.to_string(),
            draft: false,
            prerelease: false,
            published_at: None,
            assets: vec![AssetInfo {
                name: "llama-server-linux-x86_64-cpu.tar.gz".to_string(),
                size_bytes: 42,
            }],
        }
    }

    /// TEST-6a — an entry inside its TTL is fresh; past it, it is not.
    #[test]
    fn freshness_follows_ttl() {
        let base = Instant::now();
        let entry = Entry {
            releases: vec![rel("v1")],
            fetched_at: base,
            checked_at_rfc3339: "2026-01-01T00:00:00Z".to_string(),
            credential_status: CredentialStatus::Absent,
        };
        let ttl = Duration::from_secs(60);
        assert!(
            fresh_entry(&entry, ttl, base + Duration::from_secs(59)),
            "an entry 59s old under a 60s TTL must be fresh"
        );
        assert!(
            !fresh_entry(&entry, ttl, base + Duration::from_secs(61)),
            "an entry 61s old under a 60s TTL must be stale"
        );
    }

    /// TEST-6b — a second read inside the TTL performs NO upstream fetch, and
    /// reports `cache`. The counter is the assertion: this is what turns one
    /// GitHub request per page load into one per TTL.
    #[tokio::test]
    async fn second_read_within_ttl_does_not_refetch() {
        let _guard = CACHE_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        clear();
        let calls = AtomicUsize::new(0);
        let ttl = Duration::from_secs(3600);

        let first = get_or_refresh(EngineType::Llamacpp, ttl, || {
            calls.fetch_add(1, Ordering::SeqCst);
            async { ok(vec![rel("v0.0.3-alpha")]) }
        })
        .await;
        assert_eq!(first.source, CatalogSource::Live);
        assert_eq!(calls.load(Ordering::SeqCst), 1);

        let second = get_or_refresh(EngineType::Llamacpp, ttl, || {
            calls.fetch_add(1, Ordering::SeqCst);
            async { ok(vec![rel("v0.0.3-alpha")]) }
        })
        .await;
        assert_eq!(second.source, CatalogSource::Cache);
        assert_eq!(
            calls.load(Ordering::SeqCst),
            1,
            "a read within the TTL must not touch upstream"
        );
        assert!(second.unavailable_reason.is_none());
        assert!(!second.is_stale());
        clear();
    }

    /// TEST-6c — the load-bearing rule: a FAILED refresh retains and serves the
    /// previous catalogue, flagged, instead of evicting it. If this regresses,
    /// a rate-limited box shows an empty list again.
    #[tokio::test]
    async fn failed_refresh_retains_previous_catalog() {
        let _guard = CACHE_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        clear();
        let ttl = Duration::from_millis(1);

        let seeded = get_or_refresh(EngineType::Mistralrs, ttl, || async {
            ok(vec![rel("v0.0.3-alpha"), rel("v0.0.2-alpha")])
        })
        .await;
        assert_eq!(seeded.source, CatalogSource::Live);
        assert_eq!(seeded.releases.len(), 2);

        // Let the entry age past the (deliberately tiny) TTL, then fail.
        tokio::time::sleep(Duration::from_millis(5)).await;
        let degraded = get_or_refresh(EngineType::Mistralrs, ttl, || async {
            err("HTTP 403 rate limit exceeded")
        })
        .await;

        assert_eq!(
            degraded.source,
            CatalogSource::Cache,
            "a failed refresh must fall back to cache, not Unavailable"
        );
        assert_eq!(
            degraded.releases.len(),
            2,
            "the previously-known versions must survive a failed refresh"
        );
        assert!(degraded.is_stale(), "stale data must be flagged as such");
        assert_eq!(
            degraded.unavailable_reason.as_deref(),
            Some("HTTP 403 rate limit exceeded"),
            "the reason must be carried through so the caller can say WHY"
        );
        assert!(degraded.checked_at.is_some());
        clear();
    }

    /// TEST-6d — with nothing cached, a failure is `unavailable` WITH a reason,
    /// never a silent empty catalogue. The distinction between this and an
    /// upstream that genuinely published nothing is the whole point.
    #[tokio::test]
    async fn failure_with_empty_cache_is_unavailable_with_reason() {
        let _guard = CACHE_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        clear();
        let cat = get_or_refresh(EngineType::Llamacpp, Duration::from_secs(60), || async {
            err("dns error: failed to lookup address")
        })
        .await;
        assert_eq!(cat.source, CatalogSource::Unavailable);
        assert!(cat.releases.is_empty());
        assert!(cat.checked_at.is_none());
        assert!(
            cat.unavailable_reason.is_some(),
            "an empty catalogue must always carry a reason, so it can never be \
             mistaken for 'upstream published no versions'"
        );

        // Positive control in the same test: a successful fetch that genuinely
        // returns zero releases is `live` with NO reason — the two empty
        // catalogues are distinguishable, which is what INV-2 requires.
        let genuinely_empty =
            get_or_refresh(EngineType::Llamacpp, Duration::from_secs(60), || async {
                ok(Vec::new())
            })
            .await;
        assert_eq!(genuinely_empty.source, CatalogSource::Live);
        assert!(genuinely_empty.releases.is_empty());
        assert!(genuinely_empty.unavailable_reason.is_none());
        clear();
    }

    /// TEST-7 — a rejected credential survives BOTH cache-serving paths.
    ///
    /// The failure this pins: if a cache hit reported `Absent` instead of the
    /// stored verdict, the "your token was rejected" notice would appear on the
    /// first page load inside the TTL and vanish on the second — an
    /// intermittent warning reads as a glitch, which is worse than never
    /// showing it. The positive control at the end is that a credential-free
    /// fetch still reports `Absent`, so nothing here can pass by hardcoding
    /// `Rejected`.
    #[tokio::test]
    async fn rejected_credential_survives_cache_hit_and_retain_on_failure() {
        let _guard = CACHE_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        clear();
        let ttl = Duration::from_millis(1);

        // A LIVE read whose credential was rejected but whose anonymous retry
        // succeeded: real versions, `Live`, no unavailable_reason, `Rejected`.
        let live = get_or_refresh(EngineType::Llamacpp, Duration::from_secs(3600), || async {
            (Ok(vec![rel("v0.0.3-alpha")]), CredentialStatus::Rejected)
        })
        .await;
        assert_eq!(live.source, CatalogSource::Live);
        assert_eq!(live.credential_status, CredentialStatus::Rejected);
        assert!(
            live.unavailable_reason.is_none(),
            "an anonymous-rescued read is genuinely fresh — flagging it \
             unreachable would render 'couldn't reach GitHub' over a full list"
        );

        // Path 1: a fresh cache HIT must echo the stored verdict, not reset it.
        let hit = get_or_refresh(EngineType::Llamacpp, Duration::from_secs(3600), || async {
            panic!("must not refetch within the TTL")
        })
        .await;
        assert_eq!(hit.source, CatalogSource::Cache);
        assert_eq!(
            hit.credential_status,
            CredentialStatus::Rejected,
            "a cache hit must report the credential status of the fetch that \
             produced it, exactly as it already does for checked_at"
        );

        // Path 2: retain-on-failure must report the FAILED refresh's verdict.
        clear();
        let seeded = get_or_refresh(EngineType::Mistralrs, ttl, || async {
            (Ok(vec![rel("v1")]), CredentialStatus::Used)
        })
        .await;
        assert_eq!(seeded.credential_status, CredentialStatus::Used);
        tokio::time::sleep(Duration::from_millis(5)).await;
        let degraded = get_or_refresh(EngineType::Mistralrs, ttl, || async {
            (
                Err("Failed to list releases: HTTP 401 Unauthorized".to_string()),
                CredentialStatus::Rejected,
            )
        })
        .await;
        assert_eq!(degraded.source, CatalogSource::Cache);
        assert_eq!(degraded.releases.len(), 1, "retain-on-failure still holds");
        assert_eq!(
            degraded.credential_status,
            CredentialStatus::Rejected,
            "a token revoked since the entry was cached must be reported NOW, \
             not masked by the stored 'used' verdict"
        );

        // Positive control: a credential-free fetch still reports Absent.
        clear();
        let anon = get_or_refresh(EngineType::Llamacpp, Duration::from_secs(3600), || async {
            ok(vec![rel("v1")])
        })
        .await;
        assert_eq!(anon.credential_status, CredentialStatus::Absent);
        clear();
    }
}
