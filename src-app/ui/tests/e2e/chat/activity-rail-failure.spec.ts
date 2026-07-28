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
} from './helpers/rail-helpers'

/**
 * TEST-5 [acceptance, INV-5] — A FAILURE IS NEVER HIDDEN.
 *
 * INV-5: "A failed or timed-out step forces the rail open; a failure is never
 * hidden inside a collapsed summary."
 *
 * A red dot inside a collapsed one-line summary is a silent failure: the reader
 * has to click machinery they were told they could ignore in order to discover
 * that the answer above them is built on a tool that never ran. So the rail must
 * be open on arrival, the failed row must be visible with ZERO clicks, and the
 * collapse control must not be offered (an inert control that looks like it
 * closes the rail and then doesn't is worse than no control).
 *
 * Both failure shapes are covered, because they are DIFFERENT statuses from
 * different producers: `failed` (a `tool_result` with `is_error: true`) and
 * `timeout` (code_sandbox's `structuredContent.timed_out`, the only in-tree
 * producer of `ToolStatusKey.timeout`).
 *
 * Block shapes mirror `showcase.sql`'s C18 turn.
 */

test.describe('Activity rail — a failure forces it open (INV-5)', () => {
  test.beforeEach(async ({ page, testInfra }) => {
    await loginAsAdmin(page, testInfra.baseURL)
  })

  test('a FAILED step leaves the rail expanded, visible without clicking, and offers no collapse', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    const token = await getAdminToken(apiURL)

    const seeded = await seedRailConversation(page, testInfra, token, 'rail-failed', [
      { role: 'user', blocks: [textBlock('Pull the upstream changelog.')] },
      {
        role: 'assistant',
        blocks: [
          textBlock('Checking the workspace first, then fetching upstream.'),
          ...toolPair({
            id: 'toolu_rail_ok',
            name: 'list_workspace',
            serverId: BUILTIN_SERVER.codeSandbox,
            result: 'bench_ef.py\nmake_report.py',
            structuredContent: { entry_count: 2 },
          }),
          ...toolPair({
            id: 'toolu_rail_failed',
            name: 'fetch_url',
            serverId: BUILTIN_SERVER.webSearch,
            input: { url: 'https://example.com/changelog' },
            result:
              'Fetch failed: upstream returned HTTP 503 (Service Unavailable) after 2 retries.',
            isError: true,
            structuredContent: { status: 503, attempts: 3 },
          }),
          textBlock('Upstream is down — I stopped rather than guess.'),
        ],
      },
    ])
    const assistantId = seeded.messageIds[1]
    await openSeededConversation(page, baseURL, seeded.conversationId)

    const rail = railIn(page, assistantId)
    await expect(rail).toBeVisible({ timeout: 15000 })
    await expect(rail).toHaveAttribute('data-rail-shape', 'rail')

    // FORCED OPEN on arrival — no click, no hover, no scroll.
    await expect(rail).toHaveAttribute('data-forced-open', '')
    await expect(rail).toHaveAttribute('data-open', '')
    await expect(rail.getByTestId('activity-rail-steps')).toBeVisible()

    // The failed row itself is rendered and legible, not just its container.
    const failed = stepByKey(rail, 'toolu_rail_failed')
    await expect(failed).toBeVisible()
    await expect(failed).toHaveAttribute('data-status', 'failed')
    // Status leads the accessible name, so it is announced before the tool name.
    await expect(failed.getByTestId('rail-step-toggle')).toHaveAttribute(
      'aria-label',
      /^Failed,/,
    )
    // The succeeding sibling is still there — a failure does not swallow the run.
    await expect(stepByKey(rail, 'toolu_rail_ok')).toHaveAttribute(
      'data-status',
      'success',
    )

    // The SUMMARY must not read as success. `Completed` is the success label
    // from the one status vocabulary; a summary claiming it over a failed span
    // is the exact "silent failure" this invariant forbids.
    const summary = rail.getByTestId('activity-rail-summary')
    await expect(summary).toBeVisible()
    await expect(summary).not.toContainText('Completed')
    await expect(summary).toHaveAttribute('aria-label', /^Activity: /)
    await expect(summary).toHaveAttribute('aria-expanded', 'true')

    // NO usable collapse control while forced open.
    await expect(summary).toBeDisabled()
    // …and it genuinely cannot be collapsed: force the click through and assert
    // the steps are still there (an inert-but-clickable control would fail here).
    await summary.click({ force: true })
    await expect(rail.getByTestId('activity-rail-steps')).toBeVisible()
    await expect(failed).toBeVisible()

    // The failure detail is reachable inline (INV-2 still holds on this path).
    const toggle = failed.getByTestId('rail-step-toggle')
    await expect(toggle).toBeEnabled()
    await toggle.click()
    await expect(failed.getByTestId('rail-step-body')).toContainText('503')
  })

  test('a TIMED-OUT step does the same, and is amber `timeout` rather than red `failed`', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    const token = await getAdminToken(apiURL)

    const seeded = await seedRailConversation(page, testInfra, token, 'rail-timeout', [
      { role: 'user', blocks: [textBlock('Re-run the long benchmark.')] },
      {
        role: 'assistant',
        blocks: [
          ...toolPair({
            id: 'toolu_rail_ok2',
            name: 'list_workspace',
            serverId: BUILTIN_SERVER.codeSandbox,
            result: 'bench_ef.py',
            structuredContent: { entry_count: 1 },
          }),
          ...toolPair({
            id: 'toolu_rail_timeout',
            name: 'execute_command',
            serverId: BUILTIN_SERVER.codeSandbox,
            input: { command: 'python bench_ef.py --full-sweep', timeout_ms: 30000 },
            result: 'Tool call timed out after 30s.',
            isError: true,
            structuredContent: { timed_out: true, timeout_ms: 30000 },
          }),
          textBlock('The full sweep exceeded the 30s cap.'),
        ],
      },
    ])
    const assistantId = seeded.messageIds[1]
    await openSeededConversation(page, baseURL, seeded.conversationId)

    const rail = railIn(page, assistantId)
    await expect(rail).toBeVisible({ timeout: 15000 })
    await expect(rail).toHaveAttribute('data-forced-open', '')
    await expect(rail.getByTestId('activity-rail-steps')).toBeVisible()

    const timedOut = stepByKey(rail, 'toolu_rail_timeout')
    await expect(timedOut).toBeVisible()
    // `timeout` is its OWN vocabulary entry — red stays exclusive to `failed`,
    // so a cap being hit never reads as a crash.
    await expect(timedOut).toHaveAttribute('data-status', 'timeout')
    await expect(timedOut.getByTestId('rail-step-toggle')).toHaveAttribute(
      'aria-label',
      /^Timed out,/,
    )
    await expect(timedOut.getByTestId('rail-step-detail')).toContainText(
      /timed out/i,
    )

    const summary = rail.getByTestId('activity-rail-summary')
    await expect(summary).not.toContainText('Completed')
    await expect(summary).toBeDisabled()
    await summary.click({ force: true })
    await expect(timedOut).toBeVisible()
  })
})
