//! Helper functions for chat module integration tests

use reqwest::StatusCode;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::common::chat_stream_probe::{ChatFrame, ChatStreamProbe};
use crate::common::stub_engine::StubEngine;

/// Get or create a test LLM model for chat tests
/// Returns a model with chat capability that can be used in conversations
/// Uses real AI providers (Anthropic, OpenAI, etc.) with API keys from environment
/// Creates models using admin permissions to avoid permission issues in tests
/// Model configuration for testing
pub struct TestModelConfig {
    pub provider_type: &'static str,
    pub model_name: &'static str,
    pub display_name: &'static str,
}

/// Get all test models from ai-providers crate
pub fn get_test_model_configs() -> Vec<TestModelConfig> {
    vec![
        // Anthropic models (from ai-providers/tests/test_anthropic.rs)
        TestModelConfig {
            provider_type: "anthropic",
            model_name: "claude-opus-4-1-20250805",
            display_name: "Claude Opus 4.1",
        },
        TestModelConfig {
            provider_type: "anthropic",
            model_name: "claude-sonnet-4-5-20250929",
            display_name: "Claude Sonnet 4.5",
        },
        TestModelConfig {
            provider_type: "anthropic",
            model_name: "claude-haiku-4-5-20251001",
            display_name: "Claude Haiku 4.5",
        },
        // 3.5-haiku is removed — both `-20241022` and `-latest` 404
        // for our test key. The 4.5 entry above is the current cheap
        // haiku snapshot; tests that pinned the 3.5 ID should switch
        // to it.
        // OpenAI models (from ai-providers/tests/test_openai.rs)
        TestModelConfig {
            provider_type: "openai",
            model_name: "gpt-4o",
            display_name: "GPT-4o",
        },
        TestModelConfig {
            provider_type: "openai",
            model_name: "gpt-4o-mini",
            display_name: "GPT-4o Mini",
        },
        TestModelConfig {
            provider_type: "openai",
            model_name: "gpt-4-turbo",
            display_name: "GPT-4 Turbo",
        },
        TestModelConfig {
            provider_type: "openai",
            model_name: "gpt-3.5-turbo",
            display_name: "GPT-3.5 Turbo",
        },
        // Gemini models (from ai-providers/tests/test_gemini.rs)
        TestModelConfig {
            provider_type: "gemini",
            model_name: "models/gemini-2.5-flash",
            display_name: "Gemini 2.5 Flash",
        },
        TestModelConfig {
            provider_type: "gemini",
            model_name: "models/gemini-2.5-pro",
            display_name: "Gemini 2.5 Pro",
        },
        TestModelConfig {
            provider_type: "gemini",
            model_name: "models/gemini-2.0-flash",
            display_name: "Gemini 2.0 Flash",
        },
        TestModelConfig {
            provider_type: "gemini",
            model_name: "models/gemini-2.0-flash-lite",
            display_name: "Gemini 2.0 Flash Lite",
        },
    ]
}

/// Create a specific model (used by MCP tests for multi-model testing)
/// If user_id is provided, grants access to the model through group assignments
pub async fn create_test_model_with_config(
    server: &crate::common::TestServer,
    config: &TestModelConfig,
    user_id: Option<&str>,
) -> Value {
    // Create admin user with necessary permissions for model setup
    let admin = crate::common::test_helpers::create_user_with_permissions(
        server,
        "model_admin",
        &[
            "llm_models::read",
            "llm_models::create",
            "llm_providers::read",
            "llm_providers::edit",
        ],
    )
    .await;

    let (env_var, provider_name) = match config.provider_type {
        "anthropic" => ("ANTHROPIC_API_KEY", "Anthropic"),
        "openai" => ("OPENAI_API_KEY", "OpenAI"),
        "gemini" => ("GEMINI_API_KEY", "Google Gemini"),
        "groq" => ("GROQ_API_KEY", "Groq"),
        _ => panic!("Unsupported provider type: {}", config.provider_type),
    };

    // Check if provider API key is available
    if std::env::var(env_var).is_err() {
        eprintln!("Skipping {} model '{}' - {} not set", provider_name, config.display_name, env_var);
        return json!(null);
    }

    eprintln!("Configuring provider '{}' with API key from {}", provider_name, env_var);
    let provider = configure_provider_with_api_key(server, &admin.token, provider_name, env_var).await;

    eprintln!("Creating test model '{}' for provider '{}'", config.display_name, provider_name);

    let payload = json!({
        "provider_id": provider["id"],
        "name": config.model_name,
        "display_name": config.display_name,
        "description": format!("{} model for chat testing", provider_name),
        "enabled": true,
        "engine_type": "none",
        "file_format": "gguf",  // Placeholder for API models (not actually used)
        "capabilities": {
            "chat": true,
            "completion": true,
            "embedding": false
        }
    });

    let response = reqwest::Client::new()
        .post(server.api_url("/llm-models"))
        .header("Authorization", format!("Bearer {}", admin.token))
        .json(&payload)
        .send()
        .await
        .unwrap();

    let status = response.status();
    if status != StatusCode::CREATED {
        let error_body = response.text().await.unwrap();
        eprintln!("Model creation failed with status {}: {}", status, error_body);
        panic!("Failed to create test model. Status: {}, Body: {}", status, error_body);
    }

    let model = response.json().await.unwrap();
    eprintln!("Successfully created model: {}", config.display_name);

    // Grant user access if user_id provided
    if let Some(uid) = user_id {
        ensure_user_has_model_access(server, uid, &model).await;
    }

    model
}

/// Probe whether Groq's chat endpoint is actually REACHABLE + the key valid
/// from this host. Some networks/regions return a 403 "Access denied" from
/// `api.groq.com` even with a present key — in that case Groq-first must fall
/// through to a working provider rather than fail a real-LLM test. A 200/400
/// (any non-auth response) means the key + network are fine.
async fn groq_reachable() -> bool {
    let key = match std::env::var("GROQ_API_KEY") {
        Ok(k) if !k.is_empty() => k,
        _ => return false,
    };
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
    {
        Ok(c) => c,
        Err(_) => return false,
    };
    let resp = client
        .post("https://api.groq.com/openai/v1/chat/completions")
        .header("Authorization", format!("Bearer {key}"))
        .json(&json!({
            "model": "llama-3.3-70b-versatile",
            "messages": [{ "role": "user", "content": "hi" }],
            "max_tokens": 1,
        }))
        .send()
        .await;
    match resp {
        // 401/403 → key blocked / network-denied → NOT usable.
        Ok(r) => !matches!(r.status().as_u16(), 401 | 403),
        // Network failure → treat as unreachable, fall through.
        Err(_) => false,
    }
}

