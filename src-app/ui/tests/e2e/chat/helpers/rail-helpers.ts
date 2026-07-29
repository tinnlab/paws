import type { Locator, Page } from '@playwright/test'
import { expect } from '@playwright/test'
import type { TestInfrastructure } from '../../../fixtures/test-context'

/**
 * Shared setup + selectors for the ACTIVITY-RAIL e2e specs.
 *
 * ## Why the transcript is seeded through SQL rather than mocked
 *
 * Every rail invariant except the two genuinely-live ones (a streaming turn,
 * INV-4/TEST-4; a pending approval, INV-3/TEST-3) is a property of a PERSISTED
 * assistant turn carrying `tool_use` / `tool_result` blocks. Producing one from a
 * model is nondeterministic and expensive, and mocking `GET …/messages` would
 * take the real backend out of the loop for the very payload under test.
 *
 * So these specs create the conversation through the REST API (which wires the
 * branch exactly as a real chat does) and then insert the message rows with
 * `testInfra.sql` — the documented escape hatch for fixtures with no reachable
 * creation API. The transcript the browser renders is then served by the REAL
 * `GET /api/conversations/{id}/messages`, from the real database. This is the
 * same pattern `summarization/in-thread-marker.spec.ts` uses.
 *
 * Block shapes are copied from `server/seeds/showcase/showcase.sql`'s C16–C19
 * activity-rail turns, so the fixtures here and the showcase seed agree. (The
 * showcase seed itself is NOT reachable from the e2e database — the harness
 * clones a migrated template DB and never runs `showcase.sql`.)
 */

/**
 * Deterministic built-in MCP server ids — `uuid_v5(NAMESPACE_URL,
 * "<name>.ziee.internal")`, transcribed from the fixed-id header of
 * `server/seeds/showcase/showcase.sql`. A `tool_use.server_id` that resolves to
 * a real row is what lets the renderer show a server display name.
 */
export const BUILTIN_SERVER = {
  codeSandbox: 'b4d4e17b-55eb-56ce-9bc5-cbc03fd597fd',
  webSearch: 'd1a783dc-631e-570b-aba6-fee5497728b2',
  litSearch: '5bf27612-ac1b-5141-985b-e2e8ac36ca2d',
  memory: '16e2eeb0-46ed-5588-af8a-e973349f99a1',
  files: 'ca77f284-c0c3-51e0-ae83-8e34daa081f6',
  citations: '011e52cb-2d06-5e6b-8f4c-41076519f167',
  knowledgeBase: '70577fd2-afe1-52c7-a629-9464c01fb1e5',
} as const

// ── block builders ─────────────────────────────────────────────────────────

export interface SeedBlock {
  content_type: string
  content: Record<string, unknown>
}

export interface SeedMessage {
  role: 'user' | 'assistant'
  blocks: SeedBlock[]
}

export function textBlock(text: string): SeedBlock {
  return { content_type: 'text', content: { type: 'text', text } }
}

export function toolUseBlock(opts: {
  id: string
  name: string
  serverId: string
  input?: unknown
}): SeedBlock {
  return {
    content_type: 'tool_use',
    content: {
      type: 'tool_use',
      id: opts.id,
      name: opts.name,
      server_id: opts.serverId,
      input: opts.input ?? {},
    },
  }
}

export function toolResultBlock(opts: {
  toolUseId: string
  name: string
  serverId: string
  content: string
  isError?: boolean
  structuredContent?: Record<string, unknown>
  resourceLinks?: Array<Record<string, unknown>>
}): SeedBlock {
  return {
    content_type: 'tool_result',
    content: {
      type: 'tool_result',
      tool_use_id: opts.toolUseId,
      name: opts.name,
      server_id: opts.serverId,
      content: opts.content,
      is_error: opts.isError ?? false,
      ...(opts.structuredContent
        ? { structured_content: opts.structuredContent }
        : {}),
      ...(opts.resourceLinks ? { resource_links: opts.resourceLinks } : {}),
    },
  }
}

