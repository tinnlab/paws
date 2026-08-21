import type { StoreProxy } from '@ziee/framework/stores'
import type { useApiKeysStepStore } from './components/stores/apiKeysStep'
import type { useMcpServersStepStore } from './components/stores/mcpServersStep'
import type { useMemorySetupStepStore } from './components/stores/memorySetupStep'

declare module '@ziee/framework/stores' {
  interface RegisteredStores {
    ApiKeysStep: StoreProxy<ReturnType<typeof useApiKeysStepStore.getState>>
    McpServersStep: StoreProxy<ReturnType<typeof useMcpServersStepStore.getState>>
    MemorySetupStep: StoreProxy<ReturnType<typeof useMemorySetupStepStore.getState>>
  }
}

export {}