/// Like `get_or_create_test_model`, but deterministically PREFERS Groq
/// (`GROQ_API_KEY` + a reachable Groq endpoint → `llama-3.3-70b-versatile`, a
/// cheap, tool-capable model) and falls back to ANTHROPIC → OPENAI → GEMINI
/// when no Groq key is present OR Groq is network-blocked from this host. The
/// created model is granted to `user_id`.
///
/// IMPORTANT — this NEVER soft-skips: if NO provider key is set at all it
/// PANICS with an actionable message. Callers that use it are asserting that a
/// real LLM run executes (per `feedback_no_ignore_unless_platform`); a missing
/// key is an environment misconfiguration (source `tests/.env.test`), not a
/// reason to silently pass.
///
/// The returned model is marked `capabilities.tools = true` so auto-attached
/// built-in MCP servers (workflow / web_search / …) actually reach the model
/// (per `project_real_llm_tool_test_capability`).
pub async fn get_or_create_groq_first_model(
    server: &crate::common::TestServer,
    user_id: &str,
) -> Value {
    // Groq-first, then the other tool-capable providers. The model names mirror
    // `get_or_create_test_model`'s per-provider defaults. `(env_var,
    // provider_name, model_name, display_name)`. Groq is only selected when its
    // endpoint is actually reachable (the key can be present but blocked).
    let (env_var, provider_name, model_name, display_name) =
        if groq_reachable().await {
            ("GROQ_API_KEY", "Groq", "llama-3.3-70b-versatile", "Llama 3.3 70B")
        } else if std::env::var("ANTHROPIC_API_KEY").is_ok() {
            (
                "ANTHROPIC_API_KEY",
                "Anthropic",
                "claude-opus-4-1-20250805",
                "Claude Opus 4.1",
            )
        } else if std::env::var("OPENAI_API_KEY").is_ok() {
            ("OPENAI_API_KEY", "OpenAI", "gpt-4o", "GPT-4o")
        } else if std::env::var("GEMINI_API_KEY").is_ok() {
            (
                "GEMINI_API_KEY",
                "Google Gemini",
                "models/gemini-2.0-flash",
                "Gemini 2.0 Flash",
            )
        } else {
            panic!(
                "get_or_create_groq_first_model: NO usable provider API key \
                 (Groq unreachable/unset, and none of ANTHROPIC_API_KEY, \
                 OPENAI_API_KEY, GEMINI_API_KEY set). Source \
                 src-app/server/tests/.env.test before running real-LLM \
                 workflow tests — this test deliberately does NOT soft-skip."
            );
        };
    eprintln!("get_or_create_groq_first_model: selected provider '{provider_name}' ({model_name})");

    // Reuse the same provider-selection plumbing as `create_test_model_with_config`.
    let admin = crate::common::test_helpers::create_user_with_permissions(
        server,
        "groq_first_admin",
        &[
            "llm_models::read",
            "llm_models::create",
            "llm_providers::read",
            "llm_providers::edit",
        ],
    )
    .await;
    let provider = configure_provider_with_api_key(server, &admin.token, provider_name, env_var).await;

    // Create the model with `capabilities.tools = true` so an auto-attached
    // built-in MCP server (workflow / web_search / …) actually reaches the model
    // (per `project_real_llm_tool_test_capability`). This is the one thing the
    // shared `create_test_model_with_config` does NOT set, so we create directly
    // here rather than through it.
    let payload = json!({
        "provider_id": provider["id"],
        "name": model_name,
        "display_name": display_name,
        "description": format!("{} model for real-LLM workflow testing", provider_name),
        "enabled": true,
        "engine_type": "none",
        "file_format": "gguf",
        "capabilities": { "chat": true, "completion": true, "embedding": false, "tools": true }
    });
    let response = reqwest::Client::new()
        .post(server.api_url("/llm-models"))
        .header("Authorization", format!("Bearer {}", admin.token))
        .json(&payload)
        .send()
        .await
        .unwrap();
    let status = response.status();
    if status != StatusCode::CREATED {
        let error_body = response.text().await.unwrap();
        panic!(
            "get_or_create_groq_first_model: model create failed for provider \
             '{provider_name}'. Status: {status}, Body: {error_body}"
        );
    }
    let model: Value = response.json().await.unwrap();
    ensure_user_has_model_access(server, user_id, &model).await;
    model
}

