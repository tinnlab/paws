//! web_search extension registration for the chat module.

use linkme::distributed_slice;
use sqlx::PgPool;
use std::sync::Arc;

use crate::modules::chat::core::extension::{
    CHAT_EXTENSIONS, ChatExtension, ExtensionEntry, ExtensionMetadata,
};

pub const METADATA: ExtensionMetadata = ExtensionMetadata {
    name: "web_search",
    // MUST run BEFORE the MCP extension (order 30): `before_llm_call` sets the
    // `attach_web_search_mcp` metadata flag, which the MCP extension reads in
    // `auto_attach_builtin_ids` when building the tool list. 26 lands it after
    // assistant (10) / file (20) / memory (25), before MCP (30). If it ran at
    // ≥30 the flag would be set after MCP already built its tools and the
    // web_search tools would never attach.
    order: 26,
};

pub fn create(pool: PgPool, config: Arc<crate::core::config::Config>) -> Arc<dyn ChatExtension> {
    // Deploy-level kill switch, mirroring `lit_search` / `bio_mcp` / `js_tool`.
    //
    // This factory previously DISCARDED the config, and `should_attach` consults
    // only DB rows — so with `web_search: { enabled: false }` the module's
    // `init()` skipped its MCP row upsert but a row left over from a boot when
    // the feature WAS enabled still satisfied the attach gate, and the model was
    // still offered the web_search tools. The kill switch therefore did not
    // actually make the capability unreachable. `lit_search` guards exactly this
    // case and says so in its own comment; web_search was the odd one out.
    let config_enabled = config.web_search_enabled();
    Arc::new(super::web_search::WebSearchExtension::new(
        pool,
        config_enabled,
    ))
}

#[distributed_slice(CHAT_EXTENSIONS)]
static WEB_SEARCH_EXTENSION: ExtensionEntry = ExtensionEntry {
    name: METADATA.name,
    order: METADATA.order,
    factory: create,
};
