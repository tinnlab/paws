//! Regression test: a duplicate voice-model NAME reaching Postgres and
//! escaping as a generic HTTP 500.
//!
//! `voice_models` carries TWO unique constraints (migration
//! `202607140220_voice_schema.sql`):
//!
//! * `voice_models_filename_key UNIQUE (filename)`
//! * `voice_models_one_name UNIQUE (name)`
//!
//! `VoiceModelRepository::upsert` guards only the FIRST of them —
//! `ON CONFLICT (filename) DO UPDATE`. That is the trap this defect class
//! keeps setting: an `ON CONFLICT` exists on the statement, so a
//! count-the-clauses audit scores the repository "handled", but the clause
//! targets a DIFFERENT constraint than the one that fires.
//!
//! The reachable collision comes from `model_handlers.rs::upload_model`, which
//! derives the filename from the UPLOAD's extension while the name comes from
//! a separate form field:
//!
//! ```text
//! name="vprobe" + "x.bin"  -> filename "ggml-vprobe.bin"
//! name="vprobe" + "x.gguf" -> filename "ggml-vprobe.gguf"
//! ```
//!
//! So the second upload misses `ON CONFLICT (filename)`, proceeds to INSERT,
//! and trips `voice_models_one_name` → 23505 →
//! `.map_err(AppError::database_error)` → `500 SYSTEM_DATABASE_ERROR`.
//! Confirmed against a live instance before the fix.

use reqwest::multipart;
use serde_json::Value;

use crate::common::TestServer;
use crate::common::test_helpers::{TestUser, create_user_with_permissions};

/// Any of the accepted container magics passes `ModelRejection::classify`;
/// `GGUF` is the simplest (a literal 4-byte ASCII tag). Padding keeps the
/// upload above the empty-file rejection.
fn fake_model_bytes() -> Vec<u8> {
    let mut v = b"GGUF".to_vec();
    v.extend(std::iter::repeat_n(0u8, 2048));
    v
}

async fn upload_model(
    server: &TestServer,
    user: &TestUser,
    name: &str,
    file_name: &str,
) -> reqwest::Response {
    let form = multipart::Form::new().text("name", name.to_string()).part(
        "file",
        multipart::Part::bytes(fake_model_bytes()).file_name(file_name.to_string()),
    );
    reqwest::Client::new()
        .post(server.api_url("/voice/models/upload"))
        .header("Authorization", format!("Bearer {}", user.token))
        .multipart(form)
        .send()
        .await
        .expect("voice model upload request failed")
}

/// A duplicate NAME uploaded under a different extension must be a 409, not a
/// 500. Before the fix this was `500 SYSTEM_DATABASE_ERROR`.
#[tokio::test]
async fn duplicate_voice_model_name_returns_409_not_500() {
    let server = TestServer::start().await;
    let user = create_user_with_permissions(&server, "voice_dup", &["*"]).await;

    let first = upload_model(&server, &user, "vprobe", "x.bin").await;
    assert_eq!(first.status(), 200, "first upload should win");

    let second = upload_model(&server, &user, "vprobe", "x.gguf").await;
    let got = second.status();
    let body: Value = second.json().await.unwrap_or(Value::Null);
    assert_eq!(
        got,
        reqwest::StatusCode::CONFLICT,
        "duplicate voice-model name: wrong status (body: {body})"
    );
    assert_eq!(
        body.get("error_code").and_then(Value::as_str),
        Some("RESOURCE_CONFLICT"),
        "duplicate voice-model name: wrong error_code (body: {body})"
    );
}

/// Negative control: re-uploading the SAME name with the SAME extension hits
/// `ON CONFLICT (filename) DO UPDATE` and must remain an idempotent success —
/// the new conflict mapping must not turn the existing upsert into a 409.
#[tokio::test]
async fn reuploading_the_same_voice_model_filename_still_upserts() {
    let server = TestServer::start().await;
    let user = create_user_with_permissions(&server, "voice_same", &["*"]).await;

    let first = upload_model(&server, &user, "vsame", "x.bin").await;
    assert_eq!(first.status(), 200);

    let second = upload_model(&server, &user, "vsame", "x.bin").await;
    assert_eq!(
        second.status(),
        200,
        "same name + same filename must stay an idempotent upsert"
    );
}
