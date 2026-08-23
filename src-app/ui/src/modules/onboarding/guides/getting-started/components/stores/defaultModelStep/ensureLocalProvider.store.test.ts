/**
 * TEST-11 (default-model-onboarding) — the local-provider readiness leg.
 *
 * Two things must be true before a downloaded model is any use, and only the
 * first is obvious:
 *
 *  1. The provider must be ENABLED — a fresh install ships the built-in `Local`
 *     provider disabled and `list_local_providers` filters on `enabled`, so
 *     there is otherwise nothing to download into.
 *  2. The provider must be ASSIGNED TO A GROUP the user is in — `get_for_user`
 *     (the model picker's source) INNER JOINs `user_group_llm_providers`, and
 *     every chat send re-checks `user_has_access_to_provider` and answers 403
 *     without it, with no admin bypass. Nothing seeds such a row. An enabled
 *     provider holding a downloaded model is still INVISIBLE without it, and
 *     fixing that by hand means visiting a settings page — which INV-2 forbids.
 *
 * The subtle failure is the third case: `updateLlmProvider` early-returns
 * `null as any` when its own `updating` flag is set, so an install that trusted
 * its return value would abort a perfectly good install on a benign race.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Provider = {
  id: string
  provider_type: string
  enabled: boolean
  built_in?: boolean
}
type Group = { id: string; name: string; is_active: boolean; is_default: boolean }

const state = vi.hoisted(() => ({
  providers: [] as Provider[],
  /** What `updateLlmProvider` resolves to — `null` reproduces the concurrent-update race. */
  updateResult: {} as unknown,
  canEditProviders: true,
  canAssignGroups: true,
  /** Groups the provider is ALREADY assigned to. */
  assignedGroups: [] as Group[],
  allGroups: [] as Group[],
}))

const loadLlmProviders = vi.hoisted(() => vi.fn(async (_force?: boolean) => undefined))
const updateLlmProvider = vi.hoisted(() =>
  vi.fn(async (_id: string, _data: { enabled?: boolean }) => state.updateResult),
)
const assignGroupToProvider = vi.hoisted(() =>
  vi.fn(async (_providerId: string, _groupId: string) => undefined),
)
const getGroups = vi.hoisted(() => vi.fn(async () => state.assignedGroups))
const listGroups = vi.hoisted(() => vi.fn(async () => ({ groups: state.allGroups })))

vi.mock('@/modules/llm-provider/stores/llmProvider', () => ({
  LlmProvider: {
    loadLlmProviders,
    updateLlmProvider,
    assignGroupToProvider,
    get $() {
      return { providers: state.providers }
    },
  },
}))

vi.mock('@/api-client', () => ({
  ApiClient: {
    LlmProvider: { getGroups },
    UserGroup: { list: listGroups },
  },
}))

vi.mock('@/core/permissions', () => ({
  hasPermissionNow: (perm: string) =>
    perm === 'llm_providers::assign_groups'
      ? state.canAssignGroups
      : state.canEditProviders,
}))

// `getGroups` is reset per test so a `mockRejectedValueOnce` cannot leak.
const resetGetGroups = () => {
  getGroups.mockReset()
  getGroups.mockImplementation(async () => state.assignedGroups)
}

// The action writes no state of its own; these stand in for the store's
// `set`/`get` so the factory can be exercised without booting a store.
const noopSet = (() => undefined) as never
const noopGet = (() => ({})) as never

async function run() {
  const factory = (await import('./actions/ensureLocalProvider.ts')).default
  return factory(noopSet, noopGet)()
}

const USERS_GROUP: Group = {
  id: 'group-users',
  name: 'Users',
  is_active: true,
  is_default: true,
}

