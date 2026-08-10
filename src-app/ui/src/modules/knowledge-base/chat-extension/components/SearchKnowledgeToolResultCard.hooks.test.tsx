/**
 * COMPONENT HARNESS — behaviour-preservation guard for the hook split in a chat
 * CONTENT renderer.
 *
 * ## What this proves, and what it deliberately does NOT claim
 *
 * `SearchKnowledgeToolResultCard`'s `useState` sat below two content-dependent
 * guards (`isSearchKnowledgeResult`, then `parseSearchKnowledge` → null), which
 * is a genuine Rules-of-Hooks violation: a `search_knowledge` tool_result arrives
 * incrementally while the model streams, so the SAME mounted instance can see a
 * payload that parses and then one that does not.
 *
 * It is NOT, however, currently crash-capable — and that was measured, not
 * assumed. The component's other hook, `useChatPaneOrNull()`, is a `useContext`,
 * and React does not give a context read a slot in the hook list (it is tracked
 * on the fiber's `dependencies`). So the real transition is 1 slot → 0 slots, and
 * React's leftover check (`currentHook !== null && currentHook.next !== null`)
 * cannot fire when NO slot rendered. Verified directly: this spec PASSES against
 * the pre-fix file.
 *
 * That is why this file does not pretend to be a crash regression test. The
 * static rule is what catches this class — see
 * `scripts/lint-hooks-top-level.test.mjs`, which proves biome's
 * `useHookAtTopLevel` is enabled, wired into `npm run check`, and still fires on
 * a known-bad input.
 *
 * The same turned out to be true of the two sibling files fixed in the same sweep,
 * `ImageContent` (0 ↔ 4 slots) and `MessageFilesView` (0 ↔ 2). An earlier draft of
 * this comment asserted they WERE crash-capable "because growing the slot count is
 * detected"; measuring the matrix disproved it. `renderWithHooks` picks the MOUNT
 * dispatcher whenever the previous render left `memoizedState === null`, so any
 * flip involving a ZERO-slot render is compared against nothing: `0→1, 1→0, 0→2,
 * 2→0` are all silent, and only `1→2, 2→1, 1→3, 3→1` throw. Those two siblings are
 * therefore a SILENT defect (orphaned subscriptions that ratchet a ref count) —
 * see their `.hooks.test.tsx` files, which assert exactly that. `ChatMessage`
 * (7 → 6) is the only detectable site, and the only white screen.
 *
 * What this spec is for: the fix restructured the component into an outer guard +
 * an inner hook-holding component, and a restructure can silently change what
 * renders. This drives the guard in BOTH directions on a mounted instance and
 * asserts the rendered output is unchanged — the regression risk the refactor
 * actually carries.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { SearchKnowledgeToolResultCard } from './SearchKnowledgeToolResultCard'

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
  vi.restoreAllMocks()
})

/** A well-formed `search_knowledge` tool_result — the branch that renders. */
function wellFormed() {
  return {
    id: 'blk-1',
    content_type: 'tool_result',
    sequence_order: 0,
    content: {
      name: 'search_knowledge',
      structured_content: {
        query: 'what is x',
        mode: 'hybrid',
        truncated: false,
        hits: [
          {
            file_id: 'f1',
            filename: 'paper.pdf',
            page: 3,
            char_start: 10,
            char_end: 40,
            score: 0.9,
            content: 'a retrieved passage',
          },
        ],
      },
    },
  } as never
}

/** The same block mid-stream, before the structured payload has landed.
 *  `parseSearchKnowledge` returns null for it, so the card early-returns. */
function unparseable() {
  return {
    id: 'blk-1',
    content_type: 'tool_result',
    sequence_order: 0,
    content: { name: 'search_knowledge', structured_content: null },
  } as never
}

function render(content: never) {
  const el = <SearchKnowledgeToolResultCard content={content} isUser={false} />
  if (!root) {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  }
  act(() => root!.render(el))
}

describe('SearchKnowledgeToolResultCard — hook-split behaviour preservation', () => {
  test('renders the card, then cleanly renders nothing when the payload stops parsing', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    render(wellFormed())
    expect(host!.querySelector('[data-testid="kb-tool-result-card"]')).not.toBeNull()

    // Same mounted instance, payload no longer parses → the guard branch.
    expect(() => render(unparseable())).not.toThrow()
    expect(host!.querySelector('[data-testid="kb-tool-result-card"]')).toBeNull()
  })

  test('renders nothing, then renders the card when the streamed payload lands', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    render(unparseable())
    expect(host!.querySelector('[data-testid="kb-tool-result-card"]')).toBeNull()

    // The streaming case: the structured payload lands and the card appears.
    expect(() => render(wellFormed())).not.toThrow()
    expect(host!.querySelector('[data-testid="kb-tool-result-card"]')).not.toBeNull()
  })
})
