import { useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { AuthPage } from '@/modules/auth/AuthPage'
import { Loading } from '@/core/components/Loading'
import { App } from '@/modules/app/stores/app'
import { AppMode } from '@/modules/app/AppMode.store'
import { Auth } from '@/modules/auth/Auth.store'

interface AuthGuardProps {
  children: React.ReactNode
}

export const AuthGuard: React.FC<AuthGuardProps> = ({ children }) => {
  const { isAuthenticated, isInitializing } = Auth
  const { needsSetup } = App
  const { multiUserMode } = AppMode
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    // Desktop (single-admin) skips initAuth: the desktop-base module's
    // auto-login retry loop is the single source of truth for the token.
    // Any persisted token from a previous launch is stale because the
    // desktop server regenerates its JWT secret per launch.
    if (multiUserMode) {
      Auth.initAuth()
    }
  }, [multiUserMode])

  useEffect(() => {
    // Desktop never redirects to /setup; setup is handled before webview creation.
    if (!multiUserMode) return
    if (needsSetup === true && location.pathname !== '/setup') {
      navigate('/setup', { replace: true })
    }
  }, [needsSetup, navigate, location.pathname, multiUserMode])

  // Desktop: show loading spinner while auto-login is in progress;
  // never render the multi-user AuthPage (desktop users don't know
  // the hardcoded password).
  if (!multiUserMode) {
    if (!isAuthenticated) {
      return <Loading fullscreen />
    }
    return <>{children}</>
  }

  // Show loading spinner while checking auth status
  if (isInitializing || needsSetup === null) {
    return <Loading fullscreen />
  }

  // Redirect to setup if needed. The navigate() lives in the effect above —
  // calling it HERE (during render) enqueues a Router state update while
  // AuthGuard is rendering, which React 19 flags as "Cannot update a component
  // (`Router`) while rendering a different component (`AuthGuard`)". Render the
  // pending spinner instead; the `needsSetup === true` effect performs the
  // redirect right after commit.
  if (needsSetup) {
    return <Loading fullscreen />
  }

  // Show authentication page if not authenticated
  if (!isAuthenticated) {
    return <AuthPage />
  }

  // Show the protected content. Post-auth redirects (onboarding,
  // etc.) are owned by the contributing module — see the
  // `routerEffects` slot consumed by RouterComponent.
  return <>{children}</>
}
