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

/**
 * Testids for the fixture kind-renderer's action buttons. Held in variables (not
 * written inline as attribute literals) for the registry reason documented on
 * `sel` below — the kit `Button` requires a `data-testid`, and a literal one here
 * would leak a harness fixture into the app's typed product registry.
 */
const ACCEPT_TID = 'kind-action-accept'
const DECLINE_TID = 'kind-action-decline'

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
      <Button data-testid={ACCEPT_TID} variant="ghost">
        Accept
      </Button>
      <Button data-testid={DECLINE_TID} variant="ghost">
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

/**
 * Build a `data-testid` attribute selector WITHOUT writing the literal
 * `data-testid="…"` text anywhere in this file.
 *
 * `sdk/packages/gallery/scripts/gen-testid-registry.mjs` scans `src/**` for
 * /data-testid\s*[=:]\s*["']([^"']+)["']/ and folds every hit into the app's
 * TYPED product registry. It skips the `tests/` tree but NOT `src/`, where this
 * harness lives — so writing the attribute selector out in full would register
 * per-row FIXTURE ids (`notification-bell-read-n-5`, the kind-action buttons)
 * as static PRODUCT testids and make `npm run check:testid-registry` demand
 * they be committed. Composing the attribute name from a variable keeps this
 * harness out of the registry entirely: this fix adds ZERO registry churn.
 */
