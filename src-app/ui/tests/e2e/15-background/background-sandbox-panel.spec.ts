import { test, expect } from '../../fixtures/test-context'
import { loginAsAdmin, getAdminToken } from '../../common/auth-helpers'
import { byTestId } from '../testid'
import {
  adminUserId,
  openTasksPanel,
  seedConversationRun,
  seedConversationWithMessage,
} from './helpers/background-helpers'

/**
 * TEST-46 (ITEM-13) — the Background tasks surface.
 *
 * asserts (TESTS.md): a long background command surfaces in the panel with live
 * output + a terminal dot; reopening rehydrates via snapshot-on-connect.
 *
 * The no-LLM half proven here (per the task's reframe): a conversation's
 * right-panel "Tasks" tab renders that conversation's run card — status + kind
 * (Sub-agent) + label. A background run is a `workflow_runs` row with
 * `job_kind <> 'workflow'`; there is no create API (the agent/sandbox backbone
 * spawns them), so the row is seeded directly into the per-test DB via `sql()`
 * and the panel's mount-time fetch reads it through the real
 * `GET /api/background/runs?conversation_id=…` endpoint.
 *
 * RETARGETED from the deleted global `/background-tasks` page: a run bound to a
 * conversation lives in that conversation's Tasks tab, and the endpoint's
 * disjoint scope means such a run is deliberately absent from any global listing.
 *
 * (The live-output stream + snapshot-on-connect rehydrate need a running sandbox
 * exec / LLM sub-agent and are reported separately.)
 */
test.describe('Background tasks panel (ITEM-13)', () => {
  test('renders a seeded sub-agent run card inside its conversation', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL, sql } = testInfra
    await loginAsAdmin(page, baseURL)
    const token = await getAdminToken(apiURL)
    const userId = await adminUserId(sql)

    const conversationId = await seedConversationWithMessage(
      page,
      apiURL,
      token,
      sql,
      'Sandbox panel conversation',
    )

    // `inputs_json.task` becomes the card label.
    const label = 'Long-running background analysis'
    const runId = await seedConversationRun(sql, userId, conversationId, {
      kind: 'subagent',
      status: 'running',
      task: label,
    })

    await openTasksPanel(page, baseURL, conversationId)

    const card = byTestId(page, `background-run-card-${runId}`)
    await expect(card).toBeVisible({ timeout: 15000 })
    // Status badge (running) + kind label (Sub-agent) + the run label.
    await expect(byTestId(page, `background-run-status-${runId}`)).toHaveText('running')
    await expect(byTestId(page, `background-run-kind-${runId}`)).toHaveText('Sub-agent')
    await expect(card).toContainText(label)
    // The empty state is gone once a run exists.
    await expect(byTestId(page, 'background-panel-empty')).toHaveCount(0)
  })
})
