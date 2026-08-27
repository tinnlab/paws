//! Realtime-sync emission coverage for the `llm_model` module.
//!
//! Proves that a real REST mutation through the production handler emits the
//! right `sync` frame(s) to the right audience, end-to-end (handler → publish
//! → registry → SSE), via `SyncProbe`.
//!
//! A model row is created only via the `create_model_with_files` funnel
//! (file upload OR repository download). The CHEAPEST trigger that emits an
//! `llm_model` sync event without a multi-GB real download or a real engine is
//! the **upload-commit** path: `POST /llm-models/upload` with a tiny
//! zero-padded GGUF (≥1024 bytes so it clears the "suspiciously small"
//! weight-file validator — same fixture as `upload_test::
//! test_upload_duplicate_name_fails`). The shared upload-commit helper calls
//! `sync_publish` twice (`uploads.rs`):
//!
//!   - `SyncEntity::LlmModel`        / `SyncAction::Create`
//!   - `SyncEntity::UserLlmProvider` / `SyncAction::Update`
//!
//! Per the routing table in `modules/sync/event.rs`:
//!   - `LlmModel`        → `Permission("llm_models::read")`
//!   - `UserLlmProvider` → `Permission("user_llm_providers::read")`
//! and `SyncEntity`/`SyncAction` serialize `snake_case`, so the wire strings
//! are `llm_model` / `user_llm_provider` and `create` / `update`.
//!
//! The upload path publishes with `origin = None`, so EVERY subscriber holding
//! the matching read permission observes the frame (including the actor); a
//! subscriber LACKING the read permission must stay silent (audience scoping).
//! This mirrors the permission-scoped coverage approach in
//! `tests/assistant/sync_emit_test.rs` and the owner-scoped one in
//! `tests/project/sync_emit_test.rs`.

use std::time::Duration;

use reqwest::StatusCode;
use reqwest::multipart::{Form, Part};

use crate::common::sync_probe::SyncProbe;

const EVENT_TIMEOUT: Duration = Duration::from_secs(5);
const SILENCE_WINDOW: Duration = Duration::from_secs(1);

/// Get an existing local provider id or create one (mirrors
/// `upload_test::get_local_provider`). Needs `llm_providers::{read,create}`.
async fn get_local_provider_id(server: &crate::common::TestServer, token: &str) -> String {
    let response = reqwest::Client::new()
        .get(server.api_url("/llm-providers"))
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await
        .unwrap();
    let body: serde_json::Value = response.json().await.unwrap();
    if let Some(providers) = body["providers"].as_array() {
        for provider in providers {
            if provider["provider_type"].as_str() == Some("local") {
                return provider["id"].as_str().unwrap().to_string();
            }
        }
    }

    let payload = serde_json::json!({
        "name": "Local Models",
        "provider_type": "local",
        "display_name": "Local Models",
        "enabled": true
    });
    let response = reqwest::Client::new()
        .post(server.api_url("/llm-providers"))
        .header("Authorization", format!("Bearer {token}"))
        .json(&payload)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let provider: serde_json::Value = response.json().await.unwrap();
    provider["id"].as_str().unwrap().to_string()
}

/// Upload-commit a tiny zero-padded GGUF as `token`, returning the new model
/// id. 2 KiB of zeros clears the weight-file size validator (a file <1024
/// bytes is rejected as "suspiciously small"; see
/// `upload_test::test_upload_duplicate_name_fails`).
async fn upload_tiny_model(
    server: &crate::common::TestServer,
    token: &str,
    provider_id: &str,
    name: &str,
) -> String {
    let dummy_data = vec![0u8; 2048];
    let file_part = Part::bytes(dummy_data)
        .file_name("model.gguf")
        .mime_str("application/octet-stream")
        .unwrap();

    let form = Form::new()
        .text("provider_id", provider_id.to_string())
        .text("name", name.to_string())
        .text("display_name", name.to_string())
        .text("file_format", "gguf")
        .text("main_filename", "model.gguf")
        .part("files", file_part);

    let response = reqwest::Client::new()
        .post(server.api_url("/llm-models/upload"))
        .header("Authorization", format!("Bearer {token}"))
        .multipart(form)
        .send()
        .await
        .unwrap();
    assert_eq!(
        response.status(),
        StatusCode::OK,
        "upload-commit should return 200"
    );
    let model: serde_json::Value = response.json().await.unwrap();
    model["id"].as_str().unwrap().to_string()
}

// =====================================================
// llm_model — Permission("llm_models::read") audience
// =====================================================

