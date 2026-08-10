//! Engine-version DISCOVERY — `GET /local-runtime/versions/available`.
//!
//! The defect these cover, reproduced by hand against a live server before the
//! fix: `POST /local-runtime/versions/download` requires all five of
//! `{engine, version, platform, arch, backend}`, and nothing told a caller what
//! to pass. `GET /versions` returned `{"versions":[]}` on a fresh install, and
//! `GET /versions/available` was swallowed by the sibling `{version_id}` route:
//!
//! ```text
//! Invalid URL: Cannot parse `version_id` with value `available`:
//!   UUID parsing failed: invalid character: found `v` at 1
//! HTTP=400
//! ```

use reqwest::StatusCode;
use serde_json::Value;

use crate::common::test_helpers::{create_user_with_only_permissions, create_user_with_permissions};

use super::mock_release;
use super::test_helpers::{self as lrt, LOCAL_RUNTIME_ADMIN_PERMS};

/// GET the discovery endpoint, optionally filtered by engine.
async fn discover(
    mock: &mock_release::MockReleaseServer,
    token: &str,
    engine: Option<&str>,
) -> (StatusCode, Value) {
    let url = match engine {
        Some(e) => mock
            .server
            .api_url(&format!("/local-runtime/versions/available?engine={e}")),
        None => mock.server.api_url("/local-runtime/versions/available"),
    };
    let resp = reqwest::Client::new()
        .get(url)
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await
        .expect("discovery request");
    let status = resp.status();
    let body = resp.json::<Value>().await.expect("discovery json");
    (status, body)
}

fn engine_entry<'a>(body: &'a Value, engine: &str) -> &'a Value {
    body["engines"]
        .as_array()
        .unwrap_or_else(|| panic!("engines array missing from {body}"))
        .iter()
        .find(|e| e["engine"].as_str() == Some(engine))
        .unwrap_or_else(|| panic!("engine {engine} missing from {body}"))
}

fn version_entry<'a>(engine_entry: &'a Value, version: &str) -> &'a Value {
    engine_entry["versions"]
        .as_array()
        .unwrap_or_else(|| panic!("versions array missing from {engine_entry}"))
        .iter()
        .find(|v| v["version"].as_str() == Some(version))
        .unwrap_or_else(|| panic!("version {version} missing from {engine_entry}"))
}

