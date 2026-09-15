/**
 * The reported defect, reproduced at the surface an operator actually touches.
 *
 * A server configured to run in the code sandbox was told:
 *
 *   Command 'Rscript' is not allowed on the host.
 *     Allowed commands: [npx, uvx, python, python3, node].
 *     Enable run-in-sandbox to use any command.
 *
 * i.e. enable a flag the row already had.
 *
 * Toggling Enabled in create mode fires an ephemeral connection test against the
 * form values. That test always probes on the HOST — the request type carries no
 * run-in-sandbox flag and `build_ephemeral_server` hardcodes it false — so for a
 * guest-only command it can only ever fail, with the host allowlist as the
 * reason and the switch snapping back off. The drawer must therefore not run it
 * for a row the operator has marked sandboxed. That is agreement with the
 * server, not a workaround: `enforce_on_create` skips the probe for such a row,
 * so a verdict gathered here would be discarded on save anyway.
 *
 * This is pinned at the UI because two independent blind audits found it still
 * reproducible after the backend was fixed — the second time after a fix that
 * was itself wrong. Backend coverage alone did not catch either.
 *
 * SCOPE NOTE: this drives the ADMIN (system) drawer, which owns the
 * run-in-sandbox toggle. The sharper variant — a USER creating stdio, where
 * policy force-sandboxes the row and the screen has NO toggle at all, making the
 * advice impossible rather than merely wrong — cannot be driven here: with
 * `code_sandbox` disabled (the test harness default) the user policy filters
 * `stdio` out of the transport options entirely
 * (`user_policy/repository.rs:41-51`), so the path is unreachable. Covering it
 * needs a code_sandbox-enabled deployment; recorded as a gap in TESTS.md rather
 * than left as a silently-skipping test.
 */

import { test, expect } from '../../fixtures/test-context'
import { loginAsAdmin } from '../../common/auth-helpers'
import { byTestId } from '../testid'
import { goToMcpAdminPage } from './helpers/navigation-helpers'
import { openAddServerDrawer } from './helpers/form-helpers'

/** The rejection whose appearance on a sandboxed row IS the bug. */
const HOST_ALLOWLIST = /is not allowed on the host/i
/** The advice to enable a flag the operator has already ticked. */
const ALREADY_TICKED_ADVICE = /Enable run-in-sandbox/i

test('system stdio create: enabling a sandboxed guest-only command does not host-probe or blame the sandbox flag', async ({
  page,
  testInfra,
}) => {
  const { baseURL } = testInfra

  await loginAsAdmin(page, baseURL)
  await goToMcpAdminPage(page, baseURL)
  await openAddServerDrawer(page, true)
  const drawer = byTestId(page, 'mcp-drawer-form')

  const name = `sandboxed-create-${Math.random().toString(36).slice(2, 8)}`
  await byTestId(drawer, 'mcp-drawer-display-name-input').fill(name)
  await byTestId(drawer, 'mcp-drawer-name-input').fill(name)

  await byTestId(drawer, 'mcp-drawer-transport-select').click()
  await byTestId(page, 'mcp-drawer-transport-select-opt-stdio').click()

  // `Rscript` is the reported command: not on the host allowlist, perfectly
  // runnable inside the sandbox.
  await byTestId(drawer, 'mcp-drawer-command-input').fill('Rscript')

  // Tick Run in sandbox — after which the old advice is asking the operator to
  // do what they have just done.
  const sandboxSwitch = byTestId(page, 'mcp-drawer-run-sandbox-switch')
  await expect(sandboxSwitch).toBeVisible()
  if ((await sandboxSwitch.getAttribute('aria-checked')) !== 'true') {
    await sandboxSwitch.click()
  }
  await expect(sandboxSwitch).toHaveAttribute('aria-checked', 'true')

  // Toggle Enabled OFF then ON. OFF is purely local; ON is what fires the probe.
  const enabledSwitch = byTestId(page, 'mcp-drawer-enabled-switch')
  await expect(enabledSwitch).toHaveAttribute('aria-checked', 'true')
  await enabledSwitch.click()
  await expect(enabledSwitch).toHaveAttribute('aria-checked', 'false')
  await enabledSwitch.click()

  // The switch must STAY on. A host probe of `Rscript` can only fail, and a
  // failure snaps it back off — so this single assertion distinguishes "did not
  // probe" from "probed and failed", which is the behaviour under test.
  await expect(enabledSwitch).toHaveAttribute('aria-checked', 'true', {
    timeout: 15_000,
  })

  // And neither message may appear anywhere on the page.
  await expect(page.locator('body')).not.toContainText(HOST_ALLOWLIST)
  await expect(page.locator('body')).not.toContainText(ALREADY_TICKED_ADVICE)
})
