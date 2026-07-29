import { test, expect } from '../../fixtures/test-context'
import { byTestId } from '../testid'
import { loginAsAdmin, getAdminToken } from '../../common/auth-helpers'

/**
 * E2E — per-conversation assistant-picker scoping across conversation
 * switches (audit all-23d59c7f31b8).
 *
 * The picker selection lives in `AssistantPicker`'s
 * `selectedByConversation` map, KEYED BY CONVERSATION ID (ITEM-5). The
 * status chip reads `selectedByConversation[conversation.id]`
 * (AssistantStatusChip.tsx), so:
 *   - switching A → B shows NO chip (B has no entry), and
 *   - switching back B → A RESTORES A's chip (its entry is still there).
 *
 * (The original version of this spec asserted the pre-ITEM-5 behaviour —
 * a single global `selectedAssistantId` that a `conversation.id`
 * subscriber `reset()` on every change, so returning to A showed no
 * chip. That subscriber was deliberately removed when the selection
 * became per-conversation; see the comment at the top of
 * `assistant/chat-extension/extension.tsx`.)
 *
 * The proof hinges on CLIENT-SIDE navigation: switching conversations
 * via the sidebar (react-router `navigate`, no document reload) keeps
 * the picker store alive, so the chip state can only come from the
 * per-conversation keying — not from a full page reload throwing the
 * store away. Deterministic, no LLM.
 */

test.describe('Chat — assistant picker is scoped per conversation', () => {
  test('an assistant selected in one conversation does not leak into another, and is restored on return', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    await loginAsAdmin(page, baseURL)
    const token = await getAdminToken(apiURL)

    const tag = Date.now().toString(36)
    const assistantName = `Switch Assistant ${tag}`

    // A distinctively-named assistant so the picker submenu + status chip
    // are unambiguous.
    const created = await fetch(`${apiURL}/api/assistants`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name: assistantName, instructions: 'Be terse.' }),
    })
    expect(created.status).toBeLessThan(300)

    // Two real conversations to switch between (unfiled → both surface in
    // the sidebar Recent list).
    const titleA = `ZZZ Conv A ${tag}`
    const titleB = `ZZZ Conv B ${tag}`
    const mkConv = async (title: string): Promise<string> => {
      const res = await page.request.post(`${apiURL}/api/conversations`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { title },
      })
      expect(res.status()).toBeLessThan(300)
      return (await res.json()).id as string
    }
    const convA = await mkConv(titleA)
    const convB = await mkConv(titleB)

    // Land in conversation A (single full navigation — every switch AFTER
    // this is client-side so the picker store survives).
    await page.goto(`${baseURL}/chat/${convA}`)
    await page.waitForLoadState('load')

    const addBtn = byTestId(page, 'chat-input-add-btn')
    await expect(addBtn).toBeVisible({ timeout: 30000 })

    const chip = () =>
      byTestId(page, 'assistant-status-chip')

    // --- Select the assistant in conversation A → its status chip shows. ---
    await addBtn.click()
    await byTestId(page, 'assistant-menu-trigger').click()
    await expect(page.getByText(assistantName)).toBeVisible({ timeout: 10000 })
    await page.getByText(assistantName).click()
    await expect(chip()).toBeVisible({ timeout: 10000 })

    // Both conversations are reachable in the sidebar (client-side nav). The
    // recent-conversations Menu derives one item per conversation id.
    const rowA = byTestId(page, `chat-recent-conversations-menu-item-${convA}`)
    const rowB = byTestId(page, `chat-recent-conversations-menu-item-${convB}`)
    await expect(rowB).toBeVisible({ timeout: 15000 })

    // --- Switch to conversation B via the sidebar (SPA navigation). ---
    // The chip keys off `selectedByConversation[convB]`, which has no entry
    // → no chip. A regression that scoped the selection GLOBALLY would leak
    // A's assistant into B and leave the chip up.
    await rowB.click()
    await expect(page).toHaveURL(new RegExp(`/chat/${convB}`), { timeout: 15000 })
    await expect(chip()).toHaveCount(0, { timeout: 10000 })

    // --- Switch back to conversation A (SPA navigation). ---
    // A's entry is still in the map, so its chip comes back with the SAME
    // assistant — the store survived the switch (client-side nav), proving
    // the selection is per-conversation state rather than reset-on-change.
    await rowA.click()
    await expect(page).toHaveURL(new RegExp(`/chat/${convA}`), { timeout: 15000 })
    await expect(chip()).toHaveCount(1, { timeout: 10000 })
    await expect(chip()).toContainText(assistantName, { timeout: 10000 })
  })
})
