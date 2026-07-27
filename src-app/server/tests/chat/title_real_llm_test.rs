//! TEST-9 — conversation titles, against a REAL model.
//!
//! Every other title test drives `StubChat`, which always answers the title call
//! with text. That is why the suite stayed green while production shipped, twice,
//! a title budget too small for a reasoning model: on the deployment observed for
//! this feature (`qwen3.6-35b-a3b` behind an OpenAI-compatible bridge) **0 of 16
//! conversations had a title**, because the model spent the entire 512-token
//! output budget on hidden reasoning and returned `finish_reason: "length"` with
//! no answer text.
//!
//! A stub cannot express that failure — it is a property of a real model's token
//! accounting. So this test drives the CONFIGURED test LLM end to end and asserts
//! the only thing a user cares about: after a first exchange, the conversation
//! has a title. It fails if titles stop being generated, and it FAILS on the
//! pre-fix 512-token budget against that same model.
//!
//! Skips only when NO LLM is configured at all (`configured_test_llm`).

use serde_json::{Value, json};
use uuid::Uuid;

use crate::chat::helpers;
use crate::common::TestServer;
use crate::common::TestServerOptions;
use crate::common::test_helpers::create_user_with_permissions;

/// Configure the built-in provider the environment points at + a model row, and
/// grant `user_id` access. Deliberately NOT tool-capable: a title is generated
/// off the plain chat path, and keeping tools out removes a source of
/// non-determinism from a test about titles.
async fn configured_model(
    server: &TestServer,
    user_id: &str,
    llm: &helpers::TestLlm,
) -> Value {
    let admin = create_user_with_permissions(
        server,
        "title_llm_admin",
        &[
            "llm_providers::read",
            "llm_providers::edit",
            "llm_models::read",
            "llm_models::create",
        ],
    )
    .await;

    let body: Value = reqwest::Client::new()
        .get(server.api_url("/llm-providers?per_page=100"))
        .header("Authorization", format!("Bearer {}", admin.token))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let provider_id = body["providers"]
        .as_array()
        .expect("providers")
        .iter()
        .find(|p| p["name"].as_str() == Some(llm.provider_name))
        .unwrap_or_else(|| panic!("built-in provider '{}' not found", llm.provider_name))["id"]
        .as_str()
        .unwrap()
        .to_string();

    let mut update = json!({ "enabled": true, "api_key": llm.api_key });
    if let Some(base_url) = &llm.base_url {
        update["base_url"] = json!(base_url);
    }
    let r = reqwest::Client::new()
        .post(server.api_url(&format!("/llm-providers/{provider_id}")))
        .header("Authorization", format!("Bearer {}", admin.token))
        .json(&update)
        .send()
        .await
        .unwrap();
    assert!(r.status().is_success(), "configure {} → {}", llm.provider_name, r.status());

    let r = reqwest::Client::new()
        .post(server.api_url("/llm-models"))
        .header("Authorization", format!("Bearer {}", admin.token))
        .json(&json!({
            "provider_id": provider_id,
            "name": llm.model_name,
            "display_name": "Title (configured test LLM)",
            "description": "real-LLM title generation",
            "enabled": true,
            "engine_type": "none",
            "file_format": "gguf",
            "capabilities": { "chat": true, "completion": true },
            // A REASONING model spends its output budget on hidden chain of
            // thought BEFORE any answer text. Too small a cap here starves the
            // ASSISTANT turn itself, so the turn ends with no visible answer and
            // the title extension never even fires — which would make this test
            // fail for a reason other than the one it exists to catch.
            "parameters": { "max_tokens": 4096 }
        }))
        .send()
        .await
        .unwrap();
    let status = r.status();
    let model: Value = r.json().await.unwrap();
    assert_eq!(status, reqwest::StatusCode::CREATED, "create model → {status}: {model}");
    helpers::ensure_user_has_model_access(server, user_id, &model).await;
    model
}

#[tokio::test]
async fn a_real_model_first_exchange_produces_a_title() {
    let Some(llm) = helpers::configured_test_llm() else {
        eprintln!(
            "skipping chat::title_real_llm — NO LLM configured at all \
             (set OPENAI_API_KEY+OPENAI_BASE_URL+ZIEE_TEST_LLM_MODEL, or the Anthropic seam)"
        );
        return;
    };
    eprintln!(
        "chat::title_real_llm — driving provider={} model={} base_url={}",
        llm.provider_name,
        llm.model_name,
        llm.base_url.as_deref().unwrap_or("<vendor default>")
    );

    let server = TestServer::start_with_options(TestServerOptions {
        extra_env: vec![(llm.key_env.to_string(), llm.api_key.clone())],
        ..Default::default()
    })
    .await;
    let user = create_user_with_permissions(
        &server,
        "title_real",
        &[
            "conversations::create",
            "conversations::read",
            "conversations::edit",
            "messages::create",
            "messages::read",
            "llm_models::read",
        ],
    )
    .await;

    let model = configured_model(&server, &user.user_id, &llm).await;
    let model_id: Uuid = helpers::parse_uuid(&model["id"]);
    let conversation =
        helpers::create_conversation(&server, &user.token, Some(model_id), None).await;
    let conversation_id = helpers::parse_uuid(&conversation["id"]);
    let branch_id = helpers::parse_uuid(&conversation["active_branch_id"]);
    assert!(
        conversation["title"].is_null(),
        "the conversation must start untitled so the extension is what sets the title"
    );

    helpers::send_and_collect(
        &server,
        &user.token,
        conversation_id,
        branch_id,
        model_id,
        "create a new project please",
    )
    .await;

    // `call_after_llm_call` (and therefore the title write) is awaited before the
    // terminal `complete` frame, but the agent-core host can persist it just
    // after; poll briefly rather than racing.
    let mut title: Option<String> = None;
    for _ in 0..40 {
        let conv = helpers::get_conversation(&server, &user.token, conversation_id).await;
        title = conv["title"].as_str().map(|s| s.to_string()).filter(|s| !s.trim().is_empty());
        if title.is_some() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }

    let title = title.unwrap_or_else(|| {
        panic!(
            "the conversation is UNTITLED after a real first exchange through {} / {}. \
             This is the production bug: a reasoning model burns the whole title budget on \
             hidden chain-of-thought and returns no answer text, so the extension soft-fails \
             forever. Check TITLE_MAX_TOKENS / the escalated retry in \
             chat/extensions/title/title.rs.",
            llm.provider_name, llm.model_name
        )
    });
    eprintln!("chat::title_real_llm — generated title: {title:?}");
    // …and it is a GENERATED title, not the user's own message echoed back. The
    // original incarnation of this bug persisted the raw first message as the
    // title; without this the test would accept that regression.
    assert_ne!(
        title.trim().to_lowercase(),
        "create a new project please",
        "the title must be model-generated, never the raw user message"
    );
    assert!(
        title.chars().count() <= 50,
        "a generated title must respect TITLE_MAX_CHARS, got {} chars: {title:?}",
        title.chars().count()
    );
}
