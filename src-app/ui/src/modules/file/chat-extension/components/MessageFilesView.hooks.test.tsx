/**
 * COMPONENT HARNESS — `MessageFilesView` must not hold a hook below a
 * content-dependent guard.
 *
 * ## The defect
 *
 * In this codebase a reactive store-proxy field read IS a React hook: path 4 of
 * `createStoreProxy` calls `useEffect` + `useStore(useShallow(…))` (see the
 * header of `scripts/lint-hooks.mjs`, rule O2). `MessageFilesView` read
 * `FileStore.messageFilesCache` BELOW a guard driven entirely by the block's
 * CONTENT:
 *
 *     const links = extractResourceLinks(content)
 *     if (links.length === 0) return null                    // 0 hooks
 *     …
 *     const messageFilesCache = FileStore.messageFilesCache  // 2 hooks
 *
 * The guard is not stable: this is the registered `tool_result` renderer, and a
 * tool_result's `resource_links` arrive as the block streams. The SAME mounted
 * instance therefore renders 0 hook slots before the links land and 2 after —
 * and back to 0 for any subsequent re-render that sees an empty/unparsed
 * payload.
 *
 * ## What React does and does NOT catch — measured, not assumed
 *
 * React detects a hook-count change only when BOTH renders rendered at least one
 * slot. `renderWithHooks` selects the dispatcher with
 *
 *     current === null || current.memoizedState === null
 *       ? HooksDispatcherOnMount : HooksDispatcherOnUpdate
 *
 * and a render that used zero hooks leaves `memoizedState === null` — so the
 * NEXT render is treated as a fresh mount and compared against nothing. The
 * mirror-image "fewer hooks" leftover check (`currentHook !== null &&
 * currentHook.next !== null`) likewise cannot fire when no slot rendered.
 * Verified directly in this environment (React 19, `createRoot` + `act`):
 *
 *     0->1  threw=[none]   0->2  threw=[none]   1->0  threw=[none]   2->0 threw=[none]
 *     1->2  threw=[Rendered more hooks than during the previous render.]
 *     2->1  threw=[Rendered fewer hooks than expected. …]
 *
 * React is not blind to it, though — it just does not THROW. On the real
 * component the flip makes React's own dev assertion fire on console.error:
 *
 *     Internal React error: Expected static flag was missing. Please notify
 *     the React team.
 *
 * which is the passive-effect static flags on the fiber no longer matching the
 * hooks it rendered. TEST-2 asserts that message never appears.
 *
 * So this component's 0 <-> 2 flip is NOT crash-detectable, and a spec that only
 * asserted `not.toThrow()` would pass against the pre-fix file — hollow. It is
 * still a real, shipped defect with a real observable EFFECT, which is what
 * TEST-1 asserts:
 *
 * because React reuses the MOUNT dispatcher, the `useEffect` and the
 * `useSyncExternalStore` subscription from the previous render are never torn
 * down (the new render registers no passive effects, so `Passive` is not flagged
 * and no destroy runs). `refTracker.removeRef` therefore never fires: the
 * store's ref count RATCHETS UP on every guard flip and its ref-counted destroy
 * can never reach zero. Measured on this file, pre-fix vs post-fix, over the
 * same three renders (links -> no links -> links):
 *
 *     pre-fix   refCount = 1, 1, 2     (monotonic — leak)
 *     post-fix  refCount = 1, 0, 1     (balanced)
 *
 * The fix splits the rendering half into `ResourceLinkFiles`, a child that
 * genuinely UNMOUNTS when the guard takes over, so its cleanup runs.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { MessageContent, ResourceLink } from '@/api-client/types'
import { File as FileStore } from '@/modules/file/stores/file'
import { MessageFilesView } from './MessageFilesView'

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
  vi.restoreAllMocks()
})

/**
 * A real `tool_result` content block. `MessageContentDataToolResult` carries
 * `content: string` plus the optional `resource_links?: ResourceLink[] | null`
 * this renderer consumes — the exact shape the backend persists after
 * `mcp/resource_link.rs::persist_links` has stamped `file_id` onto each saved
 * artifact and rewritten its `uri` to `/api/files/{id}`.
 */
function toolResultBlock(resource_links: ResourceLink[] | null): MessageContent {
  return {
    id: 'blk-tool-result-1',
    message_id: 'msg-1',
    content_type: 'tool_result',
    sequence_order: 0,
    created_at: '2026-08-10T00:00:00Z',
    updated_at: '2026-08-10T00:00:00Z',
    content: {
      type: 'tool_result',
      tool_use_id: 'toolu_01',
      name: 'execute_command',
      content: 'wrote /workspace/chart.png',
      resource_links,
    },
  }
}

/** A saved workspace artifact, as `persist_links` leaves it. */
const CHART: ResourceLink = {
  uri: '/api/files/file-chart',
  name: 'chart.png',
  mime_type: 'image/png',
  size: 4096,
  file_id: 'file-chart',
  is_saved: true,
}

const TABLE: ResourceLink = {
  uri: '/api/files/file-table',
  name: 'results.csv',
  mime_type: 'text/csv',
  size: 128,
  file_id: 'file-table',
  is_saved: true,
}

/** Live count of mounted store-proxy field subscriptions on the File store. */
const fileStoreRefs = () => FileStore.__refCount

function render(content: MessageContent) {
  const el = <MessageFilesView content={content} isUser={false} />
  if (!root) {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  }
  act(() => root!.render(el))
}

