import { test, expect } from '../../fixtures/test-context'
import { loginAsAdmin } from '../../common/auth-helpers'
import {
  createProviderViaAPI,
  createModelViaAPI,
  assignProviderToAdministratorsGroup,
} from '../../common/provider-helpers'
import {
  mockChatTokenStream,
  startedEvent,
  textDeltaEvent,
  completeEvent,
} from '../helpers/sse-mock-helpers'
import { byTestId } from '../testid'

/**
 * REGRESSION GUARDS for the ROUND-2 network-hygiene defects the `live-ui-audit`
 * battery measured against the live app, expressed as the audit's OWN signals:
 *
 *   - `duplicate` / `excess` — `GET /api/conversations/{id}/summary` fired 3–4×
 *     inside ONE `sent` step, at every viewport and theme, because the
 *     summarization pill re-read the summary on every message-count change.
 *   - `irrelevant`           — `GET /api/memories` and `GET /api/background/runs`
 *     were fetched during `compose-send`, a flow with no use for either domain.
 *
 * Only the LLM boundary is mocked (the repo's `mockChatTokenStream`, which is the
 * house pattern for a deterministic streaming spec) — every assertion here is
 * about requests the app makes to the REAL backend.
 */

const SUMMARY_RE = /^\/api\/conversations\/[0-9a-f-]{36}\/summary$/

/** Collect the pathnames of every request matching `pred`, from now on. */
function collect(page: import('@playwright/test').Page, pred: (u: URL, method: string) => boolean) {
  const hits: string[] = []
  page.on('request', req => {
    const u = new URL(req.url())
    if (pred(u, req.method())) hits.push(`${req.method()} ${u.pathname}${u.search}`)
  })
  return hits
}

