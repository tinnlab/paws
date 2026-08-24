// App builder — re-export shim over `ziee-framework`'s app_builder (Chunk B2).
//
// `create_modules` / `initialize_modules` / `build_api_router` /
// `create_cors_layer` / `apply_rate_limit_layer` moved into `ziee-framework`.
// The `create_cors_layer` / `apply_rate_limit_layer` signatures now take
// `&ServerConfig`; ziee call sites pass `&config` (a `Config`), which
// deref-coerces to `&ServerConfig`, so they are unchanged.
//
// `register_event_handlers` stays here: it constructs the domain-coupled
// `EventBus` (which the app owns — see `core/events.rs`).

use sqlx::PgPool;
use std::sync::Arc;

use crate::core::EventBus;
use crate::module_api::AppModule;

pub use ziee_framework::app_builder::{
    apply_rate_limit_layer, build_api_router, create_modules, initialize_modules,
};

/// Every custom request header ziee's API READS, assembled from the constants the
/// handlers themselves use — never re-spelled as a literal, so a rename cannot
/// leave the allowlist silently stale.
///
/// These are unioned into whatever `server.cors.allow_headers` a deployment
/// configures (see [`create_cors_layer`]). A header the API reads is not an
/// operator preference: a deployment where it is refused at preflight is simply
/// broken, and broken *silently* — the browser never sends the request, so the
/// server logs nothing and the client's `fetch` REJECTS rather than returning a
/// status.
///
/// That is not hypothetical. `X-Chat-Stream-Connection-Id` was absent from the
/// desktop allowlist, so `PUT /api/chat/stream/subscription` never reached the
/// server, every chat-stream connection stayed scoped to no conversation, and
/// live assistant tokens were dropped at the registry — the user saw a spinner
/// that only a reload resolved. `X-Sync-Connection-Id` had already been added,
/// with a comment describing that exact failure; the chat header never followed.
///
/// `X-Sync-Connection-Id` is contributed by the framework itself
/// (`FRAMEWORK_REQUIRED_REQUEST_HEADERS`) and so is not repeated here.
pub const REQUIRED_CUSTOM_REQUEST_HEADERS: &[&str] = &[
    // Scopes a chat-token SSE connection to one conversation.
    crate::modules::chat::stream::handler::CHAT_STREAM_CONNECTION_HEADER,
    // Opts the web client into httpOnly refresh-token cookies. Only meaningful
    // cross-origin, which is exactly when preflight applies.
    ziee_auth::auth::cookie::REFRESH_COOKIE_OPTIN_HEADER,
];

/// ziee's CORS layer: the framework's, plus [`REQUIRED_CUSTOM_REQUEST_HEADERS`].
///
/// Same signature as the framework's `create_cors_layer`, so every call site
/// (`main.rs`, `lib.rs`, the desktop `lib.rs` and `server_boot.rs`) is unchanged
/// — they just stop being able to lose a header the app depends on.
pub fn create_cors_layer(
    config: &ziee_core::ServerConfig,
) -> tower_http::cors::CorsLayer {
    let mut required: Vec<&str> =
        ziee_framework::app_builder::FRAMEWORK_REQUIRED_REQUEST_HEADERS.to_vec();
    required.extend_from_slice(REQUIRED_CUSTOM_REQUEST_HEADERS);
    ziee_framework::app_builder::create_cors_layer_with(config, &required)
}

/// Register event handlers from all modules
pub fn register_event_handlers(modules: &[Box<dyn AppModule>], pool: Arc<PgPool>) -> EventBus {
    let mut event_bus = EventBus::new(pool);

    for module in modules.iter() {
        for handler in module.register_event_handlers() {
            tracing::info!(
                "Registering event handler '{}' for module: {}",
                handler.handler_name(),
                module.name()
            );
            event_bus.register(handler);
        }
    }

    tracing::info!(
        "Registered {} event handlers total",
        event_bus.handler_count()
    );
    event_bus
}

#[cfg(test)]
mod tests {
    use super::create_modules;
    use crate::module_api::MODULE_ENTRIES;