describe('MessageFilesView — a store-proxy hook below a content-dependent guard', () => {
  /**
   * TEST-1 [acceptance] — the discriminating test. A tool_result block whose
   * `resource_links` appear and disappear across re-renders of the SAME mounted
   * instance, exactly as they do while the block streams. Pre-fix, the store
   * subscription taken on the rendering path is orphaned on every flip back to
   * the guard, so the count ratchets up without bound.
   *
   * RED against the pre-fix file (a strictly growing count); GREEN after.
   */
  test('does not orphan its File-store subscription as resource_links stream in', () => {
    // Settle on the guard branch first so the baseline is measured there.
    render(toolResultBlock([]))
    const baseline = fileStoreRefs()

    // Five stream-shaped flips: the links land, then a re-render sees the block
    // without them again.
    for (let i = 0; i < 5; i++) {
      render(toolResultBlock([CHART]))
      render(toolResultBlock([]))
    }

    expect(fileStoreRefs()).toBe(baseline)
  })

  /**
   * TEST-1b — the same leak reached through the OTHER two shapes that make
   * `extractResourceLinks` return an empty array: a missing/`null`
   * `resource_links` field (the common case for a non-file tool_result), and an
   * array whose only entry has a blank `uri` (what an external MCP server can
   * emit). A fix that only handled the literal empty array would still fail.
   */
  test('does not orphan its subscription for null or uri-less link payloads', () => {
    render(toolResultBlock(null))
    const baseline = fileStoreRefs()

    for (let i = 0; i < 3; i++) {
      render(toolResultBlock([CHART, TABLE]))
      render(toolResultBlock(null))
      render(toolResultBlock([CHART]))
      render(toolResultBlock([{ uri: '   ' }]))
    }

    expect(fileStoreRefs()).toBe(baseline)
  })

  /**
   * TEST-2 [regression net] — the transition itself, driven in BOTH directions
   * on one mounted instance, asserting no Rules-of-Hooks error is thrown or
   * logged.
   *
   * Honest scope: React does not THROW on a 0 <-> N flip (see the header), so a
   * bare `not.toThrow()` here would be hollow. What makes this spec discriminate
   * is the console assertion: pre-fix React logs `Internal React error: Expected
   * static flag was missing` on the flip, post-fix it does not. It is also NOT
   * vacuous going forward: the moment anyone adds a hook to the outer `MessageFilesView` — a
   * `useState`, a `useChatPaneOrNull`-style store read, one more proxy field —
   * the counts become 1 <-> 3 and React DOES throw. This is the spec that
   * catches that, and it also proves the outer/inner split did not introduce a
   * hook mismatch of its own.
   */
  test('drives the guard in both directions with no hook-order error', () => {
    const hookErrors: string[] = []
    // `Internal React error: Expected static flag was missing` is React's own
    // dev assertion firing when a fiber's passive-effect static flags no longer
    // match the hooks it rendered — i.e. React DOES notice the corrupted hook
    // state on a 0 <-> N flip, it just reports it here instead of throwing.
    // Pre-fix both of this file's flips emit it; post-fix neither does.
    const HOOK_INVARIANT =
      /Rendered more hooks|Rendered fewer hooks|change in the order of Hooks|Invalid hook call|Internal React error/i
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      const first = args[0]
      const msg = first instanceof Error ? first.message : String(first)
      if (HOOK_INVARIANT.test(msg)) hookErrors.push(msg)
    })

    // 0 hook slots -> 2 (the growth direction): the links land mid-stream.
    render(toolResultBlock([]))
    expect(host!.querySelector('[data-testid="tool-result-files"]')).toBeNull()
    expect(() => render(toolResultBlock([CHART]))).not.toThrow()
    expect(host!.querySelector('[data-testid="tool-result-files"]')).not.toBeNull()

    // 2 -> 0 (the shrink direction).
    expect(() => render(toolResultBlock([]))).not.toThrow()
    expect(host!.querySelector('[data-testid="tool-result-files"]')).toBeNull()

    // …and once more through the `null` payload shape.
    expect(() => render(toolResultBlock([CHART, TABLE]))).not.toThrow()
    expect(() => render(toolResultBlock(null))).not.toThrow()

    expect(hookErrors).toEqual([])
  })

  /**
   * TEST-3 [behaviour preservation] — the fix restructured the component into an
   * outer guard plus an inner hook-holding child, and a restructure can silently
   * change what renders. The guard semantics and the per-block dedupe must be
   * unchanged.
   */
  test('still renders one preview per distinct uri, and nothing when there are none', () => {
    // No links -> no DOM at all (so every non-file tool_result stays empty).
    render(toolResultBlock([]))
    expect(host!.innerHTML).toBe('')

    // A missing field is the same as an empty one.
    render(toolResultBlock(null))
    expect(host!.innerHTML).toBe('')

    // A blank uri is dropped before it can render an <img src=""> / dead link.
    render(toolResultBlock([{ uri: '   ' }]))
    expect(host!.innerHTML).toBe('')

    // Two distinct links -> the container plus both file names.
    render(toolResultBlock([CHART, TABLE]))
    const container = host!.querySelector('[data-testid="tool-result-files"]')
    expect(container).not.toBeNull()
    expect(container!.textContent ?? '').toContain('chart.png')
    expect(container!.textContent ?? '').toContain('results.csv')

    // The SAME uri twice in ONE block renders once (per-block dedupe).
    render(toolResultBlock([CHART, { ...CHART, name: 'chart-again.png' }]))
    const text = host!.querySelector('[data-testid="tool-result-files"]')!.textContent ?? ''
    expect(text).toContain('chart.png')
    expect(text).not.toContain('chart-again.png')
  })
})
