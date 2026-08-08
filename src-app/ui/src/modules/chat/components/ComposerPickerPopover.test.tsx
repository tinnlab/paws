/**
 * Component harness for the composer "+" submenu picker.
 *
 * Vitest + jsdom, mounted with React's own `createRoot` + `act` — there is no
 * `@testing-library/*` in this repo, so interaction is raw `dispatchEvent` inside
 * `act`, mirroring `src/modules/js-tool/chat-extension/components/JsToolApprovalContent.test.tsx`
 * (the workspace's other real mounting spec).
 *
 * The workspace's vitest `include` is `['src/**\/*.store.test.ts', 'src/**\/*.test.tsx']`
 * and `npm run test:unit` is `node --test` over `*.test.ts` — which cannot load `.tsx`
 * at all. So this spec MUST keep its `.tsx` extension: a `*.test.ts` here would run
 * NOTHING and look like a pass.
 *
 *   npx vitest run src/modules/chat/components/ComposerPickerPopover.test.tsx
 *
 * Popover content is portalled to `document.body`, not into the mount host, so the
 * open-state queries are document-scoped.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import fs from 'node:fs'
import path from 'node:path'
import {
  ComposerPickerPanel,
  ComposerPickerPopover,
  type ComposerPickerItem,
} from './ComposerPickerPopover'

// React 19 wants this set before `act` is used outside a framework adapter.
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// jsdom ships neither of these; floating-ui (Base UI's positioner) and
// overlayscrollbars both reach for them on mount.
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

interface Mounted {
  host: HTMLElement
  unmount(): Promise<void>
}

const live: Mounted[] = []

async function mountNode(node: React.ReactElement): Promise<Mounted> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root: Root = createRoot(host)
  let alive = true
  const m: Mounted = {
    host,
    unmount: async () => {
      if (!alive) return
      alive = false
      await act(async () => {
        root.unmount()
      })
      host.remove()
    },
  }
  await act(async () => {
    root.render(node)
  })
  live.push(m)
  return m
}

beforeEach(() => {
  document.body.innerHTML = ''
})

afterEach(async () => {
  for (const m of live.splice(0)) await m.unmount()
  document.body.innerHTML = ''
})

// ── helpers ─────────────────────────────────────────────────────────────────────

const items = (n: number, prefix = 'Entry'): ComposerPickerItem[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `id-${i}`,
    label: `${prefix} ${String(i).padStart(2, '0')}`,
    testId: `opt-${i}`,
  }))

const searchBox = (): HTMLInputElement => {
  const el = document.querySelector<HTMLInputElement>('[role="combobox"]')
  if (!el) throw new Error('no search box rendered')
  return el
}

const options = (): HTMLElement[] => [
  ...document.querySelectorAll<HTMLElement>('[role="option"]'),
]

const labels = (): string[] =>
  options().map(o => o.querySelector('span')?.textContent?.trim() ?? '')

async function type(value: string): Promise<void> {
  const input = searchBox()
  await act(async () => {
    // React tracks the previous value on the DOM node; bypass its setter so the
    // synthetic `change` actually fires with the new value.
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function press(key: string, target: HTMLElement = searchBox()): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  })
}

async function click(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

const panel = (props: Partial<React.ComponentProps<typeof ComposerPickerPanel>> = {}) => (
  <ComposerPickerPanel
    data-testid="picker"
    items={items(12)}
    onSelect={() => undefined}
    searchLabel="Search entries"
    searchPlaceholder="Filter entries…"
    emptyContent={<div data-testid="picker-cta">Nothing configured yet</div>}
    {...props}
  />
)

// ── ITEM-4 / ITEM-1: filtering ──────────────────────────────────────────────────

describe('search filters the list (TEST-1)', () => {
  test('typing narrows to substring matches, case-insensitively; clearing restores', async () => {
    await mountNode(panel())
    expect(options()).toHaveLength(12)

    await type('entry 07')
    expect(labels()).toEqual(['Entry 07'])

    // Case-insensitive: the items are "Entry NN", the query is lower-case.
    await type('ENTRY 0')
    expect(options()).toHaveLength(10)

    await type('')
    expect(options()).toHaveLength(12)
  })
})

// ── ITEM-5: the two empty states ────────────────────────────────────────────────

describe('empty states (TEST-2, TEST-3)', () => {
  test('a query matching nothing renders an explicit no-matches row, not a blank panel', async () => {
    await mountNode(panel())
    await type('zzzz-no-such-entry')

    expect(options()).toHaveLength(0)
    const none = document.querySelector('[data-testid="picker-no-matches"]')
    expect(none).not.toBeNull()
    expect(none?.textContent?.trim()).toBe('No matches.')
  })

  test('zero items renders the caller CTA and NO search box', async () => {
    await mountNode(panel({ items: [] }))

    expect(document.querySelector('[data-testid="picker-cta"]')).not.toBeNull()
    expect(document.querySelector('[role="combobox"]')).toBeNull()
    expect(options()).toHaveLength(0)
  })
})

// ── ITEM-6: keyboard + focus + ARIA ─────────────────────────────────────────────

describe('keyboard navigation (TEST-5, TEST-6)', () => {
  test('arrows move aria-activedescendant across the FILTERED set and wrap; Home/End jump', async () => {
    await mountNode(panel())
    const activeLabel = () =>
      document.getElementById(searchBox().getAttribute('aria-activedescendant') ?? '')
        ?.querySelector('span')
        ?.textContent?.trim()

    expect(activeLabel()).toBe('Entry 00')
    await press('ArrowDown')
    expect(activeLabel()).toBe('Entry 01')
    await press('ArrowUp')
    expect(activeLabel()).toBe('Entry 00')
    // wraps backwards to the last row
    await press('ArrowUp')
    expect(activeLabel()).toBe('Entry 11')
    // wraps forwards to the first
    await press('ArrowDown')
    expect(activeLabel()).toBe('Entry 00')

    await press('End')
    expect(activeLabel()).toBe('Entry 11')
    await press('Home')
    expect(activeLabel()).toBe('Entry 00')

    // Now filter to 3 rows: End must land on the last FILTERED row, not row 11.
    await type('entry 0')
    await type('entry 00')
    await press('End')
    expect(activeLabel()).toBe('Entry 00')
    expect(options()).toHaveLength(1)
  })

  test('Enter activates the ACTIVE option, not merely the first match', async () => {
    const picked: string[] = []
    await mountNode(panel({ onSelect: item => picked.push(item.id) }))

    await press('ArrowDown')
    await press('ArrowDown')
    await press('Enter')

    // Two ArrowDowns from row 0 ⇒ row 2. A "select the first match" implementation
    // would push id-0 here and this assertion is what rules it out.
    expect(picked).toEqual(['id-2'])
  })
})

describe('ARIA contract (TEST-8)', () => {
  test('combobox → listbox → options, with accessible names and aria-selected', async () => {
    await mountNode(panel({ selectedIds: new Set(['id-3']) }))

    const input = searchBox()
    expect(input.getAttribute('aria-label')).toBe('Search entries')
    expect(input.getAttribute('aria-expanded')).toBe('true')

    const listId = input.getAttribute('aria-controls')
    expect(listId).toBeTruthy()
    const list = document.getElementById(listId as string)
    expect(list?.getAttribute('role')).toBe('listbox')

    const opts = options()
    expect(opts).toHaveLength(12)
    expect(opts.every(o => o.hasAttribute('aria-selected'))).toBe(true)
    expect(opts.filter(o => o.getAttribute('aria-selected') === 'true')).toHaveLength(1)
    expect(
      opts
        .find(o => o.getAttribute('aria-selected') === 'true')
        ?.querySelector('span')
        ?.textContent?.trim(),
    ).toBe('Entry 03')

    // Every option is addressable by aria-activedescendant.
    expect(opts.every(o => !!o.id)).toBe(true)
  })
})

// ── ITEM-2: long labels stay recoverable ────────────────────────────────────────

describe('long labels (TEST-10)', () => {
  test('a 300-char label is rendered in its own node carrying the full text in title', async () => {
    const long = 'L'.repeat(300)
    await mountNode(panel({ items: [{ id: 'long', label: long }] }))

    const span = options()[0]?.querySelector('span')
    expect(span).not.toBeNull()
    // jsdom does no layout, so the visual cap is proven by the e2e (TEST-13); what
    // is provable here is that the elided text stays recoverable by the user.
    expect(span?.getAttribute('title')).toBe(long)
    expect(span?.textContent).toBe(long)
  })
})

// ── ITEM-6: focus-on-open + Escape scoping, through the real Popover ────────────

describe('popover open/close (TEST-4, TEST-7)', () => {
  const popover = (onSelect: (i: ComposerPickerItem) => void = () => undefined) => (
    <ComposerPickerPopover
      data-testid="picker"
      items={items(5)}
      onSelect={onSelect}
      searchLabel="Search entries"
      searchPlaceholder="Filter entries…"
      emptyContent={<div>none</div>}
      trigger={
        <div data-testid="picker-trigger" role="button" tabIndex={0}>
          Open picker
        </div>
      }
    />
  )

  test('opening the picker puts focus in the search box', async () => {
    await mountNode(popover())
    const trigger = document.querySelector<HTMLElement>('[data-testid="picker-trigger"]')
    expect(trigger).not.toBeNull()

    await click(trigger as HTMLElement)
    // Base UI focuses the first tabbable element in the popup by default; the search
    // box is deliberately first so no ref/setTimeout hack is needed. Proven by
    // mounting, never by reading the code.
    await act(async () => {
      await Promise.resolve()
    })

    expect(document.querySelector('[role="listbox"]')).not.toBeNull()
    expect(document.activeElement).toBe(searchBox())
  })

  test('Escape closes THIS picker and does not reach an outer listener', async () => {
    const outer: string[] = []
    const onDocKey = (e: Event) => outer.push((e as KeyboardEvent).key)
    document.addEventListener('keydown', onDocKey)
    try {
      await mountNode(popover())
      await click(document.querySelector<HTMLElement>('[data-testid="picker-trigger"]') as HTMLElement)
      expect(document.querySelector('[role="listbox"]')).not.toBeNull()

      await press('Escape')

      expect(document.querySelector('[role="listbox"]')).toBeNull()
      // The parent "+" dropdown listens above this subtree; the Escape must not
      // have bubbled out of the submenu.
      expect(outer).not.toContain('Escape')
    } finally {
      document.removeEventListener('keydown', onDocKey)
    }
  })
})

// ── ITEM-1 / ITEM-9 / ITEM-10: the unification is structural, not incidental ────

const SRC = path.resolve(__dirname, '../../..')
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8')
/** Module specifiers a file imports (import-graph, not arbitrary text matching). */
const importsOf = (rel: string): string[] => [
  ...read(rel).matchAll(/^import\s[\s\S]*?from\s+'([^']+)'/gm),
].map(m => m[1])

