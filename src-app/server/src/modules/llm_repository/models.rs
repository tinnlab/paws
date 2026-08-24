// LLM Repository database models - Database entities only
// Source: react-test/src-tauri/src/database/models/repository.rs
// Note: API request/response types have been moved to types.rs

use chrono::{DateTime, Utc};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// =====================================================
// Database Entities
// =====================================================

/// Authentication configuration for LLM repositories
/// This is part of the database entity and stored as JSONB in PostgreSQL.
///
/// SECURITY: api_key / password / token are write-only — accepted from
/// request bodies (Deserialize unchanged) so admins can set values, but
/// NEVER returned in responses. Without these `skip_serializing` guards
/// the credentials round-tripped on every GET /llm-repositories and
/// /llm-repositories/{id}, exposing the secret to every user with
/// `llm_repositories::read` (no per-user scope on llm_repositories).
/// Closes 09-llm-repository F-02 (High). The deeper at-rest encryption
/// (pgcrypto / SecretView) is the follow-up A5-full work.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, Default)]
pub struct RepositoryAuthConfig {
    #[serde(default, skip_serializing)]
    pub api_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(default, skip_serializing)]
    pub password: Option<String>,
    #[serde(default, skip_serializing)]
    pub token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_test_api_endpoint: Option<String>,
}

impl RepositoryAuthConfig {
    /// Serialize for STORAGE — including the secret fields (`api_key` /
    /// `password` / `token`) that `Serialize` deliberately omits via
    /// `skip_serializing` so they never leak in API responses (F-02). The DB
    /// write path MUST persist them, so it uses this instead of
    /// `serde_json::to_value`, which respects `skip_serializing` and would
    /// silently DROP the secrets — the bug that made configured repository
    /// tokens never actually save.
    pub fn to_storage_value(&self) -> serde_json::Value {
        let mut map = serde_json::Map::new();
        if let Some(v) = &self.api_key {
            map.insert("api_key".into(), serde_json::Value::String(v.clone()));
        }
        if let Some(v) = &self.username {
            map.insert("username".into(), serde_json::Value::String(v.clone()));
        }
        if let Some(v) = &self.password {
            map.insert("password".into(), serde_json::Value::String(v.clone()));
        }
        if let Some(v) = &self.token {
            map.insert("token".into(), serde_json::Value::String(v.clone()));
        }
        if let Some(v) = &self.auth_test_api_endpoint {
            map.insert(
                "auth_test_api_endpoint".into(),
                serde_json::Value::String(v.clone()),
            );
        }
        serde_json::Value::Object(map)
    }

    /// Merge `self` (an incoming PARTIAL update) over a `base` (the
    /// currently-stored config), preserving stored SECRETS
    /// (api_key/password/token) when the incoming request omits them — the API
    /// and the edit UI both treat an omitted secret as "keep existing". Without
    /// this, a partial update (e.g. changing only `auth_test_api_endpoint`) would
    /// overwrite the whole column and WIPE the stored secret. An explicit value
    /// (including an explicit empty string) in `self` wins over the base.
    pub fn merge_over(&self, base: &RepositoryAuthConfig) -> RepositoryAuthConfig {
        RepositoryAuthConfig {
            api_key: self.api_key.clone().or_else(|| base.api_key.clone()),
            username: self.username.clone().or_else(|| base.username.clone()),
            password: self.password.clone().or_else(|| base.password.clone()),
            token: self.token.clone().or_else(|| base.token.clone()),
            auth_test_api_endpoint: self
                .auth_test_api_endpoint
                .clone()
                .or_else(|| base.auth_test_api_endpoint.clone()),
        }
    }

    /// Return a copy keeping only the secret fields relevant to `auth_type`
    /// (plus the non-secret `auth_test_api_endpoint`). Used on an auth_type
    /// SWITCH so dead credential material from the previous type doesn't linger
    /// in the stored blob.
    pub fn pruned_for(&self, auth_type: &str) -> RepositoryAuthConfig {
        let mut out = RepositoryAuthConfig {
            auth_test_api_endpoint: self.auth_test_api_endpoint.clone(),
            ..Default::default()
        };
        match auth_type {
            "api_key" => out.api_key = self.api_key.clone(),
            "bearer_token" => out.token = self.token.clone(),
            "basic_auth" => {
                out.username = self.username.clone();
                out.password = self.password.clone();
            }
            _ => {}
        }
        out
    }