/** A `tool_use` + its `tool_result`, the shape the rail folds into one step. */
export function toolPair(opts: {
  id: string
  name: string
  serverId: string
  input?: unknown
  result: string
  isError?: boolean
  structuredContent?: Record<string, unknown>
  resourceLinks?: Array<Record<string, unknown>>
}): SeedBlock[] {
  return [
    toolUseBlock({
      id: opts.id,
      name: opts.name,
      serverId: opts.serverId,
      input: opts.input,
    }),
    toolResultBlock({
      toolUseId: opts.id,
      name: opts.name,
      serverId: opts.serverId,
      content: opts.result,
      isError: opts.isError,
      structuredContent: opts.structuredContent,
      resourceLinks: opts.resourceLinks,
    }),
  ]
}

// ── seeding ────────────────────────────────────────────────────────────────

export interface SeededConversation {
  conversationId: string
  branchId: string
  /** Message ids in seeded (chronological) order. */
  messageIds: string[]
}

/**
 * Create a conversation via REST, then seed `messages` into it via SQL.
 *
 * REST-first is load-bearing: `POST /api/conversations` sets `active_branch_id`
 * and the branch row, which a messages-only SQL path would miss and the
 * transcript would then load empty.
 */
export async function seedRailConversation(
  page: Page,
  infra: Pick<TestInfrastructure, 'apiURL' | 'sql'>,
  token: string,
  title: string,
  messages: SeedMessage[],
): Promise<SeededConversation> {
  const { apiURL, sql } = infra
  const created = await page.request.post(`${apiURL}/api/conversations`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { title },
  })
  expect(
    created.ok(),
    `create conversation: ${created.status()} ${await created.text()}`,
  ).toBeTruthy()
  const conv = (await created.json()) as {
    id: string
    active_branch_id: string
  }
  expect(typeof conv.active_branch_id).toBe('string')

  const messageIds: string[] = []
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    const inserted = await sql(
      `INSERT INTO messages (id, role, originated_from_id, edit_count, created_at)
       VALUES (gen_random_uuid(), $1, gen_random_uuid(), 0, NOW() + ($2::int * INTERVAL '1 second'))
       RETURNING id`,
      [m.role, i],
    )
    const messageId = (inserted.rows[0] as { id: string }).id
    messageIds.push(messageId)
    await sql(
      `INSERT INTO branch_messages (branch_id, message_id, is_clone, created_at)
       VALUES ($1, $2, false, NOW() + ($3::int * INTERVAL '1 second'))`,
      [conv.active_branch_id, messageId, i],
    )
    for (let s = 0; s < m.blocks.length; s++) {
      const b = m.blocks[s]
      await sql(
        `INSERT INTO message_contents (message_id, content_type, content, sequence_order)
         VALUES ($1, $2, $3::jsonb, $4)`,
        [messageId, b.content_type, JSON.stringify(b.content), s],
      )
    }
  }

  return {
    conversationId: conv.id,
    branchId: conv.active_branch_id,
    messageIds,
  }
}

/**
 * Seed the durable `mcp_tool_calls` history row a rail step's LEVEL-2 detail
 * panel joins to by `tool_use_id`. Duration / `source` / result size live ONLY
 * here — that is what makes the panel a net gain over the message (INV-2).
 */
export async function seedToolCallRecord(
  infra: Pick<TestInfrastructure, 'sql'>,
  opts: {
    userId: string
    conversationId: string
    messageId: string
    toolUseId: string
    toolName: string
    serverId?: string
    serverName: string
    argumentsJson: Record<string, unknown>
    resultJson?: unknown
    status?: 'completed' | 'failed' | 'timeout' | 'cancelled'
    isError?: boolean
    source?: 'chat' | 'rest' | 'always' | 'sampling' | 'approval'
    durationMs?: number
    resultBytes?: number
    errorMessage?: string
  },
): Promise<string> {
  const res = await infra.sql(
    `INSERT INTO mcp_tool_calls
       (server_id, server_name, is_built_in, user_id, conversation_id, message_id,
        tool_use_id, tool_name, arguments_json, source, status, is_error,
        result_json, content_kinds, result_bytes, error_message,
        started_at, finished_at, duration_ms)
     VALUES ($1, $2, true, $3, $4, $5,
             $6, $7, $8::jsonb, $9, $10, $11,
             $12::jsonb, ARRAY['text']::text[], $13, $14,
             NOW(), NOW(), $15)
     RETURNING id`,
    [
      opts.serverId ?? null,
      opts.serverName,
      opts.userId,
      opts.conversationId,
      opts.messageId,
      opts.toolUseId,
      opts.toolName,
      JSON.stringify(opts.argumentsJson),
      opts.source ?? 'chat',
      opts.status ?? 'completed',
      opts.isError ?? false,
      JSON.stringify(opts.resultJson ?? null),
      opts.resultBytes ?? 128,
      opts.errorMessage ?? null,
      opts.durationMs ?? 1234,
    ],
  )
  return (res.rows[0] as { id: string }).id
}

