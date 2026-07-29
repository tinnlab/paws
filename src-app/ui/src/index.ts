/**
 * Core UI Library Entry Point
 *
 * Exports all public API for use as a library
 */

// Main App component
export { default as App } from './App'

// Core utilities and stores
export * from '@ziee/framework'

// Module system. Use the `@/`-aliased specifier (NOT a relative `./modules/loader`)
// so the desktop build's localOverridePlugin can swap in `loader.desktop.ts` — the
// relative path bypasses that override and drags the web `loader.ts` (which imports
// `virtual:ziee-module-manifest`, a plugin the desktop build doesn't run) into the
// desktop bundle, failing the desktop prod build. Resolves to the same `loader.ts`
// in the web build.
export { loadModules } from '@/modules/loader'
export { createModule } from '@ziee/framework/module'

// Auth guard for protected routes
export { AuthGuard } from './modules/auth'

// API Client
export * from './api-client'

// Re-export types for consumers
export type { AppModule } from '@ziee/framework/module-system/types'
