import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, expect } from '../../fixtures/test-context'
import { loginAsAdmin, getAdminToken } from '../../common/auth-helpers'
import { byTestId } from '../testid'
import { addStep, openNewBuilder } from './helpers/builder-helpers'

/**
 * TEST-2 / TEST-18 / TEST-21 — workflow builder VALIDATION ATTRIBUTION +
 * HUMANISATION, end-to-end against the real backend (no API mocking).
 *
 * The governing design is `.lifecycle/workflow-builder-ux/DESIGN.md`:
 *   §2.1 "Human language, always"  — no raw schema/YAML key language ever
 *        reaches the person building a workflow. The backend keeps its precise
 *        wire-vocabulary messages; the builder humanises at the PRESENTATION
 *        boundary (`components/builder/validationCopy.ts`, keyed off the stable
 *        `ValidationError.code` + the step's KIND).
 *   §2.2 "A finding belongs to a step" — every finding names its step and can
 *        take the author to that step, and the step list marks which steps are
 *        invalid without the author opening each one.
 *
 * The three tests below are deliberately DISTINCT exercises:
 *   TEST-2  (INV-2)   attribution is real, not hardcoded — TWO steps broken for
 *                     DIFFERENT reasons while a THIRD, VALID step is selected.
 *   TEST-18 (ITEM-1)  the owner's literal screenshot: an agent step with no task
 *                     shows a human sentence, and the raw wire vocabulary
 *                     ("prompt:" / "prompt_file") appears NOWHERE on the page.
 *   TEST-21 (ITEM-11) the gallery's validation fixture seeds REAL backend codes
 *                     and REAL backend messages — proven against the live
 *                     `POST /api/workflows/validate-def` for an equivalently
 *                     broken workflow. A fixture that flatters the product hides
 *                     the defect it was built to catch.
 */

/** The human copy `validationCopy.ts` maps each backend code onto. Asserted
 *  literally (not paraphrased) so a copy edit that re-introduces wire
 *  vocabulary fails here. */
const HUMAN = {
  agentPromptMissing:
    'This step needs a task description — say what the assistant should do.',
  toolNoServer: 'Choose the server this step should call.',
  toolNoTool: 'Choose the tool this step should call.',
} as const

