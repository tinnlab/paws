import { test, expect } from '../../fixtures/test-context'
import { loginAsAdmin, getAdminToken } from '../../common/auth-helpers'
import {
  BUILTIN_SERVER,
  openSeededConversation,
  railIn,
  seedRailConversation,
  stepByKey,
  textBlock,
  toolPair,
  type SeedMessage,
} from './helpers/rail-helpers'

/**
 * TEST-7 [acceptance, INV-7] — EXPANDED STATE SURVIVES THE VIRTUALISER.
 *
 * INV-7: "The rail's expanded state survives scrolling: it is keyed by message,
 * not held in component state."
 *
 * This is a live bug elsewhere in the transcript today: `ThinkingContent` holds
 * its open flag in component state and the message list is row-virtualised, so
 * scrolling away and back silently re-closes it mid-read. The rail must not
 * inherit that.
 *
 * The proof therefore has to make the row genuinely UNMOUNT — a spec that only
 * scrolled the row out of view would pass against component state too, which is
 * exactly the class of test that let the original bug ship. So it asserts the
 * DOM node count for the message goes to ZERO before scrolling back.
 *
 * The conversation is seeded at the transcript page size (30 messages) with tall
 * filler, so the whole set loads in one window and scrolling is pure
 * virtualisation rather than lazy-load paging.
 */

/** A deliberately TALL filler message — enough rows that the target scrolls
 *  well outside the virtualiser's overscan window. */
function filler(n: number): SeedMessage {
  const body = Array.from(
    { length: 24 },
    (_, i) => `Filler paragraph ${n}.${i} — padding so the list is genuinely long.`,
  ).join('\n\n')
  return {
    role: n % 2 === 0 ? 'user' : 'assistant',
    blocks: [textBlock(body)],
  }
}

test.describe('Activity rail — expanded state survives unmount (INV-7)', () => {
  test('an expanded rail AND an expanded step survive scrolling far enough to unmount the message', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    await loginAsAdmin(page, baseURL)
    const token = await getAdminToken(apiURL)

    const railTurn: SeedMessage = {
      role: 'assistant',
      blocks: [
        ...toolPair({
          id: 'toolu_state_search',
          name: 'web_search',
          serverId: BUILTIN_SERVER.webSearch,
          input: { query: 'ef_search recall' },
          result: 'Top results: ef_search is the recall knob.',
          structuredContent: {
            provider: 'searxng',
            results: [
              {
                title: 'ef_search is the recall knob',
                url: 'https://example.com/efsearch',
                snippet: 'raising ef_search trades latency for recall',
              },
            ],
          },
        }),
        ...toolPair({
          id: 'toolu_state_fetch',
          name: 'fetch_url',
          serverId: BUILTIN_SERVER.webSearch,
          input: { url: 'https://example.com/efsearch' },
          result: 'hnsw.ef_search defaults to 40.',
          structuredContent: { final_url: 'https://example.com/efsearch', char_count: 31 },
        }),
        textBlock('ef_search=100 is the right default.'),
      ],
    }

    // 30 messages == the transcript page size, so the tail window holds all of
    // them and no lazy-load paging interferes with the scroll.
    const messages: SeedMessage[] = [
      { role: 'user', blocks: [textBlock('What should ef_search be?')] },
      railTurn,
      ...Array.from({ length: 28 }, (_, i) => filler(i)),
    ]

    const seeded = await seedRailConversation(
      page,
      testInfra,
      token,
      'rail-state',
      messages,
    )
    const railMessageId = seeded.messageIds[1]
    await openSeededConversation(page, baseURL, seeded.conversationId)

    const railMessage = page.locator(`[data-message-id="${railMessageId}"]`)
    const rail = railIn(page, railMessageId)

    // Scroll UP to the rail turn (the page opens at the tail).
    await page.getByTestId('chat-top-sentinel').scrollIntoViewIfNeeded()
    await expect(railMessage).toBeVisible({ timeout: 20000 })
    await expect(rail).toBeVisible()

    // ── set the state the user expects to keep ─────────────────────────────
    const summary = rail.getByTestId('activity-rail-summary')
    await expect(summary).toHaveAttribute('aria-expanded', 'false')
    await summary.click()
    await expect(summary).toHaveAttribute('aria-expanded', 'true')

    const step = stepByKey(rail, 'toolu_state_fetch')
    const stepToggle = step.getByTestId('rail-step-toggle')
    await stepToggle.click()
    await expect(stepToggle).toHaveAttribute('aria-expanded', 'true')
    await expect(step.getByTestId('rail-step-body')).toBeVisible()

    // ── scroll far enough that the row is genuinely UNMOUNTED ──────────────
    await page.getByTestId('chat-bottom-load-sentinel').scrollIntoViewIfNeeded()
    await expect(
      railMessage,
      'the virtualiser must actually unmount the row — otherwise this spec ' +
        'would pass against component-local state too, which is the bug it exists to catch',
    ).toHaveCount(0, { timeout: 20000 })
    // The rail node is gone with it.
    await expect(rail).toHaveCount(0)

    // ── scroll back: the state is restored, not reset ──────────────────────
    await page.getByTestId('chat-top-sentinel').scrollIntoViewIfNeeded()
    await expect(railMessage).toBeVisible({ timeout: 20000 })

    const summaryAgain = rail.getByTestId('activity-rail-summary')
    await expect(
      summaryAgain,
      'the rail re-mounted CLOSED — its open state is component-local, not keyed by message',
    ).toHaveAttribute('aria-expanded', 'true', { timeout: 15000 })
    await expect(rail.getByTestId('activity-rail-steps')).toBeVisible()

    const stepAgain = stepByKey(rail, 'toolu_state_fetch')
    await expect(
      stepAgain.getByTestId('rail-step-toggle'),
      'the expanded STEP re-mounted closed — per-step state is not keyed by message either',
    ).toHaveAttribute('aria-expanded', 'true')
    await expect(stepAgain.getByTestId('rail-step-body')).toBeVisible()

    // The sibling step the user did NOT open must still be closed — the restore
    // is per-step, not "expand everything".
    await expect(
      stepByKey(rail, 'toolu_state_search').getByTestId('rail-step-toggle'),
    ).toHaveAttribute('aria-expanded', 'false')
  })
})
