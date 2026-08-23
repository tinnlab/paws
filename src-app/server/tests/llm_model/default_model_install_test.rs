//! The install sequence the Onboarding step performs, and whether its end state
//! is a model the app can actually serve.
//!
//! Covers TEST-6 (acceptance, INV-2) of the `default-model-onboarding` feature.
//!
//! > **INV-2**: The user reaches a **working model** without leaving Onboarding
//! > and without visiting a settings page.
//!
//! "Without leaving Onboarding" is a browser claim, proven by the e2e spec. This
//! file proves the half that would otherwise be silently false: that the
//! sequence yields something SERVABLE. A fresh install ships the built-in
//! `Local` provider DISABLED and no runtime engine at all, so downloading
//! weights alone leaves a file nothing can load — and every gate would still be
//! green. Both pre-conditions are asserted first, so this test fails loudly if a
//! future change makes it vacuous.
//!
//! **Scope of the model leg.** The weights download itself is not driven here:
//! `GitService::clone_repository` validates against `PUBLIC_HTTP_OR_HTTPS`
//! unconditionally, so no local fixture is reachable, and the design forbids
//! reaching for the real Hugging Face. The download leg is covered where its
//! mechanisms live — `LlmRepository::git_credential`'s unit tests (INV-1) and
//! `default_model_download_test.rs` (INV-4, INV-6). The model row here is
//! created through the supported API in the same shape a completed download
//! produces, because what INV-2 turns on is whether the END STATE is servable,
//! not which code path minted the row.

use serde_json::json;

use crate::llm_local_runtime::mock_release;
use crate::llm_local_runtime::test_helpers::{self as lrt, LOCAL_RUNTIME_ADMIN_PERMS};

const MODEL_NAME: &str = "ziee-default-qwen3-5-9b-q4-k-m";

/// TEST-6 (acceptance, INV-2) — the sequence yields a servable default model.
#[tokio::test]
async fn test_6_install_sequence_yields_a_servable_default_model() {
    let mock = mock_release::setup().await;
    // The sequence spans three subsystems, so it needs all three permission
    // families — including the two the group-assignment leg turns on.
    let mut perms: Vec<&str> = LOCAL_RUNTIME_ADMIN_PERMS.to_vec();
    perms.extend_from_slice(&[
        "groups::read",
        "llm_providers::assign_groups",
        "user_llm_providers::read",
    ]);
    let admin = crate::common::test_helpers::create_user_with_permissions(
        &mock.server,
        "installer",
        &perms,
    )
    .await;
    let client = reqwest::Client::new();
    let auth = format!("Bearer {}", admin.token);

    // ── Pre-conditions: the two gaps this sequence exists to close ──────────
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
        "pre-condition: the built-in local provider ships DISABLED — the gap the \
         step's provider leg closes"
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
        "pre-condition: a fresh install has NO local runtime engine — the gap the \
         step's runtime leg closes"
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

    // …and share it with the default group, which is the second half of the leg
    // and the one that is easy to miss: enabling alone leaves the provider out
    // of every user's list. Nothing seeds a `user_group_llm_providers` row.
    let groups: serde_json::Value = client
        .get(mock.server.api_url("/groups?page=1&per_page=100"))
        .header("Authorization", &auth)
        .send()
        .await
        .expect("list groups")
        .json()
        .await
        .expect("groups json");
    let default_group = groups["groups"]
        .as_array()
        .expect("groups array")
        .iter()
        .find(|g| g["is_default"] == true && g["is_active"] == true)
        .expect("a default group exists")
        .clone();
    let assigned = client
        .post(mock.server.api_url(&format!("/llm-providers/{local_id}/groups")))
        .header("Authorization", &auth)
        .json(&json!({ "group_id": default_group["id"] }))
        .send()
        .await
        .expect("assign the provider to the default group");
    assert!(
        assigned.status().is_success(),
        "sharing the provider with a group should succeed; got {}",
        assigned.status()
    );

    // ── Leg 2: provision llama.cpp and make it the system default ───────────
    let version_id = lrt::download_engine_from_mock(&mock, &admin.token, "llamacpp").await;

    // ── Leg 3: the model lands under that provider ──────────────────────────
    let created = client
        .post(mock.server.api_url("/llm-models"))
        .header("Authorization", &auth)
        .json(&json!({
            "provider_id": local_id,
            "name": MODEL_NAME,
            "display_name": "Qwen3.5 9B (Q4_K_M)",
            "enabled": true,
            "engine_type": "llamacpp",
            "file_format": "gguf",
            "capabilities": { "chat": true, "tools": true },
        }))
        .send()
        .await
        .expect("create the model");
    assert_eq!(created.status(), 201, "the model row is created");

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
        "the installed model must be ENABLED — the model picker resolves the first \
         ENABLED model, so a disabled one is not a default"
    );
    assert_eq!(
        model["provider_id"].as_str(),
        Some(local_id.as_str()),
        "it lives under the local provider the sequence enabled"
    );
    assert_eq!(
        model["engine_type"].as_str(),
        Some("llamacpp"),
        "and it names the engine the runtime leg installed"
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
    assert_eq!(provider_now["enabled"], true, "the provider stays enabled");

    // ── …and it is REACHABLE, which enabling alone does not achieve ─────────
    //
    // This is the assertion that would have caught the gap: an enabled provider
    // holding an enabled model is still INVISIBLE until it is assigned to a
    // group the user belongs to. `get_for_user` — which backs
    // `GET /api/user-llm-providers`, the endpoint the model picker reads —
    // INNER JOINs `user_group_llm_providers`, and every chat send re-checks
    // `user_has_access_to_provider`. Neither has an admin bypass, and nothing
    // seeds such a row. Asserting only `enabled` above passed happily while the
    // model was unusable.
    let picker: serde_json::Value = client
        .get(mock.server.api_url("/user-llm-providers"))
        .header("Authorization", &auth)
        .send()
        .await
        .expect("read the user-facing provider list")
        .json()
        .await
        .expect("user providers json");
    let visible = picker["providers"]
        .as_array()
        .expect("providers array")
        .iter()
        .find(|p| p["id"].as_str() == Some(local_id.as_str()))
        .expect(
            "INV-2: the local provider must be visible in the user-facing list — an \
             enabled provider that is not shared with any group never reaches the \
             model picker, and chat answers 403 ACCESS_DENIED for it",
        );
    assert!(
        visible["llm_models"]
            .as_array()
            .expect("llm_models array")
            .iter()
            .any(|m| m["name"].as_str() == Some(MODEL_NAME)),
        "INV-2: the installed model must be among the models the user can pick"
    );

    // An engine is resolvable for it. `BinaryManager::select_runtime_version`
    // falls through model → provider → SYSTEM DEFAULT → latest; this model names
    // no required version, so the system default is what it lands on — and on a
    // fresh install that step returned `None`, which is the whole point.
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
        .expect(
            "INV-2: a llama.cpp runtime must be the system default, or the model has \
             nothing to run on",
        );
    assert_eq!(
        default_version["id"].as_str(),
        Some(version_id.to_string().as_str()),
        "the system default is the version this sequence installed"
    );
    assert_eq!(default_version["engine"].as_str(), Some("llamacpp"));
}