pub async fn get_or_create_test_model(
    server: &crate::common::TestServer,
    user_id: &str,
) -> Value {
    // Create admin user with necessary permissions for model setup
    let admin = crate::common::test_helpers::create_user_with_permissions(
        server,
        "model_admin",
        &[
            "llm_models::read",
            "llm_models::create",
            "llm_providers::read",
            "llm_providers::edit",
        ],
    )
    .await;

    // First try to get an existing enabled model
    let response = reqwest::Client::new()
        .get(server.api_url("/llm-models?per_page=100"))
        .header("Authorization", format!("Bearer {}", admin.token))
        .send()
        .await
        .unwrap();

    if response.status() == StatusCode::OK {
        let body: Value = response.json().await.unwrap();
        if let Some(models) = body["models"].as_array() {
            // Find an enabled model suitable for chat
            for model in models {
                if model["enabled"].as_bool().unwrap_or(false) {
                    eprintln!("Using existing model: {}", model["display_name"]);
                    // Grant the user access to this existing model
                    ensure_user_has_model_access(server, user_id, model).await;
                    return model.clone();
                }
            }
        }
    }

    // No enabled model found, create one with real AI provider
    let provider = get_or_create_ai_provider(server, &admin.token).await;
    let provider_type = provider["provider_type"].as_str().unwrap();
    let provider_name = provider["name"].as_str().unwrap();

    // Determine model name and engine type based on provider
    // For MCP tool calling tests, prefer models with best tool use capabilities:
    // 1. Claude Opus 4.1 - Best at tool calling
    // 2. Claude Sonnet 4.5 - Excellent tool calling
    // 3. GPT-4o - Good tool calling
    // 4. Gemini 2.0 Flash - Native tool support
    // Use specific model if provided, otherwise use default for provider
    let (model_name, model_display_name, engine_type) = match provider_type {
        "anthropic" => ("claude-opus-4-1-20250805", "Claude Opus 4.1", "none"),
        "openai" => ("gpt-4o", "GPT-4o", "none"),
        "gemini" => ("models/gemini-2.0-flash", "Gemini 2.0 Flash", "none"),
        "groq" => ("llama-3.3-70b-versatile", "Llama 3.3 70B", "none"),
        _ => panic!("Unsupported provider type: {}", provider_type),
    };

    eprintln!("Creating test model '{}' for provider '{}'", model_display_name, provider_name);

    let payload = json!({
        "provider_id": provider["id"],
        "name": model_name,
        "display_name": model_display_name,
        "description": format!("{} model for chat testing", provider_name),
        "enabled": true,
        "engine_type": engine_type,
        "file_format": "gguf",  // Placeholder for API models (not actually used)
        "capabilities": {
            "chat": true,
            "completion": true,
            "embedding": false
        }
    });

    let response = reqwest::Client::new()
        .post(server.api_url("/llm-models"))
        .header("Authorization", format!("Bearer {}", admin.token))
        .json(&payload)
        .send()
        .await
        .unwrap();

    let status = response.status();
    if status != StatusCode::CREATED {
        let error_body = response.text().await.unwrap();
        eprintln!("Model creation failed with status {}: {}", status, error_body);
        panic!("Failed to create test model. Status: {}, Body: {}", status, error_body);
    }

    let model = response.json().await.unwrap();
    eprintln!("Successfully created model: {}", model_display_name);

    // Grant the user access to this model through group assignments
    ensure_user_has_model_access(server, user_id, &model).await;

    model
}

/// Ensure a user has access to a model by setting up the group assignment chain
/// Creates: group → assigns user to group → assigns provider to group
/// This is required for the send_message access control validation
pub async fn ensure_user_has_model_access(
    server: &crate::common::TestServer,
    user_id: &str,
    model: &Value,
) {
    let provider_id = model["provider_id"].as_str().unwrap();

    // Create admin user with permissions to manage groups and providers
    let admin = crate::common::test_helpers::create_user_with_permissions(
        server,
        "access_admin",
        &[
            "groups::create",
            "groups::assign_users",
            "llm_providers::assign_groups",
        ],
    )
    .await;

    // Create a group for this test
    let group_response = reqwest::Client::new()
        .post(server.api_url("/groups"))
        .header("Authorization", format!("Bearer {}", admin.token))
        .json(&json!({
            "name": format!("test_access_group_{}", &Uuid::new_v4().to_string()[..8]),
            "description": "Test group for model access",
            "permissions": []
        }))
        .send()
        .await
        .unwrap();

    assert_eq!(group_response.status(), StatusCode::CREATED, "Failed to create group");
    let group: Value = group_response.json().await.unwrap();
    let group_id = group["id"].as_str().unwrap();

    // Assign user to group
    let assign_user_response = reqwest::Client::new()
        .post(server.api_url("/groups/assign"))
        .header("Authorization", format!("Bearer {}", admin.token))
        .json(&json!({
            "user_id": user_id,
            "group_id": group_id
        }))
        .send()
        .await
        .unwrap();

    assert_eq!(assign_user_response.status(), StatusCode::NO_CONTENT, "Failed to assign user to group");

    // Assign provider to group
    let assign_provider_response = reqwest::Client::new()
        .put(server.api_url(&format!("/groups/{}/providers", group_id)))
        .header("Authorization", format!("Bearer {}", admin.token))
        .json(&json!({
            "provider_ids": [provider_id]
        }))
        .send()
        .await
        .unwrap();

    assert_eq!(assign_provider_response.status(), StatusCode::OK, "Failed to assign provider to group");

    eprintln!("✓ User {} granted access to model {} via group {}", user_id, model["display_name"], group_id);
}

/// Configure a built-in provider with API key from environment
/// Supports: anthropic, openai, gemini, groq
/// Resolve a real-LLM test base-URL override for a provider, given its API-key
/// env var (e.g. `ANTHROPIC_API_KEY`). Returns the per-provider override
/// (`ANTHROPIC_BASE_URL`, `OPENAI_BASE_URL`, `GEMINI_BASE_URL`, `GROQ_BASE_URL`
/// — derived by `*_API_KEY` -> `*_BASE_URL`) if set, else the global
/// `ZIEE_TEST_LLM_BASE_URL` fallback, else `None`. Lets real-LLM tiers point at
/// a local bridge per provider. Shared with `memory::real_llm_helpers`.
pub fn test_provider_base_url(api_key_env: &str) -> Option<String> {
    let per_provider = api_key_env.strip_suffix("_API_KEY").map(|p| format!("{p}_BASE_URL"));
    per_provider
        .and_then(|v| std::env::var(v).ok())
        .or_else(|| std::env::var("ZIEE_TEST_LLM_BASE_URL").ok())
        .filter(|s| !s.is_empty())
}

