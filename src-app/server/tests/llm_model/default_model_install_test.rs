//! The full "working model" install sequence the Onboarding step performs.
//!
//! Covers TEST-6 (acceptance, INV-2) of the `default-model-onboarding` feature.
//!
//! > **INV-2**: The user reaches a **working model** without leaving Onboarding
//! > and without visiting a settings page.
//!
//! The "without leaving Onboarding" half is a browser claim and is proven by the
//! e2e spec. THIS test proves the half that would silently be false otherwise:
//! that the sequence actually yields a model the app can serve. A fresh install
//! ships the built-in `Local` provider DISABLED and no runtime engine at all, so
//! downloading weights alone leaves a file nothing can load. The test asserts
//! both of those pre-conditions first, so it fails loudly if a future change
//! makes it vacuous.

use serde_json::json;

use crate::llm_local_runtime::mock_release;
use crate::llm_local_runtime::test_helpers::{self as lrt, LOCAL_RUNTIME_ADMIN_PERMS};
use crate::llm_model::git_fixture;

const MODEL_NAME: &str = "ziee-default-qwen3-5-9b-q4-k-m";
const MAIN_FILENAME: &str = "Qwen3.5-9B-Q4_K_M.gguf";
const REPO_NAME: &str = "Qwen3.5-9B-GGUF";
const FAKE_WEIGHTS: &[u8] = b"GGUF\x00ziee-test-weights";

