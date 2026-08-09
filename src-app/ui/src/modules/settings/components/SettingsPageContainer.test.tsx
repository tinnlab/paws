/**
 * COMPONENT HARNESS for the crash the gallery runtime pass reports on
 * `seeded-file-rag-error` (and, flakily, on every other `/settings/*` surface):
 *
 *     React has detected a change in the order of Hooks called by
 *     SettingsPageContainer
 *        Previous render      Next render
 *        1. useId             useId
 *        2. undefined         useEffect
 *     Error: Rendered more hooks than during the previous render.
 *       at Object.get (sdk/packages/framework/src/stores.ts)     <- the proxy read
 *       at SettingsPageContainer (sdk/packages/shell/src/settings/SettingsPageContainer.tsx)
 *
 * ## Mechanism
 *
 * In this codebase a reactive store-proxy field read IS a hook: path 4 of
 * `createStoreProxy` calls `useEffect` + `useStore(useShallow(...))`. The shell's
 * optional chrome reads the app-registered `AppLayout` store through a seam:
 *
 *     const nativeScroll =
 *       (appLayoutSeam.peek() as { nativeScroll?: boolean } | null)?.nativeScroll ?? false
 *
 * `peek()` returns `null` until the app's `app-layout` module is imported
 * (`appLayoutSeam.set(AppLayout)` is a module side effect of a LAZY chunk), so
 * the `?.` short-circuits and the proxy read — and therefore its hooks — does
 * not happen. Once that chunk lands, the same component reads the field and
 * gains hooks mid-life. The optional chain is the conditional; there is no
 * literal `use*` call to lint.
 *
 * The test below drives exactly that flip: mount with the seam UNSET, then
 * inject it and re-render. It reproduces the shipped crash with no dev server
 * and no timing luck (the browser only hits it on ~3 of 16 loads).
 *
 * Runner: Vitest + jsdom (`npm run test:component`). `npm run test:unit` is
 * `node --test "src/**\/*.test.ts"`, which cannot load `.tsx` at all — so this
 * spec MUST keep the `.tsx` extension or it runs NOTHING and reads like a pass.
 *
 *   npx vitest run src/modules/settings/components/SettingsPageContainer.test.tsx
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { appLayoutSeam } from '@ziee/shell'
import { defineStore, registerLazyStore } from '@ziee/framework/store-kit'
import { SettingsPageContainer } from '@/modules/settings/components/SettingsPageContainer'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true

if (!('ResizeObserver' in globalThis)) {
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {
      return undefined
    }
    unobserve() {
      return undefined
    }
    disconnect() {
      return undefined
    }
  }
}
if (!globalThis.matchMedia) {
  globalThis.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof globalThis.matchMedia
}

const HOOK_INVARIANT =
  /Rendered more hooks|Rendered fewer hooks|change in the order of Hooks|Should have a queue|Invalid hook call/i

const consoleErrors: string[] = []
let restoreConsole: (() => void) | null = null

interface BoundaryState {
  caught: Error | null
}
class Boundary extends React.Component<
  { children: React.ReactNode; onError: (e: Error) => void },
  BoundaryState
> {
  state: BoundaryState = { caught: null }
  static getDerivedStateFromError(error: Error): BoundaryState {
    return { caught: error }
  }
  componentDidCatch(error: Error) {
    this.props.onError(error)
  }
  render() {
    if (this.state.caught) {
      return <div data-testid="boundary-crash">{this.state.caught.message}</div>
    }
    return this.props.children as React.ReactElement
  }
}

let root: Root | null = null
let host: HTMLElement | null = null

beforeEach(() => {
  consoleErrors.length = 0
  const orig = console.error
  console.error = (...args: unknown[]) => {
    consoleErrors.push(
      args.map(a => (a instanceof Error ? `${a.message} ${a.stack}` : String(a))).join(' '),
    )
  }
  restoreConsole = () => {
    console.error = orig
  }
})

afterEach(async () => {
  if (root) {
    const r = root
    await act(async () => {
      r.unmount()
    })
    root = null
  }
  host?.remove()
  host = null
  restoreConsole?.()
  restoreConsole = null
  // Leave the seam unset for the next spec.
  appLayoutSeam.set(null as never)
})

describe('SettingsPageContainer — hook count must not depend on seam registration', () => {
  test('the AppLayout seam is injected AFTER first render (lazy app-layout chunk)', async () => {
    appLayoutSeam.set(null as never)

    const crashes: Error[] = []
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)

    const onError = (e: Error) => {
      crashes.push(e)
    }
    const tree = (
      <Boundary onError={onError}>
        <SettingsPageContainer title="Document RAG">
          <div data-testid="body">body</div>
        </SettingsPageContainer>
      </Boundary>
    )

    // 1. First render happens BEFORE the app-layout module chunk lands.
    await act(async () => {
      root!.render(tree)
    })
    expect(host.querySelector('[data-testid="body"]'), 'container rendered').not.toBeNull()

    // 2. The lazy `modules/layouts/app-layout/appLayout` chunk is imported and
    //    its module side effect injects the seam.
    const AppLayoutDef = defineStore<{ nativeScroll: boolean; isSidebarCollapsed: boolean }, Record<string, never>>(
      'TestAppLayout',
      { state: { nativeScroll: false, isSidebarCollapsed: false }, actions: () => ({}) },
    )
    const AppLayout = registerLazyStore(AppLayoutDef)
    await act(async () => {
      appLayoutSeam.set(AppLayout as never)
    })

    // 3. Anything re-renders the container (a parent state change, a store
    //    update, a theme flip). Same component instance, one more proxy read.
    await act(async () => {
      root!.render(
        <Boundary onError={onError}>
          <SettingsPageContainer title="Document RAG" subtitle="re-render">
            <div data-testid="body">body</div>
          </SettingsPageContainer>
        </Boundary>,
      )
    })

    const hookErrors = consoleErrors.filter(m => HOOK_INVARIANT.test(m))
    expect(
      { crashes: crashes.map(c => c.message), hookErrorCount: hookErrors.length },
      `hook-order invariant violated:\n${hookErrors.join('\n')}`,
    ).toEqual({ crashes: [], hookErrorCount: 0 })
    expect(host.querySelector('[data-testid="boundary-crash"]')).toBeNull()
  })
})