describe('both pickers are built from the ONE primitive (TEST-9, TEST-19)', () => {
  const ASSISTANT = 'modules/assistant/chat-extension/components/AssistantMenuItem.tsx'
  const KB = 'modules/knowledge-base/chat-extension/components/KbMenuItem.tsx'

  test('each caller imports the shared primitive and the shared trigger row', () => {
    for (const f of [ASSISTANT, KB]) {
      const imports = importsOf(f)
      expect(imports, `${f} must use the shared picker`).toContain(
        '@/modules/chat/components/ComposerPickerPopover',
      )
      expect(imports, `${f} must use the shared "+" row`).toContain(
        '@/modules/chat/components/PlusMenuItem',
      )
    }
  })

  test('neither caller still carries its own popover or scroll implementation', () => {
    for (const f of [ASSISTANT, KB]) {
      const kit = importsOf(f).filter(m => m === '@ziee/kit')
      // KbMenuItem still imports `message` from the kit; what must be gone is any
      // direct Popover/ScrollArea/Input usage — the shell now owns all three.
      const src = read(f)
      const kitImportLine = src.match(/import\s*\{([^}]*)\}\s*from\s*'@ziee\/kit'/)?.[1] ?? ''
      const named = kitImportLine
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
      expect(named, `${f} must not import Popover from the kit any more`).not.toContain('Popover')
      expect(named, `${f} must not import ScrollArea from the kit`).not.toContain('ScrollArea')
      expect(named, `${f} must not import Input from the kit`).not.toContain('Input')
      expect(kit.length, `${f} kit import count`).toBeLessThanOrEqual(1)
    }
  })

  test('the dead third assistant picker is gone and nothing imports it', () => {
    expect(
      fs.existsSync(path.join(SRC, 'modules/assistant/chat-extension/components/AssistantSelector.tsx')),
    ).toBe(false)

    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name)
        if (e.isDirectory()) {
          if (e.name !== 'node_modules') walk(full)
        } else if (/\.tsx?$/.test(e.name)) {
          // Import-graph, not a text scan: a spec that merely NAMES the deleted
          // component (this file does) is not a usage, and excluding files by name
          // would be the kind of self-exempting grep that hides real hits.
          const src = fs.readFileSync(full, 'utf8')
          if (/(?:from\s*['"]|import\s*\(\s*['"])[^'"]*AssistantSelector['"]/.test(src)) {
            offenders.push(path.relative(SRC, full))
          }
        }
      }
    }
    walk(SRC)
    expect(offenders).toEqual([])
  })
})
