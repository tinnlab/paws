import { test, expect } from '../../fixtures/test-context'
import { loginAsAdmin, getAdminToken } from '../../common/auth-helpers'
import {
  createProviderViaAPI,
  createModelViaAPI,
  assignProviderToAdministratorsGroup,
} from '../../common/provider-helpers'
import {
  goToNewChatPage,
  selectModelInDropdown,
  sendChatMessage,
} from '../chat/helpers/chat-helpers'
import { byTestId } from '../testid.ts'

/**
 * E2E — a user installs a skill and the model LOADS it in chat via skill_mcp's
 * load_skill tool. The skills specs only cover the admin/list pages; the
 * actual in-chat skill-loading flow (the point of the feature) was untested.
 * Real-LLM gated.
 */

const HAS_ANTHROPIC = Boolean(process.env.ANTHROPIC_API_KEY)

test.describe('Skills — load/use in chat (real LLM)', () => {
  test.skip(!HAS_ANTHROPIC, 'ANTHROPIC_API_KEY not set — real-LLM skill-in-chat E2E skipped')

  test('the model calls load_skill when a request matches an installed skill', async ({
    page,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra
    await loginAsAdmin(page, baseURL)
    const token = await getAdminToken(apiURL)

    // The skill chat-extension attaches skill_mcp whenever the user has ANY
    // available skill. This used to install `io.github.ziee/effective-prompting`
    // from the hub seed; paws removed that entry (the hub UI is hidden here —
    // `docs/design/paws-feature-surface.md` item 11) and the install then 404'd.
    //
    // The boot-synced built-in capability skills serve the same purpose and are
    // always present, so wait for them rather than installing anything. Polled
    // because the sync is a spawned task.
    let available = 0
    for (let i = 0; i < 40 && available === 0; i++) {
      const listed = await fetch(`${apiURL}/api/skills`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (listed.ok) available = ((await listed.json()).skills ?? []).length
      if (available === 0) await new Promise(r => setTimeout(r, 250))
    }
    expect(available, 'a skill must be available or skill_mcp never attaches').toBeGreaterThan(0)

    const providerId = await createProviderViaAPI(apiURL, token, 'Anthropic', 'anthropic')
    await assignProviderToAdministratorsGroup(apiURL, token, providerId)
    await createModelViaAPI(
      apiURL,
      token,
      providerId,
      'claude-haiku-4-5-20251001',
      'Claude Haiku 4.5',
      'anthropic',
    )

    await goToNewChatPage(page, baseURL)
    await selectModelInDropdown(page, 'Claude Haiku 4.5')
    await sendChatMessage(
      page,
      'Use the load_skill tool to open one of the available skills, then briefly summarize what it teaches. You MUST call load_skill.',
    )

    // The skill_mcp load_skill tool call surfaces in the chat transcript.
    // ("load_skill" is dynamic transcript data — assert it on the messages
    // container rather than via getByText on chrome.)
    await expect(byTestId(page, 'chat-messages')).toContainText('load_skill', {
      timeout: 90_000,
    })
  })
})