const TID = 'data-testid'
const sel = (id: string) => `[${TID}="${id}"]`

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
    const rows = panel.querySelectorAll(`[${TID}^="notification-bell-open-"]`)
    expect(rows.length).toBe(8)

    // Real content, from the REGISTERED renderers (not the fallback).
    expect(panel.textContent).toContain(LONG_TITLE)
    expect(panel.textContent).toContain(UNBROKEN_TOKEN)
    expect(panel.textContent).toContain('Notification 5')

    // Both per-row controls exist for an unread row...
    expect(panel.querySelector(sel('notification-bell-read-n-5'))).toBeTruthy()
    expect(panel.querySelector(sel('notification-bell-delete-n-5'))).toBeTruthy()
    // ...and the kind renderer's inline actions row rendered too, so TEST-7's
    // sweep genuinely covers the `ps-4` actions container.
    expect(panel.querySelector(sel(ACCEPT_TID))).toBeTruthy()

    // Header + footer are present.
    expect(panel.querySelector(sel('notification-bell-mark-all'))).toBeTruthy()
    expect(panel.querySelector(sel('notification-bell-view-all'))).toBeTruthy()
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
    //     panel), not on a child, and it is viewport-relative.
    //
    //     Tokenise the class list rather than regexing the whole string: an
    //     earlier draft used /\bw-\[…vw…\]/ against `popupCls`, and `\b` matches
    //     between the `-` and the `w` of `max-w-[…]` — so a `max-w` bound alone
    //     satisfied it and a fixed `w-[340px] max-w-[100vw]` would have passed
    //     the very check meant to forbid a fixed pixel width.
    const classes = popup().className.split(/\s+/).filter(Boolean)
    const widthTokens = classes.filter(c => /^w-/.test(c))
    expect(widthTokens, 'the popup must declare exactly one width').toHaveLength(1)
    expect(
      widthTokens[0],
      'panel width must be viewport-relative (not w-72, not a fixed w-[Npx])',
    ).toMatch(/^w-\[.*vw.*\]$/)
    // The kit primitive's own `w-72` must have been MERGED AWAY, not merely
    // followed — otherwise the override depends on stylesheet source order.
    expect(classes, 'the primitive w-72 must be merged away').not.toContain('w-72')

    // (c) The whole PANEL is height-bounded by the viewport-aware
    //     `--available-height`, so the pinned header + footer + list can never
    //     exceed the space base-ui measured.
    expect(
      classes.some(c => c.includes('--available-height') && c.startsWith('max-h-')),
      'panel height must be bounded by --available-height',
    ).toBe(true)

    // (d) Only the list scrolls, and it derives its height from that bound via
    //     `min-h-0 flex-1` rather than a hardcoded "reserve Nrem for chrome"
    //     subtraction, which silently breaks when the chrome changes height.
    const list = panel.querySelector<HTMLElement>(sel('notification-bell-list'))
    expect(list, 'the list must be its own scroll container').toBeTruthy()
    expect(list?.className).toContain('min-h-0')
    expect(list?.className).toContain('flex-1')

    // (e) …and the header + footer are SIBLINGS of the scroller, not inside it,
    //     so both stay reachable however long the list gets. This is the
    //     assertion that fails if someone re-wraps all three in one scroll box.
    const markAll = panel.querySelector(sel('notification-bell-mark-all'))
    const viewAll = panel.querySelector(sel('notification-bell-view-all'))
    expect(list?.contains(markAll as Node)).toBe(false)
    expect(list?.contains(viewAll as Node)).toBe(false)
    // The rows, by contrast, ARE inside it.
    expect(list?.querySelector(sel('notification-bell-open-n-5'))).toBeTruthy()
  })

  // TEST-6 — ITEM-3 + ITEM-4.
  //
  // HONEST SCOPE: this is a STRUCTURAL assertion, and structural assertions of
  // the form "the class string contains X" are close to tautological — they
  // restate what the diff wrote. It is kept because it localises a regression
  // to one line instantly, but it is NOT the proof that the invariant holds.
  // The BEHAVIOURAL proof — the long token's rendered box actually staying
  // inside the panel, which fails if `wrap-anywhere` is deleted — is
  // `bell-popover-responsive.spec.ts`'s "long-token row" assertions, because
  // only a real browser lays text out. Do not treat this test as covering INV-4.
  test('TEST-6: the wrap rule is on the content column, where a kind renderer inherits it', () => {
    const panel = mountAndOpen()

    // The wrap rule must sit on the CONTENT COLUMN, because the column's
    // content comes from an app-registered renderer the SDK cannot restyle.
    // `wrap-anywhere` (overflow-wrap: anywhere) both wraps the token AND
    // shrinks the column's min-content contribution, so the flex row cannot be
    // forced wider than the panel; `break-words` would do only the former.
    const columns = [
      ...panel.querySelectorAll<HTMLElement>(`[${TID}^="notification-bell-open-"]`),
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
      sel('notification-bell-read-n-1'),
    )
    const group = readBtn?.parentElement
    expect(group?.className).toContain('shrink-0')
    expect(group?.getAttribute('style') ?? '').not.toMatch(/width/)
  })

  // TEST-7 — [acceptance] for INV-3. Asserts the DESIGN's promise (logical
  // direction only) over the whole RENDERED subtree, so it fails wherever the
  // promise is broken — not only at the one line this fix edited. This is also
  // the ONLY enforcement of INV-3 for this code: `npm run lint:logical-direction`
  // diffs the PARENT repo and filters to `src-app/{ui,desktop/ui}/src/`, so a
  // change inside the `sdk` submodule is invisible to it.
  test('TEST-7: no physical-direction LAYOUT utility survives in the rendered popover', () => {
    const panel = mountAndOpen()

    // Population control, local to THIS test. TEST-8 proves the fixture renders,
    // but it is a separate `test()` with its own mount — so without this line a
    // crash in this mount would leave the sweep below scanning nothing and
    // passing.
    expect(panel.textContent, 'the sweep must run against a populated panel').toContain(
      UNBROKEN_TOKEN,
    )
    expect(panel.querySelector(sel(ACCEPT_TID)), 'the ps-4 actions row must render').toBeTruthy()

    // Physical-direction LAYOUT utilities: padding, margin, border, radius,
    // inset, scroll-margin/padding, text alignment, float, and the `space-x`
    // shorthand. The earlier draft covered only pl/pr/ml/mr + text-left/right.
    // Two shapes, because Tailwind spells the side differently per family:
    // padding/margin fuse it on (`pl-4`, `-ml-2`, `scroll-pr-2`), while
    // border/radius separate it (`border-l-2`, `border-l`, `rounded-r-lg`).
    const PHYSICAL = new RegExp(
      [
        '^-?(?:p|m|scroll-p|scroll-m)(?:l|r)-',
        '^-?(?:border|rounded)-(?:l|r)(?:-|$)',
        '^-?(?:left|right)-',
        '^-?space-x-',
        '^(?:text|float|clear)-(?:left|right)$',
      ].join('|'),
    )

    // EXCLUDED, deliberately and narrowly: the kit popover primitive's own
    // ENTER-ANIMATION classes (`data-[side=left]:slide-in-from-right-2`, …).
    // They are variant-prefixed motion, not layout box-model direction; they
    // live in `sdk/packages/kit/src/shadcn/popover.tsx`, which this change does
    // NOT own (a concurrent workstream is reworking that primitive). Scoped to
    // the `slide-in-from-*` family under a `data-[side=…]:` variant so an
    // ordinary physical utility can never hide behind this exemption.
    const isKitSlideAnimation = (t: string) =>
      /^data-\[side=[a-z-]+\]:slide-in-from-(?:left|right|top|bottom)-/.test(t)

    // `el.className` is an SVGAnimatedString on SVG elements (every lucide
    // icon), which stringifies to "[object SVGAnimatedString]" — silently
    // exempting the entire icon subtree from the sweep. Read the attribute.
    const classTokens = (el: Element) =>
      (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)

    const offenders = [...popup().querySelectorAll('*')]
      .concat(popup())
      .flatMap(el =>
        classTokens(el)
          .filter(t => !isKitSlideAnimation(t) && PHYSICAL.test(t))
          .map(t => `${el.tagName}: ${t}`),
      )

    expect(offenders).toEqual([])

    // Negative controls: the matcher genuinely fires on each family it claims to
    // cover, and does NOT fire on the logical equivalents. Without these, a
    // broken regex would make the assertion above pass vacuously forever.
    for (const bad of [
      'pl-4', 'pr-2', 'ml-1', 'mr-3', 'border-l-2', 'border-l', 'rounded-r-lg',
      'rounded-l', 'left-0', 'right-4', 'space-x-2', 'text-left', 'text-right',
      '-ml-2', 'scroll-pl-4',
    ]) {
      expect(PHYSICAL.test(bad), `${bad} must be flagged`).toBe(true)
    }
    for (const ok of [
      'ps-4', 'pe-2', 'ms-1', 'me-3', 'border-s-2', 'rounded-e-lg', 'border-s',
      'start-0', 'end-4', 'space-y-2', 'text-start', 'text-end', 'p-4', 'm-2',
      'rounded-lg', 'border-2', 'scroll-ps-4',
    ]) {
      expect(PHYSICAL.test(ok), `${ok} must NOT be flagged`).toBe(false)
    }
    // …and the exemption is narrow: a physical utility cannot hide behind it.
    expect(isKitSlideAnimation('data-[side=left]:slide-in-from-right-2')).toBe(true)
    expect(isKitSlideAnimation('data-[side=left]:pl-4')).toBe(false)
  })

  // TEST-9 — the EMPTY branch. The whole fix is about the populated render, so
  // the zero-notification path is where a regression would hide: it takes a
  // DIFFERENT branch (`<Empty>` instead of the `ScrollArea`), so the list and
  // its testid do not exist at all there. This asserts the panel is still
  // correctly bounded, and still free of inline sizing, with nothing in it.
  test('TEST-9: the empty (0-notification) branch is bounded the same way', () => {
    const panel = mountAndOpen([])

    expect(panel.querySelector(sel('notification-bell-empty')), 'empty state renders').toBeTruthy()
    // The list branch is genuinely absent — this is a different code path.
    expect(panel.querySelector(sel('notification-bell-list'))).toBeNull()
    // No unread ⇒ no "Mark all read"; "View all" still renders (inboxPath set).
    expect(panel.querySelector(sel('notification-bell-mark-all'))).toBeNull()
    expect(panel.querySelector(sel('notification-bell-view-all'))).toBeTruthy()

    // The panel's bounds come from the popup, so they hold on this branch too.
    const classes = popup().className.split(/\s+/).filter(Boolean)
    expect(classes.filter(c => /^w-/.test(c))).toHaveLength(1)
    expect(classes).not.toContain('w-72')
    expect(
      classes.some(c => c.includes('--available-height') && c.startsWith('max-h-')),
    ).toBe(true)

    // And no inline pixel sizing crept back in on this branch.
    const inlineSized = [...popup().querySelectorAll<HTMLElement>('*')]
      .concat(popup())
      .filter(el => /(^|;)\s*(width|max-height|height)\s*:\s*\d/.test(el.getAttribute('style') ?? ''))
    expect(inlineSized).toEqual([])
  })
})
