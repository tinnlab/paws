/**
 * COMPONENT HARNESS for `LeftSidebar`'s bottom-widget row.
 *
 * TEST-7 [covers: ITEM-4] — the `sidebarBottom` row is a SIBLING of the Tools
 * section, not a child of it, so it renders even when Tools contributes nothing.
 *
 * ## Why this file exists
 *
 * Merging the notification and download icons onto one row meant moving that
 * container, and moving it surfaced a latent bug worth pinning: the row was
 * nested INSIDE `{toolsItems.length > 0 && ( … )}`, so an empty Tools section
 * took the notification bell and the download indicator with it. Only three
 * modules register `sidebarTools` and one of them (`hub`) is hidden on paws, so
 * the margin was a single module — and no test could have caught it, because on
 * paws Tools is never empty and the e2e therefore cannot reach the branch.
 *
 * This harness reaches it directly by seeding the slot registry with NO tools.
 *
 *   npx vitest run src/modules/layouts/app-layout/components/LeftSidebar.test.tsx
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { useModuleSystemStore } from '@ziee/framework'

import { LeftSidebar } from './LeftSidebar'

const TID = 'data-testid'
const sel = (id: string) => `[${TID}="${id}"]`

/** A trivial widget so the row has a child to render. */
function MarkerWidget() {
  return <div data-testid="test-bottom-widget">bottom widget</div>
}

/** A trivial tool entry, for the control case. */
const TOOL_ITEM = {
  id: 'tool-settings',
  label: 'Settings',
  path: '/settings',
  icon: null,
}

let container: HTMLDivElement
let root: Root

/**
 * Seed the slot registry and mount the sidebar.
 *
 * `slots` is a plain `Map<SlotKey, any[]>` on the module-system store, so the
 * registry can be driven directly — no module loader, no manifest.
 */
function mountWith({ withTools }: { withTools: boolean }): HTMLElement {
  const slots = new Map<string, unknown[]>()
  slots.set('sidebarBottom', [{ id: 'marker', component: MarkerWidget, order: 5 }])
  if (withTools) slots.set('sidebarTools', [TOOL_ITEM])

  act(() => {
    useModuleSystemStore.setState({ slots } as never)
  })

  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root.render(
      <MemoryRouter>
        <LeftSidebar />
      </MemoryRouter>,
    )
  })
  return container
}

beforeEach(() => {
  document.body.innerHTML = ''
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  document.body.innerHTML = ''
  act(() => {
    useModuleSystemStore.setState({ slots: new Map() } as never)
  })
})

describe('LeftSidebar — the bottom-widget row', () => {
  // Every assertion below anchors on the WIDGET (`test-bottom-widget`), which
  // renders in both the pre-change and post-change tree, rather than on the
  // `layout-sidebar-bottom-widgets` testid this change introduces. An earlier
  // draft anchored on the new testid and went red against the old code with
  // "expected null to be truthy" — red because a testid was missing, not
  // because the row vanished with the Tools section. A red that is not caused
  // by the defect proves nothing about the defect.

  // Control. Establishes that the harness mounts the widget AT ALL, so the
  // no-tools case below differs from it only in the variable under test.
  test('TEST-7a: the widget mounts when the Tools section is populated', () => {
    const el = mountWith({ withTools: true })
    expect(el.querySelector(sel('layout-sidebar-tools-menu')), 'tools render').toBeTruthy()
    expect(el.querySelector(sel('test-bottom-widget')), 'the widget mounts').toBeTruthy()
  })

  test('TEST-7: the bottom widgets render even when the Tools section contributes nothing', () => {
    const el = mountWith({ withTools: false })

    // The Tools section is genuinely absent — otherwise the assertion below is
    // not testing what it claims.
    expect(
      el.querySelector(sel('layout-sidebar-tools-menu')),
      'the Tools section must be absent for this case to mean anything',
    ).toBeNull()

    // …and the bottom widget survives it. This is the assertion that fails
    // against the pre-change nesting, and it fails for the RIGHT reason: the
    // widget is simply not in the tree when Tools is empty.
    expect(
      el.querySelector(sel('test-bottom-widget')),
      'the bottom widgets must not depend on the Tools section',
    ).toBeTruthy()
  })

  test('TEST-7b: the widgets are laid out in a row, not stacked', () => {
    const el = mountWith({ withTools: true })
    const widget = el.querySelector<HTMLElement>(sel('test-bottom-widget'))
    expect(widget, 'the widget mounts').toBeTruthy()

    // Walk UP from the widget to its row container rather than selecting the
    // container by its new testid, for the anchor reason above. The container
    // is the ancestor that declares the layout direction.
    const row = widget?.closest('div.flex') as HTMLElement | null
    expect(row, 'the widgets must sit inside a flex container').toBeTruthy()

    // jsdom does no layout, so this is the DOM contract BEHIND the geometry the
    // e2e measures (TEST-5 / TEST-6) — not a substitute for it.
    expect(row?.className, 'the container must lay out as a row').toContain('flex-row')
  })
})
