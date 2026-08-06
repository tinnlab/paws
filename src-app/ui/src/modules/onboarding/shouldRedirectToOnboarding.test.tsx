import { describe, it, expect } from 'vitest'
import {
  shouldRedirectToOnboarding,
  type OnboardingRedirectInput,
} from '@/modules/onboarding/shouldRedirectToOnboarding'

/**
 * Locks down the onboarding auto-redirect, and in particular the ESCAPE case,
 * which shipped untested and produced a real lockout.
 *
 * The defect, as observed by the live exploration rig on 2026-08-01: the
 * explorer registered an ordinary NON-ADMIN account through the sign-up form,
 * landed on `/onboarding?id=getting-started`, and then could not leave it for
 * the rest of the run. 262 recorded bounces across 11 escape targets
 * (`/chat`, `/chats`, `/knowledge`, `/settings/profile`, …), including the
 * page's own "Back to Chat" button. Every navigation away was undone by
 * `OnboardingRedirect` on the next render.
 *
 * Two things combined to make it permanent:
 *   1. The redirect had no notion of "the user asked to leave", so the escape
 *      buttons the page RENDERS were no-ops.
 *   2. The guide could not be completed either — `applyMcpServerChanges`
 *      collects per-item failures and THROWS, and `handleGlobalNext` catches
 *      the throw and refuses to advance. A non-admin hits a 403 on the
 *      admin-only system-server toggle; any user hits it on a hub item whose
 *      version gate rejects the install (observed verbatim in the rig log:
 *      `Failed to apply MCP server changes: Install "app.linear/mcp": hub item
 *      requires ziee >= 99.0.0 but this server is 0.1.0`).
 *
 * The pre-existing suite asserted only that the redirect FIRES
 * (`tests/e2e/onboarding/guarded-route-redirect.spec.ts`) — a passing test
 * that certified half the behaviour and left the trap invisible. The negative
 * controls below are therefore as important as the positive one: they prove
 * this test would still fail if the redirect were simply deleted.
 */

const base: OnboardingRedirectInput = {
  isInitializing: false,
  isAuthenticated: true,
  hasUser: true,
  isAdmin: false,
  loaded: true,
  dismissed: false,
  pathname: '/chat',
  guideIds: ['getting-started'],
  completedGuideIds: [],
}

const input = (over: Partial<OnboardingRedirectInput> = {}) => ({
  ...base,
  ...over,
})

describe('shouldRedirectToOnboarding — the gate still works', () => {
  it('redirects a non-admin with an incomplete guide', () => {
    expect(shouldRedirectToOnboarding(input())).toBe('getting-started')
  })

  it('redirects on a guarded deep-link, not just on "/"', () => {
    expect(shouldRedirectToOnboarding(input({ pathname: '/settings/profile' })))
      .toBe('getting-started')
  })

  it('picks the FIRST incomplete guide, in registration order', () => {
    expect(
      shouldRedirectToOnboarding(
        input({
          guideIds: ['getting-started', 'advanced'],
          completedGuideIds: ['getting-started'],
        }),
      ),
    ).toBe('advanced')
  })

  it('stays put once every guide is complete', () => {
    expect(
      shouldRedirectToOnboarding(
        input({ completedGuideIds: ['getting-started'] }),
      ),
    ).toBeNull()
  })

  it('never force-onboards an admin', () => {
    expect(shouldRedirectToOnboarding(input({ isAdmin: true }))).toBeNull()
  })

  it('waits for auth to settle', () => {
    expect(
      shouldRedirectToOnboarding(input({ isInitializing: true })),
    ).toBeNull()
  })

  it('does nothing for an unauthenticated visitor', () => {
    expect(
      shouldRedirectToOnboarding(input({ isAuthenticated: false })),
    ).toBeNull()
    expect(shouldRedirectToOnboarding(input({ hasUser: false }))).toBeNull()
  })

  it('waits for the progress fetch, so a done user is not mis-redirected', () => {
    expect(shouldRedirectToOnboarding(input({ loaded: false }))).toBeNull()
  })

  it('does not fight a user already inside the wizard', () => {
    expect(
      shouldRedirectToOnboarding(
        input({ pathname: '/onboarding?id=getting-started' }),
      ),
    ).toBeNull()
  })
})

describe('shouldRedirectToOnboarding — the user can LEAVE (the lockout)', () => {
  it('honors an explicit dismissal instead of bouncing back', () => {
    // The exact rig scenario: non-admin, guide incomplete and uncompletable,
    // clicks "Back to Chat" → dismissed. Must NOT be dragged back.
    expect(shouldRedirectToOnboarding(input({ dismissed: true }))).toBeNull()
  })

  it('keeps honoring it across every route the rig tried to reach', () => {
    // One case per distinct forced-redirect finding recorded on 2026-08-01.
    const targets = [
      '/chat',
      '/chats',
      '/scheduled-tasks',
      '/settings/web-search-keys',
      '/settings/profile',
      '/settings/user-llm-providers',
      '/settings/users',
      '/settings/assistants',
      '/knowledge',
      '/hub/assistants',
      '/settings/literature-keys',
    ]
    for (const pathname of targets) {
      expect(
        shouldRedirectToOnboarding(input({ pathname, dismissed: true })),
        `dismissed user must be able to stay on ${pathname}`,
      ).toBeNull()
    }
  })

  it('dismissal does not leak into the gate for a fresh, non-dismissed user', () => {
    // Negative control: if `dismissed` were wired to suppress the redirect
    // unconditionally, this would return null and the gate would be gone.
    expect(shouldRedirectToOnboarding(input({ dismissed: false }))).toBe(
      'getting-started',
    )
  })

  it('an admin and a dismissed non-admin are skipped for DIFFERENT reasons', () => {
    // Negative control against collapsing the two exemptions: a non-admin who
    // has NOT dismissed is still redirected, proving the admin exemption is
    // not silently covering this case.
    expect(shouldRedirectToOnboarding(input({ isAdmin: false }))).toBe(
      'getting-started',
    )
    expect(
      shouldRedirectToOnboarding(input({ isAdmin: false, dismissed: true })),
    ).toBeNull()
  })
})
