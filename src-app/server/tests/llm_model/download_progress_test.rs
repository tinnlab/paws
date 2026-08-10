/// Download Progress Tracking Integration Tests
///
/// These tests verify that the download progress tracking works correctly,
/// including status updates, progress data updates, and model creation.
use reqwest::StatusCode;
use serde_json::json;
use tokio::time::{Duration, sleep};

#[tokio::test]
async fn test_download_status_and_progress_tracking() {
    let server = crate::common::TestServer::start().await;
    let user = crate::common::test_helpers::create_user_with_permissions(
        &server,
        "downloader",
        &[
            "llm_models::create",
            "llm_models::read",
            "llm_providers::read",
            "llm_providers::create",
            "llm_repositories::read",
            "llm_repositories::edit",
            "llm_models::downloads_read",
        ],
    )
    .await;

    // Get Hugging Face repository and configure API key
    let hf_repo =
        crate::llm_model::download_test::get_huggingface_repository(&server, &user.token, true)
            .await;
    let repo_id = hf_repo["id"].as_str().unwrap();

    // Get local provider
    let provider = crate::llm_model::download_test::get_local_provider(&server, &user.token).await;
    let provider_id = provider["id"].as_str().unwrap();

    // Initiate download
    let payload = json!({
        "provider_id": provider_id,
        "repository_id": repo_id,
        "repository_path": "hf-internal-testing/tiny-random-gpt2",
        "repository_branch": "main",
        "name": "tiny-gpt2-progress-test",
        "display_name": "Tiny GPT-2 (Progress Test)",
        "description": "Test model for progress tracking",
        "file_format": "safetensors",
        "main_filename": "model.safetensors",
        "source": {
            "type": "hub",
            "id": "hf-internal-testing/tiny-random-gpt2"
        }
    });

    println!("Initiating download...");
    let response = reqwest::Client::new()
        .post(server.api_url("/llm-models/download"))
        .header("Authorization", format!("Bearer {}", user.token))
        .json(&payload)
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let download_instance: serde_json::Value = response.json().await.unwrap();
    let download_id = download_instance["id"].as_str().unwrap();

    println!("Download initiated with ID: {}", download_id);

    // Poll for status changes
    let mut iterations = 0;
    let max_iterations = 60; // 60 seconds max
    let mut saw_downloading = false;
    let mut saw_progress_update = false;
    let mut final_status = String::new();

    while iterations < max_iterations {
        sleep(Duration::from_secs(1)).await;
        iterations += 1;

        // Get download status
        let response = reqwest::Client::new()
            .get(server.api_url(&format!("/llm-models/downloads/{}", download_id)))
            .header("Authorization", format!("Bearer {}", user.token))
            .send()
            .await
            .unwrap();

        if response.status() == StatusCode::NOT_FOUND {
            // Download was deleted (means it completed)
            println!(
                "Download completed and deleted after {} seconds",
                iterations
            );
            final_status = "completed".to_string();
            break;
        }

        assert_eq!(response.status(), StatusCode::OK);

        let download: serde_json::Value = response.json().await.unwrap();
        let status = download["status"].as_str().unwrap();
        final_status = status.to_string();

        println!("Iteration {}: status = {}", iterations, status);

        // Check if we've seen the "downloading" status
        if status == "downloading" {
            saw_downloading = true;
            println!("✅ Status transitioned to 'downloading'");
        }

        // Check for progress data
        if let Some(progress_data) = download["progress_data"].as_object()
            && let Some(phase) = progress_data.get("phase") {
                saw_progress_update = true;
                println!(
                    "✅ Progress update: phase={}, current={}, total={}",
                    phase.as_str().unwrap_or("unknown"),
                    progress_data
                        .get("current")
                        .and_then(|v| v.as_i64())
                        .unwrap_or(0),
                    progress_data
                        .get("total")
                        .and_then(|v| v.as_i64())
                        .unwrap_or(0)
                );
            }

        // Check if completed
        if status == "completed" {
            println!("✅ Download completed");

            // Verify model_id is set. NOTE: this block used to read
            // `download["result"]["model_id"]`, but `result` is not a field of
            // DownloadInstance — `model_id` is top-level. The `as_object()`
            // guard therefore never matched and everything below it (including
            // the models-list check) was silently skipped on every run.
            let model_id = download["model_id"]
                .as_str()
                .unwrap_or_else(|| panic!("Model ID not set in completed download: {download}"));
            println!("✅ Model ID set: {}", model_id);

            // Verify model appears in provider's models list
            let response = reqwest::Client::new()
                .get(server.api_url(&format!("/llm-models?provider_id={}", provider_id)))
                .header("Authorization", format!("Bearer {}", user.token))
                .send()
                .await
                .unwrap();

            assert_eq!(response.status(), StatusCode::OK);

            let models_list: serde_json::Value = response.json().await.unwrap();
            let models = models_list["models"].as_array().unwrap();

            let found_model = models.iter().find(|m| m["id"].as_str() == Some(model_id));

            assert!(
                found_model.is_some(),
                "Downloaded model should appear in provider's models list"
            );
            println!("✅ Model appears in provider's models list");
            break;
        }

        // Check if failed
        if status == "failed" {
            let error_msg = download["error_message"]
                .as_str()
                .unwrap_or("Unknown error");
            panic!("Download failed: {}", error_msg);
        }
    }

    // Verify the download completed successfully
    assert_eq!(
        final_status, "completed",
        "Download must complete successfully"
    );

    // Log what we observed during download
    println!("Download completed successfully");
    if saw_downloading {
        println!("  - Observed 'downloading' status transition");
    }
    if saw_progress_update {
        println!("  - Received progress updates");
    }

    println!("✅ Download progress tracking test passed!");
}