test.describe('Workflows — builder validation attribution + humanisation', () => {
  test('TEST-2 — two steps broken for different reasons, a third valid step selected: findings name their step, the list marks exactly those two, and a finding navigates to ITS step', async ({
    page,
    testInfra,
  }) => {
    const { baseURL } = testInfra

    await loginAsAdmin(page, baseURL)
    await openNewBuilder(page, baseURL)

    // ── Fixture: THREE steps, only two of which are broken, broken DIFFERENTLY.
    // (A single-error fixture would pass even if attribution were hardcoded to
    // whatever step happened to be first / selected — hence three steps, two
    // distinct failure codes, and a third step that is genuinely VALID.)
    const agentId = await addStep(page, 'agent', 1) // agent_1 — no task ⇒ invalid
    await byTestId(page, 'wf-builder-step-description').fill('Research the topic')

    const toolId = await addStep(page, 'tool', 1) // tool_1 — no server + no tool ⇒ invalid
    await byTestId(page, 'wf-builder-step-description').fill('Call the search tool')

    const llmId = await addStep(page, 'llm', 1) // llm_1 — fully configured ⇒ VALID
    await byTestId(page, 'wf-builder-step-description').fill('Summarize the findings')
    await byTestId(page, 'wf-builder-llm-prompt').fill(
      'Write a short summary of what was found.',
    )

    // The VALID, UNRELATED step is the one selected — the owner's exact
    // situation (a finding about a different step, read while looking at this
    // one).
    await byTestId(page, `wf-builder-step-row-${llmId}`).click()
    await expect(
      byTestId(page, `wf-builder-step-row-${llmId}`),
    ).toHaveAttribute('data-selected', 'true')
    await expect(byTestId(page, 'wf-builder-step-config-kind')).toHaveText(
      'LLM prompt',
    )

    // ── §2.2 leg 1: the Validation section NAMES each broken step ────────────
    const validation = byTestId(page, 'wf-builder-validation')
    const errors = byTestId(page, 'wf-builder-errors')
    await expect(errors).toBeVisible({ timeout: 20000 })

    // Step titles: "Step <1-based index> · <label>" for each broken step.
    await expect(errors).toContainText('Step 1 · Research the topic', {
      timeout: 20000,
    })
    await expect(errors).toContainText('Step 2 · Call the search tool')
    // The VALID step is never named as broken.
    await expect(errors).not.toContainText('Step 3 · Summarize the findings')

    // …and each finding is HUMAN copy for THAT step's kind (§2.1): the agent
    // step asks for a task, the tool step for a server + a tool.
    await expect(errors).toContainText(HUMAN.agentPromptMissing)
    await expect(errors).toContainText(HUMAN.toolNoServer)
    await expect(errors).toContainText(HUMAN.toolNoTool)

    // Findings carry their step id, and none is attributed to the valid step.
    const agentFindings = page.locator(
      `[data-testid="wf-builder-finding"][data-step-id="${agentId}"]`,
    )
    const toolFindings = page.locator(
      `[data-testid="wf-builder-finding"][data-step-id="${toolId}"]`,
    )
    const llmFindings = page.locator(
      `[data-testid="wf-builder-finding"][data-step-id="${llmId}"]`,
    )
    await expect(agentFindings).toHaveCount(1)
    await expect(toolFindings).toHaveCount(2)
    await expect(llmFindings).toHaveCount(0)
    // The agent's single finding is the agent-flavoured sentence, not the
    // generic one — proving the copy is resolved against the finding's OWN step.
    await expect(agentFindings.first()).toContainText(HUMAN.agentPromptMissing)

    // ── §2.2 leg 2: the step list marks EXACTLY those two rows invalid ───────
    await expect(byTestId(page, `wf-builder-step-invalid-${agentId}`)).toBeVisible()
    await expect(byTestId(page, `wf-builder-step-invalid-${toolId}`)).toBeVisible()
    await expect(byTestId(page, `wf-builder-step-invalid-${llmId}`)).toHaveCount(0)
    await expect(byTestId(page, `wf-builder-step-warned-${llmId}`)).toHaveCount(0)
    // …and no OTHER row is marked (exactly two, repo-wide on this page).
    await expect(
      page.locator('[data-testid^="wf-builder-step-invalid-"]'),
    ).toHaveCount(2)
    // The per-step counts match the per-step findings (1 vs 2), so the badge is
    // derived from attribution rather than from "the workflow is invalid".
    await expect(byTestId(page, `wf-builder-step-invalid-${agentId}`)).toContainText(
      '1',
    )
    await expect(byTestId(page, `wf-builder-step-invalid-${toolId}`)).toContainText(
      '2',
    )

    // ── §2.2 leg 3: clicking a finding selects ITS step in the config panel ──
    // Every finding of a step carries the same goto testid (a step with two
    // problems renders two buttons, both pointing at that step), so target the
    // first one explicitly rather than relying on there being exactly one.
    // From the valid llm step, jump to the AGENT finding.
    await byTestId(page, `wf-builder-finding-goto-${agentId}`).first().click()
    await expect(byTestId(page, 'wf-builder-step-config-kind')).toHaveText(
      'AI assistant task',
    )
    await expect(
      byTestId(page, `wf-builder-step-row-${agentId}`),
    ).toHaveAttribute('data-selected', 'true')
    await expect(byTestId(page, `wf-builder-step-row-${llmId}`)).not.toHaveAttribute(
      'data-selected',
      'true',
    )

    // Now jump to the TOOL finding — a DIFFERENT step, proving the target is
    // read off the finding rather than being a fixed destination.
    await byTestId(page, `wf-builder-finding-goto-${toolId}`).first().click()
    await expect(byTestId(page, 'wf-builder-step-config-kind')).toHaveText(
      'Call a tool',
    )
    await expect(byTestId(page, `wf-builder-step-row-${toolId}`)).toHaveAttribute(
      'data-selected',
      'true',
    )
    await expect(
      byTestId(page, `wf-builder-step-row-${agentId}`),
    ).not.toHaveAttribute('data-selected', 'true')

    // The Validation section itself is still the surface all of this lives in.
    await expect(validation).toBeVisible()
  })

  test('TEST-18 — an agent step with no task shows a HUMAN sentence, and no raw wire vocabulary ("prompt:" / "prompt_file") appears anywhere on the page', async ({
    page,
    testInfra,
  }) => {
    const { baseURL } = testInfra

    await loginAsAdmin(page, baseURL)
    await openNewBuilder(page, baseURL)

    // The owner's literal screenshot: a single `agent` step, task left empty.
    // NOTE: nothing typed below may contain the strings under test — the page
    // text assertion would then be self-poisoned.
    const agentId = await addStep(page, 'agent', 1)
    await byTestId(page, 'wf-builder-step-description').fill('Research the topic')

    // The Validation section says what the PERSON must do…
    const errors = byTestId(page, 'wf-builder-errors')
    await expect(errors).toBeVisible({ timeout: 20000 })
    await expect(errors).toContainText(HUMAN.agentPromptMissing, {
      timeout: 20000,
    })
    // …attributed to the step it belongs to.
    await expect(
      page.locator(
        `[data-testid="wf-builder-finding"][data-step-id="${agentId}"]`,
      ),
    ).toHaveCount(1)

    // …and the backend's own wire vocabulary — the literal defect the owner
    // reported, "step has neither prompt: nor prompt_file:" — reaches the
    // rendered page NOWHERE (§2.1). Scoped to rendered text, so testids /
    // attributes / prop names are irrelevant; only what a person can READ.
    const bodyText = await page.locator('body').innerText()
    expect(
      bodyText,
      'raw wire vocabulary must never reach the author (DESIGN §2.1)',
    ).not.toMatch(/prompt_file|prompt:/i)
    // Positive control for the negative assertion above: the page text really
    // was captured and really does carry the humanised finding.
    expect(bodyText).toContain(HUMAN.agentPromptMissing)
  })

  test('TEST-21 — the gallery validation fixture seeds REAL backend codes and messages (proven against live POST /api/workflows/validate-def)', async ({
    page,
    request,
    testInfra,
  }) => {
    const { baseURL, apiURL } = testInfra

    await loginAsAdmin(page, baseURL)
    const token = await getAdminToken(apiURL)

    // ── The fixture, read from the gallery source ───────────────────────────
    const galleryPath = fileURLToPath(
      new URL('../../../src/modules/workflow/gallery.tsx', import.meta.url),
    )
    const gallerySrc = readFileSync(galleryPath, 'utf8')
    const start = gallerySrc.indexOf('const errorValidation')
    expect(
      start,
      'gallery.tsx must declare the `errorValidation` fixture',
    ).toBeGreaterThan(-1)
    const end = gallerySrc.indexOf('\n}\n', start)
    expect(end, 'the errorValidation literal must terminate').toBeGreaterThan(start)
    const fixtureBlock = gallerySrc.slice(start, end)

    // Each fixture finding declares `code` / `layer` / `location` in that order.
    const fixtureFindings = [
      ...fixtureBlock.matchAll(
        /code:\s*'([A-Z0-9_]+)',\s*\n\s*layer:\s*'([a-z]+)',\s*\n\s*location:\s*'([^']+)',/g,
      ),
    ].map(m => ({ code: m[1], layer: m[2], location: m[3] }))
    expect(
      fixtureFindings.length,
      'the gallery fixture must seed at least the three findings the builder surface is designed around',
    ).toBeGreaterThanOrEqual(3)

    // ── The same workflow, broken the same way, validated by the REAL backend.
    // Step ids mirror the fixture's locations exactly (`agent_1`, `tool_1`,
    // `summarize.prompt`) so a location mismatch is a real fixture defect and
    // not an artefact of this test naming things differently.
    const def = {
      steps: [
        {
          id: 'agent_1',
          kind: 'agent',
          // Empty task ⇒ WORKFLOW_PROMPT_MISSING. `json` output leaves the
          // shape unknown, which is what makes the field access below a
          // WARNING rather than an error.
          prompt: '',
          servers: [],
          max_steps: 30,
          output_format: 'json',
        },
        {
          id: 'tool_1',
          kind: 'tool',
          // Server set, tool empty ⇒ WORKFLOW_TOOL_NO_TOOL only (the fixture
          // does not claim a missing-server finding).
          server: 'e2e_placeholder_server',
          tool: '',
          arguments: {},
        },
        {
          id: 'summarize',
          kind: 'llm',
          prompt: 'Summarise {{ agent_1.output.title }}',
          output_format: 'text',
          depends_on: ['agent_1'],
        },
      ],
    }

    const resp = await request.post(`${apiURL}/api/workflows/validate-def`, {
      headers: { Authorization: `Bearer ${token}` },
      data: def,
    })
    expect(resp.status(), `validate-def: ${await resp.text()}`).toBe(200)
    const live = (await resp.json()) as {
      errors: { code: string; layer: string; location?: string; message: string }[]
      warnings: {
        code: string
        layer: string
        location?: string
        message: string
      }[]
    }
    const liveFindings = [...live.errors, ...live.warnings]
    expect(
      liveFindings.length,
      'the live backend must actually find this workflow broken',
    ).toBeGreaterThan(0)

    // The fixture's codes must be codes the presentation layer knows how to
    // humanise — a live code with no human copy is the ITEM-1 defect. Drive the
    // equivalent workflow through the real builder and assert the rendered
    // finding is HUMAN, and specifically is NOT the backend's own wire message.
    await openNewBuilder(page, baseURL)
    await addStep(page, 'agent', 1)
    const builderErrors = byTestId(page, 'wf-builder-errors')
    await expect(builderErrors).toBeVisible({ timeout: 20000 })
    await expect(builderErrors).toContainText(HUMAN.agentPromptMissing, {
      timeout: 20000,
    })
    const promptMissingMessage = liveFindings.find(
      f => f.code === 'WORKFLOW_PROMPT_MISSING',
    )?.message
    expect(
      promptMissingMessage,
      'the live backend must emit WORKFLOW_PROMPT_MISSING for an empty agent task',
    ).toBeTruthy()
    await expect(builderErrors).not.toContainText(promptMissingMessage as string)

    // ── Every triple the gallery CLAIMS is one the backend really emits ──────
    for (const fixture of fixtureFindings) {
      const match = liveFindings.find(
        f =>
          f.code === fixture.code &&
          f.layer === fixture.layer &&
          f.location === fixture.location,
      )
      expect(
        match,
        `gallery fixture seeds ${fixture.code} (layer '${fixture.layer}', location '${fixture.location}') — the live backend emitted: ${JSON.stringify(
          liveFindings.map(f => ({
            code: f.code,
            layer: f.layer,
            location: f.location,
          })),
        )}`,
      ).toBeTruthy()

      // …and the MESSAGE the gallery seeds is the backend's own verbatim
      // message, not humanised prose invented for the fixture. (Humanisation
      // is the builder's job at render time — a fixture that pre-humanises
      // hides exactly the defect a design pass is there to catch.)
      expect(
        fixtureBlock,
        `gallery fixture message for ${fixture.code} must be the backend's verbatim message`,
      ).toContain((match as { message: string }).message)
    }
  })
})
