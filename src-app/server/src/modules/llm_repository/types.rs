// LLM Repository API types - Request/Response types for API communication
// Separated from models.rs to distinguish API types from database entities

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::models::{LlmRepository, RepositoryAuthConfig, RepositoryHealthStatus};

// =====================================================
// Request Types
// =====================================================

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct CreateLlmRepositoryRequest {
    pub name: String,
    pub url: String,
    pub auth_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_config: Option<RepositoryAuthConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct UpdateLlmRepositoryRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_config: Option<RepositoryAuthConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct TestRepositoryConnectionRequest {
    pub name: String,
    pub url: String,
    pub auth_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_config: Option<RepositoryAuthConfig>,
}

// =====================================================
// Response Types
// =====================================================

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct LlmRepositoryListResponse {
    pub repositories: Vec<LlmRepository>,
    pub total: i64,
    pub page: i32,
    pub per_page: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct TestRepositoryConnectionResponse {
    /// True ONLY when a model-serving capability was positively confirmed.
    /// A reachable-but-unconfirmable host reports `success: false` with
    /// `status: "unverified"` — reachability alone is not a pass.
    pub success: bool,
    pub message: String,
    /// The three-way probe outcome. `unverified` is distinct from
    /// `unhealthy`: it never auto-disables the repository.
    pub status: RepositoryHealthStatus,
}