/** The acting user's own id (the `mcp_tool_calls.user_id` owner scope). */
export async function currentUserId(
  page: Page,
  apiURL: string,
  token: string,
): Promise<string> {
  const res = await page.request.get(`${apiURL}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(res.ok(), `GET /auth/me: ${res.status()}`).toBeTruthy()
  const body = (await res.json()) as { id?: string; user?: { id: string } }
  const id = body.id ?? body.user?.id
  expect(typeof id, 'the /auth/me payload must carry a user id').toBe('string')
  return id as string
}

/** Open a seeded conversation and wait until its transcript has mounted. */
export async function openSeededConversation(
  page: Page,
  baseURL: string,
  conversationId: string,
): Promise<void> {
  await page.goto(`${baseURL}/chat/${conversationId}`)
  await expect(page.getByTestId('chat-messages')).toBeVisible({ timeout: 30000 })
  await expect(
    page.locator('[data-testid="chat-message"][data-role="assistant"]').first(),
  ).toBeVisible({ timeout: 30000 })
}

// ── selectors ──────────────────────────────────────────────────────────────

/** Every rail on the page (a message may contain more than one span). */
export const rails = (scope: Page | Locator): Locator =>
  scope.locator('[data-testid="activity-rail"]')

/** The rail rendered inside a specific message. */
export const railIn = (page: Page, messageId: string): Locator =>
  page.locator(`[data-message-id="${messageId}"] [data-testid="activity-rail"]`)

/** The collapsed one-line summary control of a multi-step rail. */
export const railSummary = (rail: Locator): Locator =>
  rail.getByTestId('activity-rail-summary')

/** The expanded list of step rows. */
export const railSteps = (rail: Locator): Locator =>
  rail.getByTestId('activity-rail-steps')

/** One step row, addressed by its stable step key (the `tool_use_id`). */
export const stepByKey = (scope: Page | Locator, key: string): Locator =>
  scope.locator(`[data-testid="rail-step"][data-step-key="${key}"]`)

/** Expand a step row and return its inline detail body. */
export async function expandStep(
  scope: Page | Locator,
  key: string,
): Promise<Locator> {
  const step = stepByKey(scope, key)
  await expect(step).toBeVisible({ timeout: 15000 })
  const toggle = step.getByTestId('rail-step-toggle')
  await expect(toggle).toBeEnabled()
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  return step.getByTestId('rail-step-body')
}

/** Open the LEVEL-2 full record for a step in the chat right panel. */
export async function openStepRecord(
  page: Page,
  scope: Page | Locator,
  key: string,
): Promise<Locator> {
  const step = stepByKey(scope, key)
  await expect(step).toBeVisible({ timeout: 15000 })
  await step.getByTestId('rail-step-record-btn').click()
  const panel = page.locator('[data-testid="chat-right-panel"]')
  await expect(panel).toBeVisible({ timeout: 15000 })
  return panel
}

/**
 * Seed the clipboard with a sentinel, run `action`, then resolve the clipboard
 * text once it has changed. Mirrors the polling approach in
 * `chat-right-panel.spec.ts` — a toast assertion is unreliable headless.
 */
export async function copyAndRead(
  page: Page,
  action: () => Promise<void>,
): Promise<string> {
  const sentinel = `__SENTINEL_${Date.now()}__`
  await page.evaluate(s => navigator.clipboard.writeText(s), sentinel)
  await action()
  await page.waitForFunction(
    async s => {
      try {
        const t = await navigator.clipboard.readText()
        return t !== s && t.length > 0
      } catch {
        return false
      }
    },
    sentinel,
    { timeout: 10000 },
  )
  return page.evaluate(() => navigator.clipboard.readText())
}
