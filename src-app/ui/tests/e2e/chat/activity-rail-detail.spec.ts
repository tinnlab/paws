import type { Browser, Page } from '@playwright/test'
import { test, expect } from '../../fixtures/test-context'
import { loginAsAdmin, getAdminToken } from '../../common/auth-helpers'
import {
  BUILTIN_SERVER,
  copyAndRead,
  currentUserId,
  expandStep,
  openSeededConversation,
  openStepRecord,
  railIn,
  seedRailConversation,
  seedToolCallRecord,
  stepByKey,
  textBlock,
  toolPair,
} from './helpers/rail-helpers'

/**
 * TEST-2 [acceptance, INV-2] + TEST-20 + TEST-39 — DETAIL REACHABILITY.
 *
 * INV-2: "Every detail reachable today must remain reachable, ideally better."
 *
 * The rail deletes the bordered per-tool card, so this spec is the proof that
 * nothing went with it. It exercises the three depths the design promises:
 *
 *   row   → label, status, timing on the step itself,
 *   level 1 → expanding the step renders the OWNING extension's body inline,
 *   level 2 → the full persisted record in the right panel.
 *
 * The "ideally better" half is not decorative: `duration`, `source` and the
 * result size live on `mcp_tool_calls` and were, before this feature,
 * unreachable from the message that produced them. This spec asserts they are
 * present — a rail that merely preserved the old surface would fail here.
 *
 * TEST-39 proves DELEGATION rather than re-implementation: the rail supplies no
 * body of its own, it calls back into each extension's registered renderer, so
 * a knowledge-base step must render the knowledge-base card and a file step the
 * file preview.
 */

/** An EXTERNAL MCP server row, so an unclaimed tool name resolves a display
 *  name and lands on mcp's generic contribution (the "owning extension" for a
 *  tool no domain module claims). Mirrors showcase.sql's `weather-api` row. */
async function seedExternalServer(
  sql: (t: string, p?: unknown[]) => Promise<{ rows: unknown[] }>,
  userId: string,
): Promise<string> {
  const res = await sql(
    `INSERT INTO mcp_servers (id, user_id, name, display_name, is_built_in, is_system, transport_type, url)
     VALUES (gen_random_uuid(), $1, 'weather-api', 'Weather API (external)', false, false, 'http', 'https://example.com/mcp')
     RETURNING id`,
    [userId],
  )
  return (res.rows[0] as { id: string }).id
}

/** Clipboard read/write needs an explicitly-permitted context. */
async function clipboardPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    permissions: ['clipboard-read', 'clipboard-write'],
  })
  return context.newPage()
}

