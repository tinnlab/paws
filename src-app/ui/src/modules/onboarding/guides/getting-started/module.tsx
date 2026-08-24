import { createModule } from '@ziee/framework'
import { lazy } from 'react'
import './types'

export default createModule({
  metadata: {
    name: 'guide-getting-started',
    version: '1.0.0',
    description: 'Getting Started guide',
  },
  // smart-loading gate (build-lifted into the manifest)
  shouldLoad: (ctx) => ctx.isAuthenticated,
  dependencies: ['onboarding'],
  stores: [
  ],
  slots: {
    onboarding: [
      {
        id: 'getting-started',
        title: 'Getting Started',
        description: 'Set up your AI providers and MCP servers to get started.',
        order: 1,
        steps: [
          { id: 'welcome',       title: 'Welcome',      component: lazy(() => import('./components/WelcomeStep')) },
          { id: 'api-keys',      title: 'AI Providers', component: lazy(() => import('./components/ApiKeysStep')) },
          // Directly after `api-keys` on purpose: a user who has just supplied a
          // key should meet the no-key local option immediately, and be free to
          // skip it. Skipping is always allowed (INV-3) — hence no
          // `skippable: false`, which is what would gate Next.
          { id: 'default-model', title: 'Local Model',  component: lazy(() => import('./components/DefaultModelStep')) },
          { id: 'mcp-servers',   title: 'MCP Servers',  component: lazy(() => import('./components/McpServersStep')) },
          { id: 'memory-setup',  title: 'Memory',       component: lazy(() => import('./components/MemorySetupStep')) },
          { id: 'finish',        title: 'Finish',       component: lazy(() => import('./components/FinishStep')) },
        ],
      },
    ],
  },
})
