import type { OnboardingGet, OnboardingSet } from '../state'

/**
 * The user explicitly chose to leave the wizard. Suppresses the auto-redirect
 * for the rest of the session (re-armed on a user switch by the store's
 * `init` watcher), so `OnboardingRedirect` stops undoing the navigation the
 * escape buttons perform.
 */
export default (set: OnboardingSet, _get: OnboardingGet) =>
  async () => {
    set(draft => {
      draft.dismissed = true
    })
  }
