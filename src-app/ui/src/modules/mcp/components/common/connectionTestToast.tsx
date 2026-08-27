import type { TestMcpConnectionResponse } from '@/api-client/types'

// Minimal structural shape so any toast API (kit `message` or a legacy antd
// MessageInstance from a not-yet-migrated caller) satisfies it.
type MessageApi = {
  success: (content: string) => unknown
  error: (content: string) => unknown
  info: (content: string) => unknown
}

// Backend connection errors can be long (timeout details, a 401 body, a
// command-not-found dump). The kit toast renders the message as plain text and
// wraps long content itself, so we pass the raw string through.

/**
 * Show a connection-test result as a toast.
 *
 * `notTestable` is NOT a failure: Test Connection probes on the host and
 * cannot reach a sandboxed server at all, so the backend answers
 * `success: false` with an explanation and records the row `untested` rather
 * than `unhealthy`. An error toast there would contradict the message it is
 * carrying, whose own text says the server is fine. Callers pass the row's
 * `run_in_sandbox`.
 */
export const showConnectionTestResult = (
  message: MessageApi,
  result: TestMcpConnectionResponse,
  notTestable = false,
) => {
  if (result.success) {
    message.success(result.message || 'Connection successful')
  } else if (notTestable) {
    message.info(result.message || 'Connection could not be tested')
  } else {
    message.error(result.message || 'Connection failed')
  }
}

/** Show a thrown error (network/unexpected) as an error toast. */
export const showConnectionTestError = (message: MessageApi, error: unknown) => {
  message.error(error instanceof Error ? error.message : 'Connection test failed')
}
