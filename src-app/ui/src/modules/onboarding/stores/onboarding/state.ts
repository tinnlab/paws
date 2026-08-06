import type { StoreSet } from '@ziee/framework/store-kit'

export const onboardingState = {
  // Wizard UI state
  nextEnabled: true,
  nextLoading: false,
  nextError: null as string | null,
  // Per-user progress (owned here, not on Auth.user). `loaded` gates
  // the redirect so it can't mis-fire before the first fetch.
  completedGuideIds: [] as string[],
  completedStepIds: [] as string[],
  loading: false,
  loaded: false,
  // The user explicitly asked to leave the wizard ("Back to Chat" / "Go to
  // Chat"). Suppresses the auto-redirect for the rest of the session so the
  // escape affordance the page RENDERS is one the redirect actually honors.
  // Without it a non-admin whose guide cannot be completed (a step's
  // beforeNext throwing — a 403 on an admin-only toggle, or an incompatible
  // hub item) is trapped on /onboarding with no way out. Re-armed on a user
  // switch (see index.ts) so a genuinely new user is still onboarded.
  dismissed: false,
}

export type OnboardingState = typeof onboardingState
export type OnboardingSet = StoreSet<OnboardingState>
export type OnboardingGet = () => OnboardingState
