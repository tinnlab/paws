use aide::axum::{ApiRouter, routing::get_with};

use super::handlers::*;

/// Hardware module routes
pub fn hardware_router() -> ApiRouter {
    ApiRouter::new()
        .api_route(
            "/hardware",
            get_with(get_hardware_info, get_hardware_info_docs),
        )
        .api_route(
            "/hardware/usage-stream",
            get_with(subscribe_hardware_usage, subscribe_hardware_usage_docs),
        )
    // NOTE: there is deliberately no `/hardware/types` route. It used to exist
    // purely as an OpenAPI type-generation anchor for `HardwareUsageUpdate`, but
    // being a registered route it was also *reachable* — ungated — and returned a
    // live host-telemetry snapshot (CPU load/frequency, RAM, swap) to any
    // unauthenticated caller. The anchor was redundant: `HardwareUsageUpdate` is
    // already pulled into the spec transitively via `SSEHardwareUsageEvent`
    // (`Update(HardwareUsageUpdate)`), which is the documented 200 response of
    // the `hardware::monitor`-gated `/hardware/usage-stream` above. A schema
    // anchor must never be a live data route — if you need a new type in the
    // spec, reference it from a real, permission-gated endpoint's response.
}
