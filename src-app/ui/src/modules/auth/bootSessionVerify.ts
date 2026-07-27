import { Auth } from '@/modules/auth/Auth.store'

/**
 * Kick the session verification (`GET /api/auth/me`) at module-INITIALIZE time
 * rather than waiting for `AuthGuard`'s mount effect.
 *
 * WHY: `AuthGuard` is inside the router tree, so its effect cannot run until the
 * router + guard chunks have downloaded and committed. Measured on a cold
 * authenticated load, that put `/api/auth/me` ~300 ms after
 * `/api/app/setup/status` — and because `AuthGuard` renders a full-screen
 * spinner while `isInitializing`, NOTHING else in the app mounted (and therefore
 * nothing else fetched) until it resolved. `/auth/me` was the head of the boot
 * waterfall purely because of WHERE it was issued, not because anything it needs
 * was unavailable earlier: the token is in `localStorage` before React exists.
 *
 * Issuing it from `initialize()` makes it overlap `/api/app/setup/status` and
 * `/api/onboarding/progress` instead of following them.
 *
 * `AuthGuard` KEEPS its call — this is an earlier start, not a relocation.
 * `initAuth()` is self-guarded (`if (state.isLoading) return`), so the guard's
 * call collapses into this one on a cold boot and still covers the paths that
 * reach the guard without a boot (an in-session user switch, a desktop bundle,
 * a remount after logout).
 *
 * DESKTOP: this file has a `.desktop.ts` NO-OP twin. Desktop's auto-login loop
 * is the sole owner of the token — a token persisted from a previous launch is
 * stale by construction because the desktop server regenerates its JWT secret
 * per launch — so verifying it here would `endSession()` and fight auto-login
 * (see `AuthGuard.desktop.tsx`, reason 3). The divergence is structural (the
 * desktop bundle never contains this body) rather than a runtime flag check,
 * because `AppMode.setMultiUserMode(false)` is applied in desktop `main.tsx`
 * AFTER module loading and can race a module `initialize()`.
 */
export function bootSessionVerify(): void {
  void Auth.initAuth()
}