#[tokio::test]
async fn test_download_with_invalid_repository() {
    let server = crate::common::TestServer::start().await;
    let user = crate::common::test_helpers::create_user_with_permissions(
        &server,
        "downloader",
        &[
            "llm_models::create",
            "llm_models::read",
            "llm_providers::read",
            "llm_providers::create",
            "llm_repositories::read",
            "llm_repositories::edit",
            "llm_models::downloads_read",
        ],
    )
    .await;

    // Get Hugging Face repository
    let hf_repo =
        crate::llm_model::download_test::get_huggingface_repository(&server, &user.token, true)
            .await;
    let repo_id = hf_repo["id"].as_str().unwrap();

    // Get local provider
    let provider = crate::llm_model::download_test::get_local_provider(&server, &user.token).await;
    let provider_id = provider["id"].as_str().unwrap();

    // Initiate download with invalid repository path
    let payload = json!({
        "provider_id": provider_id,
        "repository_id": repo_id,
        "repository_path": "invalid/nonexistent-model-12345",
        "repository_branch": "main",
        "name": "invalid-repo-test",
        "display_name": "Invalid Repo Test",
        "description": "Test model with invalid repository",
        "file_format": "safetensors",
        "main_filename": "model.safetensors",
        "source": {
            "type": "hub",
            "id": "invalid/nonexistent-model-12345"
        }
    });

    println!("Initiating download with invalid repository...");
    let response = reqwest::Client::new()
        .post(server.api_url("/llm-models/download"))
        .header("Authorization", format!("Bearer {}", user.token))
        .json(&payload)
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let download_instance: serde_json::Value = response.json().await.unwrap();
    let download_id = download_instance["id"].as_str().unwrap();

    println!("Download initiated with ID: {}", download_id);

    // Poll for status changes - should transition to failed
    let mut iterations = 0;
    let max_iterations = 30; // 30 seconds max
    let mut saw_failed = false;
    let mut error_message = String::new();

    while iterations < max_iterations {
        sleep(Duration::from_secs(1)).await;
        iterations += 1;

        // Get download status
        let response = reqwest::Client::new()
            .get(server.api_url(&format!("/llm-models/downloads/{}", download_id)))
            .header("Authorization", format!("Bearer {}", user.token))
            .send()
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);

        let download: serde_json::Value = response.json().await.unwrap();
        let status = download["status"].as_str().unwrap();

        println!("Iteration {}: status = {}", iterations, status);

        // Check if failed
        if status == "failed" {
            saw_failed = true;
            if let Some(error) = download["error_message"].as_str() {
                error_message = error.to_string();
                println!("✅ Download failed with error: {}", error);
            }
            break;
        }
    }

    // Verify the download failed
    assert!(
        saw_failed,
        "Download should have failed for invalid repository"
    );
    assert!(
        !error_message.is_empty(),
        "Error message should be set for failed download"
    );

    println!("✅ Invalid repository error handling test passed!");
}

