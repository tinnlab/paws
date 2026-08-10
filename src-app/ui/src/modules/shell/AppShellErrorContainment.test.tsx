/**
 * COMPONENT HARNESS — a caught module crash must never empty the document
 * (INV-2 / INV-3).
 *
 * ## The defect this closes
 *
 * `AppShell` wraps every module-registered component in its own
 * `AppErrorBoundary`, and that boundary's fallback was `() => null`. The ROUTER
 * is a module component too — it renders the entire routed app — so a render
 * throw anywhere beneath it was caught here and replaced with NOTHING.
 * `document.body.innerText` went to zero length, no message, no affordance, and
 * a boundary latches, so it stayed dead until a manual reload.
 *
 * That is the CONTAINMENT half of the white-screen bug. The other half (a
 * Rules-of-Hooks violation in `ChatMessage`) is covered by
 * `ChatMessage.hooks.test.tsx`. They are independent: fixing only the throw would
 * leave the next render error to produce the same white screen, which is why this
 * file exists at all.
 *
 * ## What is mocked, and what is NOT
 *
 * The REAL `AppShell`, the REAL `AppErrorBoundary` and the REAL
 * `ModuleErrorFallback` all run — that composition IS the fix, so mocking any of
 * them would make the test cosmetic. Only the app-context boundaries AppShell
 * reaches for are stubbed: the module registry, the sync SSE lifecycle, the
 * idle-prefetch hook, and the theme provider (which needs the app's ConfigClient
 * store). Nothing about error handling is stubbed.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const components: Array<Record<string, unknown>> = []

vi.mock('@ziee/framework/stores', () => ({
  ModuleSystem: {
    get components() {
      return components
    },
  },
}))
vi.mock('@ziee/framework/sync', () => ({ initSync: () => undefined }))
vi.mock('@ziee/shell/hooks/usePrefetchModules', () => ({
  usePrefetchModules: () => undefined,
}))
vi.mock('@ziee/shell/theme/ThemeProvider', () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

const { AppShell } = await import('@ziee/shell/bootstrap/AppShell')

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement | null = null
let root: Root | null = null

function render() {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(<AppShell authStore={{} as never} />))
}

beforeEach(() => {
  components.length = 0
  renderAttempts = 0
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
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

/** A module component that throws on render until `stopThrowing` is flipped. */
let throwing = true
/** Render attempts, so a test can prove a RESET actually re-ran the module. */
let renderAttempts = 0
function CrashingRouter(): React.ReactNode {
  renderAttempts++
  if (throwing) throw new Error('boom from the router module')
  return <div data-testid="router-content">routed app</div>
}
function HealthySidebar(): React.ReactNode {
  return <div data-testid="sidebar-content">sidebar</div>
}

describe('AppShell error containment (INV-2 / INV-3)', () => {
  /**
   * TEST-3 [acceptance] [invariant: INV-3]
   *
   * RED against `fallback={() => null}`: the document would be empty apart from
   * the sibling module, with no alert and no recovery affordance.
   */
  test('a crashing module renders a visible, actionable error — and siblings keep working', () => {
    throwing = true
    components.push(
      { id: 'router', order: 0, component: CrashingRouter },
      { id: 'sidebar', order: 1, component: HealthySidebar },
    )

    render()

    // INV-2 — the document is NOT empty. This is the literal production symptom
    // (`document.body.innerText.length === 0`) asserted directly.
    expect(document.body.innerText ?? host!.textContent ?? '').not.toHaveLength(0)
    expect((host!.textContent ?? '').length).toBeGreaterThan(0)

    // A real, announced error surface — not a silent blank.
    const alert = host!.querySelector('[role="alert"]')
    expect(alert).not.toBeNull()
    expect(alert!.getAttribute('data-module-id')).toBe('router')
    expect(host!.querySelector('[data-testid="module-error-fallback-message"]')!.textContent)
      .toContain('boom from the router module')

    // …with a way out.
    expect(host!.querySelector('[data-testid="module-error-fallback-retry"]')).not.toBeNull()
    expect(host!.querySelector('[data-testid="module-error-fallback-reload"]')).not.toBeNull()

    // INV-3 — isolation: the sibling module is untouched.
    expect(host!.querySelector('[data-testid="sidebar-content"]')).not.toBeNull()

    // And the crash is still LOUD — auto-recovery must not hide it from the
    // runtime-health gate, which counts these console errors.
    expect(console.error).toHaveBeenCalled()
  })

  /**
   * TEST-4 — the latch must be clearable, or one crash is permanent for the tab.
   */
  test('"Try again" re-renders the module once the cause is gone', () => {
    throwing = true
    components.push({ id: 'router', order: 0, component: CrashingRouter })
    render()
    expect(host!.querySelector('[role="alert"]')).not.toBeNull()

    throwing = false
    const retry = host!.querySelector(
      '[data-testid="module-error-fallback-retry"]',
    ) as HTMLButtonElement
    act(() => retry.click())

    expect(host!.querySelector('[data-testid="router-content"]')).not.toBeNull()
    expect(host!.querySelector('[role="alert"]')).toBeNull()
  })

  /**
   * TEST-4b — navigating away resets the latched boundary. This is the
   * "stays dead across four subsequent navigations" behaviour from the explorer
   * log, asserted directly.
   */
  test('navigating resets a latched boundary', () => {
    throwing = true
    components.push({ id: 'router', order: 0, component: CrashingRouter })
    render()
    expect(host!.querySelector('[role="alert"]')).not.toBeNull()

    throwing = false
    act(() => {
      window.history.pushState({}, '', '/somewhere-else')
    })

    expect(host!.querySelector('[data-testid="router-content"]')).not.toBeNull()
    expect(host!.querySelector('[role="alert"]')).toBeNull()
  })

  /**
   * TEST-4c — a module that throws on EVERY render must not loop. The reset is a
   * fresh ATTEMPT, not a retry storm: it re-renders once, the throw is caught
   * again, and the fallback is shown again — bounded.
   */
  test('a permanently-throwing module RETRIES once per navigation, then re-contains', () => {
    throwing = true
    components.push({ id: 'router', order: 0, component: CrashingRouter })
    render()

    const attemptsBefore = renderAttempts
    const before = (console.error as unknown as { mock: { calls: unknown[] } }).mock
      .calls.length

    act(() => {
      window.history.pushState({}, '', '/still-broken')
    })

    // The reset must actually have RE-RUN the module. Without this the test is
    // vacuous: with `resetKeys` removed entirely nothing re-renders, so the
    // fallback is trivially still on screen and the console delta is 0 — an
    // earlier draft of this test passed in exactly that state.
    expect(renderAttempts).toBeGreaterThan(attemptsBefore)

    // Still contained, still visible, still not a blank document.
    expect(host!.querySelector('[role="alert"]')).not.toBeNull()
    expect((host!.textContent ?? '').length).toBeGreaterThan(0)

    // BOUNDED: one reset costs at most a couple of render attempts (React
    // re-invokes a throwing render once more to recover a component stack), not
    // an unbounded storm. Without `resetKeys` this delta is 0, which is what
    // makes the assertion non-vacuous.
    expect(renderAttempts - attemptsBefore).toBeLessThanOrEqual(2)
    const after = (console.error as unknown as { mock: { calls: unknown[] } }).mock
      .calls.length
    expect(after - before).toBeGreaterThan(0)
    expect(after - before).toBeLessThanOrEqual(2)
  })
})