beforeEach(() => {
  state.providers = []
  state.updateResult = {}
  state.canEditProviders = true
  state.canAssignGroups = true
  state.assignedGroups = []
  state.allGroups = [USERS_GROUP]
  loadLlmProviders.mockClear()
  assignGroupToProvider.mockClear()
  listGroups.mockClear()
  resetGetGroups()
  // `mockReset`, not `mockClear`: a per-test `mockImplementation` survives
  // `mockClear`, so an earlier case's "flip enabled on update" would leak into
  // the case that asserts what happens when the enable does NOT take effect.
  updateLlmProvider.mockReset()
  updateLlmProvider.mockImplementation(async () => state.updateResult)
  vi.resetModules()
})

/** Make `updateLlmProvider` behave like the server flipping the row. */
function enableOnUpdate(result: unknown = {}) {
  updateLlmProvider.mockImplementation(async (id: string) => {
    state.providers = state.providers.map(p =>
      p.id === id ? { ...p, enabled: true } : p,
    )
    return result
  })
}

describe('ensureLocalProvider', () => {
  it('enables a DISABLED built-in local provider and shares it with a group', async () => {
    state.providers = [{ id: 'local-1', provider_type: 'local', enabled: false }]
    enableOnUpdate()

    await expect(run()).resolves.toEqual({ providerId: 'local-1', problem: null })
    expect(updateLlmProvider).toHaveBeenCalledWith('local-1', { enabled: true })
    expect(assignGroupToProvider).toHaveBeenCalledWith('local-1', 'group-users')
  })

  it('leaves an EXISTING group arrangement alone', async () => {
    state.providers = [{ id: 'local-1', provider_type: 'local', enabled: false }]
    state.assignedGroups = [
      { id: 'group-custom', name: 'Researchers', is_active: true, is_default: false },
    ]
    enableOnUpdate()

    await expect(run()).resolves.toEqual({ providerId: 'local-1', problem: null })
    expect(
      assignGroupToProvider,
      'an operator who already shared this provider must not have it re-scoped',
    ).not.toHaveBeenCalled()
  })

  it('does NOT grant access to a provider it did not provision', async () => {
    // An empty group set on an ALREADY-enabled provider is a supported admin
    // arrangement — it is how you keep a provider out of users' pickers while
    // leaving it on. Silently re-granting would reverse that decision and widen
    // access to everyone in the default group.
    state.providers = [{ id: 'local-1', provider_type: 'local', enabled: true }]
    state.assignedGroups = []

    const result = await run()
    expect(assignGroupToProvider).not.toHaveBeenCalled()
    expect(result.providerId).toBeNull()
    expect(result.problem).toMatch(/not shared with any user group/i)
  })

  it('fails CLOSED when the current assignment cannot be read', async () => {
    // A read failure is not evidence of "no groups". Treating it as such would
    // widen access on a transient 5xx.
    state.providers = [{ id: 'local-1', provider_type: 'local', enabled: false }]
    enableOnUpdate()
    getGroups.mockRejectedValueOnce(new Error('503 Service Unavailable'))

    const result = await run()
    expect(
      assignGroupToProvider,
      'an unreadable arrangement must never be overwritten',
    ).not.toHaveBeenCalled()
    expect(result.providerId).toBeNull()
    expect(result.problem).toMatch(/could not check/i)
  })

  it('prefers the DEFAULT group over any other', async () => {
    state.providers = [{ id: 'local-1', provider_type: 'local', enabled: false }]
    state.allGroups = [
      { id: 'group-other', name: 'Admins', is_active: true, is_default: false },
      USERS_GROUP,
    ]
    enableOnUpdate()

    await run()
    expect(assignGroupToProvider).toHaveBeenCalledWith('local-1', 'group-users')
  })

  it('falls back to a group NAMED Users when none is marked default', async () => {
    // The second preference, exercised on its own — with an `is_default` group
    // present the first preference always wins and this branch is never reached.
    state.providers = [{ id: 'local-1', provider_type: 'local', enabled: false }]
    state.allGroups = [
      { id: 'group-admins', name: 'Admins', is_active: true, is_default: false },
      { id: 'group-named', name: 'Users', is_active: true, is_default: false },
    ]
    enableOnUpdate()

    await run()
    expect(assignGroupToProvider).toHaveBeenCalledWith('local-1', 'group-named')
  })

  it('never guesses a group when neither the default nor Users is available', async () => {
    // Granting to whichever group happens to sort first is a silent
    // access-control decision nobody asked for — on a deployment with many
    // groups that could be 'Auditors' or 'Contractors'.
    state.providers = [{ id: 'local-1', provider_type: 'local', enabled: false }]
    state.allGroups = [
      { id: 'group-aud', name: 'Auditors', is_active: true, is_default: false },
      { id: 'group-con', name: 'Contractors', is_active: true, is_default: false },
    ]
    enableOnUpdate()

    const result = await run()
    expect(assignGroupToProvider).not.toHaveBeenCalled()
    expect(result.providerId).toBeNull()
    expect(result.problem).toMatch(/no default user group/i)
  })

  it('ignores INACTIVE groups — assigning to one would not grant access', async () => {
    state.providers = [{ id: 'local-1', provider_type: 'local', enabled: false }]
    state.allGroups = [
      { id: 'group-dead', name: 'Users', is_active: false, is_default: true },
      { id: 'group-live', name: 'Users', is_active: true, is_default: false },
    ]
    enableOnUpdate()

    await run()
    expect(assignGroupToProvider).toHaveBeenCalledWith('local-1', 'group-live')
  })

  it('provisions the BUILT-IN local provider, not whichever sorts first', async () => {
    // Enabling and then sharing an operator's own custom provider would be a
    // bigger action than the user asked for.
    state.providers = [
      { id: 'local-custom', provider_type: 'local', enabled: false, built_in: false },
      { id: 'local-builtin', provider_type: 'local', enabled: false, built_in: true },
    ]
    enableOnUpdate()

    await expect(run()).resolves.toEqual({ providerId: 'local-builtin', problem: null })
    expect(updateLlmProvider).toHaveBeenCalledWith('local-builtin', { enabled: true })
    expect(assignGroupToProvider).toHaveBeenCalledWith('local-builtin', 'group-users')
  })

  it("re-reads the list instead of trusting updateLlmProvider's return value", async () => {
    // The concurrent-update race: the store early-returns `null` while another
    // update is in flight, even though the write it represents did land.
    state.providers = [{ id: 'local-1', provider_type: 'local', enabled: false }]
    state.updateResult = null
    enableOnUpdate(null)

    const result = await run()
    expect(
      result.providerId,
      "returning updateLlmProvider's value would abort the install with 'no local provider'",
    ).toBe('local-1')
    expect(loadLlmProviders).toHaveBeenCalledWith(true)
  })

  it('reports a problem when the enable did not take effect', async () => {
    state.providers = [{ id: 'local-1', provider_type: 'local', enabled: false }]

    const result = await run()
    expect(result.providerId).toBeNull()
    expect(result.problem).toMatch(/could not be turned on/i)
  })

  it('reports a problem when no local provider exists at all', async () => {
    state.providers = [{ id: 'openai-1', provider_type: 'openai', enabled: true }]

    const result = await run()
    expect(result.providerId).toBeNull()
    expect(result.problem).toMatch(/no local provider/i)
    expect(updateLlmProvider).not.toHaveBeenCalled()
  })

  it('names what a human must do when it cannot enable', async () => {
    state.providers = [{ id: 'local-1', provider_type: 'local', enabled: false }]
    state.canEditProviders = false

    const result = await run()
    expect(result.providerId).toBeNull()
    expect(result.problem).toMatch(/administrator/i)
    expect(updateLlmProvider).not.toHaveBeenCalled()
  })

  it('names what a human must do when it cannot assign a group', async () => {
    state.providers = [{ id: 'local-1', provider_type: 'local', enabled: false }]
    state.canAssignGroups = false
    enableOnUpdate()

    const result = await run()
    expect(
      result.providerId,
      'succeeding here would start a multi-GB download for a model nobody can see',
    ).toBeNull()
    expect(result.problem).toMatch(/group/i)
    expect(assignGroupToProvider).not.toHaveBeenCalled()
  })
})