test.describe('live-ui-audit round 2 — network hygiene regression guards', () => {
  // `mockChatTokenStream` couples each intercepted `POST …/messages` to the NEXT
  // `GET /api/chat/stream`, and the new-chat path opens an extra stream of its
  // own (`setActiveConversation` → PUT subscription → reconnect) around that
  // POST. Measured across six runs, that race loses the scripted frames roughly
  // half the time and the assistant row never arrives — a property of the
  // harness, not of the app (the same flow drives a real model successfully on
  // the live rig). Retry rather than weaken the assertions.
  test.describe.configure({ retries: 2 })

  test.beforeEach(async ({ page, testInfra }) => {
    const { baseURL, apiURL } = testInfra
    await loginAsAdmin(page, baseURL)
    const token = await page.evaluate(
      () => JSON.parse(localStorage.getItem('auth-storage')!).state.token,
    )
    const providerId = await createProviderViaAPI(apiURL, token, 'OpenAI', 'openai')
    await assignProviderToAdministratorsGroup(apiURL, token, providerId)
    await createModelViaAPI(apiURL, token, providerId, undefined, undefined, 'openai')
  })

  test('TEST-2 + TEST-3 + TEST-6a: one send issues ≤1 summary read, and zero memories/background fetches', async ({
    page,
    testInfra,
  }) => {
    const { baseURL } = testInfra
    await mockChatTokenStream(page, [
      [
        startedEvent({ userMessageId: 'umsg_r2_1' }),
        textDeltaEvent({ delta: 'Round two answer.', messageId: 'amsg_r2_1' }),
        completeEvent({ finishReason: 'end_turn' }),
      ],
    ])

    await page.goto(`${baseURL}/`)
    await expect(page.getByRole('main')).toBeVisible({ timeout: 20000 })
    await expect(byTestId(page, 'chat-message-textarea')).toBeVisible({ timeout: 20000 })
    // Let the new-chat surface settle so the counters below measure the SEND
    // step, which is the step the audit measured.
    await page.waitForTimeout(1500)

    const summaryReads = collect(page, (u, m) => m === 'GET' && SUMMARY_RE.test(u.pathname))
    const memoryReads = collect(page, (u, m) => m === 'GET' && u.pathname === '/api/memories')
    const backgroundReads = collect(
      page,
      (u, m) => m === 'GET' && u.pathname === '/api/background/runs',
    )

    await byTestId(page, 'chat-message-textarea').fill('round two summary trigger')
    await byTestId(page, 'chat-message-textarea').press('Enter')

    // Wait for the turn to actually complete — the streaming true→false edge is
    // exactly the moment the (single) summary read is now allowed to happen, so
    // measuring before it would pass vacuously at zero.
    await expect(page.locator('[data-role="assistant"]').last()).toBeVisible({ timeout: 30000 })
    await expect(byTestId(page, 'chat-input-send-btn')).toBeEnabled({ timeout: 30000 })
    await page.waitForTimeout(3000)

    // TEST-2 — the audit measured 3–4 here. Asserted as EXACTLY one, not
    // "at most one": a regression that stops the turn-end read altogether
    // (a dropped `afterStreamComplete`, a wrong-pane read) would leave the
    // in-thread summary marker permanently stale, and `<= 1` would call that a
    // pass.
    expect(
      summaryReads.length,
      `one send must read the summary exactly once; got ${summaryReads.length}:\n${summaryReads.join('\n')}`,
    ).toBe(1)

    // ...and the pill that DRIVES that read is still on screen, so a "fix" that
    // simply stopped rendering the read-model would not pass.
    await expect(byTestId(page, 'summ-mode-tag')).toBeVisible({ timeout: 20000 })

    // TEST-3 — the memory chat-extension no longer refetches the memories page
    // after every turn; `sync:memory` covers it (proven live by TEST-4).
    expect(
      memoryReads.length,
      `a chat turn must not fetch the memories list; got:\n${memoryReads.join('\n')}`,
    ).toBe(0)

    // TEST-6a — the background-runs probe is off the compose path for a
    // conversation this tab created.
    expect(
      backgroundReads.length,
      `a just-created conversation must not probe background runs; got:\n${backgroundReads.join('\n')}`,
    ).toBe(0)
  })

  test('TEST-6b: a conversation NOT created in this tab still probes background runs', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    const token = await page.evaluate(
      () => JSON.parse(localStorage.getItem('auth-storage')!).state.token,
    )

    // Seed a conversation out-of-band, so it is a genuine server-loaded
    // conversation this tab never created. Its first turn is sent below, in-app,
    // because the footer's slot only renders once the message list has messages.
    const convRes = await fetch(`${apiURL}/api/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ title: 'round2 pre-existing conversation' }),
    })
    expect(convRes.ok, `seed conversation failed: ${convRes.status}`).toBeTruthy()
    const conversationId: string = (await convRes.json()).id

    await mockChatTokenStream(page, [
      [
        startedEvent({ userMessageId: 'umsg_r2_2' }),
        textDeltaEvent({ delta: 'seeded turn', messageId: 'amsg_r2_2' }),
        completeEvent({ finishReason: 'end_turn' }),
      ],
    ])

    const backgroundReads = collect(
      page,
      (u, m) => m === 'GET' && u.pathname === '/api/background/runs',
    )

    // A FULL page load, so the tab has no memory of having created anything —
    // this is the control that stops TEST-6a from being satisfied by simply
    // deleting the probe.
    await page.goto(`${baseURL}/chat/${conversationId}`)
    await expect(page.getByRole('main')).toBeVisible({ timeout: 20000 })
    await byTestId(page, 'chat-message-textarea').fill('hello from a fresh tab')
    await byTestId(page, 'chat-message-textarea').press('Enter')
    await expect(page.locator('[data-role="assistant"]').last()).toBeVisible({ timeout: 30000 })
    await page.waitForTimeout(3000)

    expect(
      backgroundReads.length,
      'a conversation loaded from the server must still discover its background runs',
    ).toBeGreaterThanOrEqual(1)
  })

  test('TEST-4 [acceptance INV-2]: the memories page stays fresh through sync, with no per-turn refetch', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    const token = await page.evaluate(
      () => JSON.parse(localStorage.getItem('auth-storage')!).state.token,
    )

    await page.goto(`${baseURL}/settings/memory`)
    await expect(page.getByRole('main')).toBeVisible({ timeout: 20000 })
    await page.waitForTimeout(2000)

    // A CONTROL first: prove the page can render a memory at all, so the
    // no-reload assertion below cannot pass vacuously by never rendering any.
    const control = `round2-control-${Date.now()}`
    const seed = await fetch(`${apiURL}/api/memories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ content: control }),
    })
    expect(seed.ok, `creating the control memory failed: ${seed.status}`).toBeTruthy()
    await page.reload()
    // `.first()`: the settings page renders each memory in both the card list
    // and the audit table, so the marker text legitimately matches twice.
    await expect(page.getByText(control).first()).toBeVisible({ timeout: 25000 })

    const marker = `round2-sync-proof-${Date.now()}`
    const res = await fetch(`${apiURL}/api/memories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ content: marker }),
    })
    expect(res.ok, `creating a memory failed: ${res.status}`).toBeTruthy()

    // NO reload: the row must arrive because the store refetches on
    // `sync:memory`. That subscription is the freshness mechanism the deleted
    // `afterStreamComplete` hook was duplicating — if it ever breaks, deleting
    // the hook WOULD have been a staleness regression, and this test is what
    // says so.
    await expect(page.getByText(marker).first()).toBeVisible({ timeout: 25000 })
  })
})
