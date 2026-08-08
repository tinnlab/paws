/**
 * COMPONENT HARNESS — the answerless-turn notice's CAUSE must reach the DOM.
 *
 * ## Why this file exists
 *
 * The three `empty-completion-cause` e2e specs failed with `Received: ""` while
 * the rendered COPY was correct: the server half worked and the cause was simply
 * not on the element. The kit's `Alert` destructured `...rest` and never spread
 * it onto its root, so every pass-through `data-*` / `aria-*` attribute was
 * silently dropped. Nothing else catches that —
 *
 *  - `tsc` does not: hyphenated JSX attributes skip excess-property checking, so
 *    `data-empty-completion-cause={…}` type-checks against a prop set that does
 *    not declare it, whether or not the component forwards it.
 *  - the pure unit tests do not: `emptyCompletionCause()` returns the right
 *    string; the defect is entirely in the rendering seam BELOW it.
 *  - the e2e does — but only after a full stack boot, and it reports a missing
 *    attribute with no hint at which of the four layers dropped it.
 *
 * So this MOUNTS the shipped kit `Alert` exactly as `ChatMessage.tsx` renders the
 * notice and reads the attribute back off the DOM: the defect is caught by its
 * EFFECT, in milliseconds, at the layer that actually broke.
 */
import { afterEach, describe, expect, test } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Alert } from '@ziee/kit'
import type { MessageWithContent } from '@/api-client/types'
import { emptyCompletionCause, emptyCompletionNotice } from './emptyCompletion'

// React 19 wants this set before `act` is used outside a framework adapter.
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement | null = null
let root: Root | null = null

afterEach(() => {
  if (root) {
    const r = root
    act(() => r.unmount())
  }
  host?.remove()
  root = null
  host = null
})

/** An answerless assistant turn carrying (or lacking) a persisted cause. */
function answerless(completion_state?: string): MessageWithContent {
  return {
    message: {},
    contents: [
      {
        id: 'blk-thinking',
        message_id: 'm',
        content_type: 'thinking',
        content: { type: 'thinking', thinking: 'a long chain of reasoning' },
        sequence_order: 0,
        created_at: '',
        updated_at: '',
      },
    ],
    completion_state,
  } as unknown as MessageWithContent
}

/**
 * Held as a `const` rather than written inline. The `testid-unique` Vite plugin
 * aborts `buildStart` when the same id appears as a quoted literal in two places,
 * and the production render in `ChatMessage.tsx` already owns this one — so
 * repeating it here broke `npm run dev` for everyone. `vite build`, `tsc` and
 * `npm run check` never run that hook, so the breakage ships green.
 */
const NOTICE_TESTID = 'chat-empty-completion-notice'

/** The exact render from `ChatMessage.tsx` — same props, same order. */
function mountNotice(message: MessageWithContent): HTMLElement {
  const cause = emptyCompletionCause(message)
  const content = emptyCompletionNotice(cause)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  const r = root
  act(() =>
    r.render(
      <Alert
        tone={content.tone}
        data-testid={NOTICE_TESTID}
        data-empty-completion-cause={cause}
        className="w-full"
        description={content.description}
      />,
    ),
  )
  // Built with JSON.stringify so the quoted id never appears literally in this
  // source. The registry generator scans text, not syntax: any quoted value
  // following the attribute name is harvested as a real id, including one that
  // is only an interpolation placeholder or an example inside a comment.
  const el = host.querySelector<HTMLElement>(`[data-testid=${JSON.stringify(NOTICE_TESTID)}]`)
  expect(el, 'the notice must render').not.toBeNull()
  return el as HTMLElement
}

describe('the answerless-turn notice carries its cause on the DOM', () => {
  for (const state of [
    'budget_truncated',
    'aborted',
    'failed',
    'content_filtered',
    'empty',
  ] as const) {
    test(`renders data-empty-completion-cause="${state}"`, () => {
      const notice = mountNotice(answerless(state))
      expect(notice.getAttribute('data-empty-completion-cause')).toBe(state)
    })
  }

  test('a row with no recorded state renders the honest `unknown` cause', () => {
    const notice = mountNotice(answerless(undefined))
    expect(notice.getAttribute('data-empty-completion-cause')).toBe('unknown')
    // …and the copy must not assert a cause it does not have.
    expect(notice.textContent ?? '').not.toMatch(/empty response/i)
  })

  test('the COPY is per-cause, not one string for every answerless turn', () => {
    const seen = new Set<string>()
    for (const state of [
      'budget_truncated',
      'aborted',
      'failed',
      'content_filtered',
      'empty',
      undefined,
    ]) {
      const text = mountNotice(answerless(state)).textContent ?? ''
      expect(text.length).toBeGreaterThan(0)
      seen.add(text)
      // Clean up between mounts inside the single test body.
      const r = root
      if (r) act(() => r.unmount())
      host?.remove()
      root = null
      host = null
    }
    expect(seen.size).toBe(6)
  })
})
