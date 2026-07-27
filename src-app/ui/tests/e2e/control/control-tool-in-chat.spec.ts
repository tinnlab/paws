import { test, expect } from '../../fixtures/test-context'
import type { Page } from '@playwright/test'
import { sendChatMessage } from '../chat/helpers/chat-helpers'
import {
  TEST_LLM,
  NO_LLM_SKIP,
  setupControlChat,
  recordedToolNames,
  currentConversationId,
  listJson,
} from './helpers/control-llm-helpers'

/**
 * control_mcp — REAL LLM end-to-end through the actual browser UI, NO mocks.
 *
 * The built-in app-control tools (list_capabilities / describe_capability /
 * invoke_capability) let the model create and update the app's OWN entities.
 * This is the matrix that proves the whole chain works — and that would have
 * caught the two bugs this feature fixes:
 *
 *   1. DISCOVERY — the user asks in plain language ("create a new project called
 *      Foo"); the model must FIND the operation via `list_capabilities`. The
 *      prompts here deliberately never name an operation id, because a prompt
 *      that does never exercises search. A real user session showed
 *      `list_capabilities{query:"create project"}` returning **0 results**.
 *   2. SECURITY — a mutating `invoke_capability` is FORCED through the approval
 *      card even in a fresh, auto-approve chat.
 *   3. EFFECT — Approve → the entity really exists via the REST API;
 *      Deny → nothing was created.
 *
 * Gating: runs against WHATEVER LLM the environment configures. It skips ONLY
 * when nothing at all is configured — never merely because one vendor's key is
 * absent (that is how this surface went unverified in the first place).
 */

