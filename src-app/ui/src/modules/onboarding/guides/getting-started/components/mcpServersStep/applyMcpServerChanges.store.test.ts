/**
 * A failed OPTIONAL install must not make onboarding uncompletable.
 *
 * The action used to throw when any per-item install/toggle failed. Its caller
 * (`OnboardingPage.handleGlobalNext`) awaits it before `completeStep` and
 * `completeGuide`, so the throw meant neither ever ran: the guide could not be
 * finished. Paired with the redirect that returned a non-admin to /onboarding on
 * every navigation, the account was trapped — cannot finish, cannot leave. The
 * live UI audit hit exactly this, 262 times, on a hub item declaring
 * `requires ziee >= 99.0.0`.
 *
 * These tests pin the contract that matters: failures are REPORTED, not thrown.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const createMcpServerFromHub = vi.fn()
const systemUpdate = vi.fn()
const serverUpdate = vi.fn()

vi.mock('@/api-client', () => ({
  ApiClient: {
    Hub: { createMcpServerFromHub: (...a: unknown[]) => createMcpServerFromHub(...a) },
    McpServerSystem: { update: (...a: unknown[]) => systemUpdate(...a) },
    McpServer: { update: (...a: unknown[]) => serverUpdate(...a) },
  },
}))
vi.mock('@/api-client/permissions', () => ({ Permissions: { McpServersAdminEdit: 'mcp' } }))
vi.mock('@/core/permissions', () => ({ hasPermissionNow: () => true }))

import applyMcpServerChanges from './actions/applyMcpServerChanges'

/** Minimal store harness: the action is `(set, get) => async () => …`. */
function harness(overrides: Record<string, unknown> = {}) {
  let state: Record<string, unknown> = {
    selectedMcpServerIds: [],
    disabledSystemIds: new Set(),
    originalDisabledSystemIds: new Set(),
    systemServers: [],
    installedNames: new Set(),
    applyErrors: [],
    ...overrides,
  }
  const set = (next: unknown) => {
    state = typeof next === 'function'
      ? (() => { const draft = { ...state }; (next as (d: typeof draft) => void)(draft); return draft })()
      : { ...state, ...(next as Record<string, unknown>) }
  }
  const get = () => state as never
  return { run: applyMcpServerChanges(set as never, get), state: () => state }
}

beforeEach(() => {
  createMcpServerFromHub.mockReset()
  systemUpdate.mockReset()
  serverUpdate.mockReset()
})

describe('a failed optional install does not block onboarding', () => {
  it('does NOT throw when a hub install fails', async () => {
    createMcpServerFromHub.mockRejectedValue(
      new Error("hub item 'app.linear/mcp' requires ziee >= 99.0.0 but this server is 0.1.0"),
    )
    const h = harness({ selectedMcpServerIds: ['app.linear/mcp'] })
    // The assertion that matters: the caller must be able to proceed to
    // completeStep/completeGuide. A rejection here is the whole defect.
    await expect(h.run()).resolves.toBeUndefined()
  })

  it('reports the failure instead, so the user is not left guessing', async () => {
    createMcpServerFromHub.mockRejectedValue(new Error('requires ziee >= 99.0.0'))
    const h = harness({ selectedMcpServerIds: ['app.linear/mcp'] })
    await h.run()
    const errs = h.state().applyErrors as string[]
    expect(errs).toHaveLength(1)
    expect(errs[0]).toContain('app.linear/mcp')
    expect(errs[0]).toContain('99.0.0')
  })

  it('does not throw when a system-server toggle fails', async () => {
    systemUpdate.mockRejectedValue(new Error('403 Forbidden'))
    const h = harness({
      systemServers: [{ id: 's1', name: 'files', display_name: 'Files' }],
      disabledSystemIds: new Set(['s1']),
      originalDisabledSystemIds: new Set(),
    })
    await expect(h.run()).resolves.toBeUndefined()
    expect((h.state().applyErrors as string[])[0]).toContain('Files')
  })

  it('keeps going past one failure and still applies the rest', async () => {
    createMcpServerFromHub
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({})
    const h = harness({ selectedMcpServerIds: ['bad', 'good'] })
    await h.run()
    expect(createMcpServerFromHub).toHaveBeenCalledTimes(2)
    expect(h.state().applyErrors as string[]).toHaveLength(1)
    expect((h.state().installedNames as Set<string>).has('good')).toBe(true)
  })

  it('clears stale failures on a retry, so a fixed problem stops being reported', async () => {
    createMcpServerFromHub.mockResolvedValue({})
    const h = harness({ selectedMcpServerIds: ['ok'], applyErrors: ['a previous failure'] })
    await h.run()
    expect(h.state().applyErrors).toEqual([])
  })

  it('still succeeds silently when everything works', async () => {
    createMcpServerFromHub.mockResolvedValue({})
    const h = harness({ selectedMcpServerIds: ['ok'] })
    await expect(h.run()).resolves.toBeUndefined()
    expect(h.state().applyErrors).toEqual([])
  })
})