    /// `create_modules` must instantiate EVERY registered module exactly once,
    /// in ascending `order` (the init/route/event-registration sequence depends
    /// on this ordering — e.g. the project chat-extension at order 8 must run
    /// before the assistant extension at order 10).
    ///
    /// This test also proves the linkme `MODULE_ENTRIES` slice — now DEFINED in
    /// `ziee-framework` and registered into from ziee's modules via the
    /// re-export shim — links every app module across the crate boundary.
    #[test]
    fn create_modules_instantiates_all_entries_in_order() {
        // Expected: the linkme slice sorted by order (stable), by name.
        let mut expected_entries: Vec<_> = MODULE_ENTRIES.iter().collect();
        expected_entries.sort_by_key(|e| e.order);
        let expected_names: Vec<&str> = expected_entries.iter().map(|e| e.name).collect();

        let modules = create_modules();

        // One module per registered entry — nothing dropped or duplicated.
        assert_eq!(
            modules.len(),
            MODULE_ENTRIES.len(),
            "create_modules must instantiate every registered module"
        );

        // Same names, in the same by-order sequence — proves the sort happened
        // and each entry's constructor produced a module reporting its name.
        let got_names: Vec<&str> = modules.iter().map(|m| m.name()).collect();
        assert_eq!(got_names, expected_names);

        // The reported orders are non-decreasing (defensive: catches a future
        // regression where the sort key changes).
        let orders: Vec<i32> = expected_entries.iter().map(|e| e.order).collect();
        assert!(
            orders.windows(2).all(|w| w[0] <= w[1]),
            "modules must be ordered by ascending `order`"
        );
    }

    /// Module names must be unique — two modules sharing a name would make the
    /// order/route/event wiring ambiguous.
    #[test]
    fn module_names_are_unique() {
        let modules = create_modules();
        let mut names: Vec<&str> = modules.iter().map(|m| m.name()).collect();
        names.sort_unstable();
        let unique = {
            let mut n = names.clone();
            n.dedup();
            n.len()
        };
        assert_eq!(unique, names.len(), "duplicate module name registered");
    }
}

/// TEST-1 / TEST-4 — INV-1: "a custom request header the API reads must be
/// accepted by the API's own CORS preflight, in every deployment shape, WITHOUT
/// a config file having to remember it."
#[cfg(test)]
mod required_request_header_tests {
    use super::*;
    use axum::{body::Body, http::Request, routing::put, Router};
    use tower::ServiceExt; // oneshot

    /// A `ServerConfig` whose explicit `allow_headers` is exactly `allow` —
    /// deliberately NOT including the headers under test.
    fn config_with(allow: &[&str]) -> ziee_core::ServerConfig {
        serde_json::from_value(serde_json::json!({
            "postgresql": { "use_embedded": false },
            "server": {
                "host": "127.0.0.1",
                "port": 8080,
                "api_prefix": "/api",
                "cors": {
                    "allow_origins": ["tauri://localhost"],
                    "allow_methods": ["GET", "PUT", "OPTIONS"],
                    "allow_headers": allow,
                },
            },
            "jwt": {
                "secret": "test-secret-not-used-by-the-cors-layer",
                "issuer": "ziee",
                "audience": "ziee-api",
                "access_token_expiry_hours": 1,
            },
        }))
        .expect("minimal ServerConfig fixture must deserialize")
    }