/// TEST-6 (acceptance, INV-2) — the sequence yields a WORKING model.
#[tokio::test]
async fn test_6_install_sequence_yields_a_servable_default_model() {
    let mock = mock_release::setup().await;
    let mut perms: Vec<&str> = LOCAL_RUNTIME_ADMIN_PERMS.to_vec();
    perms.extend_from_slice(&["llm_repositories::create", "llm_repositories::read"]);
    let admin =
        crate::common::test_helpers::create_user_with_permissions(&mock.server, "installer", &perms)
            .await;
    let client = reqwest::Client::new();
    let auth = format!("Bearer {}", admin.token);

    // ── Pre-conditions: the two gaps this sequence exists to close ──────────
    //
    // If either of these ever stops being true the test would still pass while
    // proving much less, so assert them rather than assume them.
    let providers: serde_json::Value = client
        .get(mock.server.api_url("/llm-providers?page=1&per_page=50"))
        .header("Authorization", &auth)
        .send()
        .await
        .expect("list providers")
        .json()
        .await
        .expect("providers json");
    let local = providers["providers"]
        .as_array()
        .expect("providers array")
        .iter()
        .find(|p| p["provider_type"].as_str() == Some("local") && p["built_in"] == true)
        .expect("a fresh install ships a built-in local provider")
        .clone();
    assert_eq!(
        local["enabled"], false,
        "pre-condition: the built-in local provider ships DISABLED — this is the gap \
         the step's provider leg closes"
    );
    let local_id = local["id"].as_str().expect("local provider id").to_string();

    let versions: serde_json::Value = client
        .get(mock.server.api_url("/local-runtime/versions?engine=llamacpp"))
        .header("Authorization", &auth)
        .send()
        .await
        .expect("list runtime versions")
        .json()
        .await
        .expect("versions json");
    assert!(
        versions["versions"]
            .as_array()
            .map(|v| v.is_empty())
            .unwrap_or(true),
        "pre-condition: a fresh install has NO local runtime engine — this is the gap \
         the step's runtime leg closes"
    );

    // ── Leg 1: enable a local provider to install into ──────────────────────
    let enabled = client
        .post(mock.server.api_url(&format!("/llm-providers/{local_id}")))
        .header("Authorization", &auth)
        .json(&json!({ "enabled": true }))
        .send()
        .await
        .expect("enable the local provider");
    assert_eq!(enabled.status(), 200, "the local provider should enable");

    // ── Leg 2: provision the llama.cpp runtime and make it the system default ─
    let version_id = lrt::download_engine_from_mock(&mock, &admin.token, "llamacpp").await;

    // ── Leg 3: download the weights anonymously ─────────────────────────────
    let fixture = git_fixture::start(REPO_NAME, &[(MAIN_FILENAME, FAKE_WEIGHTS)]).await;
    let repo = client
        .post(mock.server.api_url("/llm-repositories"))
        .header("Authorization", &auth)
        .json(&json!({
            "name": format!("anon-fixture-{}", uuid::Uuid::new_v4()),
            "url": fixture.base_url,
            "auth_type": "none",
            "enabled": false,
        }))
        .send()
        .await
        .expect("create fixture repository");
    assert_eq!(repo.status(), 201);
    let repository_id = repo.json::<serde_json::Value>().await.unwrap()["id"]
        .as_str()
        .expect("repository id")
        .to_string();

    let started = client
        .post(mock.server.api_url("/llm-models/download"))
        .header("Authorization", &auth)
        .json(&json!({
            "provider_id": local_id,
            "repository_id": repository_id,
            "repository_path": REPO_NAME,
            "repository_branch": "main",
            "name": MODEL_NAME,
            "display_name": "Qwen3.5 9B (Q4_K_M)",
            "main_filename": MAIN_FILENAME,
            "file_format": "gguf",
            "engine_type": "llamacpp",
            "capabilities": { "chat": true, "tools": true },
        }))
        .send()
        .await
        .expect("start the model download");
    assert_eq!(started.status(), 200);
    let download_id = started.json::<serde_json::Value>().await.unwrap()["id"]
        .as_str()
        .expect("download id")
        .to_string();

    let mut status = String::new();
    for _ in 0..300 {
        let body: serde_json::Value = client
            .get(
                mock.server
                    .api_url(&format!("/llm-models/downloads/{download_id}")),
            )
            .header("Authorization", &auth)
            .send()
            .await
            .expect("read download")
            .json()
            .await
            .expect("download json");
        status = body["status"].as_str().unwrap_or("").to_string();
        if matches!(status.as_str(), "completed" | "failed" | "cancelled") {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    assert_eq!(status, "completed", "the weights download should complete");

    // ── The invariant: what exists now is a model the app can SERVE ─────────
    let models: serde_json::Value = client
        .get(mock.server.api_url("/llm-models?page=1&perPage=100"))
        .header("Authorization", &auth)
        .send()
        .await
        .expect("list models")
        .json()
        .await
        .expect("models json");
    let model = models["models"]
        .as_array()
        .expect("models array")
        .iter()
        .find(|m| m["name"].as_str() == Some(MODEL_NAME))
        .expect("the default model exists after the sequence")
        .clone();
    assert_eq!(
        model["enabled"], true,
        "the installed model must be enabled — a disabled model is not a default"
    );
    assert_eq!(
        model["provider_id"].as_str(),
        Some(local_id.as_str()),
        "it lives under the local provider the sequence enabled"
    );

    let provider_now: serde_json::Value = client
        .get(mock.server.api_url(&format!("/llm-providers/{local_id}")))
        .header("Authorization", &auth)
        .send()
        .await
        .expect("re-read provider")
        .json()
        .await
        .expect("provider json");
    assert_eq!(
        provider_now["enabled"], true,
        "the provider stays enabled, so the model is reachable from the picker"
    );

    // An engine is resolvable for it. `select_runtime_version` falls through
    // model → provider → SYSTEM DEFAULT → latest; the model names no required
    // version, so the system default is what it lands on — and on a fresh
    // install that step returned `None`.
    let versions_now: serde_json::Value = client
        .get(mock.server.api_url("/local-runtime/versions?engine=llamacpp"))
        .header("Authorization", &auth)
        .send()
        .await
        .expect("list runtime versions")
        .json()
        .await
        .expect("versions json");
    let default_version = versions_now["versions"]
        .as_array()
        .expect("versions array")
        .iter()
        .find(|v| v["is_system_default"] == true)
        .expect("INV-2: a llama.cpp runtime must be the system default, or the model \
                 has nothing to run on");
    assert_eq!(
        default_version["id"].as_str(),
        Some(version_id.to_string().as_str()),
        "the system default is the version this sequence installed"
    );
    assert_eq!(default_version["engine"].as_str(), Some("llamacpp"));
}
