import { test, expect } from '../../fixtures/test-context'
import { loginAsAdmin, getCurrentUserToken } from '../../common/auth-helpers'
import { byTestId } from '../testid'
import { openTasksPanel } from '../15-background/helpers/background-helpers'
import {
  seedBridgeConversation,
  spawnBackgroundSubagent,
  HAS_BRIDGE,
  BRIDGE_SKIP,
} from './helpers/agent-llm-helpers'

/**
 * TEST-25 / ITEM-10 — a background sub-agent run PERSISTS across a page reload
 * (snapshot-on-connect rehydrate), driven by a REAL detached sub-agent turn.
 *
 * A real background run is launched through the production `spawn_background`
 * path — the built-in `background_mcp` JSON-RPC endpoint that the chat model calls
 * — so a real bridge sub-agent turn actually executes on the `workflow_runs`
 * backbone. The conversation's right-panel "Tasks" tab fetches that conversation's
 * runs through the real `GET /api/background/runs?conversation_id=…` endpoint on
 * mount, so the run's card survives a full page reload: the durable
 * `workflow_runs` row is the source of truth, not transient in-memory state. We
 * assert the run card is present, reload, and assert it is STILL present (same run
 * id) — the rehydrate.
 *
 * RETARGETED from the deleted global `/background-tasks` page: a run spawned by a
 * conversation now lives in that conversation's Tasks tab.
 *
 * Requires the agent-core chat path + a real LLM bridge. Skips cleanly when unset.
 */
test.describe('background run — persists across reload (real sub-agent, agent-core)', () => {
  test.skip(!HAS_BRIDGE, BRIDGE_SKIP)
  test.setTimeout(120_000)

  test('a launched background sub-agent run survives a page reload', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    await loginAsAdmin(page, baseURL)
    const token = await getCurrentUserToken(page)

    const { conversationId } = await seedBridgeConversation(
      page,
      apiURL,
      token,
      'Background Persist Model',
    )

    // Launch a REAL detached sub-agent run on the durable backbone.
    const runId = await spawnBackgroundSubagent(
      page,
      apiURL,
      token,
      conversationId,
      'Reply with the single word DONE and nothing else.',
    )

    // The run surfaces INSIDE the conversation that spawned it — the right-panel
    // "Tasks" tab, opened from the end-of-conversation footer affordance (fetched
    // from the real `GET /api/background/runs?conversation_id=…` on mount).
    await openTasksPanel(page, baseURL, conversationId)
    const card = byTestId(page, `background-run-card-${runId}`)
    await expect(card).toBeVisible({ timeout: 30_000 })
    await expect(byTestId(page, `background-run-kind-${runId}`)).toHaveText('Sub-agent')

    // Reload → the durable run row rehydrates through the same REST fetch (and the
    // persisted panel snapshot restores the Tasks tab); the background task is NOT
    // lost across the reload.
    await page.reload()
    await expect(byTestId(page, 'background-panel-list')).toBeVisible({ timeout: 30_000 })
    await expect(byTestId(page, `background-run-card-${runId}`)).toBeVisible({ timeout: 30_000 })
    // The empty state is (still) gone — a real run persists.
    await expect(byTestId(page, 'background-panel-empty')).toHaveCount(0)
  })
})