#[tokio::test]
async fn test_download_cancellation() {
    // NOTE: This test verifies the cancellation endpoint works correctly.
    // With tiny test models that complete in <1 second, the download will
    // always be completed before we can cancel it. This tests the endpoint's
    // behavior when attempting to cancel an already-completed download.

    let server = crate::common::TestServer::start().await;
    let user = crate::common::test_helpers::create_user_with_permissions(
        &server,
        "downloader",
        &[
            "llm_models::create",
            "llm_models::read",
            "llm_providers::read",
            "llm_providers::create",
            "llm_repositories::read",
            "llm_repositories::edit",
            "llm_models::downloads_read",
            "llm_models::downloads_cancel",
        ],
    )
    .await;

    // Get Hugging Face repository
    let hf_repo =
        crate::llm_model::download_test::get_huggingface_repository(&server, &user.token, true)
            .await;
    let repo_id = hf_repo["id"].as_str().unwrap();

    // Get local provider
    let provider = crate::llm_model::download_test::get_local_provider(&server, &user.token).await;
    let provider_id = provider["id"].as_str().unwrap();

    // Initiate download
    let payload = json!({
        "provider_id": provider_id,
        "repository_id": repo_id,
        "repository_path": "hf-internal-testing/tiny-random-gpt2",
        "repository_branch": "main",
        "name": "tiny-gpt2-cancel-test",
        "display_name": "Tiny GPT-2 (Cancel Test)",
        "description": "Test model for cancellation endpoint",
        "file_format": "safetensors",
        "main_filename": "model.safetensors",
        "source": {
            "type": "hub",
            "id": "hf-internal-testing/tiny-random-gpt2"
        }
    });

    println!("Initiating download...");
    let response = reqwest::Client::new()
        .post(server.api_url("/llm-models/download"))
        .header("Authorization", format!("Bearer {}", user.token))
        .json(&payload)
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let download_instance: serde_json::Value = response.json().await.unwrap();
    let download_id = download_instance["id"].as_str().unwrap();

    println!("Download initiated with ID: {}", download_id);

    // Poll the download row until it reaches a terminal state. The
    // previous fixed 2-second sleep was tight enough that on a slow
    // host the download could still be `Downloading` at the cancel
    // call → can_cancel()=true → 204 success → test asserted 400
    // and failed flakily. Polling makes the precondition explicit:
    // we WANT to test cancel-after-complete, so wait until complete.
    let client = reqwest::Client::new();
    let deadline = std::time::Instant::now() + Duration::from_secs(60);
    #[allow(unused_assignments)]
    let mut last_status = String::new();
    loop {
        let resp = client
            .get(server.api_url(&format!("/llm-models/downloads/{}", download_id)))
            .header("Authorization", format!("Bearer {}", user.token))
            .send()
            .await
            .unwrap();
        if resp.status() == StatusCode::NOT_FOUND {
            // Already auto-deleted; that's a terminal state too.
            last_status = "deleted".to_string();
            break;
        }
        let dl: serde_json::Value = resp.json().await.unwrap();
        last_status = dl["status"].as_str().unwrap_or("").to_string();
        if matches!(last_status.as_str(), "completed" | "failed" | "cancelled") {
            break;
        }
        if std::time::Instant::now() > deadline {
            panic!("download didn't reach terminal state in 60s; last_status={last_status}");
        }
        sleep(Duration::from_millis(200)).await;
    }
    println!(
        "Download reached terminal status '{last_status}'; attempting cancel…"
    );

    // Cancel should fail with 400 for completed/failed downloads
    // (can_cancel() returns false for anything but Pending/Downloading).
    // If the row was already auto-deleted, the handler returns 404
    // instead — accept either as a valid "you can't cancel this" reply.
    let cancel_response = client
        .post(server.api_url(&format!("/llm-models/downloads/{}/cancel", download_id)))
        .header("Authorization", format!("Bearer {}", user.token))
        .send()
        .await
        .unwrap();
    let cancel_status = cancel_response.status();
    assert!(
        cancel_status == StatusCode::BAD_REQUEST || cancel_status == StatusCode::NOT_FOUND,
        "cancel-after-terminal should return 400 (still in DB) or 404 (already evicted); got {cancel_status} after terminal_status={last_status}"
    );

    // Verify download is in terminal state (completed, failed, or deleted)
    let status_response = reqwest::Client::new()
        .get(server.api_url(&format!("/llm-models/downloads/{}", download_id)))
        .header("Authorization", format!("Bearer {}", user.token))
        .send()
        .await
        .unwrap();

    if status_response.status() == StatusCode::NOT_FOUND {
        println!("✅ Download was deleted after completion (as expected)");
    } else {
        assert_eq!(status_response.status(), StatusCode::OK);
        let download: serde_json::Value = status_response.json().await.unwrap();
        let status = download["status"].as_str().unwrap();
        assert!(
            status == "completed" || status == "failed",
            "Download must be in terminal state (completed/failed), got: {}",
            status
        );
        println!("✅ Download in terminal state: {}", status);
    }

    println!("✅ Cancellation endpoint test passed!");
}

