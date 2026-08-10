/**
 * COMPONENT HARNESS — `ImageContent` must not hold hooks below a
 * content-dependent guard.
 *
 * ## The defect
 *
 * In this codebase a reactive store-proxy field read IS a React hook: path 4 of
 * `createStoreProxy` calls `useEffect` + `useStore(useShallow(…))` (see the
 * header of `scripts/lint-hooks.mjs`, rule O2). `ImageContent` made TWO such
 * reads — `FileStore.messageFilesCache` and `FileStore.thumbnailUrls` — and both
 * sat BELOW three content-dependent early returns:
 *
 *     if (isUser && source.type === 'file') return <AttachedFileCard … />  // 0 hooks
 *     if (source.type === 'url')            return …                       // 0 hooks
 *     if (source.type === 'base64')         return …                       // 0 hooks
 *     const file = FileStore.messageFilesCache.get(fileId) …               // 4 hooks
 *     const url  = FileStore.thumbnailUrls.get(fileId) …
 *
 * The same mounted instance therefore rendered 0 hook slots on a guard branch
 * and 4 on the fall-through, and the guard is not stable: `ContentRenderer`
 * passes `renderAsUser = isUser && !isObservation`, derived from the message's
 * CONTENTS, which change as blocks stream in.
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
 * So this component's 0 <-> 4 flip is NOT crash-detectable, and a spec that only
 * asserted `not.toThrow()` would pass against the pre-fix file — hollow. It is
 * still a real, shipped defect, and it has a real observable EFFECT, which is
 * what TEST-1 asserts:
 *
 * because React reuses the MOUNT dispatcher, the `useEffect` and the
 * `useSyncExternalStore` subscription from the previous render are never torn
 * down (the new render registers no passive effects, so `Passive` is not
 * flagged and no destroy runs). `refTracker.removeRef` therefore never fires:
 * the store's ref count RATCHETS UP on every guard flip and its ref-counted
 * destroy can never reach zero. Measured on this file, pre-fix vs post-fix,
 * over the same four renders:
 *
 *     pre-fix   refCount = 0, 2, 4, 4, 6     (monotonic — leak)
 *     post-fix  refCount = 0, 2, 2, 2, 2     (balanced)
 *
 * The fix splits the store reads into `FileSourceImage`, a child that genuinely
 * UNMOUNTS when the guard takes over, so its cleanup runs.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { defineStore, registerLazyStore } from '@ziee/framework/store-kit'
import { setAuthView } from '@ziee/framework/permissions'
import type { ImageSource, MessageContent } from '@/api-client/types'
import { File as FileStore } from '@/modules/file/stores/file'
import { ImageContent } from './ImageContent'

// React 19 wants this set before `act` is used outside a framework adapter.
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * APP BOOTSTRAP, not a mock. The `isUser && file` guard renders
 * `AttachedFileCard` -> `FileCard`, which calls `usePermission(…)`, which reads
 * the Auth view the real app registers once at startup (`Auth.store.ts` ends
 * with `setAuthView(Auth)`). Registering an equivalent empty one here is the
 * same seam `FileRagAdminPage.test.tsx` uses. Nothing in the component under
 * test — or in its render path — is stubbed.
 */
const TestAuthDef = defineStore<
  { user: { id: string; is_admin: boolean } | null; permissions: string[] },
  Record<string, never>
>('ImageContentHooksTestAuth', {
  state: { user: null, permissions: [] },
  actions: () => ({}),
})
setAuthView(registerLazyStore(TestAuthDef) as never)

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
 * A real `image` content block. `MessageContentDataImage` is
 * `{ type: 'image'; alt_text?: string | null; source: ImageSource }`, and
 * `ImageSource` is the three-arm `url | base64 | file` union — the exact shape
 * the backend persists and `ContentRenderer` hands to this renderer.
 */
function imageBlock(source: ImageSource): MessageContent {
  return {
    id: 'blk-image-1',
    message_id: 'msg-1',
    content_type: 'image',
    sequence_order: 0,
    created_at: '2026-08-10T00:00:00Z',
    updated_at: '2026-08-10T00:00:00Z',
    content: { type: 'image', alt_text: 'a generated chart', source },
  }
}

/** The source a stored image (user attachment / model-returned file) carries. */
const FILE_SOURCE: ImageSource = { type: 'file', file_id: 'file-abc' }

/** Live count of mounted store-proxy field subscriptions on the File store. */
const fileStoreRefs = () => FileStore.__refCount

function render(content: MessageContent, isUser: boolean) {
  const el = <ImageContent content={content} isUser={isUser} />
  if (!root) {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  }
  act(() => root!.render(el))
}

