import { test, beforeEach, afterEach, expect } from 'vitest'
import makeSendMessage from './sendMessage'
import { chatExtensionRegistry } from '@/modules/chat/core/extensions'

/**
 * TEST-2 (acceptance, INV-4) + TEST-3 — the REAL `sendMessage` action driven
 * through a fake store.
 *
 * This is not a re-implementation of the behaviour: the action's own code runs,
 * start to finish. Only the two module boundaries it reaches out to are stubbed
 * — the extension registry (a real singleton object, monkey-patched per test and
 * restored afterwards) and the store's own `set`/`get`. That is what lets these
 * tests prove the property that matters and that no e2e can reach
 * deterministically: a throw ANYWHERE after the streaming flags go true still
 * leaves the store recoverable.
 *
 * Before the fix, `sending`/`isStreaming` were set ~40 lines ABOVE the `try`, so
 * a `loadMessages` or `provideUserContent` failure wedged both flags forever — a
 * spinner that never stops, a composer that never re-enables, and (because the
 * reconnect resync bails while `isStreaming`) no self-heal either.
 *
 * Runs under Vitest rather than `node:test` because the action imports
 * `@ziee/framework/stores`, whose package export only resolves through Vite's
 * resolver (matching the workspace's existing store-test pattern).
 */

type Patch = Record<string, unknown>

/** Minimal store double: records every `set` and folds it into one state. */
function makeStore(overrides: Patch = {}) {
  const state: Patch = {
    conversation: { id: 'conv-1', active_branch_id: 'branch-1' },
    messages: new Map(),
    tempUserMessageId: null,
    paneId: null,
    hasMoreAfter: false,
    error: null,
    sending: false,
    isStreaming: false,
    extensionRuntime: null,
    chatStreamClient: null,
    pendingBranchFromMessageId: null,
    pendingBranchForkLevel: null,
    loadMessages: async () => {},
    clearPendingBranch: async () => {},
    createConversation: async () => ({ id: 'conv-1', active_branch_id: 'branch-1' }),
    ...overrides,
  }
  const sets: Patch[] = []
  const set = (patch: Patch | ((s: Patch) => Patch)) => {
    const p = typeof patch === 'function' ? patch(state) : patch
    sets.push(p)
    Object.assign(state, p)
  }
  const get = () => state
  return { state, sets, set, get }
}

/** Registry methods this action calls; each test overrides what it needs. */
const REGISTRY_KEYS = [
  'beforeSendMessage',
  'composeRequestFields',
  'provideUserContent',
  'onMessageSent',
  'onStreamError',
  'afterCreateConversation',
  'onConversationLoad',
  'initialize',
] as const

const reg = chatExtensionRegistry as unknown as Record<string, unknown>
let saved: Record<string, unknown> = {}

function stubRegistry(over: Record<string, unknown> = {}) {
  const base: Record<string, unknown> = {
    beforeSendMessage: async () => ({ cancel: false }),
    composeRequestFields: async () => ({ content: 'hello' }),
    provideUserContent: async () => [],
    onMessageSent: async () => {},
    onStreamError: async () => {},
    afterCreateConversation: async (c: unknown) => c,
    onConversationLoad: async () => {},
    initialize: async () => {},
  }
  Object.assign(reg, base, over)
}

beforeEach(() => {
  saved = {}
  for (const k of REGISTRY_KEYS) saved[k] = reg[k]
})

afterEach(() => {
  for (const k of REGISTRY_KEYS) reg[k] = saved[k]
})

/** Capture console.error for the duration of `fn`. */
async function captureConsoleError(fn: () => Promise<void>): Promise<string[]> {
  const lines: string[] = []
  const original = console.error
  console.error = (...args: unknown[]) => {
    lines.push(args.map(a => (a instanceof Error ? a.message : String(a))).join(' '))
  }
  try {
    await fn()
  } finally {
    console.error = original
  }
  return lines
}

// ── TEST-2 (a): a LOUD cancel is never swallowed ────────────────────────────
test('a non-silent cancel still THROWS (never resolves quietly)', async () => {
  stubRegistry({
    beforeSendMessage: async () => ({ cancel: true, errorMessage: 'still uploading' }),
  })
  const { set, get, sets } = makeStore()
  await expect(makeSendMessage(set as never, get as never)()).rejects.toThrow(
    /still uploading/,
  )
  // A rejected send must not have mutated state.
  expect(sets.length).toBe(0)
})

// ── ITEM-1: a SILENT cancel is a true no-op ─────────────────────────────────
test('a silent cancel returns without throwing and without touching state', async () => {
  stubRegistry({
    beforeSendMessage: async () => ({
      cancel: true,
      silent: true,
      errorMessage: 'Message cannot be empty',
    }),
  })
  const { set, get, sets } = makeStore()
  await makeSendMessage(set as never, get as never)()
  // An empty submit must not flip sending / isStreaming / error.
  expect(sets.length).toBe(0)
})

// ── TEST-3: the previously-unprotected region ───────────────────────────────
test('a provideUserContent failure does NOT wedge sending/isStreaming', async () => {
  stubRegistry({
    provideUserContent: async () => {
      throw new Error('content extension exploded')
    },
  })
  const { set, get, state } = makeStore()
  await makeSendMessage(set as never, get as never)()
  expect(state.sending).toBe(false) // composer must re-enable
  expect(state.isStreaming).toBe(false) // spinner must stop
  expect(state.error).toBe('content extension exploded')
})

test('a loadMessages failure (mid-conversation anchor) does NOT wedge the flags', async () => {
  stubRegistry()
  const { set, get, state } = makeStore({
    hasMoreAfter: true,
    loadMessages: async () => {
      throw new Error('tail snap failed')
    },
  })
  await makeSendMessage(set as never, get as never)()
  expect(state.sending).toBe(false)
  expect(state.isStreaming).toBe(false)
  expect(state.error).toBe('tail snap failed')
})

// ── TEST-2 (b): a failure always surfaces a message ─────────────────────────
test('a failure sets a NON-EMPTY error (never left null, never a blank alert)', async () => {
  stubRegistry({
    provideUserContent: async () => {
      throw new Error('')
    },
  })
  const { set, get, state } = makeStore()
  await makeSendMessage(set as never, get as never)()
  expect(typeof state.error).toBe('string')
  expect((state.error as string).length).toBeGreaterThan(0)
})

// ── TEST-2 (c): a throwing extension hook cannot eat the recovery ───────────
test('a throwing onStreamError hook is LOGGED and the state reset still runs', async () => {
  stubRegistry({
    provideUserContent: async () => {
      throw new Error('primary failure')
    },
    onStreamError: async () => {
      throw new Error('hook exploded')
    },
  })
  const { set, get, state } = makeStore()
  const logged = await captureConsoleError(async () => {
    await makeSendMessage(set as never, get as never)()
  })

  // The hook must not take the recovery down with it.
  expect(state.sending).toBe(false)
  expect(state.isStreaming).toBe(false)
  // The PRIMARY failure is what the user sees.
  expect(state.error).toBe('primary failure')
  // The secondary error must be logged, not discarded (CODING_GUIDELINES §6).
  expect(logged.some(l => l.includes('hook exploded'))).toBe(true)
})
