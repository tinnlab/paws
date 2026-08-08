/**
 * COMPONENT HARNESS for the sidebar notification bell popover
 * (`@ziee/notification-ui`'s `NotificationBellWidget` + `NotificationItem`).
 *
 * ## Why this file exists
 *
 * The user reported: *"the render of the notification popover is also broken,
 * not responsive"*. Measured on `origin/main` the popover PANEL was the kit's
 * fixed `w-72` (288px) while the content wrapper carried an inline
 * `style={{ width: 340 }}` — so 62px of every row (the mark-read + delete
 * controls) painted OUTSIDE the popover's background, and at a 320px viewport
 * that fixed 340px pushed `document.scrollWidth` to 358 and scrolled the page
 * sideways.
 *
 * ## What this harness proves, and what it deliberately does NOT
 *
 * jsdom does no layout: it cannot measure a rect, so it cannot prove
 * containment. The GEOMETRY is proven in a real browser by
 * `tests/e2e/15-notifications/bell-popover-responsive.spec.ts` (TEST-1/2/3/4).
 * What this file pins is the DOM/class CONTRACT that produces that geometry —
 * the mechanism, not the pixels — because that is the part a future refactor
 * can silently revert while every e2e still happens to pass on one viewport:
 *
 *  - the inline fixed `width` / `maxHeight` (the defect's literal mechanism) is
 *    gone, and nothing re-introduces an inline pixel size;
 *  - the width bound lives on the PANEL and is viewport-relative;
 *  - only the LIST scrolls, with the header and the "View all" footer as
 *    siblings OUTSIDE the scroller (before, both were inside a 460px scroll box
 *    and "View all" was unreachable without scrolling past 8 rows);
 *  - a long unbroken token wraps because the CONTENT COLUMN carries the wrap
 *    rule — the placement that matters, since what fills that column is whatever
 *    an app's REGISTERED kind renderer returns, not the SDK's fallback block;
 *  - no physical-direction utility survives anywhere in the rendered subtree.
 *
 * ## Runner
 *
 * Vitest + jsdom (`npm run test:component` = `vitest run .test.tsx`). The
 * `node --test` runner cannot load `.tsx`, so a component spec is invisible to
 * it; `vitest.config.ts` includes `src/**\/*.test.tsx`. Mounting uses React's own
 * `createRoot` + `act` — no `@testing-library/*` dependency is added, mirroring
 * `src/modules/js-tool/chat-extension/components/JsToolApprovalContent.test.tsx`.
 *
 *   npx vitest run src/modules/notification/components/NotificationBellPopover.test.tsx
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { Button } from '@ziee/kit'
import { registerNotificationKind } from '@ziee/framework/notification'
import {
  NotificationBellWidget,
  notificationsSeam,
  type NotificationRow,
  type NotificationsStoreView,
} from '@ziee/notification-ui'

// ---------------------------------------------------------------------------
// Fixture — a POPULATED, adversarial notification set.
//
// An empty panel hides every real-data layout bug (the lifecycle's
// "Populated-render review" rule), so the fixture carries the two shapes that
// actually broke: a very long TITLE and a long UNBROKEN token with no space to
// wrap at.
// ---------------------------------------------------------------------------

const LONG_TITLE =
  'Quarterly cross-institutional pharmacogenomics variant reconciliation sweep has completed successfully'
const UNBROKEN_TOKEN =
  'pmid:PMC10293847_supplementary_table_S3_reconciliation_output_final_v2_reviewed.csv'

/** The kind whose renderer also supplies an inline `actions` row (the `ps-4` path). */
const KIND_WITH_ACTIONS = 'test_kind_with_actions'
/** A kind with a REGISTERED renderer but no actions — the common case. */
const KIND_REGISTERED = 'test_kind_registered'
/** A kind with NO registered renderer — exercises the SDK's fallback block. */
const KIND_UNREGISTERED = 'test_kind_unregistered'

function row(i: number, over: Partial<NotificationRow> = {}): NotificationRow {
  return {
    id: `n-${i}`,
    kind: KIND_REGISTERED,
    title: `Notification ${i}`,
    body: `Body of notification ${i}.`,
    interrupt: true,
    payload: {},
    read_at: null,
    created_at: '2026-08-08T09:00:00.000Z',
    ...over,
  }
}

/** 12 rows — more than the bell's 8-row slice, so the list genuinely overflows. */
const ITEMS: NotificationRow[] = [
  row(0, { kind: KIND_WITH_ACTIONS, title: LONG_TITLE }),
  row(1, { kind: KIND_UNREGISTERED, title: UNBROKEN_TOKEN, body: UNBROKEN_TOKEN }),
  ...Array.from({ length: 10 }, (_, k) => row(k + 2)),
]

/**
 * Register renderers exactly as a consuming app does. This is load-bearing: the
 * SDK's own fallback block is NOT what ziee's real rows use (every scheduler
 * kind is registered in `modules/notification/kinds.tsx`), so a wrap rule that
 * only covered the fallback would leave every real row overflowing. Registering
 * here means the assertions run against the same dispatch path production uses.
 */
