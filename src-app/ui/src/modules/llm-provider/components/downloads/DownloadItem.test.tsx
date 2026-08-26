/**
 * COMPONENT HARNESS for `DownloadItem` in `minimal` mode — the row the sidebar
 * Downloads panel renders.
 *
 * TEST-3 [covers: ITEM-2] — the row truncates by CSS, keeps the FULL name
 * available, and cannot push the percentage out of the row.
 *
 * ## Why this file exists
 *
 * The owner's report ("the progress bar and the percentage render outside that
 * box") had TWO independent causes. The panel's fixed width is the obvious one
 * and is proven geometrically in a real browser by
 * `tests/e2e/llm/download-popover-responsive.spec.ts`. This file pins the other
 * one, which survives a correctly-bounded panel:
 *
 *  - the name/percent flex row had NO `min-w-0`, and a flex child's default
 *    `min-width: auto` refuses to shrink below its content — so a long name
 *    forced the row wider than the panel and pushed the percentage out;
 *  - the name was truncated by JS character count (`substring(0, 30)`), which
 *    cannot respond to the panel's actual width AND destroyed the full name, so
 *    nothing was left for a tooltip/title to reveal.
 *
 * ## What this harness proves, and what it deliberately does NOT
 *
 * jsdom does no layout, so it cannot measure whether the percentage is inside
 * the panel — that is the e2e's job. What it pins is the DOM CONTRACT that
 * produces the geometry, plus the one thing jsdom CAN prove outright: the full
 * name is still in the DOM rather than sliced away.
 *
 *   npx vitest run src/modules/llm-provider/components/downloads/DownloadItem.test.tsx
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import type { DownloadInstance } from '@/api-client/types'
import { DownloadItem } from './DownloadItem'

/**
 * 71 characters — comfortably past the old 30-character slice, and past what
 * fits in a ~268px panel column, so both mechanisms are exercised.
 */
const LONG_NAME =
  'Qwen3.5 9B Instruct — Q4_K_M (tinnlab mirror of the unsloth GGUF build)'

const TID = 'data-testid'
const sel = (id: string) => `[${TID}="${id}"]`

/**
 * Resolve the name + percentage elements STRUCTURALLY, not by the testids this
 * change introduces.
 *
 * This matters more than it looks. An earlier draft selected them by their new
 * `llm-download-item-{name,percent}` testids, and every assertion then went red
 * against pre-fix code with "expected null to be truthy" — i.e. red because a
 * testid was missing, not because the row overflowed. A red that is not caused
 * by the defect proves nothing about the defect, and would keep proving nothing
 * if the fix were later reverted while the testids stayed.
 *
 * The name/percent row exists in BOTH versions as the first `div.flex` inside
 * the card, with the name first and the percentage last, so anchoring there
 * makes the failures below attributable to the real mechanism.
 */
function nameAndPercent(card: HTMLElement): {
  row: HTMLElement
  name: HTMLElement
  percent: HTMLElement
} {
  const row = card.querySelector<HTMLElement>('div.flex')
  expect(row, 'the name/percent flex row must exist').toBeTruthy()
  const kids = [...(row as HTMLElement).children] as HTMLElement[]
  expect(kids.length, 'the row holds a name and a percentage').toBeGreaterThanOrEqual(2)
  return {
    row: row as HTMLElement,
    name: kids[0],
    percent: kids[kids.length - 1],
  }
}

function makeDownload(displayName: string): DownloadInstance {
  return {
    id: 'dl-1',
    provider_id: 'p-1',
    repository_id: 'r-1',
    status: 'downloading',
    created_at: '2026-08-08T09:00:00.000Z',
    started_at: '2026-08-08T09:00:00.000Z',
    updated_at: '2026-08-08T09:00:00.000Z',
    progress_data: {
      current: 3_650_722_201,
      total: 6_100_000_000,
      phase: 'downloading',
      message: 'Fetching weights…',
      speed_bps: 5_242_880,
      eta_seconds: 468,
    },
    request_data: {
      model_name: 'qwen3-5-9b',
      display_name: displayName,
      repository_path: 'Qwen3.5-9B-GGUF',
      main_filename: 'Qwen3.5-9B-Q4_K_M.gguf',
    },
  } as unknown as DownloadInstance
}

let container: HTMLDivElement
let root: Root

