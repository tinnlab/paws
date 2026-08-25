import { test, expect } from '../../fixtures/test-context'
import { byTestId } from '../testid'
import { loginAsAdmin, getAdminToken } from '../../common/auth-helpers'
import {
  createProviderViaAPI,
  createModelViaAPI,
  assignProviderToAdministratorsGroup,
} from '../../common/provider-helpers'
import {
  createConversationWithModel,
  waitForAssistantResponse,
} from './helpers/chat-helpers'
import {
  FILE_ASSETS,
  attachFileViaUI,
  openFileInPanel,
} from './helpers/file-panel-helpers'

/**
 * E2E — chat right-panel resize handle (ChatRightPanel.tsx:197). The panel only
 * exists when a right-panel tab is open, so we open one, then drag the left-edge
 * ResizeHandle and assert the panel widens. This exercises the
 * drag→setRightPanelWidth path that no other E2E covers.
 *
 * The tab used to be opened by seeding a literature_search result and clicking
 * its card. paws hides the `literature` module, so no `literature` panel
 * renderer is registered and that route to an open panel no longer exists — the
 * spec now opens a FILE tab instead (the `file` panel renderer survives). The
 * feature under test is the resize handle, which is chat core and unaffected;
 * only the vehicle changed.
 */

test.describe('Chat — right panel resize', () => {
  test('dragging the right-panel resize handle widens the panel', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    await loginAsAdmin(page, baseURL)
    const token = await getAdminToken(apiURL)
    const providerId = await createProviderViaAPI(apiURL, token, 'OpenAI', 'openai')
    await assignProviderToAdministratorsGroup(apiURL, token, providerId)
    await createModelViaAPI(apiURL, token, providerId, undefined, undefined, 'openai')

    // A conversation with one attached file → its FileCard opens the right panel.
    await createConversationWithModel(page, baseURL, 'GPT-4o Mini', 'Hello!')
    await waitForAssistantResponse(page)

    const sendButton = byTestId(page, 'chat-input-send-btn')
    await expect(sendButton).toBeEnabled({ timeout: 30000 })
    await attachFileViaUI(page, FILE_ASSETS.md)
    const textarea = page.locator('textarea[placeholder*="Type your message"]')
    await textarea.fill('Here is a file.')
    await expect(sendButton).toBeEnabled({ timeout: 30000 })
    await sendButton.click()
    await waitForAssistantResponse(page)

    await openFileInPanel(page, 'test.md')

    const panel = byTestId(page, 'chat-right-panel')
    await expect(panel).toBeVisible({ timeout: 10000 })
    const before = (await panel.boundingBox())!.width

    // Drag the left-edge resize handle further LEFT to widen the panel.
    const handle = panel.getByRole('separator').first()
    const hb = (await handle.boundingBox())!
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
    await page.mouse.down()
    await page.mouse.move(hb.x - 150, hb.y + hb.height / 2, { steps: 10 })
    await page.mouse.up()

    await expect
      .poll(async () => (await panel.boundingBox())!.width, { timeout: 5000 })
      .toBeGreaterThan(before)
  })
})