    async fn preflight_allow_headers(
        config: &ziee_core::ServerConfig,
        requested: &str,
    ) -> String {
        let app = Router::new()
            .route(
                "/api/chat/stream/subscription",
                put(|| async { axum::http::StatusCode::NO_CONTENT }),
            )
            .layer(create_cors_layer(config));
        let res = app
            .oneshot(
                Request::builder()
                    .method("OPTIONS")
                    .uri("/api/chat/stream/subscription")
                    .header("Origin", "tauri://localhost")
                    .header("Access-Control-Request-Method", "PUT")
                    .header("Access-Control-Request-Headers", requested)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .expect("preflight must produce a response");
        res.headers()
            .get("access-control-allow-headers")
            .and_then(|v| v.to_str().ok())
            .map(str::to_ascii_lowercase)
            .expect("an explicit allow-list must echo Access-Control-Allow-Headers")
    }

    /// TEST-1 — the acceptance test for INV-1.
    ///
    /// The config here lists ONLY `Authorization` + `Content-Type`, i.e. it
    /// "forgets" every custom header — which is the exact condition the design
    /// says must not matter. A test that listed them would prove nothing: it
    /// would pass with the union deleted.
    ///
    /// Compiling this at all also pins ITEM-9: `create_cors_layer` delegates to
    /// `ziee_framework::app_builder::create_cors_layer_with`, so the `sdk`
    /// gitlink must point at an sdk commit that has it.
    #[tokio::test]
    async fn a_config_that_forgets_a_required_header_still_allows_it() {
        let cfg = config_with(&["Authorization", "Content-Type"]);
        let allowed = preflight_allow_headers(
            &cfg,
            "authorization,content-type,x-chat-stream-connection-id",
        )
        .await;

        for required in REQUIRED_CUSTOM_REQUEST_HEADERS
            .iter()
            .chain(ziee_framework::app_builder::FRAMEWORK_REQUIRED_REQUEST_HEADERS)
        {
            assert!(
                allowed.contains(&required.to_ascii_lowercase()),
                "{required} is read by the API, so no config may be able to drop it \
                 from the preflight; got {allowed:?}"
            );
        }
        // The operator's own entries survive — the union adds, never replaces.
        assert!(allowed.contains("authorization"), "got {allowed:?}");
        assert!(allowed.contains("content-type"), "got {allowed:?}");
    }

    /// The list is assembled from the handlers' own constants, so a rename
    /// cannot leave the allowlist stale. Asserting the VALUES here would just
    /// re-spell them; asserting the SOURCE is what has content.
    #[test]
    fn the_required_list_is_sourced_from_the_handler_constants() {
        assert!(
            REQUIRED_CUSTOM_REQUEST_HEADERS
                .contains(&crate::modules::chat::stream::handler::CHAT_STREAM_CONNECTION_HEADER),
            "the chat-stream subscription header must come from the handler's constant"
        );
        assert!(
            REQUIRED_CUSTOM_REQUEST_HEADERS
                .contains(&ziee_auth::auth::cookie::REFRESH_COOKIE_OPTIN_HEADER),
            "the refresh-cookie opt-in header must come from ziee-auth's constant"
        );
    }

    /// TEST-4 — the shipped operator examples must not teach a broken config.
    ///
    /// After the union these lists are no longer load-bearing, so the only thing
    /// at stake is that an example a human copies documents the real surface.
    /// Parsed as real YAML rather than grepped, so a malformed example fails here
    /// too.
    #[test]
    fn the_shipped_example_configs_list_every_required_header() {
        #[derive(serde::Deserialize)]
        struct CorsOnly {
            server: ServerOnly,
        }
        #[derive(serde::Deserialize)]
        struct ServerOnly {
            cors: ziee_core::CorsConfig,
        }

        for example in ["dev.example.yaml", "prod.example.yaml"] {
            let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("config")
                .join(example);
            let raw = std::fs::read_to_string(&path)
                .unwrap_or_else(|e| panic!("{} must be readable: {e}", path.display()));
            let parsed: CorsOnly = serde_norway::from_str(&raw)
                .unwrap_or_else(|e| panic!("{example} must parse as config YAML: {e}"));

            for required in REQUIRED_CUSTOM_REQUEST_HEADERS
                .iter()
                .chain(ziee_framework::app_builder::FRAMEWORK_REQUIRED_REQUEST_HEADERS)
            {
                assert!(
                    parsed.server
                        .cors
                        .allow_headers
                        .iter()
                        .any(|h| h.eq_ignore_ascii_case(required)),
                    "{example} must list {required} in server.cors.allow_headers so a \
                     copied example documents the real surface; got {:?}",
                    parsed.server.cors.allow_headers
                );
            }
        }
    }
}