async fn configure_provider_with_api_key(
    server: &crate::common::TestServer,
    token: &str,
    provider_name: &str,
    env_var: &str,
) -> Value {
    // Get all providers
    let response = reqwest::Client::new()
        .get(server.api_url("/llm-providers?per_page=100"))
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .unwrap();

    let body: Value = response.json().await.unwrap();
    let providers = body["providers"].as_array().unwrap();

    // Find the built-in provider
    let provider = providers
        .iter()
        .find(|p| p["name"].as_str() == Some(provider_name))
        .unwrap_or_else(|| panic!("Built-in provider '{}' not found", provider_name));

    let provider_id = provider["id"].as_str().unwrap();

    // Check if already configured
    if provider["enabled"].as_bool().unwrap_or(false)
        && provider["api_key"].as_str().is_some() {
        eprintln!("Provider '{}' already configured", provider_name);
        return provider.clone();
    }

    // Get API key from environment
    let api_key = std::env::var(env_var)
        .unwrap_or_else(|_| panic!("{} not set. Please source tests/.env.test", env_var));

    eprintln!("Configuring provider '{}' with API key from {}", provider_name, env_var);

    // Configure provider with API key.
    //
    // Test seam: redirect the provider at a local OpenAI/Anthropic-compatible
    // bridge (e.g. the DeepSeek/Qwen LiteLLM bridge on :4000) so real-LLM tiers
    // run against a self-hosted model instead of the paid SaaS endpoint. The
    // per-provider base URL is derived from the key var — `ANTHROPIC_API_KEY` ->
    // `ANTHROPIC_BASE_URL` (the official SDK convention), `OPENAI_API_KEY` ->
    // `OPENAI_BASE_URL`, etc. `ZIEE_TEST_LLM_BASE_URL` is a global fallback that
    // applies to every provider. A bridge wildcard-maps any model name, so the
    // hardcoded `claude-*`/`gpt-*` names need no change. Loopback is permitted
    // by the provider's DEV_LOCAL base_url validation policy.
    let mut update_payload = json!({
        "enabled": true,
        "api_key": api_key
    });
    if let Some(base_url) = test_provider_base_url(env_var) {
        update_payload["base_url"] = json!(base_url);
        eprintln!("  (redirecting provider base_url -> {base_url})");
    }

    let response = reqwest::Client::new()
        .post(server.api_url(&format!("/llm-providers/{}", provider_id)))
        .header("Authorization", format!("Bearer {}", token))
        .json(&update_payload)
        .send()
        .await
        .unwrap();

    let status = response.status();
    if status != StatusCode::OK {
        let error_body = response.text().await.unwrap();
        panic!(
            "Failed to configure provider '{}'. Status: {}, Body: {}",
            provider_name, status, error_body
        );
    }

    response.json().await.unwrap()
}

/// Get or create an AI provider with API key for chat testing
/// Prioritizes Anthropic (Claude) as it's most reliable for tool calling tests
async fn get_or_create_ai_provider(server: &crate::common::TestServer, token: &str) -> Value {
    // Try Anthropic first (best at tool calling - Claude Opus 4.1)
    if std::env::var("ANTHROPIC_API_KEY").is_ok() {
        return configure_provider_with_api_key(server, token, "Anthropic", "ANTHROPIC_API_KEY").await;
    }

    // Fallback to OpenAI (GPT-4o has good tool calling)
    if std::env::var("OPENAI_API_KEY").is_ok() {
        return configure_provider_with_api_key(server, token, "OpenAI", "OPENAI_API_KEY").await;
    }

    // Fallback to Gemini (native tool support)
    if std::env::var("GEMINI_API_KEY").is_ok() {
        return configure_provider_with_api_key(server, token, "Google Gemini", "GEMINI_API_KEY").await;
    }

    // Fallback to Groq (OpenAI-compatible)
    if std::env::var("GROQ_API_KEY").is_ok() {
        return configure_provider_with_api_key(server, token, "Groq", "GROQ_API_KEY").await;
    }

    panic!("No AI provider API keys found. Please set at least one in tests/.env.test");
}

/// Create a conversation with specified options
/// Returns the created conversation as JSON
pub async fn create_conversation(
    server: &crate::common::TestServer,
    token: &str,
    model_id: Option<Uuid>,
    title: Option<&str>,
) -> Value {
    let mut payload = json!({});

    if let Some(id) = model_id {
        payload["model_id"] = json!(id.to_string());
    }

    if let Some(t) = title {
        payload["title"] = json!(t);
    }

    let response = reqwest::Client::new()
        .post(server.api_url("/conversations"))
        .header("Authorization", format!("Bearer {}", token))
        .json(&payload)
        .send()
        .await
        .unwrap();

    assert_eq!(
        response.status(),
        StatusCode::CREATED,
        "Failed to create conversation"
    );
    response.json().await.unwrap()
}

/// Get a conversation by ID
pub async fn get_conversation(
    server: &crate::common::TestServer,
    token: &str,
    conversation_id: Uuid,
) -> Value {
    let response = reqwest::Client::new()
        .get(server.api_url(&format!("/conversations/{}", conversation_id)))
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    response.json().await.unwrap()
}

/// Update a conversation
pub async fn update_conversation(
    server: &crate::common::TestServer,
    token: &str,
    conversation_id: Uuid,
    title: Option<&str>,
) -> Value {
    let mut payload = json!({});

    if let Some(t) = title {
        payload["title"] = json!(t);
    }

    let response = reqwest::Client::new()
        .put(server.api_url(&format!("/conversations/{}", conversation_id)))
        .header("Authorization", format!("Bearer {}", token))
        .json(&payload)
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    response.json().await.unwrap()
}

/// Delete a conversation
pub async fn delete_conversation(
    server: &crate::common::TestServer,
    token: &str,
    conversation_id: Uuid,
) -> StatusCode {
    let response = reqwest::Client::new()
        .delete(server.api_url(&format!("/conversations/{}", conversation_id)))
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .unwrap();

    response.status()
}

/// Get conversation message history
pub async fn get_conversation_history(
    server: &crate::common::TestServer,
    token: &str,
    conversation_id: Uuid,
) -> Value {
    let response = reqwest::Client::new()
        .get(server.api_url(&format!(
            "/conversations/{}/messages",
            conversation_id
        )))
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    // The endpoint is keyset-paginated: it returns
    // `PaginatedMessages { messages, has_more_before, has_more_after }`. Callers
    // expect the message array directly, so unwrap the `messages` field.
    let page: Value = response.json().await.unwrap();
    page.get("messages")
        .cloned()
        .unwrap_or_else(|| panic!("history response missing `messages` array: {page}"))
}

/// Get a specific message by ID
pub async fn get_message(
    server: &crate::common::TestServer,
    token: &str,
    message_id: Uuid,
) -> Value {
    let response = reqwest::Client::new()
        .get(server.api_url(&format!("/messages/{}", message_id)))
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    response.json().await.unwrap()
}

/// Edit a message (creates a new branch)
pub async fn edit_message(
    server: &crate::common::TestServer,
    token: &str,
    conversation_id: Uuid,
    message_id: Uuid,
    new_content: &str,
) -> Value {
    let payload = json!({
        "content": new_content
    });

    let response = reqwest::Client::new()
        .put(server.api_url(&format!(
            "/conversations/{}/messages/{}",
            conversation_id, message_id
        )))
        .header("Authorization", format!("Bearer {}", token))
        .json(&payload)
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    response.json().await.unwrap()
}

