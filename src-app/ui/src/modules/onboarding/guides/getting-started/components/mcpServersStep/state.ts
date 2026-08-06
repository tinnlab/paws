import type { StoreSet } from '@ziee/framework/store-kit'
import type { HubMCPServer, McpServer } from '@/api-client/types'

export const mcpServersStepState = {
  selectedMcpServerIds: [] as string[],
  systemServers: [] as McpServer[],
  hubServers: [] as HubMCPServer[],
  installedNames: new Set<string>(),
  /** IDs of system servers the user wants DISABLED */
  disabledSystemIds: new Set<string>(),
  /** Snapshot of disabledSystemIds at load — used to compute the diff on apply */
  originalDisabledSystemIds: new Set<string>(),
  loadingServers: false,
  serversError: null as string | null,
  /**
   * Per-item failures from the last apply. NOT a blocking error.
   *
   * Installing an optional MCP server is a convenience, not a precondition for
   * having onboarded. This used to be thrown, which meant one unavailable hub
   * item — e.g. one declaring `requires ziee >= 99.0.0` — aborted the step's
   * before-next handler, so `completeStep`/`completeGuide` never ran and the
   * guide could never be finished. Combined with the redirect that returned a
   * non-admin to /onboarding on every navigation, that was an inescapable trap.
   * Recording the failures and letting the user continue keeps them informed
   * without holding the whole account hostage to an optional install.
   */
  applyErrors: [] as string[],
}

export type McpServersStepState = typeof mcpServersStepState
export type McpServersStepSet = StoreSet<McpServersStepState>
export type McpServersStepGet = () => McpServersStepState