function mount(displayName = LONG_NAME): HTMLElement {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root.render(
      <MemoryRouter>
        <DownloadItem download={makeDownload(displayName)} mode="minimal" />
      </MemoryRouter>,
    )
  })
  const card = container.querySelector<HTMLElement>(sel('llm-download-item-card'))
  expect(card, 'the minimal row must render').toBeTruthy()
  return card as HTMLElement
}

beforeEach(() => {
  document.body.innerHTML = ''
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  document.body.innerHTML = ''
})

describe('DownloadItem (minimal) — row containment contract', () => {
  // Population control. Every assertion below is of the form "the row does X";
  // all of them pass VACUOUSLY against a crashed or empty render.
  test('TEST-3a: the fixture really renders a populated row', () => {
    const card = mount()
    const { name, percent } = nameAndPercent(card)
    expect(name.textContent, 'the name column has content').toBeTruthy()
    expect(card.querySelector(sel('llm-download-progress'))).toBeTruthy()
    // 3_650_722_201 / 6_100_000_000 → 60%.
    expect(percent.textContent).toContain('60')
  })

  test('TEST-3: the name truncates by CSS, keeps its full text, and never displaces the percentage', () => {
    const card = mount()

    const { row, name, percent } = nameAndPercent(card)

    // (a) The FULL name survives. This is the assertion that fails against the
    //     old `substring(0, 30) + '...'`, which destroyed everything past
    //     character 30 — so no tooltip or title could ever reveal it.
    expect(name.textContent, 'the full name must reach the DOM').toBe(LONG_NAME)
    expect(
      name.textContent,
      'the name must not be sliced by a character count',
    ).not.toContain('...')
    expect(name.getAttribute('title'), 'the full name is revealable').toBe(LONG_NAME)

    // (b) The row and the name can SHRINK. Without `min-w-0` a flex child's
    //     default `min-width: auto` refuses to shrink below its content, which
    //     is the mechanism that pushed the percentage out of the row.
    expect(row.className, 'the row must be allowed to shrink').toContain('min-w-0')
    expect(name.className, 'the name column must be allowed to shrink').toContain('min-w-0')

    // (c) The percentage never shrinks or wraps — it is the fixed end of the
    //     row, so all the flexing is absorbed by the name column.
    expect(percent.className, 'the percentage must not shrink').toContain('shrink-0')

    // (d) No inline ABSOLUTE sizing anywhere in the row: the panel owns the
    //     width, and a re-introduced inline pixel size here would defeat that
    //     from inside.
    //
    //     Two exclusions, both deliberate and both narrow:
    //      - a PERCENTAGE width is not a layout bound, it is data — the kit
    //        `Progress` fill is `width: 60%`, which is the whole point of a
    //        progress bar. Only absolute units (px/rem/em) are flagged.
    //      - the visually-hidden a11y span (`clip-path: inset(50%)` + a 1px
    //        box) is a standard sr-only idiom, not a layout box.
    const isSrOnly = (style: string) => /clip-path:\s*inset\(50%\)/.test(style)
    const inlineSized = [...card.querySelectorAll<HTMLElement>('*')]
      .concat(card)
      .filter(el => {
        const style = el.getAttribute('style') ?? ''
        if (isSrOnly(style)) return false
        return /(^|;)\s*(width|max-width|height|max-height)\s*:\s*\d+(px|rem|em)\b/.test(
          style,
        )
      })
      .map(el => `${el.tagName}[${el.getAttribute('style')}]`)
    expect(inlineSized).toEqual([])

    // Negative controls, so a broken matcher cannot make (d) pass vacuously.
    const flags = (style: string) =>
      !isSrOnly(style) &&
      /(^|;)\s*(width|max-width|height|max-height)\s*:\s*\d+(px|rem|em)\b/.test(style)
    expect(flags('width: 320px'), 'a fixed pixel width must be flagged').toBe(true)
    expect(flags('max-height: 440px'), 'a fixed pixel max-height must be flagged').toBe(true)
    expect(flags('width: 60%'), 'a percentage width must NOT be flagged').toBe(false)
  })

  // The short-name case takes the same code path now (there is no longer a
  // length branch at all), so this guards against someone re-introducing one.
  test('TEST-3b: a short name is rendered verbatim, with no branch of its own', () => {
    const card = mount('Tiny Model')
    const { name } = nameAndPercent(card)
    expect(name.textContent).toBe('Tiny Model')
    expect(name.getAttribute('title')).toBe('Tiny Model')
    expect(name.className).toContain('min-w-0')
  })
})