/// Create a branch from a message
pub async fn create_branch(
    server: &crate::common::TestServer,
    token: &str,
    conversation_id: Uuid,
    from_message_id: Option<Uuid>,
) -> Value {
    let mut payload = json!({});

    if let Some(msg_id) = from_message_id {
        payload["from_message_id"] = json!(msg_id.to_string());
    }

    let response = reqwest::Client::new()
        .post(server.api_url(&format!(
            "/conversations/{}/branches",
            conversation_id
        )))
        .header("Authorization", format!("Bearer {}", token))
        .json(&payload)
        .send()
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::CREATED);
    response.json().await.unwrap()
}

/// Fire-and-forget send: POST `/conversations/{id}/messages`. Returns the raw
/// response — the body is `{userMessageId, assistantMessageId}` JSON (the reply
/// itself now streams over `GET /api/chat/stream`, NOT this response). Use
/// `send_and_collect` when you need the streamed reply.
pub async fn send_message_simple(
    server: &crate::common::TestServer,
    token: &str,
    conversation_id: Uuid,
    model_id: Uuid,
    branch_id: Uuid,
    content: &str,
) -> reqwest::Response {
    let payload = json!({
        "content": content,
        "model_id": model_id.to_string(),
        "branch_id": branch_id.to_string()
    });

    reqwest::Client::new()
        .post(server.api_url(&format!(
            "/conversations/{}/messages",
            conversation_id
        )))
        .header("Authorization", format!("Bearer {}", token))
        .json(&payload)
        .send()
        .await
        .unwrap()
}

/// Send a message and return a synthetic message object carrying the assistant
/// message id (mirrors the old return shape so id-only callers don't change).
/// The `id` field is the assistant message id; `user_message_id` is also
/// included. Callers that need the assistant reply TEXT must use
/// `send_and_collect` (the reply streams asynchronously over the chat stream).
pub async fn send_message(
    server: &crate::common::TestServer,
    token: &str,
    conversation_id: Uuid,
    branch_id: Uuid,
    model_id: Uuid,
    content: &str,
) -> Value {
    let response = send_message_simple(
        server,
        token,
        conversation_id,
        model_id,
        branch_id,
        content,
    )
    .await;

    let status = response.status();
    let body: Value = response.json().await.unwrap();
    assert_eq!(
        status,
        StatusCode::OK,
        "send_message (POST /messages) failed: {body}"
    );

    json!({
        "id": body["assistant_message_id"],
        "user_message_id": body["user_message_id"],
        "assistant_message_id": body["assistant_message_id"],
        "content": content,
        "conversation_id": conversation_id.to_string(),
        "branch_id": branch_id.to_string(),
    })
}

/// A fully-collected assistant turn: the persisted ids plus the reply assembled
/// from the live chat-token stream.
pub struct CollectedTurn {
    pub user_message_id: Option<Uuid>,
    pub assistant_message_id: Uuid,
    pub text: String,
    pub frames: Vec<ChatFrame>,
}

/// The faithful replacement for "send a message and read the streamed reply" in
/// the fire-and-forget model: open a chat-stream probe, subscribe to the
/// conversation BEFORE sending (so no frame is missed), POST the message, and
/// collect frames until the reply terminates. Returns the ids + assembled text.
pub async fn send_and_collect(
    server: &crate::common::TestServer,
    token: &str,
    conversation_id: Uuid,
    branch_id: Uuid,
    model_id: Uuid,
    content: &str,
) -> CollectedTurn {
    let mut probe = ChatStreamProbe::open(server, token).await;
    probe.subscribe(Some(conversation_id)).await;

    let response =
        send_message_simple(server, token, conversation_id, model_id, branch_id, content).await;
    let status = response.status();
    let body: Value = response.json().await.unwrap();
    assert_eq!(status, StatusCode::OK, "send failed: {body}");

    let assistant_message_id = parse_uuid(&body["assistant_message_id"]);
    let user_message_id = body["user_message_id"]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok());

    let frames = probe
        .collect_until_terminal(conversation_id, std::time::Duration::from_secs(30))
        .await;
    let text = ChatStreamProbe::assemble_text(&frames);

    CollectedTurn {
        user_message_id,
        assistant_message_id,
        text,
        frames,
    }
}

/// Subscribe → POST an arbitrary `body` to `/messages` → collect the streamed
/// frames as `SSEEvent`s (the `{event, data}` shape the pre-migration
/// `parse_sse_events` returned), so existing event-name assertions
/// (`events.iter().find(|e| e.event == "mcpToolStart")`) keep working with
/// minimal call-site change. Stops at a terminal (complete/error) frame OR any
/// `stop_at` event type — pass e.g. `&["mcpApprovalRequired",
/// "mcpElicitationRequired"]` for flows that pause mid-stream awaiting a
/// separate respond/approve call. Asserts the POST returned 200.
pub async fn send_body_and_collect_events(
    server: &crate::common::TestServer,
    token: &str,
    conversation_id: Uuid,
    body: Value,
    stop_at: &[&str],
) -> Vec<SSEEvent> {
    let mut probe = ChatStreamProbe::open(server, token).await;
    probe.subscribe(Some(conversation_id)).await;

    let resp = reqwest::Client::new()
        .post(server.api_url(&format!("/conversations/{}/messages", conversation_id)))
        .header("Authorization", format!("Bearer {token}"))
        .json(&body)
        .send()
        .await
        .unwrap();
    let status = resp.status();
    let resp_body: Value = resp.json().await.unwrap_or(Value::Null);
    assert_eq!(status, StatusCode::OK, "send body failed: {resp_body}");

    // Default 60s is ample for Linux/bwrap. The macOS libkrun backend pays a
    // one-time full-flavor (~850 MB) microVM cold-start when a Tier-5 test
    // spawns a *sandboxed* stdio MCP server (the echo-server case), which can
    // exceed 60s. `ZIEE_TEST_CHAT_COLLECT_SECS` lets such runs extend the
    // window without slowing fast-failure detection on Linux.
    let collect_secs = std::env::var("ZIEE_TEST_CHAT_COLLECT_SECS")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(60);
    let frames = probe
        .collect_until(conversation_id, stop_at, std::time::Duration::from_secs(collect_secs))
        .await;
    frames
        .into_iter()
        .map(|f| SSEEvent {
            event: f.event_type,
            data: f.data,
        })
        .collect()
}