registerNotificationKind(KIND_REGISTERED, {
  render: (n: { title: string; body: string }) => (
    <>
      <span>{n.title}</span>
      <span>{n.body}</span>
    </>
  ),
})
registerNotificationKind(KIND_WITH_ACTIONS, {
  render: (n: { title: string }) => <span>{n.title}</span>,
  actions: () => (
    <>
      <Button data-testid="kind-action-accept" variant="ghost">
        Accept
      </Button>
      <Button data-testid="kind-action-decline" variant="ghost">
        Decline
      </Button>
    </>
  ),
})

function makeStore(items: NotificationRow[]): NotificationsStoreView {
  const noop = () => undefined
  return {
    items,
    unread: items.filter(n => !n.read_at).length,
    total: items.length,
    page: 1,
    perPage: 20,
    unreadOnly: false,
    loading: false,
    error: null,
    load: noop,
    refreshUnread: noop,
    fetchOne: async () => null,
    setPage: noop,
    setUnreadOnly: noop,
    markRead: noop,
    markAllRead: noop,
    remove: noop,
    clearError: noop,
    onNavigate: () => undefined,
    inboxPath: '/notifications',
  }
}

let container: HTMLDivElement
let root: Root

/**
 * Mount the bell and OPEN its popover, returning the Base UI POPUP box — the
 * element that paints the popover background.
 *
 * The handle is deliberately `[data-slot="popover-content"]`, which exists both
 * before and after this fix, and NOT the `notification-bell-panel` testid this
 * fix introduces. Anchoring on a new testid would make every assertion below go
 * red against pre-fix code for a bookkeeping reason ("the testid is missing")
 * instead of for the reason under test, and a red that isn't caused by the
 * defect proves nothing about the defect.
 */
function mountAndOpen(items: NotificationRow[] = ITEMS): HTMLElement {
  notificationsSeam.set(makeStore(items))
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root.render(
      <MemoryRouter>
        <NotificationBellWidget />
      </MemoryRouter>,
    )
  })
  const trigger = document.querySelector<HTMLElement>('[data-slot="popover-trigger"]')
  expect(trigger, 'the bell trigger must render').toBeTruthy()
  act(() => {
    trigger?.click()
  })
  // Base UI portals the popup to document.body, so query the document, not the
  // mount container.
  const el = document.querySelector<HTMLElement>('[data-slot="popover-content"]')
  expect(el, 'the popover popup box must render once opened').toBeTruthy()
  return el as HTMLElement
}

/** Alias kept for readability at the call sites that mean "the popup box". */
function popup(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[data-slot="popover-content"]')
  expect(el, 'the popover popup box must render').toBeTruthy()
  return el as HTMLElement
}

beforeEach(() => {
  document.body.innerHTML = ''
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  document.body.innerHTML = ''
})

// ---------------------------------------------------------------------------

