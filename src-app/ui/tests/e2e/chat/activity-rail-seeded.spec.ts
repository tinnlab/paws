import { test, expect } from '../../fixtures/test-context'
import { loginAsAdmin, getAdminToken } from '../../common/auth-helpers'
import {
  BUILTIN_SERVER,
  openSeededConversation,
  railIn,
  rails,
  seedRailConversation,
  stepByKey,
  textBlock,
  toolPair,
  type SeedMessage,
} from './helpers/rail-helpers'

/**
 * TEST-38 — THE RAIL SHAPES.
 *
 * ## Why this does NOT read `showcase.sql`
 *
 * TESTS.md scopes this test to "the seeded multi-tool, artifact, failure,
 * approval and knowledge-base turns" — the C16–C19 turns ITEM-27 added to
 * `server/seeds/showcase/showcase.sql`. **That seed is not reachable from the
 * e2e database.** The Playwright harness (`tests/fixtures/test-context.ts`)
 * creates each test's database by cloning a MIGRATED TEMPLATE and never runs
 * `showcase.sql`; the only consumers of that file are `seeds/showcase/load.sh`
 * (a dev DB) and `scripts/record-gallery-fixtures.mjs` (the gallery cassettes).
 * A spec that navigated to conversation `11111111-…` here would 404 on every
 * run — green by never asserting anything.
 *
 * So this spec drives the SAME SHAPES the way the other chat specs do: the
 * block payloads below are transcribed from C16–C19 (same tool names, same
 * `structuredContent` keys, same `resource_links`), seeded into the per-test
 * database. If the harness ever loads the showcase seed, this file should be
 * re-pointed at conversation `11111111-1111-1111-1111-111111111111` and the
 * fixtures deleted.
 *
 * One C-turn is deliberately NOT reproduced here: a live pending tool APPROVAL
 * has no seedable form (`pending-approval` exists only in the SSE-fed live-step
 * source), so the approval breakout is proven by
 * `activity-rail-breakout.spec.ts` against a real stream. The seedable
 * request-for-input — an `elicitation_request` — is covered below, since it
 * exercises the same INV-3 breakout path from a persisted block.
 */

// ── C16: five consecutive tools across four servers → the multi-step rail ──
const multiTool: SeedMessage = {
  role: 'assistant',
  blocks: [
    textBlock('Working through it — searching, reading, checking, benchmarking, citing.'),
    ...toolPair({
      id: 'toolu_rail_search',
      name: 'web_search',
      serverId: BUILTIN_SERVER.webSearch,
      input: { query: 'HNSW ef_search recall latency tradeoff', max_results: 3 },
      result: 'Top results:\n1. ef_search: the single biggest recall knob.',
      structuredContent: {
        provider: 'searxng',
        results: [
          { title: 'ef_search is the recall knob', url: 'https://example.com/efsearch', snippet: 'raising ef_search…' },
          { title: 'Measuring recall@10', url: 'https://example.com/recall10', snippet: 'build a reference set…' },
          { title: 'Choosing m', url: 'https://example.com/m', snippet: 'm above 32 rarely pays…' },
        ],
      },
    }),
    ...toolPair({
      id: 'toolu_rail_fetch',
      name: 'fetch_url',
      serverId: BUILTIN_SERVER.webSearch,
      input: { url: 'https://example.com/efsearch' },
      result: '# ef_search is the recall knob\n\nhnsw.ef_search defaults to 40.',
      structuredContent: { final_url: 'https://example.com/efsearch', char_count: 212 },
    }),
    ...toolPair({
      id: 'toolu_rail_semantic',
      name: 'semantic_search',
      serverId: BUILTIN_SERVER.files,
      input: { query: 'ef_search default we settled on', top_k: 2 },
      result: 'notes.md:p1: We standardised on ef_search=100.',
      structuredContent: {
        results: [
          {
            file_id: 'f1000000-0000-0000-0000-000000000007',
            name: 'notes.md',
            page: 1,
            char_start: 412,
            char_end: 476,
            score: 0.83,
            text: 'We standardised on ef_search=100 after the March benchmark.',
          },
        ],
        mode: 'hybrid',
        truncated: false,
        query: 'ef_search default we settled on',
      },
    }),
    ...toolPair({
      id: 'toolu_rail_exec',
      name: 'execute_command',
      serverId: BUILTIN_SERVER.codeSandbox,
      input: { command: 'python bench_ef.py --ef 40,100,200', timeout_ms: 60000 },
      result: 'exit_code: 0\nef= 40  recall@10=0.911\nef=100  recall@10=0.958',
      structuredContent: { exit_code: 0, stdout_bytes: 132, stderr_bytes: 0, duration_ms: 4210 },
    }),
    ...toolPair({
      id: 'toolu_rail_cite',
      name: 'format_citations',
      serverId: BUILTIN_SERVER.citations,
      input: { style: 'apa', items: [{ doi: '10.1000/hnsw.2024' }] },
      result: 'Malkov, Y., & Yashunin, D. (2024). Efficient approximate nearest neighbor search.',
      structuredContent: { style: 'apa', formatted_count: 1, verification_status: 'verified' },
    }),
    textBlock('**ef_search=100** is the right default.'),
  ],
}