test.describe('control_mcp — real LLM end-to-end (discover → approve → mutate)', () => {
  test.skip(!TEST_LLM, NO_LLM_SKIP)
  // Real-LLM + live SSE: multi-round tool calling and the streaming connection
  // are non-deterministic, so retry like the other real-backend specs.
  test.describe.configure({ retries: 2 })
  test.slow()

  /** The Approve/Deny controls of a pending tool-approval card. */
  function approvalButtons(page: Page) {
    return {
      approve: page.locator('[data-testid="tool-approval-approve-once"]').first(),
      deny: page.locator('[data-testid="tool-approval-deny"]').first(),
    }
  }

  /**
   * TEST-13 / TEST-14 / TEST-15 / TEST-18 — the natural-language
   * DISCOVERY → MUTATION journey, end to end.
   *
   * This single test is the one that would have caught the multi-word search
   * bug: with the shipped whole-phrase matcher, `list_capabilities` for a
   * two-word request returns nothing and the model can never reach the invoke,
   * so the approval card never appears and the project is never created.
   */
  test('a plain-language request is DISCOVERED, forced through approval, and really creates the project', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    const { token } = await setupControlChat(page, baseURL, apiURL)

    const name = `ControlE2E_${Date.now()}`
    const before = (await listJson(page, apiURL, token, '/api/projects?per_page=100', 'projects'))
      .length

    // NOTE: no operation id, no tool name. A real user's phrasing.
    await sendChatMessage(page, `Create a new project called "${name}" for me.`, false)

    // INV-4 — a mutating control write must raise the approval card even though
    // this fresh chat auto-approves ordinary tools.
    const { approve } = approvalButtons(page)
    await expect(
      approve,
      'a mutating control invoke must be forced through the approval card',
    ).toBeVisible({ timeout: 120000 })

    // INV-3 — prove the model DISCOVERED the operation rather than being told it.
    // The durable, owner-scoped MCP tool-call history is the record of truth.
    const conversationId = currentConversationId(page)
    expect(conversationId, 'the chat must have created a conversation').toBeTruthy()
    await expect
      .poll(async () => recordedToolNames(page, apiURL, token, conversationId as string), {
        timeout: 30000,
      })
      .toContain('list_capabilities')

    // Nothing may exist before the human approves.
    expect(
      (await listJson(page, apiURL, token, '/api/projects?per_page=100', 'projects')).length,
      'the project must NOT exist until the user approves',
    ).toBe(before)

    await approve.click()

    // INV-5 — approve → the entity REALLY exists, verified through REST.
    await expect
      .poll(
        async () =>
          (await listJson(page, apiURL, token, '/api/projects?per_page=100', 'projects')).length,
        { timeout: 90000 },
      )
      .toBeGreaterThan(before)

    // TEST-18 — and the chat reflects it: the tool result came back into the
    // conversation, so the mutating invoke is recorded on the transcript.
    await expect
      .poll(async () => recordedToolNames(page, apiURL, token, conversationId as string), {
        timeout: 60000,
      })
      .toContain('invoke_capability')
  })

  /**
   * TEST-14 / TEST-15 — the same chain, table-driven across representative
   * mutating operations.
   *
   * These rows exist to prove approval + effect across operation CLASSES, so
   * they add a "use the app-control tools, don't ask me first" nudge to keep a
   * chatty local model from stalling on a clarifying question. The nudge names
   * the TOOL FAMILY, never an operation id — discovery via `list_capabilities`
   * is still required. The unnudged, purely natural phrasing is exercised by the
   * discovery journey above.
   */
  const approveRows = [
    {
      op: 'Assistant.create',
      prompt: (n: string) =>
        `Create a new assistant named "${n}" for me. Use the app-control tools; do not ask me first.`,
      count: async (page: Page, apiURL: string, token: string) =>
        (await listJson(page, apiURL, token, '/api/assistants?per_page=100', 'assistants')).length,
    },
    {
      op: 'Project.create (a second, differently-phrased request)',
      prompt: (n: string) =>
        `Please set up a project named "${n}". Use the app-control tools; do not ask me first.`,
      count: async (page: Page, apiURL: string, token: string) =>
        (await listJson(page, apiURL, token, '/api/projects?per_page=100', 'projects')).length,
    },
  ]

  for (const row of approveRows) {
    test(`approval is forced and approve really performs the write — ${row.op}`, async ({
      page,
      testInfra,
    }) => {
      const { baseURL, apiURL } = testInfra
      const { token } = await setupControlChat(page, baseURL, apiURL)

      const name = `Ctl_${Date.now()}`
      const before = await row.count(page, apiURL, token)

      await sendChatMessage(page, row.prompt(name), false)

      const { approve } = approvalButtons(page)
      await expect(approve, `${row.op}: approval must be forced`).toBeVisible({ timeout: 120000 })
      expect(
        await row.count(page, apiURL, token),
        `${row.op}: nothing may exist before approval`,
      ).toBe(before)

      await approve.click()

      await expect
        .poll(async () => row.count(page, apiURL, token), { timeout: 90000 })
        .toBeGreaterThan(before)
    })
  }

  /**
   * TEST-15 — a SETTINGS update: a different class of mutating operation (a PUT
   * on a singleton the caller owns), verified by reading the setting back.
   */
  test('approval is forced and approve really performs the write — MemorySettings.update', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    const { token } = await setupControlChat(page, baseURL, apiURL)

    const readEnabled = async (): Promise<boolean | null> => {
      const res = await page.request.get(`${apiURL}/api/memory/settings`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok()) return null
      const body = await res.json()
      // The user memory settings row exposes `retrieval_enabled` /
      // `extraction_enabled` — there is no bare `enabled`.
      return (body.retrieval_enabled ?? null) as boolean | null
    }

    const before = await readEnabled()
    expect(before, 'memory settings must be readable to test a settings write').not.toBeNull()

    await sendChatMessage(
      page,
      before
        ? 'In my memory settings, turn memory retrieval OFF. Do it now, using the app-control tools; do not ask me first.'
        : 'In my memory settings, turn memory retrieval ON. Do it now, using the app-control tools; do not ask me first.',
      false,
    )

    const { approve } = approvalButtons(page)
    await expect(approve, 'a settings write must be forced through approval').toBeVisible({
      timeout: 120000,
    })
    expect(await readEnabled(), 'the setting must be unchanged before approval').toBe(before)

    await approve.click()

    await expect.poll(readEnabled, { timeout: 90000 }).toBe(!before)
  })

  /**
   * TEST-16 — deny → nothing created, table-driven.
   *
   * The pre-existing `denying the control write leaves nothing created` test
   * survives here as the `Assistant.create` row, strengthened from a name-only
   * match to a TOTAL-count baseline (a model that names the entity slightly
   * differently used to satisfy the old assertion vacuously).
   */
  const denyRows = [
    {
      op: 'Project.create',
      prompt: (n: string) => `Create a new project called "${n}" for me.`,
      list: '/api/projects?per_page=100',
      key: 'projects',
    },
    {
      op: 'Assistant.create',
      prompt: (n: string) => `Create a new assistant named "${n}" for me.`,
      list: '/api/assistants?per_page=100',
      key: 'assistants',
    },
  ]

  for (const row of denyRows) {
    test(`denying the control write leaves nothing created — ${row.op}`, async ({
      page,
      testInfra,
    }) => {
      const { baseURL, apiURL } = testInfra
      const { token } = await setupControlChat(page, baseURL, apiURL)

      const name = `ControlDeny_${Date.now()}`
      const before = await listJson(page, apiURL, token, row.list, row.key)

      await sendChatMessage(page, row.prompt(name), false)

      const { deny } = approvalButtons(page)
      await expect(
        deny,
        `${row.op}: approval must be forced before a deny is possible`,
      ).toBeVisible({ timeout: 120000 })
      await deny.click()

      // Give the turn a moment to settle; nothing may have been created.
      await page.waitForTimeout(5000)
      const after = await listJson(page, apiURL, token, row.list, row.key)
      expect(after.length, `${row.op}: a denied write must create nothing`).toBe(before.length)
      expect(
        after.some((e) => e.name === name),
        `${row.op}: the denied entity "${name}" must not exist`,
      ).toBe(false)
    })
  }
})