#[tokio::test]
async fn model_upload_emits_llm_model_create_to_read_holders_not_to_others() {
    let server = crate::common::TestServer::start().await;

    // The actor needs upload-create perms + provider perms (to stand up the
    // local provider) + llm_models::read so its own stream is in the
    // `llm_models::read` audience for the create frame.
    let actor = crate::common::test_helpers::create_user_with_permissions(
        &server,
        "llm_sync_actor",
        &[
            "llm_models::create",
            "llm_models::read",
            "llm_providers::read",
            "llm_providers::create",
        ],
    )
    .await;
    // A second user with ONLY `profile::read` — enough to subscribe, but
    // stripped from the default group so it holds neither `llm_models::read`
    // NOR the baseline `user_llm_providers::read`. It must observe NEITHER the
    // admin `llm_model` frame nor the dual-audience `user_llm_provider` frame
    // (a plain `&[]` user would inherit `user_llm_providers::read` from the
    // default group and receive the latter, breaking the silence assertion).
    let other = crate::common::test_helpers::create_user_with_only_permissions(
        &server,
        "llm_sync_other",
        &["profile::read"],
    )
    .await;

    // Open both probes BEFORE the mutation so neither misses the frame.
    let mut actor_probe = SyncProbe::open(&server, &actor.token).await;
    let mut other_probe = SyncProbe::open(&server, &other.token).await;

    let provider_id = get_local_provider_id(&server, &actor.token).await;
    let model_id = upload_tiny_model(&server, &actor.token, &provider_id, "sync-create-model").await;

    // The actor holds llm_models::read → receives `llm_model`/`create`
    // carrying the new model's id. (Upload publishes with origin = None, so
    // there is no self-echo suppression.)
    let frame = actor_probe
        .expect_event("llm_model", "create", EVENT_TIMEOUT)
        .await;
    assert_eq!(frame.id, model_id, "the frame must carry the new model's id");

    // Audience scoping: a user lacking llm_models::read stays silent.
    other_probe.expect_silence(SILENCE_WINDOW).await;
}

// =====================================================
// user_llm_provider — Permission("user_llm_providers::read") audience
// =====================================================

#[tokio::test]
async fn model_upload_also_emits_user_llm_provider_update_to_that_read_audience() {
    let server = crate::common::TestServer::start().await;

    // The actor uploads the model. It also holds user_llm_providers::read so
    // its own stream is in the dual-audience for the second frame.
    let actor = crate::common::test_helpers::create_user_with_permissions(
        &server,
        "ulp_sync_actor",
        &[
            "llm_models::create",
            "llm_models::read",
            "llm_providers::read",
            "llm_providers::create",
            "user_llm_providers::read",
        ],
    )
    .await;
    // A bystander who holds ONLY user_llm_providers::read (NOT llm_models::read)
    // must still receive the user_llm_provider frame — it is scoped to the
    // user-facing read permission, independent of the admin one.
    let bystander = crate::common::test_helpers::create_user_with_permissions(
        &server,
        "ulp_sync_bystander",
        &["user_llm_providers::read"],
    )
    .await;

    let mut actor_probe = SyncProbe::open(&server, &actor.token).await;
    let mut bystander_probe = SyncProbe::open(&server, &bystander.token).await;

    let provider_id = get_local_provider_id(&server, &actor.token).await;
    let model_id = upload_tiny_model(&server, &actor.token, &provider_id, "sync-ulp-model").await;

    // Actor sees both frames; assert on the user_llm_provider one. (expect_event
    // skips the llm_model/create frame that also arrives.)
    let actor_frame = actor_probe
        .expect_event("user_llm_provider", "update", EVENT_TIMEOUT)
        .await;
    assert_eq!(
        actor_frame.id, model_id,
        "actor user_llm_provider frame must carry the model id"
    );

    // The user-facing read-permission holder receives the user_llm_provider
    // frame even without llm_models::read.
    let bystander_frame = bystander_probe
        .expect_event("user_llm_provider", "update", EVENT_TIMEOUT)
        .await;
    assert_eq!(
        bystander_frame.id, model_id,
        "bystander user_llm_provider frame must carry the model id"
    );

    // ...but the bystander lacks llm_models::read, so the admin-scoped
    // `llm_model`/`create` frame must NOT reach them. Silence here would be
    // wrong (they should have gotten user_llm_provider), but a SECOND frame of
    // entity `llm_model` would be a leak. Since expect_event already consumed
    // the user_llm_provider frame above, any further frame within the window is
    // a routing bug.
    bystander_probe.expect_silence(SILENCE_WINDOW).await;
}