#[tokio::test]
async fn test_download_with_authenticated_repository() {
    // This test verifies that downloads work with repositories that require authentication.
    // With a valid API key and valid repository, the download MUST succeed.

    let server = crate::common::TestServer::start().await;
    let user = crate::common::test_helpers::create_user_with_permissions(
        &server,
        "downloader",
        &[
            "llm_models::create",
            "llm_models::read",
            "llm_providers::read",
            "llm_providers::create",
            "llm_repositories::read",
            "llm_repositories::edit",
            "llm_models::downloads_read",
        ],
    )
    .await;

    // Get Hugging Face repository (which uses API key authentication)
    let hf_repo = crate::llm_model::download_test::get_huggingface_repository(
        &server,
        &user.token,
        true, // configure with API key
    )
    .await;
    let repo_id = hf_repo["id"].as_str().unwrap();

    // Verify the repository has auth configured
    let auth_type = hf_repo["auth_type"].as_str().unwrap();
    assert_eq!(
        auth_type, "api_key",
        "Repository must use API key authentication"
    );
    println!("Repository configured with auth_type: {}", auth_type);

    // Get local provider
    let provider = crate::llm_model::download_test::get_local_provider(&server, &user.token).await;
    let provider_id = provider["id"].as_str().unwrap();

    // Initiate download from authenticated repository
    let payload = json!({
        "provider_id": provider_id,
        "repository_id": repo_id,
        "repository_path": "hf-internal-testing/tiny-random-gpt2",
        "repository_branch": "main",
        "name": "tiny-gpt2-auth-test",
        "display_name": "Tiny GPT-2 (Auth Test)",
        "description": "Test model for authenticated repository",
        "file_format": "safetensors",
        "main_filename": "model.safetensors",
        "source": {
            "type": "hub",
            "id": "hf-internal-testing/tiny-random-gpt2"
        }
    });

    println!("Initiating download from authenticated repository...");
    let response = reqwest::Client::new()
        .post(server.api_url("/llm-models/download"))
        .header("Authorization", format!("Bearer {}", user.token))
        .json(&payload)
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let download_instance: serde_json::Value = response.json().await.unwrap();
    let download_id = download_instance["id"].as_str().unwrap();

    println!("Download initiated with ID: {}", download_id);

    // Poll until download completes
    let mut iterations = 0;
    let max_iterations = 30;
    let mut final_status = String::new();

    while iterations < max_iterations {
        sleep(Duration::from_millis(500)).await;
        iterations += 1;

        let response = reqwest::Client::new()
            .get(server.api_url(&format!("/llm-models/downloads/{}", download_id)))
            .header("Authorization", format!("Bearer {}", user.token))
            .send()
            .await
            .unwrap();

        if response.status() == StatusCode::NOT_FOUND {
            // Download completed and deleted
            final_status = "completed".to_string();
            println!("Download completed and deleted from database");
            break;
        }

        assert_eq!(response.status(), StatusCode::OK);

        let download: serde_json::Value = response.json().await.unwrap();
        let status = download["status"].as_str().unwrap();
        final_status = status.to_string();

        if status == "completed" {
            println!("Download completed successfully");
            break;
        }

        if status == "failed" {
            let error_msg = download["error_message"]
                .as_str()
                .unwrap_or("Unknown error");
            panic!(
                "Download failed: {}\nWith valid API key and valid repository, download must succeed",
                error_msg
            );
        }
    }

    // Download must complete successfully
    assert_eq!(
        final_status, "completed",
        "Download with valid auth credentials must complete successfully"
    );

    // Verify model appears in provider's models list
    let models_response = reqwest::Client::new()
        .get(server.api_url(&format!("/llm-models?provider_id={}", provider_id)))
        .header("Authorization", format!("Bearer {}", user.token))
        .send()
        .await
        .unwrap();

    assert_eq!(models_response.status(), StatusCode::OK);

    let models_list: serde_json::Value = models_response.json().await.unwrap();
    let models = models_list["models"].as_array().unwrap();

    let found_model = models
        .iter()
        .find(|m| m["name"].as_str().unwrap() == "tiny-gpt2-auth-test");

    assert!(
        found_model.is_some(),
        "Downloaded model must appear in provider's models list"
    );

    println!("✅ Authenticated repository download test passed!");
    println!("  - Auth token extracted from repository config");
    println!("  - Download completed successfully");
    println!("  - Model appears in provider's models list");
}

