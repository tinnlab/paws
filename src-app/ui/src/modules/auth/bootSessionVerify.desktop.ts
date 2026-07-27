/**
 * DELIBERATE DIVERGENCE from core's `bootSessionVerify`.
 *
 * On desktop the boot-time session verification must NOT happen. The
 * desktop-base module's `auto_login` retry loop is the single source of truth
 * for the token, and any token persisted from a previous launch is stale because
 * the desktop server regenerates its JWT secret per launch
 * (`desktop/tauri/src/modules/backend/mod.rs`). Calling `Auth.initAuth()` here
 * would 401 on that stale token, `endSession()`, and race the auto-login loop —
 * the same reason `AuthGuard.desktop.tsx` (reason 3) skips `initAuth()`.
 *
 * A no-op, not a runtime `AppMode.multiUserMode` branch: `desktop/ui/src/main.tsx`
 * flips that flag AFTER `loadDesktopModules()`, which can race a module's
 * `initialize()`. Resolving the divergence at build time (tier 2 of
 * `desktop/ui/plugins/vite-plugin-local-override.ts`) removes the code from the
 * desktop bundle entirely, so there is no window in which it could run.
 */
export function bootSessionVerify(): void {
  // intentionally empty — desktop auto-login owns the session
}