describe('ImageContent — store-proxy hooks below a content-dependent guard', () => {
  /**
   * TEST-1 [acceptance] — the discriminating test. `renderAsUser` flips on the
   * SAME mounted instance, exactly as it does while a message streams. Pre-fix
   * the store subscriptions taken on the fall-through render are orphaned on
   * every flip back to the guard, so the count ratchets up without bound.
   *
   * RED against the pre-fix file (a strictly growing count); GREEN after.
   */
  test('does not orphan its File-store subscriptions when renderAsUser flips', () => {
    // Settle on the guard branch first, so the baseline includes the refs
    // `AttachedFileCard` legitimately holds and the comparison is like-for-like.
    render(imageBlock(FILE_SOURCE), true)
    const baseline = fileStoreRefs()

    // Five stream-shaped flips: fall through to the store-backed branch, then
    // back to the user-attachment guard.
    for (let i = 0; i < 5; i++) {
      render(imageBlock(FILE_SOURCE), false)
      render(imageBlock(FILE_SOURCE), true)
    }

    // Every subscription the fall-through took must have been released again.
    expect(fileStoreRefs()).toBe(baseline)
  })

  /**
   * TEST-1b — the same leak reached through the OTHER guards (`url`, then
   * `base64`), so a fix that only hoisted the reads past the `isUser` guard and
   * left them below the source-type returns would still fail.
   */
  test('does not orphan its subscriptions when the source-type guards take over', () => {
    render(imageBlock({ type: 'url', url: '/api/files/file-abc/preview' }), false)
    const baseline = fileStoreRefs()

    for (let i = 0; i < 3; i++) {
      render(imageBlock(FILE_SOURCE), false)
      render(imageBlock({ type: 'url', url: '/api/files/file-abc/preview' }), false)
      render(imageBlock(FILE_SOURCE), false)
      render(
        imageBlock({ type: 'base64', media_type: 'image/png', data: 'AAAA' }),
        false,
      )
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
   * vacuous going forward: the moment anyone adds a hook to the outer `ImageContent` — a
   * `useState`, a `usePermission`, one more store read — the counts become
   * 1 <-> 5 and React DOES throw. This is the spec that catches that, and it
   * also proves the outer/inner split did not introduce a hook mismatch of its
   * own.
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

    // 0 hook slots -> 4 (the growth direction).
    render(imageBlock(FILE_SOURCE), true)
    expect(() => render(imageBlock(FILE_SOURCE), false)).not.toThrow()

    // 4 -> 0 (the shrink direction).
    expect(() => render(imageBlock(FILE_SOURCE), true)).not.toThrow()

    // …and through the url / base64 guards as well.
    expect(() => render(imageBlock(FILE_SOURCE), false)).not.toThrow()
    expect(() =>
      render(imageBlock({ type: 'url', url: '/api/files/x/preview' }), false),
    ).not.toThrow()
    expect(() => render(imageBlock(FILE_SOURCE), false)).not.toThrow()
    expect(() =>
      render(imageBlock({ type: 'base64', media_type: 'image/png', data: 'AA' }), false),
    ).not.toThrow()

    expect(hookErrors).toEqual([])
  })

  /**
   * TEST-3 [behaviour preservation] — the fix restructured the component into an
   * outer guard plus an inner hook-holding child, and a restructure can silently
   * change what renders. Each branch must still produce its documented output.
   */
  test('each source branch still renders its documented output', () => {
    // Same-origin url -> inline img.
    render(imageBlock({ type: 'url', url: '/api/files/x/preview' }), false)
    const img = host!.querySelector<HTMLImageElement>(
      '[data-testid="chat-image-content"] img',
    )
    expect(img?.getAttribute('src')).toBe('/api/files/x/preview')
    expect(img?.getAttribute('alt')).toBe('a generated chart')

    // Cross-origin url -> nothing (the SafeImg exfiltration guard).
    render(imageBlock({ type: 'url', url: 'https://evil.example/track.png' }), false)
    expect(host!.querySelector('[data-testid="chat-image-content"]')).toBeNull()

    // base64 with an image media type -> inline data URI.
    render(imageBlock({ type: 'base64', media_type: 'image/png', data: 'AAAA' }), false)
    expect(
      host!
        .querySelector<HTMLImageElement>('[data-testid="chat-image-content"] img')
        ?.getAttribute('src'),
    ).toBe('data:image/png;base64,AAAA')

    // base64 with a non-image media type -> nothing (the XSS guard).
    render(
      imageBlock({ type: 'base64', media_type: 'text/html', data: 'PHNjcmlwdD4=' }),
      false,
    )
    expect(host!.querySelector('[data-testid="chat-image-content"]')).toBeNull()

    // A user-attached file image -> the compact attachment card, never the
    // full-width inline preview.
    render(imageBlock(FILE_SOURCE), true)
    expect(host!.querySelector('[data-testid="chat-image-content"]')).toBeNull()
    expect(host!.textContent ?? '').toContain('a generated chart')

    // The same block not rendered as a user attachment -> the store-backed
    // branch, which shows the loading state until the blob URL resolves.
    render(imageBlock(FILE_SOURCE), false)
    expect(host!.querySelector('[data-testid="chat-image-content"]')).toBeNull()
    expect(host!.innerHTML.length).toBeGreaterThan(0)
  })
})