// =====================================================
// TEST-15 [covers: ITEM-15] — the VALIDATOR's transitions must reach the
// user-facing audience, not only admins.
// =====================================================

/// Upload a tiny GGUF as a **llamacpp** model, so `create_model_with_files`
/// enqueues Tier-2 validation for it.
///
/// The sibling helper above omits `engine_type`, which is right for its own
/// assertions but leaves the model outside the
/// `matches!(engine_type, Llamacpp | Mistralrs)` gate that triggers validation.
async fn upload_tiny_llamacpp_model(
    server: &crate::common::TestServer,
    token: &str,
    provider_id: &str,
    name: &str,
) -> String {
    let dummy_data = vec![0u8; 2048];
    let file_part = Part::bytes(dummy_data)
        .file_name("model.gguf")
        .mime_str("application/octet-stream")
        .unwrap();

    let form = Form::new()
        .text("provider_id", provider_id.to_string())
        .text("name", name.to_string())
        .text("display_name", name.to_string())
        .text("file_format", "gguf")
        .text("main_filename", "model.gguf")
        .text("engine_type", "llamacpp")
        .part("files", file_part);

    let response = reqwest::Client::new()
        .post(server.api_url("/llm-models/upload"))
        .header("Authorization", format!("Bearer {token}"))
        .multipart(form)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK, "upload-commit should return 200");
    let model: serde_json::Value = response.json().await.unwrap();
    model["id"].as_str().unwrap().to_string()
}

/// TEST-15 — the validator publishes the `user_llm_provider` pair, not just the
/// admin `llm_model` entity.
///
/// ## The defect
///
/// `validator.rs` published ONLY `SyncEntity::LlmModel`, whose audience is
/// `llm_models::read` (admins). Every other model mutation publishes the PAIR —
/// see `llm_model/handlers/models.rs` (create / update / enable / disable /
/// delete) and `create_model_with_files`. So the validator's TERMINAL
/// transition — the one that writes the final `validation_status` AND the
/// capabilities extracted from the file — never reached the user-facing
/// `user_llm_provider` view that backs the chat model picker.
///
/// On desktop the single user is an admin, so the omission was invisible; on a
/// server deployment an ordinary user's picker kept whatever capabilities the
/// row had at CREATE time until something else happened to refetch.
///
/// ## Why "more than one frame" is the assertion
///
/// Both the create and the validator emit `user_llm_provider`/`update`-family
/// frames for the same model, so identity alone cannot tell them apart. What
/// distinguishes them is COUNT: the create path emits exactly one, and the
/// validator adds its own (a `processing` transition and a terminal one). A
/// subscriber holding ONLY the user-facing read perm therefore sees exactly one
/// frame before this fix and more than one after it.
///
/// No engine is installed in the harness, so validation fails fast and writes
/// `validation_warning` — which is fine and is deliberately not asserted: the
/// invariant is about WHO HEARS the transition, not what the verdict was.
#[tokio::test]
async fn validator_transitions_reach_the_user_facing_audience() {
    let server = crate::common::TestServer::start().await;

    let actor = crate::common::test_helpers::create_user_with_permissions(
        &server,
        "llm_val_actor",
        &[
            "llm_models::create",
            "llm_models::read",
            "llm_providers::read",
            "llm_providers::create",
        ],
    )
    .await;

    // A watcher holding the USER-FACING read perm but NOT `llm_models::read`,
    // so every frame it receives came through the `user_llm_provider` audience
    // specifically — which is the audience the validator was missing.
    let watcher = crate::common::test_helpers::create_user_with_only_permissions(
        &server,
        "llm_val_watcher",
        &["profile::read", "user_llm_providers::read"],
    )
    .await;

    let mut watcher_probe = SyncProbe::open(&server, &watcher.token).await;

    let provider_id = get_local_provider_id(&server, &actor.token).await;
    let _model_id =
        upload_tiny_llamacpp_model(&server, &actor.token, &provider_id, "sync-validated-model")
            .await;

    // Frame 1 — the CREATE pair. This is the control: it proves the watcher's
    // stream and audience work at all, so a later timeout means "the validator
    // did not publish", not "this subscriber never hears anything".
    watcher_probe
        .expect_event("user_llm_provider", "update", EVENT_TIMEOUT)
        .await;

    // Frame 2+ — the VALIDATOR's transition. Times out against the pre-fix
    // code, where the validator published `llm_model` alone. The window is
    // generous because validation is serialized behind a background worker
    // whose idle tick is 2s.
    watcher_probe
        .expect_event("user_llm_provider", "update", Duration::from_secs(30))
        .await;
}