test.describe('Activity rail — the seeded turn shapes (TEST-38)', () => {
  test.beforeEach(async ({ page, testInfra }) => {
    await loginAsAdmin(page, testInfra.baseURL)
  })

  test('C16 multi-tool: five consecutive tools collapse into ONE rail with five steps', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    const token = await getAdminToken(apiURL)
    const seeded = await seedRailConversation(page, testInfra, token, 'rail-c16', [
      { role: 'user', blocks: [textBlock('Cross-check our notes against HNSW tuning.')] },
      multiTool,
    ])
    const assistantId = seeded.messageIds[1]
    await openSeededConversation(page, baseURL, seeded.conversationId)

    const rail = railIn(page, assistantId)
    await expect(rail).toBeVisible({ timeout: 20000 })
    // ONE rail for the whole run, not five stacked cards — the entire point.
    await expect(rails(page.locator(`[data-message-id="${assistantId}"]`))).toHaveCount(1)
    await expect(rail).toHaveAttribute('data-rail-shape', 'rail')
    // Collapsed, because an answer exists.
    const summary = rail.getByTestId('activity-rail-summary')
    await expect(summary).toHaveAttribute('aria-expanded', 'false')
    await expect(summary).toContainText('5 steps')

    await summary.click()
    await expect(rail.getByTestId('rail-step')).toHaveCount(5)
    // Each step is described in its OWNING module's language, never the raw id.
    for (const [key, label] of [
      ['toolu_rail_semantic', 'Searching your documents'],
      ['toolu_rail_exec', 'Running a command'],
    ] as const) {
      await expect(stepByKey(rail, key).getByTestId('rail-step-label')).toHaveText(label)
    }
    // Every step settled successfully.
    await expect(
      rail.locator('[data-testid="rail-step"][data-status="success"]'),
    ).toHaveCount(5)
    // The narration text block BREAKS the run — it is prose, not a step.
    await expect(rail.getByText('Working through it')).toHaveCount(0)
  })

  test('C17 artifact: a one-step run surfaces its files as chips without expanding anything', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    const token = await getAdminToken(apiURL)
    const seeded = await seedRailConversation(page, testInfra, token, 'rail-c17', [
      { role: 'user', blocks: [textBlock('Turn that benchmark into a report.')] },
      {
        role: 'assistant',
        blocks: [
          ...toolPair({
            id: 'toolu_rail_artifacts',
            name: 'execute_command',
            serverId: BUILTIN_SERVER.codeSandbox,
            input: { command: 'python make_report.py --out report.pdf', timeout_ms: 60000 },
            result: 'exit_code: 0\nWrote report.pdf, chart.png and data.csv.',
            structuredContent: { exit_code: 0, artifact_count: 3, duration_ms: 1980 },
            resourceLinks: [
              { uri: '/api/files/f1000000-0000-0000-0000-000000000005', name: 'report.pdf', mime_type: 'application/pdf', size: 631 },
              { uri: '/api/files/f1000000-0000-0000-0000-000000000001', name: 'chart.png', mime_type: 'image/png', size: 6381 },
              { uri: '/api/files/f1000000-0000-0000-0000-000000000004', name: 'data.csv', mime_type: 'text/csv', size: 133 },
            ],
          }),
          textBlock('Report is ready — PDF, the chart, and the raw numbers.'),
        ],
      },
    ])
    const assistantId = seeded.messageIds[1]
    await openSeededConversation(page, baseURL, seeded.conversationId)

    const rail = railIn(page, assistantId)
    await expect(rail).toBeVisible({ timeout: 20000 })
    // A run of ONE is a quiet single line — no summary, no collapse ceremony.
    await expect(rail).toHaveAttribute('data-rail-shape', 'single')
    await expect(rail.getByTestId('activity-rail-summary')).toHaveCount(0)

    const step = stepByKey(rail, 'toolu_rail_artifacts')
    await expect(step).toBeVisible()
    const chips = step.getByTestId('rail-step-artifacts')
    await expect(chips).toBeVisible()
    for (const name of ['report.pdf', 'chart.png', 'data.csv']) {
      await expect(chips).toContainText(name)
    }
  })

  test('C18 failure+timeout: the rail is forced open with both bad steps visible', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    const token = await getAdminToken(apiURL)
    const seeded = await seedRailConversation(page, testInfra, token, 'rail-c18', [
      { role: 'user', blocks: [textBlock('Pull the changelog and re-run the sweep.')] },
      {
        role: 'assistant',
        blocks: [
          textBlock('Checking the workspace first, then fetching upstream.'),
          ...toolPair({
            id: 'toolu_rail_ok',
            name: 'list_workspace',
            serverId: BUILTIN_SERVER.codeSandbox,
            result: 'bench_ef.py\nmake_report.py\ndata.csv',
            structuredContent: { entry_count: 3 },
          }),
          ...toolPair({
            id: 'toolu_rail_failed',
            name: 'fetch_url',
            serverId: BUILTIN_SERVER.webSearch,
            input: { url: 'https://example.com/changelog' },
            result: 'Fetch failed: upstream returned HTTP 503 after 2 retries.',
            isError: true,
            structuredContent: { status: 503, attempts: 3 },
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
          textBlock('Upstream is down and the full sweep exceeded the 30s cap.'),
        ],
      },
    ])
    const assistantId = seeded.messageIds[1]
    await openSeededConversation(page, baseURL, seeded.conversationId)

    const rail = railIn(page, assistantId)
    await expect(rail).toBeVisible({ timeout: 20000 })
    await expect(rail).toHaveAttribute('data-forced-open', '')
    await expect(rail.getByTestId('rail-step')).toHaveCount(3)
    await expect(stepByKey(rail, 'toolu_rail_failed')).toHaveAttribute('data-status', 'failed')
    await expect(stepByKey(rail, 'toolu_rail_timeout')).toHaveAttribute('data-status', 'timeout')
    await expect(stepByKey(rail, 'toolu_rail_ok')).toHaveAttribute('data-status', 'success')
  })

  // NOTE: a C19 test — "two KB tools render as one rail in knowledge-base
  // language" — stood here. paws hides the `knowledge-base` module, so its
  // chat-extension never registers and there is no knowledge-base rail language
  // left to assert. The rail's DELEGATION contract is still covered by the C16
  // test above, whose `semantic_search` (file) and `exec` (code_sandbox) label
  // assertions come from modules that survive.

  test('a request for input (elicitation) breaks OUT of the rail as a seeded block too', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    const token = await getAdminToken(apiURL)
    // Shape from showcase.sql E1b (a PENDING elicitation).
    const seeded = await seedRailConversation(page, testInfra, token, 'rail-elicit', [
      { role: 'user', blocks: [textBlock('Export the workbook.')] },
      {
        role: 'assistant',
        blocks: [
          ...toolPair({
            id: 'toolu_elicit_pre',
            name: 'list_workspace',
            serverId: BUILTIN_SERVER.codeSandbox,
            result: 'workbook.xlsx',
            structuredContent: { entry_count: 1 },
          }),
          {
            content_type: 'elicitation_request',
            content: {
              type: 'elicitation_request',
              elicitation_id: 'elic-rail-0002',
              message: 'Enter a filename for the export:',
              server: 'Code Sandbox',
              status: 'pending',
              requested_schema: {
                type: 'object',
                required: ['filename'],
                properties: { filename: { type: 'string', minLength: 1 } },
              },
            },
          },
        ],
      },
    ])
    const assistantId = seeded.messageIds[1]
    await openSeededConversation(page, baseURL, seeded.conversationId)

    const message = page.locator(`[data-message-id="${assistantId}"]`)
    const breakout = message.getByTestId('rail-breakout')
    await expect(breakout).toBeVisible({ timeout: 20000 })
    // The form the user must fill in is present, not folded into a rail row.
    await expect(
      breakout.getByTestId('elicitation-pending-elic-rail-0002'),
    ).toBeVisible()
    await expect(breakout.getByRole('textbox').first()).toBeVisible()
    await expect(
      page.locator(
        '[data-testid="activity-rail-steps"] [data-step-key="elic-rail-0002"]',
      ),
    ).toHaveCount(0)
    // …and nothing inside it can collapse the request away: actuate every
    // disclosure control it contains and prove the form is still there.
    const disclosures = breakout.locator('[aria-expanded]')
    for (let i = 0; i < (await disclosures.count()); i++) {
      await disclosures.nth(i).click({ force: true })
      await expect(breakout.getByRole('textbox').first()).toBeVisible()
    }
  })
})
