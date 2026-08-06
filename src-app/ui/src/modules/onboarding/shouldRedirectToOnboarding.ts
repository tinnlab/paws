/**
 * The onboarding auto-redirect DECISION, extracted from `OnboardingRedirect`
 * so it can be asserted directly instead of only through a mounted router.
 *
 * It exists because the escape case had no test. `OnboardingRedirect` renders
 * nothing and fires inside a `useEffect`, so the only thing the suite ever
 * checked was that the redirect FIRES (`guarded-route-redirect.spec.ts`).
 * Nothing checked that a user can ever LEAVE — and they could not: the page
 * renders "Back to Chat" / "Go to Chat" buttons that navigate to `/chat`, and
 * this effect navigated them straight back on the very next render. A
 * non-admin whose guide cannot be completed (a step's `beforeNext` throwing —
 * a 403 on an admin-only MCP toggle, or a hub item whose version gate rejects
 * the install) was therefore locked on `/onboarding` permanently.
 *
 * Keep every skip condition here, and keep them ORDERED cheapest-first; the
 * component must contain no decision logic of its own.
 */

export interface OnboardingRedirectInput {
  /** Auth is still bootstrapping — decide nothing yet. */
  isInitializing: boolean
  isAuthenticated: boolean
  /** False when there is no resolved user object. */
  hasUser: boolean
  /** Admins drive the app and are never force-onboarded. */
  isAdmin: boolean
  /** The onboarding store has fetched progress at least once. */
  loaded: boolean
  /** The user explicitly asked to leave the wizard this session. */
  dismissed: boolean
  /** Current router pathname. */
  pathname: string
  /** Registered guide ids, in display order. */
  guideIds: string[]
  /** Guide ids this user has completed. */
  completedGuideIds: string[]
}

/**
 * Returns the guide id to redirect to, or `null` to stay put.
 */
export function shouldRedirectToOnboarding(
  input: OnboardingRedirectInput,
): string | null {
  const {
    isInitializing,
    isAuthenticated,
    hasUser,
    isAdmin,
    loaded,
    dismissed,
    pathname,
    guideIds,
    completedGuideIds,
  } = input

  if (isInitializing) return null
  if (!isAuthenticated || !hasUser) return null
  if (isAdmin) return null
  if (!loaded) return null
  // An explicit "leave" outranks an incomplete guide. This is the condition
  // that makes the rendered escape buttons real.
  if (dismissed) return null
  // Don't fight a user who is already in the wizard.
  if (pathname.startsWith('/onboarding')) return null

  const firstIncomplete = guideIds.find(id => !completedGuideIds.includes(id))
  return firstIncomplete ?? null
}