/// TEST-1 `[acceptance]` for **INV-1** — discovery alone is sufficient to
/// install, with no hardcoded tag anywhere in the test.
///
/// This is the invariant's executable proof, so it is written to FAIL if the
/// promise were violated: the five-tuple fed to the download endpoint is read
/// out of the discovery response at runtime. If discovery reported a version
/// that is not installable, or omitted the platform/arch/backend a caller must
/// supply, the download would fail and this test would go red — which is
/// exactly the behaviour a caller experienced before the fix.
#[tokio::test]
async fn discovery_alone_yields_an_installable_five_tuple() {
    let mock = mock_release::setup().await;
    let admin =
        create_user_with_permissions(&mock.server, "admin", LOCAL_RUNTIME_ADMIN_PERMS).await;
    let client = reqwest::Client::new();

    // Precondition: a fresh install genuinely knows nothing. This is what made
    // the installed-versions list useless as a discovery surface.
    let installed = client
        .get(mock.server.api_url("/local-runtime/versions"))
        .header("Authorization", format!("Bearer {}", admin.token))
        .send()
        .await
        .unwrap()
        .json::<Value>()
        .await
        .unwrap();
    assert_eq!(
        installed["versions"].as_array().map(|a| a.len()),
        Some(0),
        "fresh install must report zero installed versions: {installed}"
    );

    // Discovery.
    let (status, body) = discover(&mock, &admin.token, Some("llamacpp")).await;
    assert_eq!(status, StatusCode::OK, "discovery must succeed: {body}");

    let entry = engine_entry(&body, "llamacpp");
    assert_eq!(
        entry["source"].as_str(),
        Some("live"),
        "first read must come from upstream: {entry}"
    );

    // Pick the first host-installable variant PURELY from the response — the
    // test never names a tag, platform, arch or backend of its own.
    let version_obj = entry["versions"]
        .as_array()
        .expect("versions array")
        .iter()
        .find(|v| v["binary_ready"].as_bool() == Some(true))
        .expect("at least one host-installable version must be discoverable");
    let version = version_obj["version"]
        .as_str()
        .expect("version")
        .to_string();
    let variant = version_obj["variants"]
        .as_array()
        .expect("variants array")
        .iter()
        .find(|v| v["matches_host"].as_bool() == Some(true))
        .expect("a host-matching variant must be listed");
    let platform = variant["platform"].as_str().expect("platform").to_string();
    let arch = variant["arch"].as_str().expect("arch").to_string();
    let backend = variant["backend"].as_str().expect("backend").to_string();

    // Feed the discovered tuple back VERBATIM.
    let start = client
        .post(mock.server.api_url("/local-runtime/versions/download"))
        .header("Authorization", format!("Bearer {}", admin.token))
        .json(&serde_json::json!({
            "engine": "llamacpp",
            "version": version,
            "platform": platform,
            "arch": arch,
            "backend": backend,
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(
        start.status(),
        StatusCode::OK,
        "the discovered tuple must be accepted by the download endpoint"
    );
    let started: Value = start.json().await.unwrap();
    let key = started["key"].as_str().expect("task key").to_string();

    // And must actually install.
    let snapshot = lrt::await_download_terminal(&mock.server, &admin.token, &key).await;
    assert_eq!(
        snapshot["status"].as_str(),
        Some("completed"),
        "a tuple taken from discovery must install cleanly, got: {snapshot}"
    );

    // Re-reading discovery now reflects it as installed — the surface tells the
    // truth in both directions.
    let (_, after) = discover(&mock, &admin.token, Some("llamacpp")).await;
    let after_v = version_entry(engine_entry(&after, "llamacpp"), &version);
    assert_eq!(
        after_v["installed"].as_bool(),
        Some(true),
        "discovery must report the just-installed version as installed: {after_v}"
    );
}

/// TEST-1 (negative half) — a version NOT in the discovery output is refused,
/// and the refusal names the discovery endpoint.
///
/// The reported experience was an upstream `ggml-org/llama.cpp` tag (`b10344`)
/// failing with an error that was accurate but a dead end. The rejection is
/// paired with the accept-case above so it cannot pass merely because the
/// endpoint is broken some other way.
#[tokio::test]
async fn undiscovered_version_is_refused_with_an_actionable_error() {
    let mock = mock_release::setup().await;
    let admin =
        create_user_with_permissions(&mock.server, "admin", LOCAL_RUNTIME_ADMIN_PERMS).await;
    let client = reqwest::Client::new();

    // Prove the tag really is absent from discovery, rather than assuming it.
    let (_, body) = discover(&mock, &admin.token, Some("llamacpp")).await;
    let known: Vec<&str> = engine_entry(&body, "llamacpp")["versions"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|v| v["version"].as_str())
        .collect();
    assert!(
        !known.contains(&"b10344"),
        "precondition: b10344 must not be a discoverable version, saw {known:?}"
    );

    let start = client
        .post(mock.server.api_url("/local-runtime/versions/download"))
        .header("Authorization", format!("Bearer {}", admin.token))
        .json(&serde_json::json!({
            "engine": "llamacpp",
            "version": "b10344",
            "platform": mock.platform,
            "arch": mock.arch,
            "backend": "cpu",
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(
        start.status(),
        StatusCode::OK,
        "download is accepted then fails async"
    );
    let key = start.json::<Value>().await.unwrap()["key"]
        .as_str()
        .unwrap()
        .to_string();

    let snapshot = lrt::await_download_terminal(&mock.server, &admin.token, &key).await;
    assert_eq!(snapshot["status"].as_str(), Some("failed"));
    let err = snapshot["error"].as_str().unwrap_or_default();
    assert!(
        err.contains("/local-runtime/versions/available"),
        "a rejected version must point the caller at the discovery endpoint, got: {err}"
    );
}

/// TEST-2 — the literal `available` segment resolves to the discovery handler
/// and is NOT shadowed by `/versions/{version_id}`, while a real UUID still
/// reaches the by-id handler. Both directions in one test: asserting only that
/// `available` works would not prove the by-id route survived, and asserting
/// only the by-id route would not prove the shadowing was fixed.
#[tokio::test]
async fn available_literal_and_uuid_routes_coexist() {
    let mock = mock_release::setup().await;
    let admin =
        create_user_with_permissions(&mock.server, "admin", LOCAL_RUNTIME_ADMIN_PERMS).await;
    let client = reqwest::Client::new();

    let (status, body) = discover(&mock, &admin.token, None).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "the literal `available` segment must not be parsed as a version_id: {body}"
    );
    assert!(
        body.get("engines").is_some(),
        "must return the discovery payload, not a version record: {body}"
    );

    // The sibling parameterised route still works — an unknown-but-valid UUID
    // is a 404 from the by-id handler, NOT a routing/parse error.
    let by_id = client
        .get(
            mock.server
                .api_url(&format!("/local-runtime/versions/{}", uuid::Uuid::new_v4())),
        )
        .header("Authorization", format!("Bearer {}", admin.token))
        .send()
        .await
        .unwrap();
    assert_eq!(
        by_id.status(),
        StatusCode::NOT_FOUND,
        "the {{version_id}} route must still resolve for a real UUID"
    );
}

/// TEST-3 — every published variant is reported, including ones for a platform
/// and arch that are NOT this host, and `?engine=` filters.
///
/// This is the part that actually closes the gap: the download endpoint demands
/// `platform` and `arch`, so a response listing only host-matching backends
/// would still leave a caller guessing two of the five required fields.
#[tokio::test]
async fn reports_all_published_variants_and_filters_by_engine() {
    let mock = mock_release::setup().await;
    let admin =
        create_user_with_permissions(&mock.server, "admin", LOCAL_RUNTIME_ADMIN_PERMS).await;

    let (status, body) = discover(&mock, &admin.token, None).await;
    assert_eq!(status, StatusCode::OK);

    // No filter ⇒ every engine, so a caller who knows nothing gets everything.
    let engines: Vec<&str> = body["engines"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|e| e["engine"].as_str())
        .collect();
    assert!(engines.contains(&"llamacpp"), "got {engines:?}");
    assert!(engines.contains(&"mistralrs"), "got {engines:?}");

    let test_v = version_entry(engine_entry(&body, "llamacpp"), mock_release::TEST_VERSION);
    let variants = test_v["variants"].as_array().expect("variants");
    assert!(
        !variants.is_empty(),
        "a published release must enumerate its variants: {test_v}"
    );

    // Every variant carries the full tuple the download endpoint requires.
    for v in variants {
        for field in ["platform", "arch", "backend"] {
            assert!(
                v[field].as_str().is_some_and(|s| !s.is_empty()),
                "variant missing {field}: {v}"
            );
        }
        assert!(
            v["size_bytes"].as_u64().is_some(),
            "variant must carry its download size: {v}"
        );
    }

    // The `.sig` sidecar must never be advertised as an installable backend.
    assert!(
        !variants
            .iter()
            .any(|v| v["backend"].as_str() == Some("sig")),
        "signature sidecars must not appear as installable variants: {variants:?}"
    );

    // Non-host variants ARE listed, and flagged as not matching this host.
    let non_host: Vec<&Value> = variants
        .iter()
        .filter(|v| v["matches_host"].as_bool() == Some(false))
        .collect();
    assert!(
        !non_host.is_empty(),
        "variants for other platforms must be listed too — the download \
         endpoint requires platform/arch, so hiding them leaves a caller \
         guessing. variants: {variants:?}"
    );
    assert!(
        non_host
            .iter()
            .any(|v| v["platform"].as_str() != Some(mock.platform.as_str())),
        "expected at least one variant for a different platform: {non_host:?}"
    );

    // And the host-matching one is still identified, so the UI can default.
    assert!(
        variants
            .iter()
            .any(|v| v["matches_host"].as_bool() == Some(true)),
        "the host-matching variant must be identifiable: {variants:?}"
    );

    // `?engine=` narrows to exactly one engine.
    let (_, filtered) = discover(&mock, &admin.token, Some("mistralrs")).await;
    let filtered_engines: Vec<&str> = filtered["engines"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|e| e["engine"].as_str())
        .collect();
    assert_eq!(filtered_engines, vec!["mistralrs"], "filter must narrow");

    // An unknown engine is a 400 with a message naming the valid ones — NOT an
    // empty list, which would read as "this engine has no versions" and
    // reproduce the very confusion this endpoint exists to remove.
    let (bad_status, bad_body) = discover(&mock, &admin.token, Some("llamacpp2")).await;
    assert_eq!(bad_status, StatusCode::BAD_REQUEST, "got {bad_body}");
    let msg = bad_body.to_string();
    assert!(
        msg.contains("llamacpp") && msg.contains("mistralrs"),
        "the error must name the supported engines: {msg}"
    );
}

/// TEST-9 — auth gate: 401 unauthenticated, 403 without `versions_read`, and —
/// as the positive control in the SAME test — 200 for a user who holds it.
/// Without the positive control a 403 assertion would also pass against a
/// totally broken endpoint.
#[tokio::test]
async fn discovery_requires_versions_read_permission() {
    let mock = mock_release::setup().await;
    let client = reqwest::Client::new();
    let url = mock.server.api_url("/local-runtime/versions/available");

    let anon = client.get(&url).send().await.unwrap();
    assert_eq!(
        anon.status(),
        StatusCode::UNAUTHORIZED,
        "discovery must not be readable without a token"
    );

    // A real user who simply lacks the versions_read permission.
    let weak =
        create_user_with_only_permissions(&mock.server, "weakuser", &["llm_local_runtime::read"])
            .await;
    let forbidden = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", weak.token))
        .send()
        .await
        .unwrap();
    assert_eq!(
        forbidden.status(),
        StatusCode::FORBIDDEN,
        "a user without versions_read must be refused"
    );

    // Positive control.
    let admin =
        create_user_with_permissions(&mock.server, "admin", LOCAL_RUNTIME_ADMIN_PERMS).await;
    let allowed = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", admin.token))
        .send()
        .await
        .unwrap();
    assert_eq!(
        allowed.status(),
        StatusCode::OK,
        "a permitted user must reach the endpoint — otherwise the 403 above \
         proves nothing about gating"
    );
}
