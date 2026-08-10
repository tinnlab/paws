/**
 * COMPONENT HARNESS — `ChatMessage` must obey the Rules of Hooks (INV-1).
 *
 * ## The defect this closes
 *
 * `ChatMessage` subscribes to the mutable chat-extension registry with
 * `useSyncExternalStore(chatExtensionRegistry.subscribeToExtensions, …)`. That
 * hook was added (commit `e6f33d71d`) at a point in the function BELOW a
 * pre-existing early return:
 *
 *     if (contents.length === 0 && !showEmptyCompletionNotice) return null   // line 111
 *     …
 *     useSyncExternalStore(chatExtensionRegistry.subscribeToExtensions, …)   // line 178
 *
 * So the component renders SEVEN hooks when it falls through and SIX when it
 * early-returns. React tears the whole tree down the moment a mounted instance
 * goes 7 → 6:
 *
 *     Rendered fewer hooks than expected. This may be caused by an accidental
 *     early return statement.
 *
 * In production that surfaced as a WHITE SCREEN: the throw was caught by
 * `AppShell`'s per-module boundary around the `router` component, whose fallback
 * rendered `null` — so `document.body.innerText` went to zero length and stayed
 * there (reproduced against a live server; console showed
 * `[AppErrorBoundary [router]] … Minified React error #300`).
 *
 * ## Why THIS transition, and not a synthetic one
 *
 * The 7 → 6 flip is reachable through a real, documented prop transition, per
 * `emptyCompletion.ts::shouldShowEmptyCompletionNotice`: an ASSISTANT turn with
 * no content blocks shows the empty-completion notice while
 * `isStreaming/interrupted/finalizing` are all false (7 hooks, no early return),
 * and the notice is SUPPRESSED the moment the store's per-turn `interrupted` (or
 * `finalizing`) signal flips true — at which point `contents.length === 0 &&
 * !showEmptyCompletionNotice` becomes true and the same mounted instance renders
 * 6 hooks. Every conversation in the original report visibly contains such a turn
 * ("This turn ended without an answer, and the reason was not recorded.").
 *
 * `interrupted` is a PROP, so the transition is deterministic — no timing, no
 * race, no server. That is what makes this a component test rather than an e2e.
 *
 * ## Why nothing else catches it
 *
 * - `tsc` does not — hook ORDER is not a type.
 * - The repo's own `npm run lint:hooks` does not: its rule H1 deliberately
 *   EXCLUDES the `after-early-return` context, deferring it to "the standard
 *   rules-of-hooks rule's territory" — a rule that was not enabled. (This branch
 *   enables it; see `useHookAtTopLevel`.)
 * - A pure unit test of `shouldShowEmptyCompletionNotice` does not — that
 *   function is correct. The defect is entirely in the hook ORDER above it.
 *
 * Only MOUNTING the component and driving the transition reaches it.
 */
import { afterAll, afterEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { MessageWithContent } from '@/api-client/types'
import { ChatMessage } from './ChatMessage'
import { chatExtensionRegistry } from '@/modules/chat/core/extensions'

// React 19 wants this set before `act` is used outside a framework adapter.
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement | null = null
let root: Root | null = null

function mount(node: React.ReactNode) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(node))
}

function rerender(node: React.ReactNode) {
  act(() => root!.render(node))
}

/**
 * Mounting the REAL `ChatMessage` pulls in the chat store, whose `init()` performs
 * `await import('@/modules/auth/Auth.store')`. That dynamic import is still in
 * flight when the file's tests finish; if it resolves after vitest tears the
 * environment down, vitest reports an unhandled `EnvironmentTeardownError` and the
 * whole run exits non-zero even though every assertion passed. Letting the
 * macrotask queue drain once lets it settle inside the environment.
 */
afterAll(async () => {
  await new Promise(resolve => setTimeout(resolve, 250))
})

afterEach(() => {
  if (root) {
    const r = root
    act(() => r.unmount())
  }
  host?.remove()
  root = null
  host = null
  vi.restoreAllMocks()
})

/**
 * An ANSWERLESS assistant turn: a finalised assistant message that carries no
 * content blocks at all. This is the shape that renders the empty-completion
 * notice, and the shape whose early return skips the registry subscription.
 */
const answerlessAssistantTurn: MessageWithContent = {
  id: 'msg-answerless',
  conversation_id: 'conv-1',
  role: 'assistant',
  originated_from_id: 'msg-answerless',
  edit_count: 0,
  created_at: '2026-08-10T00:00:00Z',
  updated_at: '2026-08-10T00:00:00Z',
  contents: [],
} as unknown as MessageWithContent

