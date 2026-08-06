/**
 * How a save derives `disabled_servers` when a server's tool list is UNKNOWN.
 *
 * The disabled set is computed by subtracting the user's selection from the
 * server's full tool list. When `tools/list` fails (an unreachable MCP server
 * answers 502 — a common, transient condition), the modal has no list to
 * subtract from. Coercing that to `[]` yielded an EMPTY disabled set, which the
 * backend stores as "nothing is disabled" — silently re-enabling every tool the
 * user had turned off, on a save the user never asked for (closing the modal
 * auto-saves).
 *
 * The distinction that has to hold: absent-from-map ("never learned") is NOT
 * the same as present-but-empty ("this server genuinely has no tools").
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const updateMcpSettings = vi.hoisted(() => vi.fn())
const updateProjectMcpSettings = vi.hoisted(() => vi.fn())

vi.mock('@/api-client', () => ({
  ApiClient: {
    Conversation: { updateMcpSettings },
    Project: { updateMcpSettings: updateProjectMcpSettings },
  },
}))
vi.mock('@ziee/framework/stores', () => ({
  EventBus: { emit: async () => undefined },
}))

import saveConversationConfigFactory from './actions/saveConversationConfig'
import saveProjectConfigFactory from './actions/saveProjectConfig'
import { projectConfigKey } from './state'

const CONV = 'conv-1'
const SERVER = 'srv-1'

type Cfg = {
  selectedServers: Map<string, { server_id: string; tools: string[] }>
  disabledServers: { server_id: string; tools: string[] }[]
  approvalMode?: string
  autoApprovedTools?: string[]
  loopSettings?: unknown
}

/** Store harness: one conversation config, keyed however the action expects. */
function harness(key: string, config: Cfg) {
  const configs = new Map<string, Cfg>([[key, config]])
  const state = { conversationConfigs: configs, serverDefaultApprovalMode: 'manual_approve' }
  const get = () => state as never
  const set = ((recipe: (s: typeof state) => void) => recipe(state)) as never
  return { get, set }
}

/** A user who enabled ONE of the server's two tools — so `search` is disabled. */
const PARTIAL_SELECTION: Cfg = {
  selectedServers: new Map([[SERVER, { server_id: SERVER, tools: ['read'] }]]),
  disabledServers: [{ server_id: SERVER, tools: ['search'] }],
  approvalMode: 'manual_approve',
  autoApprovedTools: [],
}

function freshConfig(): Cfg {
  return {
    ...PARTIAL_SELECTION,
    selectedServers: new Map(PARTIAL_SELECTION.selectedServers),
    disabledServers: PARTIAL_SELECTION.disabledServers.map(d => ({ ...d })),
  }
}

beforeEach(() => {
  updateMcpSettings.mockReset()
  updateProjectMcpSettings.mockReset()
})

describe('saveConversationConfig disabled-tool derivation', () => {
  it('preserves the saved disabled tools when the server tool list was never fetched', async () => {
    const { get, set } = harness(CONV, freshConfig())
    // The 502 case: the modal holds no entry for this server at all.
    await saveConversationConfigFactory(set, get)(CONV, [SERVER], new Map())

    const sent = updateMcpSettings.mock.calls[0][0]
    expect(sent.disabled_servers).toEqual([{ server_id: SERVER, tools: ['search'] }])
  })

  it('recomputes from a fetched tool list (positive control)', async () => {
    const { get, set } = harness(CONV, freshConfig())
    await saveConversationConfigFactory(set, get)(
      CONV,
      [SERVER],
      new Map([[SERVER, ['read', 'search', 'write']]]),
    )

    const sent = updateMcpSettings.mock.calls[0][0]
    // Selection is ['read'], so the newly-learned `write` is disabled too —
    // proving the fetched path still derives rather than echoing the old value.
    expect(sent.disabled_servers).toHaveLength(1)
    expect(sent.disabled_servers[0].server_id).toBe(SERVER)
    expect([...sent.disabled_servers[0].tools].sort()).toEqual(['search', 'write'])
  })

  it('does NOT resurrect a stale entry when the server truly reports no tools', async () => {
    // Negative control: `[]` present in the map is a real answer ("this server
    // has no tools"), so nothing is disabled. If the fix had keyed off
    // falsiness instead of `undefined`, this would wrongly keep ['search'].
    const { get, set } = harness(CONV, freshConfig())
    await saveConversationConfigFactory(set, get)(CONV, [SERVER], new Map([[SERVER, []]]))

    const sent = updateMcpSettings.mock.calls[0][0]
    expect(sent.disabled_servers).toEqual([])
  })
})

describe('saveProjectConfig disabled-tool derivation', () => {
  it('preserves the saved disabled tools when the server tool list was never fetched', async () => {
    const key = projectConfigKey('proj-1')
    const { get, set } = harness(key, freshConfig())
    await saveProjectConfigFactory(set, get)('proj-1', [SERVER], new Map())

    const sent = updateProjectMcpSettings.mock.calls[0][0]
    expect(sent.disabled_servers).toEqual([{ server_id: SERVER, tools: ['search'] }])
  })

  it('does NOT resurrect a stale entry when the server truly reports no tools', async () => {
    const key = projectConfigKey('proj-1')
    const { get, set } = harness(key, freshConfig())
    await saveProjectConfigFactory(set, get)('proj-1', [SERVER], new Map([[SERVER, []]]))

    const sent = updateProjectMcpSettings.mock.calls[0][0]
    expect(sent.disabled_servers).toEqual([])
  })
})