/// Spawn a stub-engine + create a `custom` provider pointing at it + a chat
/// model, and grant `user_id` access. KEEP the returned `StubEngine` alive for
/// the test (dropping it kills the process). Deterministic: the model replies
/// `"Hello from stub"`.
pub async fn create_stub_model(
    server: &crate::common::TestServer,
    user_id: &str,
) -> (StubEngine, Value) {
    create_stub_model_with_delay(server, user_id, 0).await
}

/// Like `create_stub_model`, but the stub paces its deltas by `chunk_delay_ms`
/// so a turn is slow enough to be observed / cancelled mid-flight.
pub async fn create_stub_model_with_delay(
    server: &crate::common::TestServer,
    user_id: &str,
    chunk_delay_ms: u64,
) -> (StubEngine, Value) {
    let stub = StubEngine::start_with_chunk_delay(chunk_delay_ms).await;

    let admin = crate::common::test_helpers::create_user_with_permissions(
        server,
        "stub_model_admin",
        &[
            "llm_models::read",
            "llm_models::create",
            "llm_providers::read",
            "llm_providers::create",
            "llm_providers::edit",
        ],
    )
    .await;

    // A fresh `custom` (OpenAI-compatible) provider pointing at the stub. No
    // api_key is required for `custom`; loopback http passes URL validation.
    let provider_resp = reqwest::Client::new()
        .post(server.api_url("/llm-providers"))
        .header("Authorization", format!("Bearer {}", admin.token))
        .json(&json!({
            "name": format!("Stub {}", &Uuid::new_v4().to_string()[..8]),
            "provider_type": "custom",
            "enabled": true,
            "api_key": "test",
            "base_url": stub.base_url(),
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(
        provider_resp.status(),
        StatusCode::CREATED,
        "stub provider create failed"
    );
    let provider: Value = provider_resp.json().await.unwrap();

    let model_resp = reqwest::Client::new()
        .post(server.api_url("/llm-models"))
        .header("Authorization", format!("Bearer {}", admin.token))
        .json(&json!({
            "provider_id": provider["id"],
            "name": "stub-model",
            "display_name": "Stub Model",
            "description": "Deterministic stub model for chat tests",
            "enabled": true,
            "engine_type": "none",
            "file_format": "gguf",
            "capabilities": { "chat": true, "completion": true, "embedding": false }
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(
        model_resp.status(),
        StatusCode::CREATED,
        "stub model create failed"
    );
    let model: Value = model_resp.json().await.unwrap();

    ensure_user_has_model_access(server, user_id, &model).await;

    (stub, model)
}

/// SSE Event with event name and data
#[derive(Debug, Clone)]
pub struct SSEEvent {
    pub event: String,
    pub data: Value,
}

/// Extract UUIDs from JSON string fields
pub fn parse_uuid(value: &Value) -> Uuid {
    value
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok())
        .expect("Failed to parse UUID from JSON value")
}

/// Assert that two UUIDs match (helper for cleaner test code)
pub fn assert_uuid_eq(actual: &Value, expected: Uuid, field_name: &str) {
    let actual_uuid = parse_uuid(actual);
    assert_eq!(
        actual_uuid, expected,
        "UUID mismatch for field '{}'",
        field_name
    );
}

/// Get message contents from database
/// Returns the raw message_contents rows for verification
pub async fn get_message_contents_from_db(
    server: &crate::common::TestServer,
    message_id: Uuid,
) -> Vec<Value> {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(5)
        .connect(&server.database_url)
        .await
        .expect("Failed to connect to test database");

    let rows = sqlx::query!(
        r#"
        SELECT id, message_id, content_type, content, sequence_order, created_at
        FROM message_contents
        WHERE message_id = $1
        ORDER BY sequence_order
        "#,
        message_id
    )
    .fetch_all(&pool)
    .await
    .unwrap();

    pool.close().await;

    rows.iter()
        .map(|row| {
            json!({
                "id": row.id.to_string(),
                "message_id": row.message_id.to_string(),
                "content_type": row.content_type,
                "content": row.content,
                "sequence_order": row.sequence_order,
                "created_at": row.created_at.to_string(),
            })
        })
        .collect()
}

/// Get tool use approval status from database
/// Returns None if not found, Some(status) otherwise
pub async fn get_approval_status_from_db(
    server: &crate::common::TestServer,
    tool_use_id: &str,
    branch_id: Uuid,
) -> Option<String> {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(5)
        .connect(&server.database_url)
        .await
        .expect("Failed to connect to test database");

    let result = sqlx::query!(
        r#"
        SELECT status FROM tool_use_approvals
        WHERE tool_use_id = $1 AND branch_id = $2
        "#,
        tool_use_id,
        branch_id
    )
    .fetch_optional(&pool)
    .await
    .unwrap();

    pool.close().await;

    result.map(|row| row.status)
}

/// Seed a message carrying a single `text` content block directly into a
/// conversation's branch, bypassing the streaming/LLM path. Used by the
/// content-search + sort tests to give conversations deterministic, searchable
/// message text without a provider. Returns the new message id.
pub async fn seed_text_message(
    database_url: &str,
    branch_id: Uuid,
    role: &str,
    text: &str,
) -> Uuid {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(2)
        .connect(database_url)
        .await
        .expect("Failed to connect to test database");

    // originated_from_id is NOT NULL; a standalone seeded message originates
    // from itself.
    let message_id: Uuid = sqlx::query_scalar(
        "INSERT INTO messages (role, originated_from_id, edit_count)
         VALUES ($1, gen_random_uuid(), 0)
         RETURNING id",
    )
    .bind(role)
    .fetch_one(&pool)
    .await
    .expect("insert message");

    sqlx::query("UPDATE messages SET originated_from_id = id WHERE id = $1")
        .bind(message_id)
        .execute(&pool)
        .await
        .expect("set originated_from_id");

    let content = json!({ "type": "text", "text": text });
    sqlx::query(
        "INSERT INTO message_contents (message_id, content_type, content, sequence_order)
         VALUES ($1, 'text', $2, 0)",
    )
    .bind(message_id)
    .bind(&content)
    .execute(&pool)
    .await
    .expect("insert message_contents");

    sqlx::query(
        "INSERT INTO branch_messages (branch_id, message_id, is_clone)
         VALUES ($1, $2, false)",
    )
    .bind(branch_id)
    .bind(message_id)
    .execute(&pool)
    .await
    .expect("insert branch_messages");

    pool.close().await;
    message_id
}

// ── the configured test LLM (one resolution, shared by every real-LLM tier) ──
//
// Real-LLM coverage used to be gated per-vendor (`ANTHROPIC_API_KEY` set? no →
// skip). On a box configured with a LOCAL bridge and no Anthropic key, that
// reports SKIPPED — so a whole surface can be "covered" by tests that never
// execute, which is exactly how the control-MCP search bug shipped. The rule is
// therefore: skip only when NO LLM is configured at all, never merely because
// one particular vendor is absent.

/// One vendor seam: which built-in provider row to configure, and the env vars
/// that carry its key / bridge base-URL / model override.
///
/// A struct rather than a tuple + a parallel defaults array: adding a vendor is
/// ONE row, and a mis-ordered field cannot compile silently into the wrong slot.
struct VendorSeam {
    provider_name: &'static str,
    provider_type: &'static str,
    key_env: &'static str,
    base_url_env: &'static str,
    model_env: &'static str,
    default_model: &'static str,
}

/// The vendors a real-LLM tier can be pointed at — the SAME four the
/// pre-existing `get_or_create_ai_provider` supports, so no box that could run a
/// real-LLM test before is narrowed by this seam.
const VENDOR_SEAMS: &[VendorSeam] = &[
    VendorSeam {
        provider_name: "OpenAI",
        provider_type: "openai",
        key_env: "OPENAI_API_KEY",
        base_url_env: "OPENAI_BASE_URL",
        model_env: "OPENAI_MODEL",
        default_model: "gpt-4o-mini",
    },
    VendorSeam {
        provider_name: "Anthropic",
        provider_type: "anthropic",
        key_env: "ANTHROPIC_API_KEY",
        base_url_env: "ANTHROPIC_BASE_URL",
        model_env: "ANTHROPIC_MODEL",
        default_model: "claude-opus-4-1-20250805",
    },
    VendorSeam {
        provider_name: "Google Gemini",
        provider_type: "gemini",
        key_env: "GEMINI_API_KEY",
        base_url_env: "GEMINI_BASE_URL",
        model_env: "GEMINI_MODEL",
        default_model: "gemini-2.5-flash",
    },
    VendorSeam {
        provider_name: "Groq",
        provider_type: "groq",
        key_env: "GROQ_API_KEY",
        base_url_env: "GROQ_BASE_URL",
        model_env: "GROQ_MODEL",
        default_model: "llama-3.1-8b-instant",
    },
];

/// Committed PLACEHOLDER key values. `tests/.env.test` ships `sk-xxx` so the
/// suite has something to source; treating that as "an LLM is configured" would
/// turn a clean self-skip into a 401 against a paid endpoint — the opposite of
/// the honesty this seam exists for. A placeholder paired with a bridge
/// `*_BASE_URL` IS usable (a local bridge ignores the key), so it only
/// disqualifies the vendor when there is no base-URL override.
fn is_placeholder_key(key: &str) -> bool {
    let k = key.trim().to_ascii_lowercase();
    k == "sk-xxx" || k == "xxx" || k.starts_with("sk-xxx") || k.starts_with("your-") || k == "changeme"
}

/// The LLM a real-LLM test tier should drive.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TestLlm {
    /// The built-in `llm_providers` row to configure, by name.
    pub provider_name: &'static str,
    /// Its `provider_type` discriminant.
    pub provider_type: &'static str,
    /// The env var the key came from — carried so callers never re-derive it
    /// (a `<TYPE>_API_KEY` guess breaks the moment a vendor names it otherwise).
    pub key_env: &'static str,
    pub api_key: String,
    /// Base-URL override (a local bridge); `None` means the vendor's SaaS default.
    pub base_url: Option<String>,
    pub model_name: String,
}

/// Pure resolution over an env lookup, so the precedence is unit-testable
/// without mutating process env (which would race across parallel tests).
///
/// Walks [`VENDOR_SEAMS`] in order and takes the first vendor with a usable key.
/// `None` only when nothing at all is configured.
///
/// NOTE the inner shadow narrows the caller's closure to "present and
/// non-blank"; a blank env var is treated as unset throughout.
pub fn resolve_test_llm(get: impl Fn(&str) -> Option<String>) -> Option<TestLlm> {
    let get = |k: &str| get(k).filter(|v| !v.trim().is_empty());
    let global_base = get("ZIEE_TEST_LLM_BASE_URL");
    let global_model = get("ZIEE_TEST_LLM_MODEL");

    for seam in VENDOR_SEAMS {
        let Some(api_key) = get(seam.key_env) else { continue };
        let base_url = get(seam.base_url_env).or_else(|| global_base.clone());
        // A placeholder key with no bridge behind it is not a configured LLM.
        if base_url.is_none() && is_placeholder_key(&api_key) {
            continue;
        }
        let model_name = get(seam.model_env)
            .or_else(|| global_model.clone())
            .unwrap_or_else(|| seam.default_model.to_string());
        return Some(TestLlm {
            provider_name: seam.provider_name,
            provider_type: seam.provider_type,
            key_env: seam.key_env,
            api_key,
            base_url,
            model_name,
        });
    }

    // A KEYLESS local bridge (`ZIEE_TEST_LLM_BASE_URL` + `ZIEE_TEST_LLM_MODEL`,
    // no vendor key) is a real, common configuration — a self-hosted
    // OpenAI-compatible server needs no credential. Refusing it would be exactly
    // the false skip this seam exists to eliminate. The provider row still needs
    // SOME key (the backend rejects an enabled remote provider with an empty
    // one), so a throwaway placeholder is supplied; the bridge ignores it.
    if let (Some(base_url), Some(model_name)) = (global_base, global_model) {
        return Some(TestLlm {
            provider_name: "OpenAI",
            provider_type: "openai",
            key_env: "OPENAI_API_KEY",
            api_key: "sk-local-bridge".to_string(),
            base_url: Some(base_url),
            model_name,
        });
    }
    None
}

/// The configured test LLM, read from the process environment.
///
/// `None` ⇒ genuinely nothing is configured ⇒ a real-LLM tier may skip.
pub fn configured_test_llm() -> Option<TestLlm> {
    resolve_test_llm(|k| std::env::var(k).ok())
}

#[cfg(test)]
mod configured_test_llm_tests {
    use super::*;
    use std::collections::HashMap;

    fn env(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> + use<> {
        let map: HashMap<String, String> =
            pairs.iter().map(|(k, v)| ((*k).to_string(), (*v).to_string())).collect();
        move |k: &str| map.get(k).cloned()
    }

    /// TEST-10 — the whole point: Anthropic being absent must NOT mean "skip".
    #[test]
    fn openai_bridge_resolves_without_any_anthropic_key() {
        let llm = resolve_test_llm(env(&[
            ("OPENAI_API_KEY", "sk-local"),
            ("OPENAI_BASE_URL", "http://localhost:4000/v1"),
            ("ZIEE_TEST_LLM_MODEL", "qwen3.6-35b-a3b"),
        ]))
        .expect("an OpenAI-seam bridge must resolve even with no Anthropic key");
        assert_eq!(llm.provider_type, "openai");
        assert_eq!(llm.key_env, "OPENAI_API_KEY");
        assert_eq!(llm.base_url.as_deref(), Some("http://localhost:4000/v1"));
        assert_eq!(llm.model_name, "qwen3.6-35b-a3b");
    }

    #[test]
    fn anthropic_seam_resolves_when_openai_is_absent() {
        let llm = resolve_test_llm(env(&[
            ("ANTHROPIC_API_KEY", "sk-local"),
            ("ANTHROPIC_BASE_URL", "http://localhost:4000/v1"),
        ]))
        .expect("the Anthropic seam must still resolve");
        assert_eq!(llm.provider_type, "anthropic");
        assert_eq!(llm.provider_name, "Anthropic");
    }

    /// Every vendor the pre-existing `get_or_create_ai_provider` supports must
    /// resolve here too, or a Gemini/Groq box silently goes dark again.
    #[test]
    fn gemini_and_groq_seams_resolve_too() {
        let gemini = resolve_test_llm(env(&[("GEMINI_API_KEY", "real-key")]))
            .expect("a Gemini box is a configured box");
        assert_eq!(gemini.provider_name, "Google Gemini");
        let groq = resolve_test_llm(env(&[("GROQ_API_KEY", "real-key")]))
            .expect("a Groq box is a configured box");
        assert_eq!(groq.provider_name, "Groq");
    }

    #[test]
    fn global_base_url_fallback_applies_to_whichever_vendor_has_a_key() {
        let llm = resolve_test_llm(env(&[
            ("ANTHROPIC_API_KEY", "sk-local"),
            ("ZIEE_TEST_LLM_BASE_URL", "http://localhost:4000/v1"),
            ("ZIEE_TEST_LLM_MODEL", "qwen3.6-35b-a3b"),
        ]))
        .expect("the global fallback must resolve");
        assert_eq!(llm.base_url.as_deref(), Some("http://localhost:4000/v1"));
        assert_eq!(llm.model_name, "qwen3.6-35b-a3b");
    }

    #[test]
    fn a_bare_saas_key_resolves_with_no_base_url_override() {
        let llm = resolve_test_llm(env(&[("ANTHROPIC_API_KEY", "sk-ant-real")]))
            .expect("a plain SaaS key is still a configured LLM");
        assert_eq!(llm.base_url, None);
        assert_eq!(llm.model_name, "claude-opus-4-1-20250805");
    }

    /// The committed `tests/.env.test` placeholder must not masquerade as a
    /// configured LLM — otherwise a clean self-skip becomes a 401 against a paid
    /// endpoint, and the placeholder OpenAI key SHADOWS a real Anthropic one.
    #[test]
    fn a_committed_placeholder_key_is_not_a_configured_llm() {
        assert_eq!(resolve_test_llm(env(&[("OPENAI_API_KEY", "sk-xxx")])), None);
        assert_eq!(
            resolve_test_llm(env(&[("OPENAI_API_KEY", "sk-xxxxxxxx"), ("ANTHROPIC_API_KEY", "sk-xxx")])),
            None
        );
        // A real key behind the placeholder still wins.
        let llm = resolve_test_llm(env(&[
            ("OPENAI_API_KEY", "sk-xxx"),
            ("ANTHROPIC_API_KEY", "sk-ant-real"),
        ]))
        .expect("a real key must not be shadowed by a placeholder");
        assert_eq!(llm.provider_type, "anthropic");
        // …but a placeholder POINTED AT A BRIDGE is usable (the bridge ignores it).
        let llm = resolve_test_llm(env(&[
            ("OPENAI_API_KEY", "sk-xxx"),
            ("OPENAI_BASE_URL", "http://localhost:4000/v1"),
        ]))
        .expect("a placeholder key with a bridge base-url IS usable");
        assert_eq!(llm.provider_type, "openai");
    }

    /// A self-hosted bridge needs no credential, so requiring a vendor key would
    /// be a FALSE skip — the same failure the seam exists to eliminate.
    #[test]
    fn a_keyless_bridge_is_a_configured_llm() {
        let llm = resolve_test_llm(env(&[
            ("ZIEE_TEST_LLM_BASE_URL", "http://localhost:4000/v1"),
            ("ZIEE_TEST_LLM_MODEL", "qwen3.6-35b-a3b"),
        ]))
        .expect("a keyless local bridge IS a configured LLM");
        assert_eq!(llm.provider_type, "openai");
        assert_eq!(llm.model_name, "qwen3.6-35b-a3b");
        assert_eq!(llm.base_url.as_deref(), Some("http://localhost:4000/v1"));
        assert!(!llm.api_key.is_empty(), "the provider row needs some key");
    }

    #[test]
    fn nothing_configured_is_the_only_none() {
        assert_eq!(resolve_test_llm(env(&[])), None);
        // Blank values do not count as configured.
        assert_eq!(resolve_test_llm(env(&[("OPENAI_API_KEY", "  ")])), None);
        // A base URL with no MODEL is not usable on its own — there would be
        // nothing to ask for.
        assert_eq!(
            resolve_test_llm(env(&[("ZIEE_TEST_LLM_BASE_URL", "http://localhost:4000/v1")])),
            None
        );
        assert_eq!(resolve_test_llm(env(&[("ZIEE_TEST_LLM_MODEL", "some-model")])), None);
    }
}