    /// Whether a usable (present AND non-empty) credential exists for the given
    /// `auth_type`. Secret fields are trimmed so a whitespace-only value does not
    /// count as configured (matching the module's validators). `none` always
    /// qualifies; an unknown auth_type never does. Shared by
    /// `LlmRepository::has_credential` and the hub credential-presence query.
    pub fn has_credential_for(&self, auth_type: &str) -> bool {
        match auth_type {
            "none" => true,
            "api_key" => self
                .api_key
                .as_deref()
                .is_some_and(|s| !s.trim().is_empty()),
            "bearer_token" => self.token.as_deref().is_some_and(|s| !s.trim().is_empty()),
            "basic_auth" => {
                self.username
                    .as_deref()
                    .is_some_and(|s| !s.trim().is_empty())
                    && self
                        .password
                        .as_deref()
                        .is_some_and(|s| !s.trim().is_empty())
            }
            _ => false,
        }
    }
}

/// LLM Repository database entity
/// Represents a row in the llm_repositories table
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct LlmRepository {
    pub id: Uuid,
    pub name: String,
    pub url: String,
    pub auth_type: String, // none, api_key, basic_auth, bearer_token
    pub auth_config: RepositoryAuthConfig,
    pub enabled: bool,
    pub built_in: bool, // true for built-in repositories like Hugging Face
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    /// Connection-health columns (migration 83). Populated by
    /// `connection_health::probe` at four points: boot startup
    /// check, create-flow probe, update-flow enable-transition
    /// probe, and the explicit form-based test path.
    /// `last_health_check_at` is NULL on rows that have never been
    /// probed (default status "untested"). The UI renders an error
    /// Alert on "unhealthy" and a warning Alert on "unverified".
    pub last_health_check_at: Option<DateTime<Utc>>,
    /// One of `"untested" | "healthy" | "unverified" | "unhealthy"`.
    ///
    /// `"unverified"` (added by migration
    /// `202607200600_llm_repository_unverified_status`) means "reachable,
    /// but model-serving capability not confirmed for this URL shape". It
    /// is deliberately NOT `"unhealthy"`: an unconfirmable host must never
    /// auto-disable a working self-hosted deployment (INV-4). `"healthy"`
    /// now requires positive evidence — a confirmed model listing — so
    /// reachability alone can never earn it.
    pub last_health_check_status: String,
    pub last_health_check_reason: Option<String>,
}

/// The health outcome vocabulary, as an API-facing enum.
///
/// The DB column is text (it also carries the `"untested"` default, which a
/// probe never writes), so this enum covers exactly the three values a probe
/// can produce.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum RepositoryHealthStatus {
    /// A model-serving capability was positively confirmed.
    Healthy,
    /// Reachable, but the capability could not be confirmed for this URL
    /// shape. Never auto-disables the repository.
    Unverified,
    /// Unreachable, or the credentials were rejected.
    Unhealthy,
}

impl RepositoryHealthStatus {
    /// The `last_health_check_status` column value.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Healthy => "healthy",
            Self::Unverified => "unverified",
            Self::Unhealthy => "unhealthy",
        }
    }
}

impl LlmRepository {
    /// Whether this repository has a usable credential configured for its
    /// `auth_type`. `none` needs nothing; the secret variants require the
    /// relevant field to be present AND non-empty — the built-in Hugging Face /
    /// GitHub rows seed empty-string secrets, so a bare `is_some()` would wrongly
    /// report "configured". Used by the hub pre-download gate and the
    /// `source_auth_configured` flag exposed on hub models.
    pub fn has_credential(&self) -> bool {
        self.auth_config.has_credential_for(&self.auth_type)
    }

