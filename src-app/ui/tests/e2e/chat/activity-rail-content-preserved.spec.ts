import { test, expect } from '../../fixtures/test-context'
import { loginAsAdmin, getAdminToken } from '../../common/auth-helpers'
import {
  BUILTIN_SERVER,
  openSeededConversation,
  railIn,
  seedRailConversation,
  textBlock,
  toolPair,
} from './helpers/rail-helpers'

/**
 * TEST-6 [acceptance, INV-6] — THE RAIL MUST NOT SWALLOW THE ANSWER.
 *
 * INV-6: "The rail removes machinery boxes only. Content boxes — code, tables,
 * alerts — stay, because they are the answer."
 *
 * The whole feature is a subtraction, and the failure mode of a subtraction is
 * taking one thing too many. A rail that folded a fenced code block or a
 * markdown table into a collapsed step would be deleting the reply, not the
 * machinery around it — so this spec seeds a turn whose answer carries all three
 * content boxes the design names, next to a multi-step rail that DOES collapse,
 * and asserts the three render at full weight OUTSIDE the rail in the same view.
 */

const ANSWER_MARKDOWN = [
  'Here is what I found.',
  '',
  '```python',
  'def ef_search(recall: float) -> int:',
  '    return 100 if recall > 0.95 else 40',
  '```',
  '',
  '| setting | recall@10 | p50 |',
  '| --- | --- | --- |',
  '| ef=40 | 0.911 | 1.9ms |',
  '| ef=100 | 0.958 | 3.7ms |',
  '',
  '> [!WARNING]',
  '> Raising ef_search past 200 buys almost no recall for double the latency.',
  '',
].join('\n')

test.describe('Activity rail — content boxes survive (INV-6)', () => {
  test('a code block, a markdown table and a GFM alert all render OUTSIDE the rail while the machinery collapses', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    await loginAsAdmin(page, baseURL)
    const token = await getAdminToken(apiURL)

    const seeded = await seedRailConversation(page, testInfra, token, 'rail-content', [
      { role: 'user', blocks: [textBlock('Benchmark ef_search and write it up.')] },
      {
        role: 'assistant',
        blocks: [
          // Two machinery steps → the multi-step rail shape, which collapses.
          ...toolPair({
            id: 'toolu_content_exec',
            name: 'execute_command',
            serverId: BUILTIN_SERVER.codeSandbox,
            input: { command: 'python bench_ef.py', timeout_ms: 60000 },
            result: 'exit_code: 0\nef=40 recall=0.911\nef=100 recall=0.958',
            structuredContent: { exit_code: 0, duration_ms: 4210 },
          }),
          ...toolPair({
            id: 'toolu_content_search',
            name: 'web_search',
            serverId: BUILTIN_SERVER.webSearch,
            input: { query: 'HNSW ef_search recall latency' },
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
          // …and the ANSWER, which must survive untouched.
          textBlock(ANSWER_MARKDOWN),
        ],
      },
    ])
    const assistantId = seeded.messageIds[1]
    await openSeededConversation(page, baseURL, seeded.conversationId)

    const message = page.locator(`[data-message-id="${assistantId}"]`)
    const rail = railIn(page, assistantId)

    // ── the machinery collapses ────────────────────────────────────────────
    await expect(rail).toBeVisible({ timeout: 15000 })
    await expect(rail).toHaveAttribute('data-rail-shape', 'rail')
    await expect(rail.getByTestId('activity-rail-summary')).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    await expect(rail.getByTestId('activity-rail-steps')).toHaveCount(0)
    await expect(rail.getByTestId('rail-step')).toHaveCount(0)

    // ── …while all three CONTENT boxes stay ────────────────────────────────
    // 1. a fenced code block, still a real code block (language + body), not
    //    flattened into the summary line.
    const code = message.locator(
      '[data-streamdown="code-block"][data-language="python"]',
    )
    await expect(code).toBeVisible()
    await expect(code.locator('[data-streamdown="code-block-body"]')).toContainText(
      'def ef_search',
    )

    // 2. a markdown table, with its header and both data rows.
    const table = message.locator('[data-streamdown="table"]')
    await expect(table).toBeVisible()
    await expect(
      table.locator('[data-streamdown="table-header-cell"]').first(),
    ).toContainText('setting')
    await expect(table.locator('[data-streamdown="table-row"]')).not.toHaveCount(0)
    await expect(table).toContainText('0.958')

    // 3. a GFM alert. Asserted by its RENDERED TEXT rather than by a particular
    // `data-streamdown` attribute: which element the markdown renderer chooses
    // for `> [!WARNING]` is its implementation detail, and INV-6's claim is about
    // the content surviving, not about the tag it survives in. The
    // outside-the-rail half is asserted structurally below, which is the part of
    // the invariant this feature can actually break.
    const alert = message.getByText('Raising ef_search past 200', { exact: false })
    await expect(alert.first()).toBeVisible()

    // ── and NONE of them is inside the rail ────────────────────────────────
    // The rail is collapsed, so anything it had absorbed would be gone from the
    // DOM entirely; these counts prove the three are not merely styled outside
    // it but structurally are not its children.
    for (const [name, selector] of [
      ['code block', '[data-streamdown="code-block"]'],
      ['table', '[data-streamdown="table"]'],
      // The alert's containing element is renderer-owned (see above), so the
      // rail-containment check for it is done by text, immediately after.

    ] as const) {
      await expect(rail.locator(selector), `${name} must not be inside the rail`).toHaveCount(0)
    }
    // The alert, by text — the rail must not have absorbed it.
    await expect(
      rail.getByText('Raising ef_search past 200', { exact: false }),
      'the GFM alert must not be inside the rail',
    ).toHaveCount(0)
    // Belt and braces: no rail anywhere on the page contains them either.
    await expect(
      page.locator('[data-testid="activity-rail"] [data-streamdown="code-block"]'),
    ).toHaveCount(0)

    // Expanding the rail must not move the answer INTO it either — the reader
    // auditing a step keeps their answer in place.
    await rail.getByTestId('activity-rail-summary').click()
    await expect(rail.getByTestId('activity-rail-steps')).toBeVisible()
    await expect(code).toBeVisible()
    await expect(table).toBeVisible()
    await expect(alert).toBeVisible()
    await expect(rail.locator('[data-streamdown="table"]')).toHaveCount(0)
  })
})