test.describe('Activity rail — detail reachability (INV-2)', () => {
  test('a tool step exposes its body inline AND a record panel with status, source and DURATION', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL, sql } = testInfra
    await loginAsAdmin(page, baseURL)
    const token = await getAdminToken(apiURL)
    const userId = await currentUserId(page, apiURL, token)
    const serverId = await seedExternalServer(sql, userId)

    const seeded = await seedRailConversation(page, testInfra, token, 'rail-detail', [
      { role: 'user', blocks: [textBlock('What is the weather in Oslo?')] },
      {
        role: 'assistant',
        blocks: [
          ...toolPair({
            id: 'toolu_detail_weather',
            name: 'get_weather',
            serverId,
            input: { city: 'Oslo', units: 'metric' },
            result: 'Oslo: 7C, light rain, wind 4 m/s.',
            structuredContent: { temperature_c: 7, condition: 'light rain' },
          }),
          textBlock('It is 7C and raining lightly in Oslo.'),
        ],
      },
    ])
    const assistantId = seeded.messageIds[1]

    // The durable record the level-2 panel joins to. Duration/source/size exist
    // ONLY here — that is the point of the join (ITEM-13).
    await seedToolCallRecord(testInfra, {
      userId,
      conversationId: seeded.conversationId,
      messageId: assistantId,
      toolUseId: 'toolu_detail_weather',
      toolName: 'get_weather',
      serverId,
      serverName: 'Weather API (external)',
      argumentsJson: { city: 'Oslo', units: 'metric' },
      resultJson: { temperature_c: 7, condition: 'light rain' },
      source: 'chat',
      durationMs: 4321,
      resultBytes: 64,
    })

    await openSeededConversation(page, baseURL, seeded.conversationId)

    // ── the ROW ────────────────────────────────────────────────────────────
    const rail = railIn(page, assistantId)
    await expect(rail).toBeVisible({ timeout: 15000 })
    // One tool ⇒ the quiet single-line shape, always visible (nothing to
    // collapse), so the step is reachable with zero clicks.
    await expect(rail).toHaveAttribute('data-rail-shape', 'single')
    const step = stepByKey(rail, 'toolu_detail_weather')
    await expect(step).toBeVisible()
    await expect(step).toHaveAttribute('data-status', 'success')
    // The accessible name leads with the STATUS, so a screen-reader user hears
    // the outcome before the tool name.
    await expect(step.getByTestId('rail-step-toggle')).toHaveAttribute(
      'aria-label',
      /^Completed,/,
    )

    // ── LEVEL 1: the owning extension's body, inline ───────────────────────
    const body = await expandStep(rail, 'toolu_detail_weather')
    await expect(body).toBeVisible()
    const inlineDetail = body.getByTestId('rail-step-detail-body')
    await expect(inlineDetail).toBeVisible()
    // Arguments AND result are both reachable inline — the two things the
    // retired per-tool card carried.
    await expect(inlineDetail.getByTestId('rail-step-detail-args')).toContainText('Oslo')
    await expect(inlineDetail.getByTestId('rail-step-detail-result')).toContainText(
      'light rain',
    )

    // ── LEVEL 2: the full record ───────────────────────────────────────────
    const panel = await openStepRecord(page, rail, 'toolu_detail_weather')
    const record = panel.getByTestId('tool-call-panel')
    await expect(record).toBeVisible({ timeout: 15000 })
    await expect(record.getByTestId('tool-call-panel-status')).toHaveText('Completed')
    await expect(record.getByTestId('tool-call-panel-source')).toHaveText('chat')
    // The "ideally better" half of INV-2 — data no message surface could show.
    await expect(record.getByTestId('tool-call-panel-duration')).toHaveText('4s')
    await expect(record.getByTestId('tool-call-panel-bytes')).toContainText('64')
    await expect(record.getByTestId('tool-call-panel-args')).toContainText('Oslo')
    await expect(record.getByTestId('tool-call-panel-result')).toContainText(
      'light rain',
    )

    // Re-opening the same step must FOCUS the existing tab, not stack a second
    // one (the tab id is derived from `tool_use_id`).
    await stepByKey(rail, 'toolu_detail_weather')
      .getByTestId('rail-step-record-btn')
      .click()
    await expect(
      page.getByTestId('chat-right-panel-tab-list').getByRole('tab'),
    ).toHaveCount(1)
  })

  test('TEST-39: a knowledge-base step renders the KNOWLEDGE-BASE card body (delegation, not re-implementation)', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    await loginAsAdmin(page, baseURL)
    const token = await getAdminToken(apiURL)

    // Shapes verbatim from showcase.sql C19 / `knowledge_base/handlers.rs`.
    const seeded = await seedRailConversation(page, testInfra, token, 'rail-kb', [
      {
        role: 'user',
        blocks: [textBlock('What does our knowledge base say about build time?')],
      },
      {
        role: 'assistant',
        blocks: [
          ...toolPair({
            id: 'toolu_rail_kb_search',
            name: 'search_knowledge',
            serverId: BUILTIN_SERVER.knowledgeBase,
            input: { query: 'index build time vs query latency', top_k: 3 },
            result: 'report.pdf:p2: HNSW build is O(N log N).',
            structuredContent: {
              hits: [
                {
                  file_id: 'f1000000-0000-0000-0000-000000000005',
                  filename: 'report.pdf',
                  page: 2,
                  char_start: 1024,
                  char_end: 1146,
                  score: 0.912,
                  content: 'HNSW build is O(N log N) and dominated by ef_construction.',
                },
              ],
              query: 'index build time vs query latency',
              mode: 'Hybrid',
              truncated: false,
              indexing_incomplete: { searchable: 7, total: 9 },
            },
          }),
          textBlock('Build cost and query latency are separate knobs.'),
        ],
      },
    ])
    const assistantId = seeded.messageIds[1]
    await openSeededConversation(page, baseURL, seeded.conversationId)

    const rail = railIn(page, assistantId)
    await expect(rail).toBeVisible({ timeout: 15000 })
    // The label is knowledge-base DOMAIN language, not the raw tool id — proof
    // the knowledge-base contribution (not mcp's generic fallback) described it.
    await expect(
      stepByKey(rail, 'toolu_rail_kb_search').getByTestId('rail-step-label'),
    ).toHaveText('Searching your knowledge base')

    const body = await expandStep(rail, 'toolu_rail_kb_search')
    // The knowledge-base module's OWN already-registered card renders inside the
    // rail's body — the rail contributed no markup of its own.
    const card = body.getByTestId('kb-tool-result-card')
    await expect(card).toBeVisible()
    // …including the half-indexed warning, which only that card knows how to
    // render (a rail that re-implemented the body would have dropped it).
    await expect(card.getByTestId('kb-tool-result-incomplete')).toBeVisible()
  })

  test('TEST-39: a file step renders the FILE PREVIEW body', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    await loginAsAdmin(page, baseURL)
    const token = await getAdminToken(apiURL)

    // A REAL file, so the preview has real bytes to render (a synthetic id
    // would prove only that an error state renders).
    const upload = await page.request.post(`${apiURL}/api/files/upload`, {
      headers: { Authorization: `Bearer ${token}` },
      multipart: {
        file: {
          name: 'rail-notes.md',
          mimeType: 'text/markdown',
          buffer: Buffer.from('# Rail notes\n\nef_search=100 is our default.\n'),
        },
      },
    })
    expect(
      upload.ok(),
      `upload: ${upload.status()} ${await upload.text()}`,
    ).toBeTruthy()
    const file = (await upload.json()) as { id: string; filename: string }

    const seeded = await seedRailConversation(page, testInfra, token, 'rail-file', [
      { role: 'user', blocks: [textBlock('Write my notes to a file.')] },
      {
        role: 'assistant',
        blocks: [
          ...toolPair({
            id: 'toolu_rail_create_file',
            name: 'create_file',
            serverId: BUILTIN_SERVER.files,
            input: { path: 'rail-notes.md', content: '# Rail notes' },
            result: 'Created rail-notes.md (v1).',
            structuredContent: { file_id: file.id, version: 1 },
            resourceLinks: [
              {
                uri: `/api/files/${file.id}`,
                name: file.filename,
                mime_type: 'text/markdown',
                size: 44,
                is_saved: true,
                file_id: file.id,
              },
            ],
          }),
          textBlock('Saved.'),
        ],
      },
    ])
    const assistantId = seeded.messageIds[1]
    await openSeededConversation(page, baseURL, seeded.conversationId)

    const rail = railIn(page, assistantId)
    const step = stepByKey(rail, 'toolu_rail_create_file')
    await expect(step).toBeVisible({ timeout: 15000 })
    await expect(step.getByTestId('rail-step-label')).toHaveText('Creating a file')
    // The artifact is reachable from the ROW without expanding anything.
    await expect(step.getByTestId('rail-step-artifacts')).toContainText(
      'rail-notes.md',
    )

    const body = await expandStep(rail, 'toolu_rail_create_file')
    // The file module's own view + inline preview — delegated, not re-built.
    await expect(body.getByTestId('tool-result-files')).toBeVisible()
    await expect(body.getByTestId('inline-file-preview').first()).toBeVisible({
      timeout: 15000,
    })
  })
})