describe('ChatMessage — Rules of Hooks (INV-1)', () => {
  /**
   * TEST-1 [acceptance] [invariant: INV-1]
   *
   * The literal reported defect. RED before the fix with
   * "Rendered fewer hooks than expected"; GREEN after.
   */
  test('survives the answerless-turn notice being suppressed on a re-render', () => {
    // React logs the render error via console.error before rethrowing; silence
    // it so a RED run reports the ASSERTION, not a wall of React noise. The
    // assertion below is on the throw itself, not on the log.
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    // Render 1 — notice SHOWS (isStreaming/interrupted/finalizing all false).
    // Falls through the early return → the full hook set.
    mount(
      <ChatMessage
        message={answerlessAssistantTurn}
        isStreaming={false}
        interrupted={false}
        finalizing={false}
      />,
    )
    expect(
      host!.querySelector('[data-testid="chat-empty-completion-notice"]'),
    ).not.toBeNull()

    // Render 2 — the store's per-turn interruption signal arrives. The notice is
    // suppressed, so `contents.length === 0 && !showEmptyCompletionNotice` is now
    // true and the component takes the early return. Same mounted instance.
    //
    // Pre-fix this throws:
    //   Rendered fewer hooks than expected. This may be caused by an accidental
    //   early return statement.
    expect(() =>
      rerender(
        <ChatMessage
          message={answerlessAssistantTurn}
          isStreaming={false}
          interrupted={true}
          finalizing={false}
        />,
      ),
    ).not.toThrow()

    // And the component genuinely took the early-return path (renders nothing),
    // which is what proves the hook-count actually changed rather than the test
    // having quietly kept both renders on the same branch.
    expect(host!.querySelector('[data-testid="chat-message"]')).toBeNull()
  })

  /**
   * TEST-1b — the same flip driven by `finalizing` (the streaming→persisted
   * handoff), the other production signal that suppresses the notice. Guards
   * against a fix that only special-cased `interrupted`.
   */
  test('survives the same suppression driven by the finalizing handoff', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    mount(
      <ChatMessage
        message={answerlessAssistantTurn}
        isStreaming={false}
        interrupted={false}
        finalizing={false}
      />,
    )

    expect(() =>
      rerender(
        <ChatMessage
          message={answerlessAssistantTurn}
          isStreaming={false}
          interrupted={false}
          finalizing={true}
        />,
      ),
    ).not.toThrow()
  })

  /**
   * TEST-1c — the reverse direction (6 → 7 hooks, "rendered MORE hooks"), which
   * is the same defect approached from the other side: a turn that starts
   * suppressed and then shows the notice.
   */
  test('survives the notice appearing on a later render (6 → 7 hooks)', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    mount(
      <ChatMessage
        message={answerlessAssistantTurn}
        isStreaming={false}
        interrupted={true}
        finalizing={false}
      />,
    )
    expect(host!.querySelector('[data-testid="chat-message"]')).toBeNull()

    expect(() =>
      rerender(
        <ChatMessage
          message={answerlessAssistantTurn}
          isStreaming={false}
          interrupted={false}
          finalizing={false}
        />,
      ),
    ).not.toThrow()

    expect(
      host!.querySelector('[data-testid="chat-empty-completion-notice"]'),
    ).not.toBeNull()
  })

  /**
   * TEST-2 — the fix must not regress what the hook was ADDED for.
   *
   * `e6f33d71d` added the subscription so a message segmented BEFORE its
   * extensions registered re-renders when one arrives (otherwise the activity
   * rail is silently absent for the life of the message). Hoisting the hook must
   * keep that live — and must now ALSO subscribe on the early-return path, which
   * is precisely the render that used to skip it.
   */
  test('still subscribes to the extension registry — including on the early-return path', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const subscribe = vi.spyOn(chatExtensionRegistry, 'subscribeToExtensions')

    // A render that takes the EARLY RETURN. Pre-fix the hook below the return was
    // never reached, so the registry was never subscribed for this message.
    mount(
      <ChatMessage
        message={answerlessAssistantTurn}
        isStreaming={false}
        interrupted={true}
        finalizing={false}
      />,
    )

    expect(host!.querySelector('[data-testid="chat-message"]')).toBeNull()
    expect(subscribe).toHaveBeenCalled()
  })
})
