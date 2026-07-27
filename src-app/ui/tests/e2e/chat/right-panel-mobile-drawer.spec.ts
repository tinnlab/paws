import type { Page } from '@playwright/test'
import { byTestId } from '../testid'
import { test, expect } from '../../fixtures/test-context'
import { loginAsAdmin, getAdminToken } from '../../common/auth-helpers'
import {
  createProviderViaAPI,
  createModelViaAPI,
  assignProviderToAdministratorsGroup,
} from '../../common/provider-helpers'
import {
  goToNewChatPage,
  selectModelInDropdown,
} from './helpers/chat-helpers'
import { FILE_ASSETS, attachFileViaUI } from './helpers/file-panel-helpers'
import { mockChatStream, startedEvent } from '../helpers/sse-mock-helpers'

/**
 * E2E — ChatRightPanel MOBILE drawer mode (audit gap all-788b166f9359).
 *
 * `chat-right-panel.spec.ts` exercises the panel exclusively at the default
 * (desktop) viewport, where it renders as the resizable side panel keyed by
 * `data-panel-open`. The NARROW branch of `ChatRightPanel` is structurally
 * different and was never exercised: instead of the inline side panel it renders
 * a MODAL DRAWER (the shared `@ziee/shell` Drawer — a Radix Dialog portalled to
 * <body>, full-bleed at an xs viewport) and is dismissed via `closeMobileDrawer`,
 * NOT the side-panel collapse. This drives that branch at a 480px viewport:
 * opening a file card must surface the modal drawer (not the side panel), and
 * the close button must tear it down.
 *
 * NOTE on the assertions below: the drawer's "covers the page" property is
 * asserted GEOMETRICALLY, not by class string. The original spec asserted
 * `fixed`+`inset-0`, matching a hand-rolled `<div class="fixed inset-0 z-[1000]">`
 * overlay that has since been replaced by the shell Drawer (`fixed inset-y-0
 * right-0` + a full-bleed `max-w-[100vw]`/100% width at xs). The class strings
 * differ; the user-visible property — a fixed layer covering the viewport — does
 * not. Measuring it keeps this test true across any equivalent re-implementation
 * (the same policy the visual specs follow).
 */

async function setupProviderAndModel(apiURL: string, adminToken: string) {
  const providerId = await createProviderViaAPI(apiURL, adminToken, 'OpenAI', 'openai')
  await assignProviderToAdministratorsGroup(apiURL, adminToken, providerId)
  await createModelViaAPI(apiURL, adminToken, providerId, undefined, undefined, 'openai')
}

async function setupChatAtNewConversation(page: Page, baseURL: string, apiURL: string) {
  await loginAsAdmin(page, baseURL)
  const adminToken = await getAdminToken(apiURL)
  await setupProviderAndModel(apiURL, adminToken)
  // started-only stream: the optimistic user bubble (with its file card) stays
  // mounted for the drawer flow without a real LLM completing the turn. The
  // drawer test operates on the USER message's file card, so no assistant
  // response is needed. Same trick as user-attachments-layout.spec.ts.
  await mockChatStream(page, [[startedEvent({ userMessageId: 'umsg_mobile' })]])
  await goToNewChatPage(page, baseURL)
  await selectModelInDropdown(page, 'GPT-4o Mini')
}

test.describe('Chat - Right Panel mobile drawer', () => {
  test('mobile viewport: opening a file renders a full-screen drawer overlay, closeable', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra

    // Narrow viewport BEFORE navigating so `useWindowMinSize().sm` (≤ 640px)
    // is true on first render and the panel takes its mobile branch.
    await page.setViewportSize({ width: 480, height: 900 })

    await setupChatAtNewConversation(page, baseURL, apiURL)

    // Attach + send so the user message carries a clickable FileCard.
    const sendButton = byTestId(page, 'chat-input-send-btn')
    await expect(sendButton).toBeEnabled({ timeout: 30000 })
    await attachFileViaUI(page, FILE_ASSETS.md)
    await byTestId(page, 'chat-message-textarea').fill('see attached')
    await expect(sendButton).toBeEnabled({ timeout: 30000 })
    await sendButton.click()

    // The sent user message carries the clickable FileCard (no assistant
    // response required — the started-only stream keeps the bubble mounted).
    await expect(
      page.locator('[data-testid="file-card"][data-filename="test.md"]').last(),
    ).toBeVisible({ timeout: 15000 })

    // Before opening: the mobile drawer (the right panel, role=dialog on mobile)
    // is not present.
    const drawer = byTestId(page, 'chat-right-panel')
    await expect(drawer).toHaveCount(0)

    // Click the most-recent file card to display it in the right panel.
    // `displayInRightPanel` sets `mobileDrawerOpen: true`, which on a mobile
    // viewport mounts the full-screen overlay branch.
    await page
      .locator('[data-testid="file-card"][data-filename="test.md"]')
      .last()
      .click()

    // Mobile branch assertions: the panel renders AS the modal drawer, NOT the
    // desktop side panel (which would expose `data-panel-open` and no role).
    await expect(drawer).toBeVisible({ timeout: 10000 })
    const panel = page.locator('[data-testid="chat-right-panel"]')
    await expect(panel).toHaveAttribute('role', 'dialog')
    await expect(panel).toHaveAttribute('aria-modal', 'true')
    // Full-screen fixed overlay contract, measured (covers the page incl. the
    // header) rather than asserted as a class string — see the note in the
    // docblock.
    const geom = await panel.evaluate(el => {
      const r = el.getBoundingClientRect()
      return {
        position: getComputedStyle(el).position,
        x: r.x,
        y: r.y,
        w: r.width,
        h: r.height,
        vw: window.innerWidth,
        vh: window.innerHeight,
      }
    })
    expect(geom.position, 'the drawer must be a fixed layer over the page').toBe('fixed')
    expect(geom.w, 'the drawer must span the full viewport width').toBeCloseTo(geom.vw, 0)
    expect(geom.h, 'the drawer must span the full viewport height').toBeCloseTo(geom.vh, 0)
    expect(Math.abs(geom.x), 'the drawer must start at the viewport left edge').toBeLessThanOrEqual(1)
    expect(Math.abs(geom.y), 'the drawer must start at the viewport top edge').toBeLessThanOrEqual(1)
    // The desktop side-panel marker must be absent in mobile mode.
    await expect(panel).not.toHaveAttribute('data-panel-open', 'true')
    // The opened tab's content surfaced inside the drawer (tab labelled by the
    // uploaded filename — dynamic data).
    await expect(
      byTestId(page, 'chat-right-panel-tab-list')
        .getByRole('tab')
        .filter({ hasText: 'test.md' }),
    ).toBeVisible()

    // Close the drawer via its close button → `closeMobileDrawer` flips
    // `mobileDrawerOpen` false and the narrow branch returns null (drawer gone).
    //
    // The affordance here is the DRAWER's own close control, not the side
    // panel's `chat-right-panel-close` ×: in the drawer branch `PanelTabs` is
    // rendered `asTitle`, which deliberately emits the tab strip ALONE ("the
    // Drawer supplies the left back button + chrome" — ChatRightPanel.tsx), so
    // the panel's own × does not exist in this branch. Clicking what the user
    // actually taps is also the stronger assertion.
    await page.locator('[data-testid="layout-drawer-close-button"]').click()
    await expect(drawer).toHaveCount(0, { timeout: 5000 })
  })
})
