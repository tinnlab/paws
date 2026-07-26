import type { Page } from '@playwright/test'
import { expect } from '../../../fixtures/test-context'
import { byTestId } from '../../testid'

/** `testInfra.sql` — a raw query runner against the per-test database. */
type Sql = (
  text: string,
  params?: unknown[],
) => Promise<{ rows: Record<string, unknown>[] }>

/**
 * Create a real conversation (through `POST /api/conversations`, so it gets its
 * root branch + `active_branch_id` exactly as production does) and give it ONE
 * real user message.
 *
 * The message matters: `MessageList` early-returns for a message-less
 * conversation and that branch does not render the `message_list_footer` slot,
 * so a conversation with no turns can never show the background footer. That is
 * correct in production (a conversation with no turns has no sub-agents), but it
 * means a seeded fixture must have a turn.
 */
export async function seedConversationWithMessage(
  page: Page,
  apiURL: string,
  token: string,
  sql: Sql,
  title: string,
  text = 'Go and do something long in the background, please.',
): Promise<string> {
  const res = await page.request.post(`${apiURL}/api/conversations`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { title },
  })
  if (res.status() >= 300) {
    throw new Error(`seed conversation failed: ${res.status()} ${await res.text()}`)
  }
  const conversationId = (await res.json()).id as string

  const branchId = (
    await sql(`SELECT active_branch_id FROM conversations WHERE id = $1`, [conversationId])
  ).rows[0].active_branch_id as string

  const messageId = (
    await sql(
      `INSERT INTO messages (role, originated_from_id) VALUES ('user', $1) RETURNING id`,
      [conversationId],
    )
  ).rows[0].id as string
  await sql(`INSERT INTO branch_messages (branch_id, message_id) VALUES ($1, $2)`, [
    branchId,
    messageId,
  ])
  await sql(
    `INSERT INTO message_contents (message_id, content_type, content, sequence_order)
     VALUES ($1, 'text', $2::jsonb, 0)`,
    [messageId, JSON.stringify({ type: 'text', text })],
  )

  return conversationId
}

/**
 * Seed a background sub-agent run BOUND to a conversation. There is no create
 * API (the agent/sandbox backbone spawns these), so the `workflow_runs` row is
 * inserted directly and then read back through the real
 * `GET /api/background/runs?conversation_id=…` endpoint by the UI.
 */
export async function seedConversationRun(
  sql: Sql,
  userId: string,
  conversationId: string | null,
  opts: { kind?: string; status?: string; task: string } = { task: 'Background work' },
): Promise<string> {
  const { kind = 'subagent', status = 'running', task } = opts
  const inserted = await sql(
    `INSERT INTO workflow_runs (user_id, job_kind, status, inputs_json, conversation_id)
     VALUES ($1, $2, $3, $4::jsonb, $5)
     RETURNING id`,
    [userId, kind, status, JSON.stringify({ task }), conversationId],
  )
  return inserted.rows[0].id as string
}

/** The admin user's id in the per-test database. */
export async function adminUserId(sql: Sql): Promise<string> {
  return (await sql(`SELECT id FROM users WHERE username = 'admin' LIMIT 1`)).rows[0]
    .id as string
}

/**
 * Open a conversation and, via the end-of-conversation footer affordance, its
 * right-panel "Tasks" tab. This is the ONLY in-app route to the panel — there is
 * no global background page — so every panel assertion goes through it.
 */
export async function openTasksPanel(
  page: Page,
  baseURL: string,
  conversationId: string,
): Promise<void> {
  await page.goto(`${baseURL}/chat/${conversationId}`)
  await expect(byTestId(page, 'chat-messages')).toBeVisible({ timeout: 30_000 })
  const footer = byTestId(page, 'background-footer-open')
  await expect(footer).toBeVisible({ timeout: 30_000 })
  await footer.click()
  await expect(byTestId(page, 'background-panel-list')).toBeVisible({ timeout: 15_000 })
}