test.describe('Activity rail — copy + deep link (TEST-20)', () => {
  test('a step copies its arguments and result, and produces a #message-<id> link that navigates back', async ({
    browser,
    testInfra,
  }) => {
    const { baseURL, apiURL, sql } = testInfra
    const page = await clipboardPage(browser)
    try {
      await loginAsAdmin(page, baseURL)
      const token = await getAdminToken(apiURL)
      const userId = await currentUserId(page, apiURL, token)
      const serverId = await seedExternalServer(sql, userId)

      // Two turns: the FIRST carries the tool step, so the deep link has to
      // navigate somewhere other than the tail the page opens on.
      const seeded = await seedRailConversation(page, testInfra, token, 'rail-copy', [
        { role: 'user', blocks: [textBlock('Look up the ticket.')] },
        {
          role: 'assistant',
          blocks: [
            ...toolPair({
              id: 'toolu_copy_lookup',
              name: 'lookup_ticket',
              serverId,
              input: { ticket: 'ZIEE-4711' },
              result: 'ZIEE-4711 is open, assigned to nobody.',
            }),
            textBlock('ZIEE-4711 is still open.'),
          ],
        },
        { role: 'user', blocks: [textBlock('Thanks, that is all.')] },
        { role: 'assistant', blocks: [textBlock('Any time.')] },
      ])
      const assistantId = seeded.messageIds[1]

      await seedToolCallRecord(testInfra, {
        userId,
        conversationId: seeded.conversationId,
        messageId: assistantId,
        toolUseId: 'toolu_copy_lookup',
        toolName: 'lookup_ticket',
        serverId,
        serverName: 'Weather API (external)',
        argumentsJson: { ticket: 'ZIEE-4711' },
        resultJson: { state: 'open', assignee: null },
        durationMs: 900,
      })

      await openSeededConversation(page, baseURL, seeded.conversationId)
      const rail = railIn(page, assistantId)
      const panel = await openStepRecord(page, rail, 'toolu_copy_lookup')
      await expect(panel.getByTestId('tool-call-panel')).toBeVisible({
        timeout: 15000,
      })

      // COPY ARGUMENTS — exercised, not merely asserted visible.
      const args = await copyAndRead(page, async () => {
        await panel.getByTestId('tool-call-copy-arguments').click()
      })
      expect(args).toContain('ZIEE-4711')
      // The button confirms the action to the user.
      await expect(panel.getByTestId('tool-call-copy-arguments')).toHaveText(
        /Copied/,
      )

      // COPY RESULT.
      const result = await copyAndRead(page, async () => {
        await panel.getByTestId('tool-call-copy-result').click()
      })
      expect(result).toContain('open')

      // COPY LINK → the deep-link PRODUCER this feature adds. The `#message-…`
      // consumer already existed on the conversation page with nothing
      // producing one.
      const link = await copyAndRead(page, async () => {
        await panel.getByTestId('tool-call-copy-link').click()
      })
      expect(link).toContain(`#message-${assistantId}`)

      // Navigate with the produced link from a cold load and assert the
      // consumer centred + highlighted that exact message.
      await page.goto(link)
      await expect(page.getByTestId('chat-messages')).toBeVisible({
        timeout: 30000,
      })
      await expect(
        page.locator(`[data-message-id="${assistantId}"][data-find-active]`),
      ).toBeVisible({ timeout: 15000 })
      await expect(
        page.locator(`[data-message-id="${assistantId}"]`),
      ).toBeInViewport({ timeout: 10000 })
    } finally {
      await page.context().close()
    }
  })
})
