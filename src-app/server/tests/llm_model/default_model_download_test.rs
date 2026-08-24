//! The default model's download lifecycle: what a FAILED download leaves behind,
//! and who owns the transfer.
//!
//! Covers TEST-5 (acceptance, INV-4) and TEST-7 (acceptance, INV-6) of the
//! `default-model-onboarding` feature.
//!
//! ## Why no clone actually happens here
//!
//! `GitService::clone_repository` validates the repository URL against
//! `PUBLIC_HTTP_OR_HTTPS` **unconditionally** — no `cfg(debug_assertions)`
//! relaxation, unlike the sibling read paths (`repo_files.rs`, `llm_provider`
//! discover, web_search, citations). Its comment states why: it is the
//! defense-in-depth check at the git entry point, closing a Critical SSRF
//! finding, so any future caller is covered too. A loopback git fixture is
//! therefore unreachable BY DESIGN, and the design forbids reaching for the real
//! Hugging Face instead.
//!
//! Rather than weaken that check to make a test pass, the invariants are proven
//! where their mechanisms actually live:
//!
//! * **INV-1** — `LlmRepository::git_credential` is the single point at which a
//!   clone's credential is decided. Its unit tests assert an anonymous row
//!   yields `(None, None)` over every input, INCLUDING a row carrying stray
//!   secret material. That goes RED if a credential were ever produced, which a
//!   clone-watching fixture could not do better.
//! * **INV-4 / INV-6** — both are about what happens AROUND a transfer rather
//!   than inside it, and a download that fails is a first-class case of each.
//!   Those are what this file drives, end to end through the real endpoints.

use std::time::Duration;

use serde_json::json;

use crate::common::TestServer;

/// Matches the frontend descriptor (`defaultModel.ts`).
const MODEL_NAME: &str = "ziee-default-qwen3-5-9b-q4-k-m";
const MAIN_FILENAME: &str = "Qwen3.5-9B-Q4_K_M.gguf";
const REPO_PATH: &str = "Qwen3.5-9B-GGUF";

struct Harness {
    server: TestServer,
    token: String,
    repository_id: String,
    provider_id: String,
}

/// Boot a server with an `auth_type = 'none'` repository and a local provider.
///
/// The URL is `example.com` — the same host the sibling repository tests use. It
/// has to satisfy create-time validation (which resolves the host, so an
/// unresolvable `.invalid` name is refused with a 400), while hosting no git
/// repository, so the clone fails fast. No real model registry is contacted, and
/// the failure is deterministic whether or not this box has a network: offline,
/// the clone fails on DNS instead, and every assertion below is about the
/// FAILURE, not its cause.
async fn setup(user: &str) -> Harness {
    let server = TestServer::start().await;
    let admin = crate::common::test_helpers::create_user_with_permissions(
        &server,
        user,
        &[
            "llm_models::create",
            "llm_models::read",
            "llm_repositories::create",
            "llm_repositories::read",
            "llm_providers::read",
            "llm_providers::create",
        ],
    )
    .await;

    // `enabled: false` only skips the post-create connection probe; the download
    // path reads the row by id and never consults `enabled`. Same trick the
    // sibling repository tests use.
    let create = reqwest::Client::new()
        .post(server.api_url("/llm-repositories"))
        .header("Authorization", format!("Bearer {}", admin.token))
        .json(&json!({
            "name": format!("anon-{}", uuid::Uuid::new_v4()),
            "url": format!("https://example.com/ziee-anon-{}", uuid::Uuid::new_v4()),
            "auth_type": "none",
            "enabled": false,
        }))
        .send()
        .await
        .expect("create anonymous repository");
    assert_eq!(create.status(), 201, "the anonymous repository is created");
    let repository_id = create.json::<serde_json::Value>().await.unwrap()["id"]
        .as_str()
        .expect("repository id")
        .to_string();

    let provider = crate::llm_model::download_test::get_local_provider(&server, &admin.token).await;
    let provider_id = provider["id"].as_str().expect("provider id").to_string();

    Harness {
        server,
        token: admin.token,
        repository_id,
        provider_id,
    }
}