describe('notification bell popover — containment contract', () => {
  // TEST-8 — the control that makes every other assertion in this file mean
  // something. Each of TEST-5/6/7 is of the form "no element does X"; all three
  // pass VACUOUSLY against an empty or crashed render. This asserts the fixture
  // actually produced a populated panel first.
  test('TEST-8: the populated fixture really renders 8 rows with their controls', () => {
    const panel = mountAndOpen()

    // The bell slices to 8 even though the fixture supplies 12.
    const rows = panel.querySelectorAll('[data-testid^="notification-bell-open-"]')
    expect(rows.length).toBe(8)

    // Real content, from the REGISTERED renderers (not the fallback).
    expect(panel.textContent).toContain(LONG_TITLE)
    expect(panel.textContent).toContain(UNBROKEN_TOKEN)
    expect(panel.textContent).toContain('Notification 5')

    // Both per-row controls exist for an unread row...
    expect(panel.querySelector('[data-testid="notification-bell-read-n-5"]')).toBeTruthy()
    expect(panel.querySelector('[data-testid="notification-bell-delete-n-5"]')).toBeTruthy()
    // ...and the kind renderer's inline actions row rendered too, so TEST-7's
    // sweep genuinely covers the `ps-4` actions container.
    expect(panel.querySelector('[data-testid="kind-action-accept"]')).toBeTruthy()

    // Header + footer are present.
    expect(panel.querySelector('[data-testid="notification-bell-mark-all"]')).toBeTruthy()
    expect(panel.querySelector('[data-testid="notification-bell-view-all"]')).toBeTruthy()
  })

  // TEST-5 — ITEM-1 + ITEM-2.
  test('TEST-5: the panel is viewport-bounded and only the LIST scrolls', () => {
    const panel = mountAndOpen()

    // (a) The defect's literal mechanism is gone: no descendant of the popup
    //     carries an inline pixel width or height. This is spelled as a sweep
    //     over the whole subtree rather than a check of one element, so
    //     re-introducing the inline size ANYWHERE inside the popover fails.
    const inlineSized = [...popup().querySelectorAll<HTMLElement>('*')]
      .concat(popup())
      .filter(el => {
        const s = el.getAttribute('style') ?? ''
        return /(^|;)\s*(width|max-height|height)\s*:\s*\d/.test(s)
      })
      .map(el => `${el.tagName}.${el.className}[${el.getAttribute('style')}]`)
    expect(inlineSized).toEqual([])

    // (b) The WIDTH bound lives on the popup (the element that paints the
    //     panel), not on a child, and it is viewport-relative — a bare `w-72`
    //     or a fixed `w-[340px]` fails both halves.
    const popupCls = popup().className
    expect(popupCls, 'panel width must be viewport-relative').toMatch(/\bw-\[[^\]]*vw[^\]]*\]/)
    expect(popupCls, 'panel width must be capped by min()').toContain('min(')

    // (c) Only the list scrolls, and it is height-bounded by the viewport-aware
    //     `--available-height` (not a fixed pixel cap).
    const list = panel.querySelector<HTMLElement>('[data-testid="notification-bell-list"]')
    expect(list, 'the list must be its own scroll container').toBeTruthy()
    expect(list?.className).toMatch(/max-h-\[[^\]]*--available-height[^\]]*\]/)

    // (d) …and the header + footer are SIBLINGS of the scroller, not inside it,
    //     so both stay reachable however long the list gets. This is the
    //     assertion that fails if someone re-wraps all three in one scroll box.
    const markAll = panel.querySelector('[data-testid="notification-bell-mark-all"]')
    const viewAll = panel.querySelector('[data-testid="notification-bell-view-all"]')
    expect(list?.contains(markAll as Node)).toBe(false)
    expect(list?.contains(viewAll as Node)).toBe(false)
    // The rows, by contrast, ARE inside it.
    expect(list?.querySelector('[data-testid="notification-bell-open-n-5"]')).toBeTruthy()
  })

  // TEST-6 — ITEM-3 + ITEM-4.
  test('TEST-6: a long unbroken token cannot widen its row', () => {
    const panel = mountAndOpen()

    // The wrap rule must sit on the CONTENT COLUMN, because the column's
    // content comes from an app-registered renderer the SDK cannot restyle.
    // `wrap-anywhere` (overflow-wrap: anywhere) both wraps the token AND
    // shrinks the column's min-content contribution, so the flex row cannot be
    // forced wider than the panel; `break-words` would do only the former.
    const columns = [
      ...panel.querySelectorAll<HTMLElement>('[data-testid^="notification-bell-open-"]'),
    ]
    expect(columns.length).toBeGreaterThan(0)
    for (const col of columns) {
      expect(col.className, 'content column must allow shrink').toContain('min-w-0')
      expect(col.className, 'content column must wrap anywhere').toContain('wrap-anywhere')
    }

    // The long token is rendered INSIDE such a column (i.e. it inherits the
    // rule) rather than in some sibling that escapes it.
    const tokenHost = columns.find(c => c.textContent?.includes(UNBROKEN_TOKEN))
    expect(tokenHost, 'the unbroken token must render inside a wrapping column').toBeTruthy()

    // The row's action group is a SIBLING that never shrinks and carries no
    // width of its own, so the column absorbs all the flexing.
    const readBtn = panel.querySelector<HTMLElement>(
      '[data-testid="notification-bell-read-n-1"]',
    )
    const group = readBtn?.parentElement
    expect(group?.className).toContain('shrink-0')
    expect(group?.getAttribute('style') ?? '').not.toMatch(/width/)
  })

  // TEST-7 — [acceptance] for INV-3. Asserts the DESIGN's promise (logical
  // direction only) over the whole RENDERED subtree, so it fails wherever the
  // promise is broken — not only at the one line this fix edited.
  test('TEST-7: no physical-direction utility survives in the rendered popover', () => {
    // Mount for its effect — the sweep below reads the portaled popup off the
    // document, so the returned panel handle isn't needed here.
    mountAndOpen()

    const PHYSICAL =
      /(?:^|\s)(?:-?(?:pl|pr|ml|mr)-[\w.[\]/-]+|text-left|text-right|float-left|float-right)(?=\s|$)/

    const offenders = [...popup().querySelectorAll<HTMLElement>('*')]
      .concat(popup())
      .filter(el => PHYSICAL.test(el.className ?? ''))
      .map(el => `${el.tagName}: ${el.className}`)

    expect(offenders).toEqual([])

    // Negative control: the matcher genuinely fires. Without this, a broken
    // regex would make the assertion above pass vacuously forever.
    const probe = document.createElement('div')
    probe.className = 'flex gap-2 pl-4'
    expect(PHYSICAL.test(probe.className)).toBe(true)
    probe.className = 'flex gap-2 ps-4'
    expect(PHYSICAL.test(probe.className)).toBe(false)
  })
})
