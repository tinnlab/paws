import { test, beforeEach, afterEach, expect } from 'vitest'
import makeSendMessage from './actions/sendMessage'
import { chatExtensionRegistry } from '@/modules/chat/core/extensions'
import { ApiClient } from '@/api-client'

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
/** Own properties that did NOT exist before a stub shadowed the prototype. */
let hadOwn: Record<string, boolean> = {}
let saved: Record<string, unknown> = {}

function stubRegistry(over: Record<string, unknown> = {}) {
  const base: Record<string, unknown> = {
    beforeSendMessage: async () => ({ cancel: false }),
    // A VALID composed body: the server declares `content` + `model_id`
    // required, and `sendMessage` now refuses to POST without them. The
    // specs that deliberately compose an INVALID body (TEST-10/10b/12)
    // override this per test.
    composeRequestFields: async () => ({ content: 'hello', model_id: 'm-1' }),
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
  hadOwn = {}
  for (const k of REGISTRY_KEYS) {
    hadOwn[k] = Object.prototype.hasOwnProperty.call(reg, k)
    saved[k] = reg[k]
  }
})

afterEach(() => {
  // A real restore: the stubs are assigned as OWN properties that SHADOW the
  // class prototype, so re-assigning the prototype method back would leave the
  // shadow permanently in place. Delete what we created; restore what existed.
  for (const k of REGISTRY_KEYS) {
    if (hadOwn[k]) reg[k] = saved[k]
    else delete reg[k]
  }
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
test('a silent cancel is quiet ONLY when the caller opts in', async () => {
  stubRegistry({
    beforeSendMessage: async () => ({
      cancel: true,
      silent: true,
      errorMessage: 'Message cannot be empty',
    }),
  })

  // The composer opts in → quiet no-op, no state touched.
  const a = makeStore()
  await makeSendMessage(a.set as never, a.get as never)({ allowSilentCancel: true })
  expect(a.sets.length).toBe(0)

  // A PROGRAMMATIC caller does NOT opt in → the veto still throws. This is the
  // guard that keeps `startRegenerateMessage` (which has already trimmed the
  // transcript and latched the pending-branch fields before calling us) from
  // silently doing nothing, and keeps a tool approval/denial from being dropped.
  const b = makeStore()
  await expect(makeSendMessage(b.set as never, b.get as never)()).rejects.toThrow(
    /Message cannot be empty/,
  )
  expect(b.sets.length).toBe(0)
})

test('a LOUD cancel throws even when the caller opts into silent cancels', async () => {
  // fail-loud wins at the call site too: opting in must not silence a real
  // blocker (e.g. "files still uploading").
  stubRegistry({
    beforeSendMessage: async () => ({ cancel: true, errorMessage: 'still uploading' }),
  })
  const { set, get } = makeStore()
  await expect(
    makeSendMessage(set as never, get as never)({ allowSilentCancel: true }),
  ).rejects.toThrow(/still uploading/)
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

// ── ITEM: the SYNCHRONOUS in-flight latch (double-send) ─────────────────────
//
// `sending` is only set AFTER `await beforeSendMessage()`, so it can never be
// the re-entrancy guard: two submits ~10ms apart both observe `sending === false`
// and both send, producing two user bubbles. `sendMessage` therefore carries a
// latch set SYNCHRONOUSLY before its first await.
//
// The risk of a latch is the mirror image of the bug — a missed release wedges
// the composer forever — so every exit path is asserted below by calling the
// SAME action instance a second time and requiring that it still sends.

/** Stub `ApiClient.Message.send`, counting calls + recording each body. */
function stubSend(impl?: () => Promise<unknown>) {
  const ns = (ApiClient as unknown as Record<string, Record<string, unknown>>).Message
  const original = ns.send
  const calls = { n: 0, bodies: [] as Record<string, unknown>[] }
  ns.send = async (body: Record<string, unknown>) => {
    calls.n += 1
    calls.bodies.push(body)
    if (impl) return await impl()
    return { user_message_id: 'user-1', assistant_message_id: 'asst-1' }
  }
  return { calls, restore: () => { ns.send = original } }
}

test('two SYNCHRONOUS calls send exactly ONCE (the double-send guard)', async () => {
  stubRegistry()
  const { set, get } = makeStore()
  const sendMessage = makeSendMessage(set as never, get as never)
  const { calls, restore } = stubSend()
  try {
    // Both invoked before either can yield — exactly the double-Enter shape.
    await Promise.all([sendMessage(), sendMessage()])
    expect(calls.n).toBe(1)
  } finally {
    restore()
  }
})

test('the latch is RELEASED after a successful send (composer not wedged)', async () => {
  stubRegistry()
  const { set, get } = makeStore()
  const sendMessage = makeSendMessage(set as never, get as never)
  const { calls, restore } = stubSend()
  try {
    await sendMessage()
    expect(calls.n).toBe(1)
    // A LATER send on the same action instance must go through.
    await sendMessage()
    expect(calls.n).toBe(2)
  } finally {
    restore()
  }
})

test('the latch is RELEASED after a silent extension cancel', async () => {
  stubRegistry({
    beforeSendMessage: async () => ({
      cancel: true,
      silent: true,
      errorMessage: 'Message cannot be empty',
    }),
  })
  const { set, get } = makeStore()
  const sendMessage = makeSendMessage(set as never, get as never)
  const { calls, restore } = stubSend()
  try {
    await sendMessage({ allowSilentCancel: true }) // quiet `return` path
    expect(calls.n).toBe(0)
    // Cancel cleared → the next send must not be blocked by a stuck latch.
    stubRegistry()
    await sendMessage()
    expect(calls.n).toBe(1)
  } finally {
    restore()
  }
})

test('the latch is RELEASED after a LOUD extension cancel (the throw path)', async () => {
  stubRegistry({
    beforeSendMessage: async () => ({ cancel: true, errorMessage: 'still uploading' }),
  })
  const { set, get } = makeStore()
  const sendMessage = makeSendMessage(set as never, get as never)
  const { calls, restore } = stubSend()
  try {
    await expect(sendMessage()).rejects.toThrow(/still uploading/)
    stubRegistry()
    await sendMessage()
    expect(calls.n).toBe(1)
  } finally {
    restore()
  }
})

test('the latch is RELEASED after a thrown error inside the send', async () => {
  // Caught-and-recovered failure (the inner catch's return path).
  stubRegistry({
    provideUserContent: async () => {
      throw new Error('content extension exploded')
    },
  })
  const { set, get, state } = makeStore()
  const sendMessage = makeSendMessage(set as never, get as never)
  const { calls, restore } = stubSend()
  try {
    await sendMessage()
    expect(state.error).toBe('content extension exploded')
    stubRegistry()
    await sendMessage()
    expect(calls.n).toBe(1)
  } finally {
    restore()
  }
})

test('the latch is RELEASED after a PRE-FLIGHT throw (outside the inner try)', async () => {
  // `composeRequestFields` runs BEFORE the streaming flags + the inner try, so
  // its throw escapes `sendMessage` entirely. Only the outer `finally` can
  // release the latch on this path.
  stubRegistry({
    composeRequestFields: async () => {
      throw new Error('compose exploded')
    },
  })
  const { set, get } = makeStore()
  const sendMessage = makeSendMessage(set as never, get as never)
  const { calls, restore } = stubSend()
  try {
    await expect(sendMessage()).rejects.toThrow(/compose exploded/)
    stubRegistry()
    await sendMessage()
    expect(calls.n).toBe(1)
  } finally {
    restore()
  }
})

test('two SEPARATE store instances (split panes) are NOT serialized by one latch', async () => {
  stubRegistry()
  const a = makeStore()
  const b = makeStore()
  const sendA = makeSendMessage(a.set as never, a.get as never)
  const sendB = makeSendMessage(b.set as never, b.get as never)
  const { calls, restore } = stubSend()
  try {
    await Promise.all([sendA(), sendB()])
    expect(calls.n).toBe(2)
  } finally {
    restore()
  }
})

// ── TEST-9 / TEST-10 / TEST-12 — a failed request-field composition must never
// reach the wire ────────────────────────────────────────────────────────────
//
// Live-UI-rig triage §4 Rank 1: a `composeRequestFields` contributor failure was
// caught + logged, and the send PROCEEDED with a structurally invalid body — the
// user saw a raw `422 missing field \`model_id\`` and nothing actionable, and
// (because the failed chunk was memoized) every later send failed the same way.
//
// TEST-9 drives the REAL registry — fake extensions registered on the singleton,
// its own `composeRequestFields` left un-stubbed — so the swallow-or-throw
// decision under test is the production one, not a test double.

/** Register fake extensions on the real singleton; returns an unregister fn. */
function withExtensions(
  contributors: Array<{ name: string; compose: () => Promise<Record<string, unknown>> }>,
) {
  const registry = chatExtensionRegistry as unknown as {
    register: (e: unknown) => void
    unregister: (n: string) => void
  }
  const log = console.log
  console.log = () => {}
  try {
    for (const c of contributors) {
      registry.register({
        name: c.name,
        description: c.name,
        composeRequestFields: c.compose,
      })
    }
  } finally {
    console.log = log
  }
  return () => {
    const l = console.log
    console.log = () => {}
    try {
      for (const c of contributors) registry.unregister(c.name)
    } finally {
      console.log = l
    }
  }
}

test('TEST-9: a contributor failure sends NOTHING and surfaces an actionable error', async () => {
  stubRegistry()
  // Un-shadow the method under test so the REAL registry composition runs.
  delete (reg as Record<string, unknown>).composeRequestFields

  const unregister = withExtensions([
    { name: 'test-text', compose: async () => ({ content: 'hello' }) },
    {
      name: 'test-model',
      compose: async () => {
        throw new Error('Failed to fetch dynamically imported module')
      },
    },
  ])
  const { set, get, state } = makeStore()
  const sendMessage = makeSendMessage(set as never, get as never)
  const { calls, restore } = stubSend()
  try {
    await captureConsoleError(async () => {
      await sendMessage().catch(() => {})
    })

    // THE defect, asserted directly: no structurally-invalid POST may leave the
    // client. Pre-fix this was 1 — a body carrying `content` but no `model_id`.
    expect(
      calls.n,
      'a failed field composition must not produce a send request',
    ).toBe(0)

    // …and the user is told something they can act on, on the store's error
    // surface (the conversation error Alert), not just a console line.
    const error = String(state.error ?? '')
    expect(error, 'the failure must be surfaced on store.error').not.toBe('')
    expect(error).toContain('test-model')
    expect(error).toMatch(/reload/i)
    expect(
      error,
      'the user must not be shown the raw server validation string',
    ).not.toMatch(/missing field/i)
  } finally {
    restore()
    unregister()
  }
})

test('TEST-10: a composed body MISSING model_id is never POSTed (pre-send guard)', async () => {
  // The contributor RESOLVES — it throws nothing — so the fail-closed registry
  // cannot be what stops this. Only the pre-POST required-field check can, which
  // is what keeps this proof independent of TEST-9's mechanism.
  stubRegistry({ composeRequestFields: async () => ({ content: 'hello' }) })
  const { set, get, state } = makeStore()
  const sendMessage = makeSendMessage(set as never, get as never)
  const { calls, restore } = stubSend()
  try {
    await captureConsoleError(async () => {
      await sendMessage().catch(() => {})
    })
    expect(
      calls.n,
      'a body without model_id must not be POSTed (the server requires it)',
    ).toBe(0)
    expect(String(state.error ?? '')).toMatch(/model/i)
  } finally {
    restore()
  }
})

test('TEST-10b: a composed body MISSING content is never POSTed either', async () => {
  stubRegistry({ composeRequestFields: async () => ({ model_id: 'm-1' }) })
  const { set, get, state } = makeStore()
  const sendMessage = makeSendMessage(set as never, get as never)
  const { calls, restore } = stubSend()
  try {
    await captureConsoleError(async () => {
      await sendMessage().catch(() => {})
    })
    expect(calls.n).toBe(0)
    expect(String(state.error ?? '')).not.toBe('')
  } finally {
    restore()
  }
})

test('TEST-12: the in-flight latch is released after a composition abort', async () => {
  stubRegistry({ composeRequestFields: async () => ({ content: 'hello' }) })
  const { set, get } = makeStore()
  const sendMessage = makeSendMessage(set as never, get as never)
  const { calls, restore } = stubSend()
  try {
    await captureConsoleError(async () => {
      await sendMessage().catch(() => {})
    })
    expect(calls.n).toBe(0)

    // A healthy send on the SAME action instance must still go through — a
    // fail-closed abort must not wedge the composer.
    stubRegistry({
      composeRequestFields: async () => ({ content: 'hello', model_id: 'm-1' }),
    })
    await sendMessage()
    expect(calls.n).toBe(1)
  } finally {
    restore()
  }
})