/// Cancel a download while it is in an ACTIVE state (the existing test only
/// cancels an already-completed download). A `downloading` row is cancellable:
/// the endpoint returns 204 and flips the row's status to `cancelled`.
#[tokio::test]
async fn cancel_download_in_active_state_succeeds() {
    let server = crate::common::TestServer::start().await;
    let user = crate::common::test_helpers::create_user_with_permissions(
        &server,
        "dl_cancel_active",
        &[
            "llm_models::read",
            "llm_providers::read",
            "llm_providers::create",
            "llm_repositories::read",
            "llm_repositories::edit",
            "llm_models::downloads_cancel",
            "llm_models::downloads_read",
        ],
    )
    .await;

    let hf_repo =
        crate::llm_model::download_test::get_huggingface_repository(&server, &user.token, false)
            .await;
    let repo_id = uuid::Uuid::parse_str(hf_repo["id"].as_str().unwrap()).unwrap();
    let provider =
        crate::llm_model::download_test::get_local_provider(&server, &user.token).await;
    let provider_id = uuid::Uuid::parse_str(provider["id"].as_str().unwrap()).unwrap();

    // Seed an ACTIVE (downloading) download instance.
    let pool = sqlx::PgPool::connect(&server.database_url).await.unwrap();
    let dl_id = uuid::Uuid::new_v4();
    sqlx::query(
        r#"INSERT INTO download_instances (id, provider_id, repository_id, request_data, status)
           VALUES ($1, $2, $3, $4, 'downloading')"#,
    )
    .bind(dl_id)
    .bind(provider_id)
    .bind(repo_id)
    .bind(serde_json::json!({ "repository_path": "org/m", "main_filename": "model.safetensors" }))
    .execute(&pool)
    .await
    .unwrap();

    // Cancel the active download.
    let res = reqwest::Client::new()
        .post(server.api_url(&format!("/llm-models/downloads/{dl_id}/cancel")))
        .header("Authorization", format!("Bearer {}", user.token))
        .send()
        .await
        .unwrap();
    assert_eq!(
        res.status(),
        StatusCode::NO_CONTENT,
        "cancelling an active download must succeed"
    );

    // The row is now cancelled.
    let row: (String,) = sqlx::query_as("SELECT status FROM download_instances WHERE id = $1")
        .bind(dl_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(row.0, "cancelled", "active download flips to cancelled");
    pool.close().await;
}

/// TEST-13 [acceptance] — INV-3: a download's reported progress must never
/// contradict its reported status.
///
/// The reported defect: `GET /llm-models/downloads/{id}` for a SUCCESSFULLY
/// completed download answered `status: "completed"` while `progress_data` was
/// still `{"phase":"committing","current":90,"total":100}` — the last tick the
/// download task wrote before creating the model. Every surface that computes
/// `current / total` therefore showed 90% forever on success.
///
/// This drives a real download to genuine success through the product path
/// (`POST /llm-models/download` → the background clone task → the terminal
/// write) and asserts the completed row reports 100% at phase `complete`.
#[tokio::test]
async fn completed_download_reports_full_progress() {
    let server = crate::common::TestServer::start().await;
    let user = crate::common::test_helpers::create_user_with_permissions(
        &server,
        "dl_progress_inv3",
        &[
            "llm_models::create",
            "llm_models::read",
            "llm_providers::read",
            "llm_providers::create",
            "llm_repositories::read",
            "llm_repositories::edit",
            "llm_models::downloads_read",
        ],
    )
    .await;

    let hf_repo =
        crate::llm_model::download_test::get_huggingface_repository(&server, &user.token, true)
            .await;
    let repo_id = hf_repo["id"].as_str().unwrap();
    let provider = crate::llm_model::download_test::get_local_provider(&server, &user.token).await;
    let provider_id = provider["id"].as_str().unwrap();

    let payload = json!({
        "provider_id": provider_id,
        "repository_id": repo_id,
        "repository_path": "hf-internal-testing/tiny-random-gpt2",
        "repository_branch": "main",
        "name": "tiny-gpt2-inv3-progress",
        "display_name": "Tiny GPT-2 (INV-3)",
        "description": "Completed downloads must report 100%",
        "file_format": "safetensors",
        "main_filename": "model.safetensors",
        "source": { "type": "hub", "id": "hf-internal-testing/tiny-random-gpt2" }
    });

    let client = reqwest::Client::new();
    let response = client
        .post(server.api_url("/llm-models/download"))
        .header("Authorization", format!("Bearer {}", user.token))
        .json(&payload)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let download_instance: serde_json::Value = response.json().await.unwrap();
    let download_id = download_instance["id"].as_str().unwrap().to_string();

    // Poll the REST read the UI uses until the download reaches a terminal
    // state. The row is only removed by an explicit DELETE, so a completed
    // download is still readable here.
    let deadline = std::time::Instant::now() + Duration::from_secs(120);
    let completed = loop {
        let resp = client
            .get(server.api_url(&format!("/llm-models/downloads/{download_id}")))
            .header("Authorization", format!("Bearer {}", user.token))
            .send()
            .await
            .unwrap();
        assert_eq!(
            resp.status(),
            StatusCode::OK,
            "the completed download row must stay readable (only an explicit \
             DELETE removes it); a 404 here means the progress contract cannot \
             be observed at all"
        );
        let download: serde_json::Value = resp.json().await.unwrap();
        match download["status"].as_str().unwrap_or("") {
            "completed" => break download,
            "failed" | "cancelled" => panic!(
                "download must succeed for this test; got status={} error={}",
                download["status"], download["error_message"]
            ),
            _ => {}
        }
        if std::time::Instant::now() > deadline {
            panic!("download did not complete within 120s: {download}");
        }
        sleep(Duration::from_millis(500)).await;
    };

    // The model was genuinely created — this really is a SUCCESSFUL download,
    // not a row that merely says `completed`. `model_id` is a top-level field
    // of DownloadInstance (there is no `result` object).
    assert!(
        completed["model_id"].as_str().is_some(),
        "a successful download stamps the created model_id: {completed}"
    );

    let progress = completed["progress_data"]
        .as_object()
        .unwrap_or_else(|| panic!("completed download must carry progress_data: {completed}"));
    let current = progress["current"].as_i64().expect("current is a number");
    let total = progress["total"].as_i64().expect("total is a number");
    let phase = progress["phase"].as_str().expect("phase is a string");

    assert!(
        total > 0,
        "a completed download must report a usable total (0 renders as NaN%/0%): {progress:?}"
    );
    assert_eq!(
        current, total,
        "INV-3: a download reported `completed` must report 100%, not {current}/{total} \
         (phase={phase}) — this is the reported defect",
    );
    assert_eq!(
        phase, "complete",
        "INV-3: a completed download's phase must be `complete`, not an \
         intermediate phase like `committing`",
    );
}

/// TEST-14 [covers ITEM-10 / DEC-10] — the completed/failed PAIR.
///
/// The fix for INV-3 must not be "always report 100%". A download that died is
/// honest about where it died: its progress stays FROZEN at the last real tick.
/// This test drives both terminal transitions through the real repository
/// chokepoint (`update_download_status`) on two rows seeded with the SAME
/// mid-flight progress, so the only difference is the terminal status.
#[tokio::test]
async fn failed_download_freezes_progress_while_completed_reports_full() {
    use ziee::test_internals::{
        DownloadStatus, UpdateDownloadStatusRequest, update_download_status,
    };

    let server = crate::common::TestServer::start().await;
    let user = crate::common::test_helpers::create_user_with_permissions(
        &server,
        "dl_progress_frozen",
        &[
            "llm_models::read",
            "llm_providers::read",
            "llm_providers::create",
            "llm_repositories::read",
            "llm_repositories::edit",
            "llm_models::downloads_read",
        ],
    )
    .await;

    let hf_repo =
        crate::llm_model::download_test::get_huggingface_repository(&server, &user.token, false)
            .await;
    let repo_id = uuid::Uuid::parse_str(hf_repo["id"].as_str().unwrap()).unwrap();
    let provider = crate::llm_model::download_test::get_local_provider(&server, &user.token).await;
    let provider_id = uuid::Uuid::parse_str(provider["id"].as_str().unwrap()).unwrap();

    let pool = sqlx::PgPool::connect(&server.database_url).await.unwrap();

    // Both rows stop at the exact progress the real happy path last writes
    // before creating the model ("Creating model from downloaded files…").
    let mid_flight = serde_json::json!({
        "phase": "committing",
        "current": 90,
        "total": 100,
        "message": "Creating model from downloaded files...",
        "speed_bps": 0,
        "eta_seconds": 0
    });
    // Distinct repository_paths: `uq_download_instances_in_progress` is a
    // partial UNIQUE index over (repository_id, provider_id, repository_path,
    // main_filename) for in-progress rows, so two identical seeds collide.
    let mut ids = Vec::new();
    for path in ["org/will-complete", "org/will-fail"] {
        let id = uuid::Uuid::new_v4();
        sqlx::query(
            r#"INSERT INTO download_instances
                 (id, provider_id, repository_id, request_data, status, progress_data)
               VALUES ($1, $2, $3, $4, 'downloading', $5)"#,
        )
        .bind(id)
        .bind(provider_id)
        .bind(repo_id)
        .bind(serde_json::json!({ "repository_path": path, "main_filename": "model.safetensors" }))
        .bind(&mid_flight)
        .execute(&pool)
        .await
        .unwrap();
        ids.push(id);
    }
    let (completed_id, failed_id) = (ids[0], ids[1]);

    update_download_status(
        &pool,
        completed_id,
        UpdateDownloadStatusRequest {
            status: DownloadStatus::Completed,
            error_message: None,
            model_id: None,
        },
    )
    .await
    .unwrap()
    .expect("completed row exists");

    update_download_status(
        &pool,
        failed_id,
        UpdateDownloadStatusRequest {
            status: DownloadStatus::Failed,
            error_message: Some("disk full while committing".to_string()),
            model_id: None,
        },
    )
    .await
    .unwrap()
    .expect("failed row exists");
    pool.close().await;

    // Read both back through the REST surface the UI uses.
    let client = reqwest::Client::new();
    let read = |id: uuid::Uuid| {
        let client = client.clone();
        let token = user.token.clone();
        let url = server.api_url(&format!("/llm-models/downloads/{id}"));
        async move {
            let resp = client
                .get(url)
                .header("Authorization", format!("Bearer {token}"))
                .send()
                .await
                .unwrap();
            assert_eq!(resp.status(), StatusCode::OK);
            resp.json::<serde_json::Value>().await.unwrap()
        }
    };

    let completed = read(completed_id).await;
    assert_eq!(completed["status"], "completed");
    assert_eq!(
        completed["progress_data"]["current"], completed["progress_data"]["total"],
        "INV-3: completed reads 100% — {completed}"
    );
    assert_eq!(
        completed["progress_data"]["total"], 100,
        "the row's own stored total (100) is preserved, not replaced"
    );
    assert_eq!(completed["progress_data"]["phase"], "complete");

    let failed = read(failed_id).await;
    assert_eq!(failed["status"], "failed");
    assert_eq!(
        failed["progress_data"]["current"], 90,
        "DEC-10: a failed download's progress stays FROZEN where it stopped — \
         reporting it as 100%-complete would be a lie about what happened: {failed}"
    );
    assert_eq!(failed["progress_data"]["total"], 100);
    assert_eq!(
        failed["progress_data"]["phase"], "committing",
        "DEC-10: a failed download's phase is not rewritten to `complete`"
    );
    assert_ne!(
        failed["progress_data"]["current"], failed["progress_data"]["total"],
        "DEC-10 negative control: the INV-3 fix must NOT have been implemented \
         as 'every terminal write reports 100%'"
    );
}
