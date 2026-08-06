/**
 * OnboardingRedirect — owned by the onboarding module.
 *
 * Effect-only component. Mounted inside <BrowserRouter> via the
 * `routerEffects` slot so it can use `useNavigate`/`useLocation`,
 * but renders nothing. Subscribes to auth + completion state and
 * navigates to the first incomplete guide when appropriate.
 *
 * Skip conditions (no redirect):
 *   - User not yet authenticated (auth still bootstrapping).
 *   - User is an admin. Admins drive the app — on the desktop shell
 *     they configured providers via Settings directly, and the
 *     phone-over-tunnel surface logs in as that same admin. Forcing
 *     them through `/onboarding` would trap the phone session in a
 *     loop they can't escape (no way to mark guides "done" from
 *     the limited remote surface). Admins can still navigate to
 *     `/onboarding` manually from the sidebar.
 *   - User explicitly left the wizard ("Back to Chat" / "Go to Chat").
 *     The SAME trap the admin exemption above describes applies to a
 *     non-admin whose guide cannot be completed, and the exemption did
 *     not cover them: the page renders escape buttons, and this effect
 *     used to undo them on the next render.
 *   - User already on `/onboarding` (don't fight the user).
 *   - User has completed every registered guide.
 *
 * Auth knows nothing about this. Router knows nothing about this.
 * All onboarding-specific logic stays inside the onboarding module.
 */

import { useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import type { OnboardingSlot } from './types/OnboardingSlot'
import { shouldRedirectToOnboarding } from './shouldRedirectToOnboarding'
import { Onboarding } from '@/modules/onboarding/stores/onboarding'
import { Auth as AuthStore } from '@/modules/auth/Auth.store'
import { ModuleSystem } from '@ziee/framework/stores'

export function OnboardingRedirect() {
  const { isAuthenticated, user, isInitializing } = AuthStore
  const { completedGuideIds, loaded, dismissed } = Onboarding
  const guides = (ModuleSystem.slots.get('onboarding') as
    | OnboardingSlot[]
    | undefined) ?? []
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    // Match AuthGuard's loading gate: don't redirect while auth is still
    // initializing (e.g. AuthGuard remounts after login form navigation
    // and calls initAuth() which sets isInitializing=true). OnboardingRedirect
    // is rendered OUTSIDE AuthGuard (as a routerEffect sibling of <Routes>),
    // so it must independently respect this guard.
    // The decision itself lives in `shouldRedirectToOnboarding` so it can be
    // asserted without a mounted router — including the escape case, which
    // had no test and was the reason a non-admin could be locked in here.
    // Note `loaded` gates the fetch race: without it a fully-onboarded user
    // would briefly look "incomplete" on first paint and get mis-redirected.
    const target = shouldRedirectToOnboarding({
      isInitializing,
      isAuthenticated,
      hasUser: !!user,
      isAdmin: user?.is_admin === true,
      loaded,
      dismissed,
      pathname: location.pathname,
      guideIds: guides.map(g => g.id),
      completedGuideIds,
    })
    if (target) {
      navigate(`/onboarding?id=${target}`, { replace: true })
    }
  }, [isAuthenticated, user, isInitializing, completedGuideIds, loaded, dismissed, guides, location.pathname, navigate])

  return null
}
