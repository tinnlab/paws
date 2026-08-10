/**
 * TEST-24 (ITEM-14) — COMPONENT HARNESS for the repository health affordance.
 *
 * The backend probe grew a third outcome (`unverified` — "reachable, but ziee
 * could not confirm this URL lists models"). Before this change both UI
 * surfaces rendered ONLY the `unhealthy` case, so `healthy`, `unverified` and
 * `untested` were all pixel-identical: nothing at all. An operator therefore
 * could not tell a CONFIRMED repository from an unconfirmed one — which is
 * the same lie the backend fix removes, just moved one layer up.
 *
 * This spec mounts the real component and asserts the three probe outcomes
 * render DISTINCT, non-empty affordances, and specifically that `unverified`
 * borrows neither neighbour's treatment. It is a mounted-DOM assertion, not a
 * source scan: `railIsolation.test.ts`'s history in this repo is the reason —
 * a hand-written static analyser's evasion space is unbounded, a rendered
 * DOM's is not.
 *
 * Runner: Vitest + jsdom (`npm run test:component`). `npm run test:unit` is
 * `node --test "src/**\/*.test.ts"`, which cannot load `.tsx` at all — so this
 * spec MUST keep the `.tsx` extension or it runs NOTHING and reads like a pass.
 *
 *   npx vitest run src/modules/llm-repository/components/LlmRepositoryHealth.test.tsx
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { LlmRepositoryHealth } from './LlmRepositoryHealth'

// React 19 wants this set before `act` is used outside a framework adapter.
;(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const ALERT_ID = 'llmrepo-health-probe-alert'
const HEALTHY_ID = 'llmrepo-health-probe-ok'
const CHECKED_AT = '2026-07-20T10:30:00.000Z'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

/**
 * Mount the component for one status and return whichever affordance it
 * rendered. The problem states and the confirmation carry DIFFERENT test ids
 * (see the component's prop docs), so the query covers both — a test that
 * only looked for one id would read a missing affordance as "the other state".
 */
function render(
  status: string | null,
  reason?: string | null,
): HTMLElement | null {
  act(() => {
    root.render(
      <LlmRepositoryHealth
        data-testid={ALERT_ID}
        healthyTestId={HEALTHY_ID}
        status={status}
        reason={reason}
        checkedAt={CHECKED_AT}
      />,
    )
  })
  return container.querySelector<HTMLElement>(
    `[data-testid="${ALERT_ID}"], [data-testid="${HEALTHY_ID}"]`,
  )
}

/** Everything the operator can actually read, normalised. */
function visibleText(el: HTMLElement): string {
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim()
}

describe('LlmRepositoryHealth', () => {
  test('the three probe outcomes render distinct, non-empty affordances', () => {
    const rendered: Record<string, { text: string; html: string }> = {}

    for (const status of ['healthy', 'unverified', 'unhealthy']) {
      const el = render(status, `probe reason for ${status}`)
      expect(el, `${status} must render an affordance`).not.toBeNull()
      const text = visibleText(el as HTMLElement)
      expect(
        text.length,
        `${status} affordance must not be empty`,
      ).toBeGreaterThan(0)
      rendered[status] = { text, html: (el as HTMLElement).outerHTML }
    }

    // The confirmation and the problem states are separately selectable, so
    // an e2e assertion of "no alert in this row" keeps meaning what it meant.
    expect(rendered.healthy.html).toContain(HEALTHY_ID)
    expect(rendered.unverified.html).toContain(ALERT_ID)
    expect(rendered.unhealthy.html).toContain(ALERT_ID)

    // Pairwise distinct — a state that renders identically to another is a
    // state the operator cannot distinguish, which is the whole defect.
    const texts = Object.values(rendered).map(r => r.text)
    expect(new Set(texts).size).toBe(3)
  })

  test('unverified renders neither the healthy nor the unhealthy treatment', () => {
    const healthy = render('healthy', 'confirmed')
    const healthyHtml = (healthy as HTMLElement).outerHTML
    const healthyText = visibleText(healthy as HTMLElement)

    const unhealthy = render(
      'unhealthy',
      'HTTP request failed with status: 401',
    )
    const unhealthyHtml = (unhealthy as HTMLElement).outerHTML
    const unhealthyText = visibleText(unhealthy as HTMLElement)

    const unverified = render(
      'unverified',
      'answered 200 but the response is not a model listing',
    )
    expect(unverified).not.toBeNull()
    const unverifiedEl = unverified as HTMLElement
    const unverifiedText = visibleText(unverifiedEl)

    expect(unverifiedText).not.toBe(healthyText)
    expect(unverifiedText).not.toBe(unhealthyText)
    expect(unverifiedEl.outerHTML).not.toBe(healthyHtml)
    expect(unverifiedEl.outerHTML).not.toBe(unhealthyHtml)

    // The unhealthy treatment is the destructive/error tone. `unverified`
    // must NOT wear it: the repository is still enabled and may well work,
    // and dressing that as an error pushes operators to "fix" a working
    // deployment. Assert on the rendered class tokens, since that is the
    // channel the tone travels through.
    expect(unhealthyHtml).toContain('destructive')
    expect(unverifiedEl.outerHTML).not.toContain('destructive')
    expect(unverifiedEl.outerHTML).toContain('warning')

    // …and it must not claim the confirmation the healthy state claims.
    // Asserted on the leading claim rather than a substring: "Not verified…"
    // CONTAINS "verified", so a substring check would pass for the wrong
    // reason (it did, on the first run of this spec).
    expect(healthyText).toMatch(/^Verified as a model repository/)
    expect(unverifiedText).toMatch(/^Not verified as a model repository/)

    // The reason the backend recorded is what the operator needs in order to
    // act; an affordance that renders but explains nothing is not enough.
    expect(unverifiedText).toContain('not a model listing')
  })

  test('unverified is announced as an alert, healthy is not', () => {
    // A warning Alert takes role="alert"; the quiet healthy confirmation is
    // not an alert at all. This is the accessibility half of "distinct".
    const unverified = render('unverified', 'could not confirm')
    expect((unverified as HTMLElement).getAttribute('role')).toBe('alert')

    const healthy = render('healthy', null)
    expect((healthy as HTMLElement).getAttribute('role')).not.toBe('alert')
  })

  test('untested renders nothing — there is no measurement to report', () => {
    expect(render('untested', null)).toBeNull()
    expect(render(null, null)).toBeNull()
  })

  test('the timestamp is surfaced on every outcome that renders one', () => {
    const stamped = new Date(CHECKED_AT).toLocaleString()
    for (const status of ['healthy', 'unverified', 'unhealthy']) {
      const el = render(status, 'reason')
      expect(visibleText(el as HTMLElement)).toContain(stamped)
    }
  })
})
