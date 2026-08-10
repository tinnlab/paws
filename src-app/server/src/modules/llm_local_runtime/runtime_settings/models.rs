//! Runtime-settings DTOs.

use chrono::{DateTime, Utc};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, sqlx::FromRow)]
pub struct RuntimeSettings {
    pub idle_unload_secs: i32,
    pub auto_start_timeout_secs: i32,
    pub drain_timeout_secs: i32,
    /// How long a fetched engine release catalogue is reused before the next
    /// discovery call refreshes it from GitHub. Discovery was previously
    /// uncached, costing one GitHub API request per call against a 60/hour
    /// anonymous budget.
    pub engine_release_cache_ttl_secs: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Bounds for [`RuntimeSettings::engine_release_cache_ttl_secs`], shared by the
/// repository validator and the migration's CHECK constraint so the two cannot
/// drift.
pub const ENGINE_RELEASE_CACHE_TTL_MIN_SECS: i32 = 60;
pub const ENGINE_RELEASE_CACHE_TTL_MAX_SECS: i32 = 86_400;

impl Default for RuntimeSettings {
    fn default() -> Self {
        Self {
            idle_unload_secs: 1800,
            auto_start_timeout_secs: 30,
            drain_timeout_secs: 30,
            engine_release_cache_ttl_secs: 3600,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct UpdateRuntimeSettingsRequest {
    pub idle_unload_secs: Option<i32>,
    pub auto_start_timeout_secs: Option<i32>,
    pub drain_timeout_secs: Option<i32>,
    pub engine_release_cache_ttl_secs: Option<i32>,
}