impl Harness {
    async fn start_download(&self) -> serde_json::Value {
        let response = reqwest::Client::new()
            .post(self.server.api_url("/llm-models/download"))
            .header("Authorization", format!("Bearer {}", self.token))
            .json(&json!({
                "provider_id": self.provider_id,
                "repository_id": self.repository_id,
                "repository_path": REPO_PATH,
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
            .expect("start download");
        assert_eq!(response.status(), 200, "the download request is accepted");
        response.json().await.expect("download instance json")
    }

    async fn download(&self, id: &str) -> serde_json::Value {
        reqwest::Client::new()
            .get(self.server.api_url(&format!("/llm-models/downloads/{id}")))
            .header("Authorization", format!("Bearer {}", self.token))
            .send()
            .await
            .expect("read download")
            .json()
            .await
            .expect("download json")
    }

    /// Poll until the download reaches a terminal status, returning it.
    async fn await_terminal(&self, id: &str) -> String {
        for _ in 0..300 {
            let body = self.download(id).await;
            let status = body["status"].as_str().unwrap_or("").to_string();
            if matches!(status.as_str(), "completed" | "failed" | "cancelled") {
                return status;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        panic!("download {id} never reached a terminal status");
    }

    /// Does a model with the descriptor's stable name exist?
    async fn model_exists(&self) -> bool {
        let body: serde_json::Value = reqwest::Client::new()
            .get(self.server.api_url("/llm-models?page=1&perPage=100"))
            .header("Authorization", format!("Bearer {}", self.token))
            .send()
            .await
            .expect("list models")
            .json()
            .await
            .expect("models json");
        body["models"]
            .as_array()
            .map(|models| models.iter().any(|m| m["name"].as_str() == Some(MODEL_NAME)))
            .unwrap_or(false)
    }
}

/// TEST-5 (acceptance, INV-4) — "A failed, cancelled, or interrupted download
/// **never leaves a half-installed model** the app will try to load."
///
/// Drives a real download to a real failure through the real endpoints, then
/// asserts the three things that would each constitute a half-install: a model
/// row, a `model_id` stamped on the instance, and the name being taken so a
/// later retry could not install cleanly.
#[tokio::test]
async fn test_5_failed_download_leaves_no_half_installed_model() {
    let h = setup("failed_downloader").await;

    let instance = h.start_download().await;
    let id = instance["id"].as_str().expect("download id").to_string();

    let status = h.await_terminal(&id).await;
    assert_eq!(
        status, "failed",
        "the unreachable repository must fail the download; body: {:?}",
        h.download(&id).await
    );

    assert!(
        !h.model_exists().await,
        "INV-4: a failed download must leave NO model row behind"
    );

    let body = h.download(&id).await;
    assert!(
        body["model_id"].is_null(),
        "INV-4: a failed download must not be linked to a model; got {:?}",
        body["model_id"]
    );
    assert!(
        body["error_message"].as_str().is_some_and(|m| !m.is_empty()),
        "a failed download records WHY, so the step can show the user a reason"
    );

    // The name is still free: a later install is not blocked by the failure's
    // residue. `llm_models` has UNIQUE (provider_id, name), so a half-created
    // row would surface here as a conflict rather than a clean slate.
    let retry = h.start_download().await;
    let retry_id = retry["id"].as_str().expect("retry id").to_string();
    assert_eq!(
        h.await_terminal(&retry_id).await,
        "failed",
        "the retry runs on its own merits rather than tripping over residue"
    );
    assert!(!h.model_exists().await);
}

/// TEST-7 (acceptance, INV-6) — "A download started from Onboarding **continues
/// if the user navigates away**, and its progress stays visible elsewhere in the
/// app."
///
/// The client half (the step re-deriving from the live store on a fresh mount)
/// is proven by the store unit test. This is the SERVER half, and the one that
/// would make the promise impossible if it were false: the transfer must not be
/// bound to the client that started it.
///
/// What this actually exercises, stated precisely: after the POST returns,
/// NOTHING further is done on the caller's behalf — no stream is read, no
/// progress is subscribed to, no connection is held open — and the work still
/// reaches its own conclusion and is still listed afterwards, which is what lets
/// a returning client pick it back up. It does not simulate a TCP reset; each
/// request here uses its own short-lived client and the response body is already
/// consumed by the time the assertions begin.
#[tokio::test]
async fn test_7_download_survives_the_client_that_started_it() {
    let h = setup("navigate_away_downloader").await;

    let instance = h.start_download().await;
    let id = instance["id"].as_str().expect("download id").to_string();

    // "The user navigated away": from here on nothing is done on the caller's
    // behalf until the assertions — no progress subscription, no polling of the
    // instance, nothing holding the work open.
    drop(instance);
    tokio::time::sleep(Duration::from_millis(300)).await;

    let status = h.await_terminal(&id).await;
    assert_eq!(
        status, "failed",
        "INV-6: the work runs server-side and reaches its own conclusion with no \
         client attached (this repository is unreachable, so 'failed' IS that \
         conclusion — the point is that it got there unattended)"
    );

    // A client coming back later still finds it. This is what makes progress
    // "stay visible elsewhere in the app" possible at all.
    let list: serde_json::Value = reqwest::Client::new()
        .get(h.server.api_url("/llm-models/downloads"))
        .header("Authorization", format!("Bearer {}", h.token))
        .send()
        .await
        .expect("list downloads")
        .json()
        .await
        .expect("downloads json");
    let found = list["downloads"]
        .as_array()
        .expect("downloads array")
        .iter()
        .find(|d| d["id"].as_str() == Some(id.as_str()))
        .expect("a returning client still sees the download it left behind");
    assert_eq!(
        found["request_data"]["model_name"].as_str(),
        Some(MODEL_NAME),
        "and it is identifiable as the default model's download, which is how the \
         step re-attaches to it"
    );
}
