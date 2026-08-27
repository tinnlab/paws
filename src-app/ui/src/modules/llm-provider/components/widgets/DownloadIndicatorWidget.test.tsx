/**
 * COMPONENT HARNESS for the sidebar Downloads popover
 * (`DownloadIndicatorWidget`).
 *
 * TEST-2 [covers: ITEM-1] — the panel, not a child of it, owns the size, and
 * that size is viewport-bounded.
 *
 * ## Why this file exists
 *
 * The owner reported: *"while a download is running, the progress bar and the
 * percentage render outside that box."* Measured on `origin/main` the content
 * wrapper carried an inline `style={{ width: 320, maxHeight: 440 }}` while the
 * kit popup box is `w-72` (288px) with `p-2.5` — 268px usable — so 52px of
 * every row painted outside the popover's background, and the height bound was
 * not viewport-relative at all.
 *
 * This is the SAME defect the notification bell already fixed, and this harness
 * is deliberately the twin of
 * `src/modules/notification/components/NotificationBellPopover.test.tsx`. The
 * two popovers now open from adjacent icons in one sidebar row, so they have to
 * stay in step; a shared test shape is how that stays true.
 *
 * ## What this harness proves, and what it deliberately does NOT
 *
 * jsdom does no layout: it cannot measure a rect, so it cannot prove
 * containment. The GEOMETRY is proven in a real browser by
 * `tests/e2e/llm/download-popover-responsive.spec.ts` (TEST-1). What this file
 * pins is the DOM/class CONTRACT that produces that geometry — the mechanism,
 * not the pixels — because that is the part a refactor can silently revert
 * while an e2e that only runs at desktop width still passes.
 *
 *   npx vitest run src/modules/llm-provider/components/widgets/DownloadIndicatorWidget.test.tsx
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import type { DownloadInstance } from '@/api-client/types'
import { LlmModelDownloadStore } from '@/modules/llm-provider/stores/llmModelDownload'
import { DownloadIndicatorWidget } from './DownloadIndicatorWidget'

const LONG_NAME =
  'Qwen3.5 9B Instruct — Q4_K_M (tinnlab mirror of the unsloth GGUF build)'

function dl(
  id: string,
  status: 'downloading' | 'failed',
  displayName: string,
): DownloadInstance {
  return {
    id,
    provider_id: 'p-1',
    repository_id: 'r-1',
    status,
    created_at: '2026-08-08T09:00:00.000Z',
    started_at: '2026-08-08T09:00:00.000Z',
    updated_at: '2026-08-08T09:00:00.000Z',
    error_message: status === 'failed' ? 'connection reset by peer' : null,
    progress_data: {
      current: 3_650_722_201,
      total: 6_100_000_000,
      phase: 'downloading',
      message: 'Fetching weights…',
      speed_bps: 5_242_880,
      eta_seconds: 468,
    },
    request_data: {
      model_name: displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      display_name: displayName,
      repository_path: 'Qwen3.5-9B-GGUF',
      main_filename: 'Qwen3.5-9B-Q4_K_M.gguf',
      file_format: 'gguf',
    },
  } as unknown as DownloadInstance
}

/**
 * An ADVERSARIAL fixture: an active row AND a failed row (the failed arm adds
 * the Clear/Retry buttons, the widest controls in the panel), with a long name.
 * An empty or single-short-row panel fits at any width and reproduces nothing —
 * which is exactly why the only gallery state that existed was blind to this.
 */
const DOWNLOADS = [
  dl('dl-active', 'downloading', LONG_NAME),
  dl('dl-failed', 'failed', 'Mistral Small 3 24B Instruct — Q5_K_M'),
]

const TID = 'data-testid'
const sel = (id: string) => `[${TID}="${id}"]`

let container: HTMLDivElement
let root: Root

/**
 * Mount the widget and OPEN its popover, returning the Base UI POPUP box — the
 * element that paints the panel background.
 *
 * The handle is `[data-slot="popover-content"]`, which exists both before and
 * after this fix, rather than a testid this change introduces: anchoring on a
 * new testid makes every assertion go red against pre-fix code for a
 * bookkeeping reason instead of for the reason under test, and a red that is
 * not caused by the defect proves nothing about the defect.
 */
function mountAndOpen(downloads: DownloadInstance[] = DOWNLOADS): HTMLElement {
  LlmModelDownloadStore.setState({ downloads } as never)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root.render(
      <MemoryRouter>
        <DownloadIndicatorWidget />
      </MemoryRouter>,
    )
  })
  const trigger = document.querySelector<HTMLElement>('[data-slot="popover-trigger"]')
  expect(trigger, 'the download trigger must render').toBeTruthy()
  act(() => {
    trigger?.click()
  })
  // Base UI portals the popup to document.body, so query the document.
  const el = document.querySelector<HTMLElement>('[data-slot="popover-content"]')
  expect(el, 'the panel must render once opened').toBeTruthy()
  return el as HTMLElement
}