    /// The `(username, secret)` pair handed to the git / LFS layer for a clone
    /// from this repository.
    ///
    /// For `basic_auth` the two are kept SEPARATE — the password is the git
    /// secret and the username is threaded through so the credential callback
    /// can pair them correctly (libgit2 Basic auth = base64("username:password")).
    /// For `api_key` / `bearer_token` the secret is a token paired with a
    /// host-default username, so the username stays `None`.
    ///
    /// **`none` yields `(None, None)`, unconditionally.** That is the mechanism
    /// behind "installing the default model requires no credential at any point":
    /// an anonymous repository hands the git layer nothing to send, so there is
    /// nothing for libgit2 to offer even if the far side challenges. It ignores
    /// any secret material still sitting in `auth_config` — a row switched to
    /// `none`, or seeded with stray fields, must not quietly keep
    /// authenticating. An unknown auth_type is anonymous for the same reason:
    /// failing closed here means sending nothing.
    ///
    /// Extracted from the download handler so this is directly assertable over
    /// every input. A clone that merely succeeded would prove nothing about what
    /// it sent.
    pub fn git_credential(&self) -> (Option<String>, Option<String>) {
        match self.auth_type.as_str() {
            "api_key" => (None, self.auth_config.api_key.clone()),
            "bearer_token" => (None, self.auth_config.token.clone()),
            "basic_auth" => match (&self.auth_config.username, &self.auth_config.password) {
                (Some(username), Some(password)) => {
                    (Some(username.clone()), Some(password.clone()))
                }
                // A half-configured basic_auth row sends nothing, rather than a
                // lone username or a password with no user.
                _ => (None, None),
            },
            _ => (None, None),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo(auth_type: &str, auth_config: RepositoryAuthConfig) -> LlmRepository {
        LlmRepository {
            id: Uuid::nil(),
            name: "Test".to_string(),
            url: "https://example.com".to_string(),
            auth_type: auth_type.to_string(),
            auth_config,
            enabled: true,
            built_in: false,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            last_health_check_at: None,
            last_health_check_status: "untested".to_string(),
            last_health_check_reason: None,
        }
    }

    #[test]
    fn none_always_has_credential() {
        assert!(repo("none", RepositoryAuthConfig::default()).has_credential());
    }

    /// TEST-4 (default-model-onboarding, acceptance, INV-1) — "Installing the
    /// default model requires **no credential** — no API key, no token, no
    /// login — at any point."
    ///
    /// `git_credential` is the single point where a clone's credential is
    /// decided, and this asserts an anonymous repository yields NOTHING there —
    /// including the case that would actually bite: a row whose `auth_config`
    /// still carries secret material. If someone changed the `none` arm to fall
    /// through to `api_key`, or dropped the catch-all so an unknown type leaked a
    /// token, this goes RED. A test that merely watched a clone succeed could not
    /// tell the difference.
    #[test]
    fn anonymous_repository_yields_no_credential_even_with_stray_secrets() {
        // The shape the default-model row is seeded with: nothing configured.
        assert_eq!(
            repo("none", RepositoryAuthConfig::default()).git_credential(),
            (None, None),
            "INV-1: an anonymous repository must hand the git layer nothing"
        );

        // The dangerous shape: `none`, but with every secret field populated.
        // A row switched to anonymous, or seeded carelessly, must still send
        // nothing — the auth_type is the authority, not the leftover blob.
        let littered = RepositoryAuthConfig {
            api_key: Some("hf_should_never_be_sent".to_string()),
            token: Some("ghp_should_never_be_sent".to_string()),
            username: Some("someone".to_string()),
            password: Some("hunter2".to_string()),
            auth_test_api_endpoint: None,
        };
        assert_eq!(
            repo("none", littered.clone()).git_credential(),
            (None, None),
            "INV-1: stray secret material on an anonymous row must NOT be sent"
        );

        // An unrecognised auth_type fails CLOSED — anonymous, not "whatever is
        // lying around".
        assert_eq!(
            repo("something_new", littered).git_credential(),
            (None, None),
            "an unknown auth_type must send nothing rather than guess"
        );
    }

    /// The credentialed arms still work — otherwise the test above could be
    /// satisfied by a `git_credential` that always returned `(None, None)`,
    /// which would break every private-repository download.
    #[test]
    fn credentialed_repositories_still_yield_their_secret() {
        let api = RepositoryAuthConfig {
            api_key: Some("hf_token".to_string()),
            ..Default::default()
        };
        assert_eq!(
            repo("api_key", api).git_credential(),
            (None, Some("hf_token".to_string()))
        );

        let bearer = RepositoryAuthConfig {
            token: Some("ghp_token".to_string()),
            ..Default::default()
        };
        assert_eq!(
            repo("bearer_token", bearer).git_credential(),
            (None, Some("ghp_token".to_string()))
        );

        let basic = RepositoryAuthConfig {
            username: Some("alice".to_string()),
            password: Some("s3cret".to_string()),
            ..Default::default()
        };
        assert_eq!(
            repo("basic_auth", basic).git_credential(),
            (Some("alice".to_string()), Some("s3cret".to_string())),
            "basic_auth keeps username and password separate for libgit2"
        );

        // Half-configured basic_auth sends neither half.
        let half = RepositoryAuthConfig {
            username: Some("alice".to_string()),
            ..Default::default()
        };
        assert_eq!(repo("basic_auth", half).git_credential(), (None, None));
    }

    #[test]
    fn api_key_requires_non_empty() {
        // Empty string (the seeded default for the Hugging Face Hub row) must NOT
        // count as configured.
        let empty = RepositoryAuthConfig {
            api_key: Some(String::new()),
            ..Default::default()
        };
        assert!(!repo("api_key", empty).has_credential());
        assert!(!repo("api_key", RepositoryAuthConfig::default()).has_credential());

        let set = RepositoryAuthConfig {
            api_key: Some("hf_xxx".to_string()),
            ..Default::default()
        };
        assert!(repo("api_key", set).has_credential());
    }

    #[test]
    fn bearer_token_requires_non_empty() {
        let empty = RepositoryAuthConfig {
            token: Some(String::new()),
            ..Default::default()
        };
        assert!(!repo("bearer_token", empty).has_credential());

        let set = RepositoryAuthConfig {
            token: Some("ghp_xxx".to_string()),
            ..Default::default()
        };
        assert!(repo("bearer_token", set).has_credential());
    }

    #[test]
    fn basic_auth_requires_both() {
        let only_user = RepositoryAuthConfig {
            username: Some("u".to_string()),
            ..Default::default()
        };
        assert!(!repo("basic_auth", only_user).has_credential());

        let both = RepositoryAuthConfig {
            username: Some("u".to_string()),
            password: Some("p".to_string()),
            ..Default::default()
        };
        assert!(repo("basic_auth", both).has_credential());
    }

    #[test]
    fn unknown_auth_type_is_false() {
        assert!(!repo("weird", RepositoryAuthConfig::default()).has_credential());
    }

    #[test]
    fn whitespace_only_secret_is_not_configured() {
        // A whitespace-only secret is unusable; the gate must not treat it as
        // configured (matches the trim convention used across the module).
        let ws = RepositoryAuthConfig {
            api_key: Some("   ".to_string()),
            ..Default::default()
        };
        assert!(!repo("api_key", ws).has_credential());
        let ws_token = RepositoryAuthConfig {
            token: Some("\t\n".to_string()),
            ..Default::default()
        };
        assert!(!repo("bearer_token", ws_token).has_credential());
    }

    #[test]
    fn to_storage_value_includes_secret_fields() {
        let cfg = RepositoryAuthConfig {
            api_key: Some("secret-key".to_string()),
            token: Some("secret-token".to_string()),
            username: Some("user".to_string()),
            password: Some("pass".to_string()),
            auth_test_api_endpoint: Some("https://example/whoami".to_string()),
        };
        let v = cfg.to_storage_value();
        assert_eq!(v["api_key"], "secret-key");
        assert_eq!(v["token"], "secret-token");
        assert_eq!(v["username"], "user");
        assert_eq!(v["password"], "pass");
        assert_eq!(v["auth_test_api_endpoint"], "https://example/whoami");

        // Round-trips back into a config that has_credential() recognizes — proving
        // the secret survives a store/load cycle (the regression that dropped it).
        let back: RepositoryAuthConfig = serde_json::from_value(v).unwrap();
        assert_eq!(back.api_key.as_deref(), Some("secret-key"));
    }

    #[test]
    fn to_storage_value_omits_absent_fields() {
        let v = RepositoryAuthConfig::default().to_storage_value();
        assert!(v.as_object().unwrap().is_empty());
    }

    #[test]
    fn merge_over_preserves_stored_secret_when_omitted() {
        let stored = RepositoryAuthConfig {
            api_key: Some("stored-key".to_string()),
            auth_test_api_endpoint: Some("https://old/whoami".to_string()),
            ..Default::default()
        };
        // Incoming partial update changes only the test endpoint, omits the secret.
        let incoming = RepositoryAuthConfig {
            auth_test_api_endpoint: Some("https://new/whoami".to_string()),
            ..Default::default()
        };
        let merged = incoming.merge_over(&stored);
        assert_eq!(
            merged.api_key.as_deref(),
            Some("stored-key"),
            "omitted secret must be preserved from the stored config"
        );
        assert_eq!(
            merged.auth_test_api_endpoint.as_deref(),
            Some("https://new/whoami"),
            "provided non-secret field should be updated"
        );
        // An explicit incoming secret wins over the stored one (rotation).
        let rotate = RepositoryAuthConfig {
            api_key: Some("new-key".to_string()),
            ..Default::default()
        };
        assert_eq!(
            rotate.merge_over(&stored).api_key.as_deref(),
            Some("new-key")
        );
    }

    #[test]
    fn pruned_for_drops_other_auth_type_secrets() {
        let mixed = RepositoryAuthConfig {
            api_key: Some("key".to_string()),
            token: Some("tok".to_string()),
            username: Some("u".to_string()),
            password: Some("p".to_string()),
            auth_test_api_endpoint: Some("https://x/whoami".to_string()),
        };
        let pruned = mixed.pruned_for("bearer_token");
        assert_eq!(pruned.token.as_deref(), Some("tok"));
        assert!(pruned.api_key.is_none());
        assert!(pruned.username.is_none());
        assert!(pruned.password.is_none());
        // Non-secret test endpoint is always kept.
        assert_eq!(
            pruned.auth_test_api_endpoint.as_deref(),
            Some("https://x/whoami")
        );
        // basic_auth keeps username + password only.
        let b = mixed.pruned_for("basic_auth");
        assert_eq!(b.username.as_deref(), Some("u"));
        assert_eq!(b.password.as_deref(), Some("p"));
        assert!(b.api_key.is_none() && b.token.is_none());
    }
}
