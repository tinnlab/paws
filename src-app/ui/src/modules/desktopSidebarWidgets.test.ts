/**
 * TEST-6b [covers: ITEM-4] — the desktop-specific half of INV-2.
 *
 * INV-2 promises the notification and download icons occupy one row **in BOTH
 * the web and the desktop layout**. The two halves have different risk:
 *
 *  - the ROW's behaviour (flex direction; surviving an empty Tools section) is
 *    shared code, proven by `LeftSidebar.test.tsx` (TEST-7) and measured
 *    geometrically in a real browser by `tests/e2e/llm/sidebar-icon-row.spec.ts`
 *    (TEST-5);
 *  - what is DESKTOP-specific is the MODULE GRAPH: `loader.desktop.ts` drops
 *    core modules by name, so the row only has two children on desktop if
 *    NEITHER contributing module is blocklisted — and it has no `user-profile`
 *    row beneath it, which is the layout the web build never renders.
 *
 * That module-graph fact is what this file pins. It is cheap, deterministic and
 * needs no server, which matters because the desktop e2e that would have
 * measured the rendered geometry (TEST-6) is blocked by a **pre-existing**
 * harness defect — an untouched spec (`desktop-real-backend-smoke.spec.ts`)
 * fails identically with `ERR_CONNECTION_REFUSED` on the derived dev port. See
 * TESTS.md for that blocker; this test is deliberately NOT presented as a
 * substitute for the geometry, only for the module-graph half.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { CORE_MODULE_BLOCKLIST, isBlocklisted } from './loader.desktop.ts'
import { PAWS_HIDDEN_MODULE_NAMES } from './pawsHiddenModules.ts'

/** The two modules that contribute the `sidebarBottom` row's widgets. */
const ROW_CONTRIBUTORS = ['notification', 'llm-provider'] as const

test('TEST-6b: both sidebarBottom contributors survive the desktop module blocklist', () => {
  for (const name of ROW_CONTRIBUTORS) {
    assert.equal(
      isBlocklisted(name),
      false,
      `${name} contributes a sidebarBottom widget; blocklisting it on desktop ` +
        `would silently leave the row with one child (or none) there while the ` +
        `web build still shows two`,
    )
    // Belt and braces: the paws hide-list feeds the blocklist, so a future
    // entry there would drop the module without anyone editing loader.desktop.
    assert.equal(
      PAWS_HIDDEN_MODULE_NAMES.has(name),
      false,
      `${name} must not be paws-hidden — it feeds CORE_MODULE_BLOCKLIST`,
    )
  }
})

test('TEST-6b: desktop still has NO user-profile widget below the row', () => {
  // The layout fact that makes the desktop row different from the web one: the
  // `sidebarFooter` slot is empty there, so the row is the last thing in the
  // sidebar. If this ever changes, the desktop layout gains a footer and the
  // row's spacing needs re-reviewing rather than silently shifting.
  assert.equal(
    isBlocklisted('user-profile'),
    true,
    'desktop drops user-profile; the sidebar footer is empty there',
  )
})

test('TEST-6b: the blocklist is a real set, not vacuously empty', () => {
  // Without this, every assertion above passes if CORE_MODULE_BLOCKLIST were
  // emptied — `isBlocklisted` would return false for everything and the first
  // test would read as "nothing is blocked, all good".
  assert.ok(
    CORE_MODULE_BLOCKLIST.size > 0,
    'the desktop blocklist must not be empty',
  )
  assert.equal(isBlocklisted('__definitely_not_a_module__'), false)
})