function popup(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[data-slot="popover-content"]')
  expect(el, 'the panel must render').toBeTruthy()
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

describe('downloads panel — containment contract', () => {
  // Population control. Every assertion below is of the form "no element does
  // X" or "the panel declares Y"; several pass VACUOUSLY against an empty or
  // crashed render, so assert the fixture really produced a populated panel.
  test('TEST-2a: the populated fixture really renders both rows and their controls', () => {
    const panel = mountAndOpen()
    expect(panel.querySelectorAll(sel('llm-download-item-card')).length).toBe(2)
    expect(panel.textContent).toContain('Active Downloads (1)')
    expect(panel.textContent).toContain('Failed Downloads (1)')
    expect(panel.textContent).toContain(LONG_NAME)
    // The failed arm's controls — the widest things in the panel.
    expect(panel.querySelector(sel('llm-download-clear-btn-dl-failed'))).toBeTruthy()
    expect(panel.querySelector(sel('llm-download-retry-btn-dl-failed'))).toBeTruthy()
  })

  test('TEST-2: the panel is viewport-bounded and only the LIST scrolls', () => {
    const panel = mountAndOpen()

    // (a) The defect's literal mechanism is gone: no descendant of the popup
    //     carries an inline ABSOLUTE width or height. Spelled as a sweep over
    //     the whole subtree rather than a check of one element, so
    //     re-introducing the inline size ANYWHERE inside the panel fails.
    //
    //     A PERCENTAGE size is excluded on purpose — the kit `Progress` fill is
    //     `width: 60%`, which is data, not a layout bound — as is the sr-only
    //     a11y span's 1px box.
    const isSrOnly = (style: string) => /clip-path:\s*inset\(50%\)/.test(style)
    const ABSOLUTE = /(^|;)\s*(width|max-width|height|max-height)\s*:\s*\d+(px|rem|em)\b/
    const inlineSized = [...popup().querySelectorAll<HTMLElement>('*')]
      .concat(popup())
      .filter(el => {
        const style = el.getAttribute('style') ?? ''
        return !isSrOnly(style) && ABSOLUTE.test(style)
      })
      .map(el => `${el.tagName}[${el.getAttribute('style')}]`)
    expect(inlineSized).toEqual([])

    // Negative controls, so a broken matcher cannot make (a) pass vacuously.
    expect(ABSOLUTE.test('width: 320px'), 'a fixed width must be flagged').toBe(true)
    expect(ABSOLUTE.test('max-height: 440px'), 'a fixed max-height must be flagged').toBe(true)
    expect(ABSOLUTE.test('width: 60%'), 'a percentage must NOT be flagged').toBe(false)

    // (b) The WIDTH bound lives on the popup (the element that paints the
    //     panel), not on a child, and it is viewport-relative.
    //
    //     Tokenise the class list rather than regexing the whole string: `\b`
    //     matches between the `-` and the `w` of `max-w-[…]`, so a whole-string
    //     regex would accept a fixed `w-[320px] max-w-[100vw]` — the very thing
    //     this forbids. (Lesson inherited from the bell harness.)
    const classes = popup().className.split(/\s+/).filter(Boolean)
    const widthTokens = classes.filter(c => /^w-/.test(c))
    expect(widthTokens, 'the panel must declare exactly one width').toHaveLength(1)
    expect(
      widthTokens[0],
      'panel width must be viewport-relative (not w-72, not a fixed w-[Npx])',
    ).toMatch(/^w-\[.*vw.*\]$/)
    // The kit primitive's own `w-72` must have been MERGED AWAY, not merely
    // followed — otherwise the override depends on stylesheet source order.
    expect(classes, 'the primitive w-72 must be merged away').not.toContain('w-72')

    // (c) The whole PANEL is height-bounded by the viewport-aware
    //     `--available-height`, so the pinned title plus the list can never
    //     exceed the space base-ui measured.
    expect(
      classes.some(c => c.includes('--available-height') && c.startsWith('max-h-')),
      'panel height must be bounded by --available-height',
    ).toBe(true)

    // (d) The LIST is its own scroll container and derives its height from that
    //     bound via `min-h-0 flex-1`, rather than a hardcoded "reserve Nrem for
    //     the title" subtraction — which breaks silently the moment the title
    //     wraps, something the viewport-relative width makes MORE likely.
    const list = panel.querySelector<HTMLElement>(sel('llm-download-list'))
    expect(list, 'the list must be its own scroll container').toBeTruthy()
    expect(list?.className).toContain('min-h-0')
    expect(list?.className).toContain('flex-1')

    // …and the rows are inside it.
    expect(list?.querySelector(sel('llm-download-item-card'))).toBeTruthy()
  })

  // The panel's bounds must hold on the failure-only branch too, which takes a
  // different arm (no "Active Downloads" heading) and is the branch where the
  // widest controls — Clear + Retry — are the ONLY content.
  test('TEST-2b: the failed-only branch is bounded the same way', () => {
    const panel = mountAndOpen([dl('dl-failed', 'failed', LONG_NAME)])

    expect(panel.textContent).not.toContain('Active Downloads')
    expect(panel.textContent).toContain('Failed Downloads (1)')
    expect(panel.querySelector(sel('llm-download-retry-btn-dl-failed'))).toBeTruthy()

    const classes = popup().className.split(/\s+/).filter(Boolean)
    expect(classes.filter(c => /^w-/.test(c))).toHaveLength(1)
    expect(classes).not.toContain('w-72')
    expect(
      classes.some(c => c.includes('--available-height') && c.startsWith('max-h-')),
    ).toBe(true)
  })

  // The self-hiding branch: with nothing downloading the widget renders NOTHING
  // at all. This is its normal state, and it is why the sidebar row must read
  // correctly with a single child (asserted in the e2e).
  test('TEST-2c: with no active or failed downloads the widget renders nothing', () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    LlmModelDownloadStore.setState({ downloads: [] } as never)
    root = createRoot(container)
    act(() => {
      root.render(
        <MemoryRouter>
          <DownloadIndicatorWidget />
        </MemoryRouter>,
      )
    })
    expect(container.textContent).toBe('')
    expect(document.querySelector('[data-slot="popover-trigger"]')).toBeNull()
  })
})
